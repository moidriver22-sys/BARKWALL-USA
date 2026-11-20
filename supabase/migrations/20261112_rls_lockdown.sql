-- =====================================================================
-- Barkwalk USA · Migración 2026-11-12 · RLS (QA Punto 3)
-- Ejecutar completo en Supabase → SQL Editor. Es idempotente y va en una transacción.
--
-- Antes de esta migración, la clave pública (anon) podía leer TODAS las filas de
-- walk_requests, profiles, walk_messages y walk_reports.
--
-- Después:
--   · anon: sin ningún acceso a estas 4 tablas.
--   · Cliente: lee/edita solo lo suyo. En walk_requests solo puede CANCELAR (pending/accepted).
--   · Paseador VERIFICADO: ve sus paseos asignados + solicitudes abiertas YA PAGADAS;
--     puede aceptarlas y avanzar el estado / GPS de las suyas. No toca precio ni pago.
--   · Admin (profiles.is_admin): lee todo y puede cambiar walker_status.
--   · Servidor (service_role: /api/*): sin cambios, RLS no le aplica.
--   · Los triggers impiden que un usuario cambie columnas que no le corresponden
--     (role, is_admin, walker_status, total_price, payment_status, client_id…).
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 0. Funciones auxiliares (security definer: leen profiles sin recursión de RLS)
-- ---------------------------------------------------------------------
create or replace function public.bw_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                 where p.id::text = auth.uid()::text and coalesce(p.is_admin, false))
$$;

create or replace function public.bw_is_verified_walker()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                 where p.id::text = auth.uid()::text
                   and p.role in ('walker', 'shopper')
                   and p.walker_status = 'verified')
$$;

-- ¿El usuario actual es el cliente o el paseador asignado de este paseo?
create or replace function public.bw_is_walk_participant(p_walk_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.walk_requests r
                 where r.id::text = p_walk_id
                   and auth.uid() is not null
                   and (r.client_id::text = auth.uid()::text or r.walker_id::text = auth.uid()::text))
$$;

create or replace function public.bw_is_assigned_walker(p_walk_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.walk_requests r
                 where r.id::text = p_walk_id
                   and auth.uid() is not null
                   and r.walker_id::text = auth.uid()::text)
$$;

revoke all on function public.bw_is_admin(), public.bw_is_verified_walker(),
                       public.bw_is_walk_participant(text), public.bw_is_assigned_walker(text) from public, anon;
grant execute on function public.bw_is_admin(), public.bw_is_verified_walker(),
                          public.bw_is_walk_participant(text), public.bw_is_assigned_walker(text) to authenticated;

-- Borra TODAS las políticas existentes de una tabla (las antiguas eran las que abrían el acceso)
create or replace function private.bw_drop_policies(p_table text)
returns void language plpgsql as $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = p_table loop
    execute format('drop policy %I on public.%I', p.policyname, p_table);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 1. PROFILES
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
select private.bw_drop_policies('profiles');
revoke all on public.profiles from anon;
revoke all on public.profiles from authenticated;
grant select, insert, update on public.profiles to authenticated;

create policy "profiles: own read" on public.profiles for select to authenticated
  using (id::text = auth.uid()::text);
create policy "profiles: admin read" on public.profiles for select to authenticated
  using (public.bw_is_admin());
-- Respaldo del registro (si el trigger handle_new_user no creó el perfil): solo cliente/paseador, nunca admin
create policy "profiles: own insert" on public.profiles for insert to authenticated
  with check (id::text = auth.uid()::text
              and role in ('client', 'walker')
              and not coalesce(is_admin, false)
              and coalesce(walker_status, 'pending') = 'pending');
create policy "profiles: own update" on public.profiles for update to authenticated
  using (id::text = auth.uid()::text) with check (id::text = auth.uid()::text);
create policy "profiles: admin update" on public.profiles for update to authenticated
  using (public.bw_is_admin()) with check (true);

-- Nadie (salvo service_role) cambia id/role/is_admin; walker_status solo el admin
create or replace function private.bw_profiles_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() = 'service_role' or auth.uid() is null then return new; end if; -- servidor / SQL Editor
  if new.id is distinct from old.id or new.role is distinct from old.role
     or coalesce(new.is_admin, false) is distinct from coalesce(old.is_admin, false) then
    raise exception 'profiles: no puedes cambiar id, role ni is_admin' using errcode = '42501';
  end if;
  if new.walker_status is distinct from old.walker_status and not public.bw_is_admin() then
    raise exception 'profiles: solo un admin cambia walker_status' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists bw_profiles_guard on public.profiles;
create trigger bw_profiles_guard before update on public.profiles
  for each row execute function private.bw_profiles_guard();

-- RPC que ya usa el panel de admin (index.html → admin_set_walker_status)
create or replace function public.admin_set_walker_status(target_id text, new_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.bw_is_admin() then raise exception 'not admin' using errcode = '42501'; end if;
  if new_status not in ('pending', 'verified', 'suspended') then raise exception 'invalid status' using errcode = '22023'; end if;
  update public.profiles set walker_status = new_status where id::text = target_id;
end $$;
revoke all on function public.admin_set_walker_status(text, text) from public, anon;
grant execute on function public.admin_set_walker_status(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. WALK_REQUESTS
-- ---------------------------------------------------------------------
alter table public.walk_requests enable row level security;
select private.bw_drop_policies('walk_requests');
revoke all on public.walk_requests from anon;
revoke all on public.walk_requests from authenticated;
grant select, update on public.walk_requests to authenticated;   -- INSERT/DELETE: solo el servidor (webhook de Stripe)

create policy "walk_requests: client reads own" on public.walk_requests for select to authenticated
  using (client_id::text = auth.uid()::text);
create policy "walk_requests: walker reads assigned" on public.walk_requests for select to authenticated
  using (walker_id::text = auth.uid()::text);
-- Solicitudes abiertas: solo pagadas, sin paseador, y solo para paseadores verificados
create policy "walk_requests: verified walker reads open" on public.walk_requests for select to authenticated
  using (walker_id is null and coalesce(status, 'pending') = 'pending'
         and payment_status = 'paid' and public.bw_is_verified_walker());
create policy "walk_requests: admin reads all" on public.walk_requests for select to authenticated
  using (public.bw_is_admin());

create policy "walk_requests: client updates own" on public.walk_requests for update to authenticated
  using (client_id::text = auth.uid()::text) with check (client_id::text = auth.uid()::text);
create policy "walk_requests: walker accepts open" on public.walk_requests for update to authenticated
  using (walker_id is null and coalesce(status, 'pending') = 'pending'
         and payment_status = 'paid' and public.bw_is_verified_walker())
  with check (walker_id::text = auth.uid()::text and status = 'accepted');
create policy "walk_requests: walker updates assigned" on public.walk_requests for update to authenticated
  using (walker_id::text = auth.uid()::text) with check (walker_id::text = auth.uid()::text);

-- Qué columnas y transiciones de estado puede tocar cada quien
create or replace function private.bw_walk_requests_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid  text := auth.uid()::text;
  o      jsonb := to_jsonb(old);
  n      jsonb := to_jsonb(new);
  v_old  text := coalesce(old.status, 'pending');
  v_new  text := coalesce(new.status, 'pending');
  k      text;
  v_cols text[];
begin
  if auth.role() = 'service_role' or auth.uid() is null then return new; end if; -- servidor / SQL Editor
  if public.bw_is_admin() then return new; end if;

  if old.walker_id::text = v_uid or (old.walker_id is null and new.walker_id::text = v_uid) then
    -- Paseador: estado, asignación y GPS
    v_cols := array['status', 'walker_id', 'latitude', 'longitude', 'lat', 'lng', 'location_updated_at', 'destination_photo'];
    if v_new <> v_old and not (
         (v_old = 'pending'     and v_new = 'accepted')
      or (v_old = 'accepted'    and v_new in ('en_camino', 'cancelled'))
      or (v_old = 'en_camino'   and v_new in ('in_progress', 'cancelled'))
      or (v_old = 'in_progress' and v_new in ('completed', 'cancelled'))) then
      raise exception 'walk_requests: transición no permitida (% → %)', v_old, v_new using errcode = '42501';
    end if;
    if old.walker_id is not null and new.walker_id is distinct from old.walker_id then
      raise exception 'walk_requests: no puedes reasignar el paseo' using errcode = '42501';
    end if;
  elsif old.client_id::text = v_uid then
    -- Cliente: solo cancelar antes de que salgan a recogerlo
    v_cols := array['status'];
    if v_new <> v_old and not (v_old in ('pending', 'accepted') and v_new = 'cancelled') then
      raise exception 'walk_requests: solo puedes cancelar un paseo pendiente o aceptado' using errcode = '42501';
    end if;
  else
    raise exception 'walk_requests: sin permiso' using errcode = '42501';
  end if;

  for k in select jsonb_object_keys(n) loop
    if not (k = any(v_cols)) and (n -> k) is distinct from (o -> k) then
      raise exception 'walk_requests: no puedes modificar la columna %', k using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists bw_walk_requests_guard on public.walk_requests;
create trigger bw_walk_requests_guard before update on public.walk_requests
  for each row execute function private.bw_walk_requests_guard();

-- Mapa de demanda del paseador: solo puntos aproximados (~1 km), sin nombres ni direcciones
create or replace function public.walker_demand_points(p_days int default 30)
returns table (lat double precision, lng double precision, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select round(r.pickup_latitude::numeric, 2)::double precision,
         round(r.pickup_longitude::numeric, 2)::double precision,
         date_trunc('hour', r.created_at)
  from public.walk_requests r
  where (public.bw_is_verified_walker() or public.bw_is_admin())
    and r.pickup_latitude is not null and r.pickup_longitude is not null
    and r.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90))
  limit 1000
$$;
revoke all on function public.walker_demand_points(int) from public, anon;
grant execute on function public.walker_demand_points(int) to authenticated;

-- ---------------------------------------------------------------------
-- 3. WALK_MESSAGES (chat del paseo)
-- ---------------------------------------------------------------------
alter table public.walk_messages enable row level security;
select private.bw_drop_policies('walk_messages');
revoke all on public.walk_messages from anon;
revoke all on public.walk_messages from authenticated;
grant select, insert on public.walk_messages to authenticated;   -- sin UPDATE/DELETE

create policy "walk_messages: participants read" on public.walk_messages for select to authenticated
  using (public.bw_is_walk_participant(walk_id::text) or public.bw_is_admin());
create policy "walk_messages: participants write as self" on public.walk_messages for insert to authenticated
  with check (sender::text = auth.uid()::text and public.bw_is_walk_participant(walk_id::text));

-- ---------------------------------------------------------------------
-- 4. WALK_REPORTS (reporte final del paseo)
-- ---------------------------------------------------------------------
alter table public.walk_reports enable row level security;
select private.bw_drop_policies('walk_reports');
revoke all on public.walk_reports from anon;
revoke all on public.walk_reports from authenticated;
grant select, insert on public.walk_reports to authenticated;    -- sin UPDATE/DELETE

create policy "walk_reports: participants read" on public.walk_reports for select to authenticated
  using (public.bw_is_walk_participant(walk_id::text) or public.bw_is_admin());
create policy "walk_reports: assigned walker writes" on public.walk_reports for insert to authenticated
  with check (public.bw_is_assigned_walker(walk_id::text));

drop function private.bw_drop_policies(text);
commit;

-- ---------------------------------------------------------------------
-- Comprobación (ejecutar aparte): todas deben salir con rls = true y sin políticas para anon/public
-- ---------------------------------------------------------------------
-- select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public' and c.relname in ('walk_requests','profiles','walk_messages','walk_reports');
-- select tablename, policyname, roles, cmd from pg_policies
--  where schemaname = 'public' and tablename in ('walk_requests','profiles','walk_messages','walk_reports')
--  order by 1, 2;
