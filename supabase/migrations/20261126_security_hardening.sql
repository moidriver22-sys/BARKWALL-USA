-- =====================================================================
-- Barkwalk USA · Paquete de seguridad y privacidad (auditoría del 2026-11-23)
-- ---------------------------------------------------------------------
-- Hallazgos corregidos:
--  1. pet_passports tenía la política "Acceso publico pet_passports" (rol anon, using true / check true):
--     CUALQUIERA sin iniciar sesión podía leer, crear, cambiar o borrar los pasaportes de salud de todos.
--  2. pets: "Authenticated view pets" (using true) → cualquier usuario con sesión leía todas las mascotas
--     (nombres, notas de cuidado, fotos). Ahora: dueño, admin, y el paseador SOLO de los perros de sus
--     paseos (asignados, o abiertos y pagados que puede aceptar si está verificado).
--  3. Permisos sobrantes: anon tenía INSERT/UPDATE/DELETE/TRUNCATE en pets, pet_passports y payment_methods,
--     y TRUNCATE en bookings (TRUNCATE no pasa por RLS). Se retiran; authenticated conserva solo lo que la app usa.
--  4. Storage walk-photos: cualquier usuario con sesión podía subir cualquier archivo en cualquier carpeta.
--     Ahora solo el paseador asignado, en la carpeta de SU paseo (<walk_id>/…) y solo imágenes.
--  5. Límite de peticiones persistente para /api (tabla privada + public.bw_rate_hit, solo service_role).
-- Privacidad de ubicación (sin cambios necesarios, verificado): la ubicación en vivo de walk_requests
-- (latitude/longitude/lat/lng/location_updated_at) solo la escribe el paseador asignado (trigger
-- bw_walk_requests_guard); el cliente solo puede cambiar 'status'. La ubicación del dueño NO se guarda
-- nunca: el paseador solo recibe la dirección de recogida acordada (pickup_address / pickup_latitude/longitude,
-- geocodificada desde la dirección escrita en la reserva).
-- Solo cambia permisos/políticas; no toca datos. Se puede ejecutar más de una vez.
-- =====================================================================

-- ---------- 1. pet_passports ----------
drop policy if exists "Acceso publico pet_passports" on public.pet_passports;
revoke all on public.pet_passports from anon;
revoke truncate, references, trigger on public.pet_passports from authenticated;

-- ---------- 2. pets ----------
drop policy if exists "Authenticated view pets" on public.pets;
drop policy if exists "pets: owner, admin and walkers of its walks read" on public.pets;
create policy "pets: owner, admin and walkers of its walks read" on public.pets for select to authenticated
using (
  owner_id = auth.uid()
  or public.bw_is_admin()
  or exists (
    -- RLS de walk_requests se aplica aquí: el paseador solo "ve" sus paseos y los abiertos pagados
    select 1 from public.walk_requests wr
     where wr.client_id = pets.owner_id
       and (wr.walker_id = auth.uid() or (wr.walker_id is null and coalesce(wr.status, 'pending') = 'pending'))
       and (wr.pet_id = pets.id
            or coalesce(wr.pet_ids, '[]'::jsonb) ? pets.id::text
            or wr.pet_name = pets.name)
  )
);
revoke all on public.pets from anon;
revoke truncate, references, trigger on public.pets from authenticated;

-- ---------- 3. payment_methods y bookings ----------
revoke all on public.payment_methods from anon;
revoke truncate, references, trigger on public.payment_methods from authenticated;
revoke all on public.bookings from anon;
revoke truncate, references, trigger on public.bookings from authenticated;

-- ---------- 4. Storage: fotos del paseo ----------
drop policy if exists "Authenticated Upload" on storage.objects;
drop policy if exists "walk-photos: assigned walker uploads" on storage.objects;
create policy "walk-photos: assigned walker uploads" on storage.objects for insert to authenticated
with check (
  bucket_id = 'walk-photos'
  and public.bw_is_assigned_walker((storage.foldername(name))[1])
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp', 'heic')
);

-- ---------- 5. Límite de peticiones (para api/_lib/rate-limit.js) ----------
create schema if not exists private;
create table if not exists private.bw_rate_hits (
  key          text        not null,
  window_start timestamptz not null,
  hits         int         not null default 0,
  primary key (key, window_start)
);
revoke all on private.bw_rate_hits from public, anon, authenticated;

-- Ventana fija: devuelve true si la petición está permitida (y la cuenta), false si superó el máximo
create or replace function public.bw_rate_hit(p_key text, p_window_seconds int, p_max int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / greatest(p_window_seconds, 1)) * greatest(p_window_seconds, 1));
  v_hits int;
begin
  insert into private.bw_rate_hits as h (key, window_start, hits) values (left(p_key, 250), v_start, 1)
  on conflict (key, window_start) do update set hits = h.hits + 1
  returning hits into v_hits;
  if random() < 0.01 then delete from private.bw_rate_hits where window_start < now() - interval '2 days'; end if;
  return v_hits <= p_max;
end $$;
revoke all on function public.bw_rate_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.bw_rate_hit(text, int, int) to service_role;

-- Verificación:
-- select polname from pg_policy where polrelid = 'public.pet_passports'::regclass;   -- sin "Acceso publico"
-- select grantee, privilege_type from information_schema.role_table_grants where table_name = 'pets' and grantee = 'anon';  -- vacío
-- select public.bw_rate_hit('test:x', 60, 2), public.bw_rate_hit('test:x', 60, 2), public.bw_rate_hit('test:x', 60, 2);  -- t, t, f
