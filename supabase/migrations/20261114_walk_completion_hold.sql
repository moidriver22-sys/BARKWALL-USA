-- =====================================================================
-- Barkwalk USA · Migración 2026-11-14 · Blindaje del completado + retención de pagos (QA crítico 3)
-- Ejecutar COMPLETO en Supabase → SQL Editor (seleccionar todo el archivo). Idempotente, en una transacción.
-- Requiere 20261112_rls_lockdown.sql. Incluye (y repara) todo lo de 20261113_stripe_connect.sql.
--
-- Reglas (las aplica la base de datos; el navegador no las puede saltar):
--   1. Al pasar a 'in_progress' el servidor marca started_at; al completar, completed_at.
--   2. No se puede completar antes del 80 % de la duración contratada
--      (guardería: 6 h · nocturno: 8 h · duración desconocida: 15 min).
--   3. El pago al paseador se libera 48 h después del completado (payout_eligible_at), por el cron diario.
--   4. Queda RETENIDO para revisión del admin si no hubo ninguna señal GPS durante el paseo
--      o si el cliente reporta un problema dentro de las 48 h (report_walk_issue).
--   5. El admin libera una retención con admin_release_walk_payout(walk_id).
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 0. Columnas de Stripe Connect (reparación: la base quedó con una versión parcial)
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists stripe_account_id        text,
  add column if not exists stripe_details_submitted boolean not null default false,
  add column if not exists stripe_payouts_enabled   boolean not null default false,
  add column if not exists stripe_transfers_active  boolean not null default false,
  add column if not exists stripe_onboarded_at      timestamptz;
create unique index if not exists profiles_stripe_account_id_uniq
  on public.profiles (stripe_account_id) where stripe_account_id is not null;

alter table public.bookings
  add column if not exists stripe_charge_id text,
  add column if not exists transfer_group   text;

alter table public.walk_requests
  add column if not exists walker_payout_cents  int,
  add column if not exists walker_payout_status text not null default 'unpaid',
  add column if not exists walker_transfer_id   text,
  add column if not exists walker_paid_at       timestamptz,
  add column if not exists walker_payout_error  text;
alter table public.walk_requests drop constraint if exists walk_requests_walker_payout_status_check;
alter table public.walk_requests add constraint walk_requests_walker_payout_status_check
  check (walker_payout_status in ('unpaid', 'processing', 'paid', 'failed'));
create unique index if not exists walk_requests_walker_transfer_uniq
  on public.walk_requests (walker_transfer_id) where walker_transfer_id is not null;

-- ---------------------------------------------------------------------
-- 1. Columnas del completado y la retención
-- ---------------------------------------------------------------------
alter table public.walk_requests
  add column if not exists started_at             timestamptz,
  add column if not exists completed_at           timestamptz,
  add column if not exists payout_eligible_at     timestamptz,
  add column if not exists payout_review_required boolean not null default false,
  add column if not exists payout_review_reason   text,
  add column if not exists client_issue_at        timestamptz,
  add column if not exists client_issue_reason    text;
create index if not exists walk_requests_payout_due_idx on public.walk_requests (payout_eligible_at)
  where status = 'completed' and walker_transfer_id is null;

-- Paseos que ya estaban en curso al aplicar esto: inicio = última señal GPS (o ahora)
update public.walk_requests set started_at = coalesce(location_updated_at, now())
 where status = 'in_progress' and started_at is null;
-- Completados antes de esta migración y sin pagar: quedan para revisión del admin (nunca pago automático)
update public.walk_requests
   set completed_at = coalesce(completed_at, now()),
       payout_eligible_at = coalesce(payout_eligible_at, now()),
       payout_review_required = true,
       payout_review_reason = coalesce(payout_review_reason, 'completado antes del blindaje (2026-11-14)')
 where status = 'completed' and walker_transfer_id is null and payout_eligible_at is null;

-- ---------------------------------------------------------------------
-- 2. Parámetros
-- ---------------------------------------------------------------------
create or replace function private.bw_payout_hold()
returns interval language sql immutable as $$ select interval '48 hours' $$;

-- Minutos mínimos antes de poder completar: 80 % de la duración contratada
create or replace function private.bw_min_walk_minutes(p_duration text)
returns int language plpgsql immutable as $$
declare
  d text := lower(coalesce(p_duration, ''));
  n numeric;
begin
  if d ~ 'night|noche' then return 480; end if;            -- cuidado nocturno: 8 h
  if d ~ '\mday\M|d[ií]a' then return 360; end if;          -- guardería: 6 h
  n := nullif(substring(d from '(\d+(?:\.\d+)?)'), '')::numeric;
  if n is null then return 15; end if;
  if d ~ '\m(h|hr|hrs|hour|hours|hora|horas)\M' then n := n * 60; end if;
  return greatest(5, floor(n * 0.8))::int;
end $$;

-- ---------------------------------------------------------------------
-- 3. Guardia de walk_requests (reemplaza la de 20261112): columnas permitidas,
--    transiciones, tiempo mínimo y sellos de tiempo puestos por el servidor
-- ---------------------------------------------------------------------
create or replace function private.bw_walk_requests_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid   text := auth.uid()::text;
  o       jsonb := to_jsonb(old);
  n       jsonb := to_jsonb(new);
  v_old   text := coalesce(old.status, 'pending');
  v_new   text := coalesce(new.status, 'pending');
  v_admin boolean;
  v_min   int;
  v_mins  numeric;
  k       text;
  v_cols  text[];
begin
  if auth.role() = 'service_role' or auth.uid() is null then return new; end if; -- servidor / SQL Editor
  -- Funciones del servidor (report_walk_issue) que ya validaron permisos: solo dentro de su transacción
  if current_setting('bw.trusted_update', true) = 'on' then return new; end if;
  v_admin := public.bw_is_admin();

  if not v_admin then
    if old.walker_id::text = v_uid or (old.walker_id is null and new.walker_id::text = v_uid) then
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

    -- Tiempo mínimo real desde el inicio (lo marca el servidor, no el teléfono)
    if v_new = 'completed' and v_old <> 'completed' then
      if old.started_at is null then
        raise exception 'Primero marca el paseo como "en curso". / Start the walk first.' using errcode = '42501';
      end if;
      v_min  := private.bw_min_walk_minutes(old.duration);
      v_mins := extract(epoch from (now() - old.started_at)) / 60;
      if v_mins < v_min then
        raise exception 'Aún no puedes completar el paseo: faltan % min (mínimo % min). / You can''t complete this walk yet: % min left (minimum % min).',
          ceil(v_min - v_mins)::int, v_min, ceil(v_min - v_mins)::int, v_min using errcode = '42501';
      end if;
    end if;
  end if;

  -- Sellos de tiempo y retención del pago (también cuando lo cambia un admin)
  if v_new = 'in_progress' and v_old <> 'in_progress' then
    new.started_at := now();
  end if;
  if v_new = 'completed' and v_old <> 'completed' then
    new.completed_at := now();
    new.payout_eligible_at := now() + private.bw_payout_hold();
    if new.location_updated_at is null or old.started_at is null or new.location_updated_at < old.started_at then
      new.payout_review_required := true;
      new.payout_review_reason := 'sin señal GPS durante el paseo';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists bw_walk_requests_guard on public.walk_requests;
create trigger bw_walk_requests_guard before update on public.walk_requests
  for each row execute function private.bw_walk_requests_guard();

-- ---------------------------------------------------------------------
-- 4. Guardia de profiles (reemplaza versiones anteriores): columnas de Stripe solo desde el servidor
-- ---------------------------------------------------------------------
create or replace function private.bw_profiles_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() = 'service_role' or auth.uid() is null then return new; end if;
  if new.id is distinct from old.id or new.role is distinct from old.role
     or coalesce(new.is_admin, false) is distinct from coalesce(old.is_admin, false) then
    raise exception 'profiles: no puedes cambiar id, role ni is_admin' using errcode = '42501';
  end if;
  if new.walker_status is distinct from old.walker_status and not public.bw_is_admin() then
    raise exception 'profiles: solo un admin cambia walker_status' using errcode = '42501';
  end if;
  if new.stripe_account_id        is distinct from old.stripe_account_id
     or new.stripe_details_submitted is distinct from old.stripe_details_submitted
     or new.stripe_payouts_enabled   is distinct from old.stripe_payouts_enabled
     or new.stripe_transfers_active  is distinct from old.stripe_transfers_active
     or new.stripe_onboarded_at      is distinct from old.stripe_onboarded_at then
    raise exception 'profiles: las columnas de Stripe solo las escribe el servidor' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists bw_profiles_guard on public.profiles;
create trigger bw_profiles_guard before update on public.profiles
  for each row execute function private.bw_profiles_guard();

drop policy if exists "profiles: own insert" on public.profiles;
create policy "profiles: own insert" on public.profiles for insert to authenticated
  with check (id::text = auth.uid()::text
              and role in ('client', 'walker')
              and not coalesce(is_admin, false)
              and coalesce(walker_status, 'pending') = 'pending'
              and stripe_account_id is null
              and not stripe_details_submitted and not stripe_payouts_enabled and not stripe_transfers_active);

-- ---------------------------------------------------------------------
-- 5. Cliente: reportar un problema (retiene el pago para revisión)
-- ---------------------------------------------------------------------
create or replace function public.report_walk_issue(p_walk_id text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w record;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 500), '');
begin
  if auth.uid() is null then return jsonb_build_object('status', 'unauthorized'); end if;
  if v_reason is null then return jsonb_build_object('status', 'reason_required'); end if;
  select r.client_id, r.status, r.payout_eligible_at, r.walker_transfer_id, r.client_issue_at into w
    from public.walk_requests r where r.id::text = p_walk_id limit 1;
  if not found or w.client_id::text <> auth.uid()::text then return jsonb_build_object('status', 'not_found'); end if;
  if w.status <> 'completed' then return jsonb_build_object('status', 'not_completed'); end if;
  if w.client_issue_at is not null then return jsonb_build_object('status', 'already_reported'); end if;
  if w.walker_transfer_id is not null or (w.payout_eligible_at is not null and now() > w.payout_eligible_at) then
    return jsonb_build_object('status', 'window_closed'); -- pasadas 48 h: soporte por correo
  end if;
  perform set_config('bw.trusted_update', 'on', true);   -- true = solo esta transacción
  update public.walk_requests
     set client_issue_at = now(), client_issue_reason = v_reason,
         payout_review_required = true, payout_review_reason = 'reporte del cliente'
   where id::text = p_walk_id;
  perform set_config('bw.trusted_update', 'off', true);
  return jsonb_build_object('status', 'ok');
end $$;
revoke all on function public.report_walk_issue(text, text) from public, anon;
grant execute on function public.report_walk_issue(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Admin: liberar un pago retenido (el cron lo transfiere en su siguiente corrida)
-- ---------------------------------------------------------------------
create or replace function public.admin_release_walk_payout(p_walk_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.bw_is_admin() then raise exception 'not admin' using errcode = '42501'; end if;
  update public.walk_requests
     set payout_review_required = false,
         payout_review_reason = coalesce(payout_review_reason, '') || ' · liberado por admin ' || now()::text,
         payout_eligible_at = least(coalesce(payout_eligible_at, now()), now())
   where id::text = p_walk_id and status = 'completed' and walker_transfer_id is null;
end $$;
revoke all on function public.admin_release_walk_payout(text) from public, anon;
grant execute on function public.admin_release_walk_payout(text) to authenticated;

commit;

-- ---------------------------------------------------------------------
-- Comprobación (ejecutar aparte): debe devolver 2 triggers y 0 columnas faltantes
-- ---------------------------------------------------------------------
-- select tgrelid::regclass, tgname from pg_trigger where tgname in ('bw_profiles_guard', 'bw_walk_requests_guard');
-- select c from unnest(array['stripe_transfers_active','stripe_onboarded_at']) c
--   where not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = c)
-- union all
-- select c from unnest(array['walker_payout_cents','walker_transfer_id','walker_paid_at','walker_payout_error',
--                            'started_at','completed_at','payout_eligible_at','payout_review_required','client_issue_at']) c
--   where not exists (select 1 from information_schema.columns where table_name = 'walk_requests' and column_name = c);
