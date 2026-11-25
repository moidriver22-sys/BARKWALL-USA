-- =====================================================================
-- Barkwalk USA · Migración 2026-11-24 · Foto OBLIGATORIA de entrega segura
--   1. Bucket PRIVADO 'delivery-photos' (JPEG/PNG/WEBP, máx. 5 MB): delivery-photos/<walk_id>/…
--      · sube SOLO el paseador asignado a ese paseo, y solo mientras está en curso (in_progress)
--      · ven el cliente y el paseador de ese paseo (y el admin), con URLs firmadas de corta duración
--      · sin UPDATE ni DELETE: la evidencia no se sobrescribe ni se borra desde la app
--   2. Trigger NUEVO bw_walk_requests_delivery_photo: nadie puede pasar un paseo a 'completed' sin una foto en
--      su carpeta subida DESPUÉS de iniciarlo. (El servidor con la clave de servicio queda exento, para soporte.)
-- No se modifica ningún trigger ni política existente: solo se AGREGAN el bucket, sus políticas y un trigger.
-- =====================================================================
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('delivery-photos', 'delivery-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "delivery-photos: assigned walker uploads during walk" on storage.objects;
create policy "delivery-photos: assigned walker uploads during walk" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'delivery-photos'
    and public.bw_is_assigned_walker((storage.foldername(name))[1])
    and exists (select 1 from public.walk_requests r where r.id::text = (storage.foldername(name))[1] and r.status = 'in_progress')
    and lower(storage.extension(name)) = any (array['jpg', 'jpeg', 'png', 'webp'])
  );
drop policy if exists "delivery-photos: participants or admin read" on storage.objects;
create policy "delivery-photos: participants or admin read" on storage.objects for select to authenticated
  using (bucket_id = 'delivery-photos'
         and (public.bw_is_walk_participant((storage.foldername(name))[1]) or public.bw_is_admin()));

-- ¿Hay foto de entrega de este paseo, subida después de iniciarlo?
create or replace function private.bw_has_delivery_photo(p_walk_id uuid, p_since timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from storage.objects o
                  where o.bucket_id = 'delivery-photos'
                    and (storage.foldername(o.name))[1] = p_walk_id::text
                    and o.created_at >= coalesce(p_since, '-infinity'::timestamptz))
$$;
revoke all on function private.bw_has_delivery_photo(uuid, timestamptz) from public, anon, authenticated;

create or replace function private.bw_require_delivery_photo()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'completed' and coalesce(old.status, 'pending') <> 'completed'
     and auth.uid() is not null                                   -- usuarios de la app (la clave de servicio queda exenta)
     and not private.bw_has_delivery_photo(new.id, old.started_at) then
    raise exception 'Falta la foto de entrega segura: tómala antes de completar el paseo. / Safe drop-off photo required before completing the walk.'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.bw_require_delivery_photo() from public, anon, authenticated;

drop trigger if exists bw_walk_requests_delivery_photo on public.walk_requests;
create trigger bw_walk_requests_delivery_photo
  before update of status on public.walk_requests
  for each row execute function private.bw_require_delivery_photo();

commit;
