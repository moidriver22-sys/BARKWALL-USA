-- =====================================================================
-- Barkwalk USA · Migración 2026-11-15 · Membresías recurrentes (Stripe Billing)
-- Ejecutar COMPLETO en Supabase → SQL Editor. Idempotente, en una transacción.
-- Requiere 20261112_rls_lockdown.sql y 20261114_walk_completion_hold.sql.
--
--   · Barkwalk Club (dueño, $12.99/mes): 10 % de descuento en sus reservas.
--   · Socio Pro (paseador, $19.99/mes): 80 % por paseo (en vez de 75 %) e insignia "Pro".
--   · Beneficios activos solo con membership_status 'active' o 'trialing'.
--   · Las columnas de membresía las escribe SOLO el servidor (webhook de Stripe / service_role).
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Columnas
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists membership_tier               text not null default 'free',
  add column if not exists membership_status             text not null default 'inactive',
  add column if not exists stripe_customer_id            text,
  add column if not exists stripe_subscription_id        text,
  add column if not exists membership_current_period_end timestamptz;
alter table public.profiles drop constraint if exists profiles_membership_tier_check;
alter table public.profiles add constraint profiles_membership_tier_check
  check (membership_tier in ('free', 'club', 'walker_pro'));
alter table public.profiles drop constraint if exists profiles_membership_status_check;
alter table public.profiles add constraint profiles_membership_status_check
  check (membership_status in ('inactive', 'incomplete', 'incomplete_expired', 'trialing', 'active',
                               'past_due', 'unpaid', 'canceled', 'paused'));
create unique index if not exists profiles_stripe_customer_id_uniq
  on public.profiles (stripe_customer_id) where stripe_customer_id is not null;
create unique index if not exists profiles_stripe_subscription_id_uniq
  on public.profiles (stripe_subscription_id) where stripe_subscription_id is not null;

-- Precio de lista por día (sin descuento): base del pago al paseador
alter table public.bookings
  add column if not exists per_day_list_cents  int,
  add column if not exists member_discount_pct int not null default 0;

-- Insignia "Pro" del paseador asignado (la fija el servidor al aceptar; el cliente no lee profiles ajenos)
alter table public.walk_requests
  add column if not exists walker_is_pro boolean not null default false;

-- ---------------------------------------------------------------------
-- 2. Helper: ¿este usuario es paseador Pro activo?
-- ---------------------------------------------------------------------
create or replace function private.bw_is_pro_walker(p_user text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                 where p.id::text = p_user
                   and p.role in ('walker', 'shopper')
                   and p.membership_tier = 'walker_pro'
                   and p.membership_status in ('active', 'trialing'))
$$;
revoke all on function private.bw_is_pro_walker(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Guardia de profiles (reemplaza la de 20261114): + columnas de membresía
-- ---------------------------------------------------------------------
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
  if new.stripe_account_id        is distinct from old.stripe_account_id
     or new.stripe_details_submitted is distinct from old.stripe_details_submitted
     or new.stripe_payouts_enabled   is distinct from old.stripe_payouts_enabled
     or new.stripe_transfers_active  is distinct from old.stripe_transfers_active
     or new.stripe_onboarded_at      is distinct from old.stripe_onboarded_at then
    raise exception 'profiles: las columnas de Stripe solo las escribe el servidor' using errcode = '42501';
  end if;
  -- Membresía: ni el usuario ni un admin desde el navegador (solo el webhook de Stripe)
  if new.membership_tier                  is distinct from old.membership_tier
     or new.membership_status             is distinct from old.membership_status
     or new.stripe_customer_id            is distinct from old.stripe_customer_id
     or new.stripe_subscription_id        is distinct from old.stripe_subscription_id
     or new.membership_current_period_end is distinct from old.membership_current_period_end then
    raise exception 'profiles: la membresía solo la actualiza Stripe' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists bw_profiles_guard on public.profiles;
create trigger bw_profiles_guard before update on public.profiles
  for each row execute function private.bw_profiles_guard();

-- INSERT de respaldo del registro: siempre sin membresía ni ids de Stripe
drop policy if exists "profiles: own insert" on public.profiles;
create policy "profiles: own insert" on public.profiles for insert to authenticated
  with check (id::text = auth.uid()::text
              and role in ('client', 'walker')
              and not coalesce(is_admin, false)
              and coalesce(walker_status, 'pending') = 'pending'
              and stripe_account_id is null
              and not stripe_details_submitted and not stripe_payouts_enabled and not stripe_transfers_active
              and membership_tier = 'free' and membership_status = 'inactive'
              and stripe_customer_id is null and stripe_subscription_id is null
              and membership_current_period_end is null);

-- ---------------------------------------------------------------------
-- 4. Guardia de walk_requests (reemplaza la de 20261114, idéntica + walker_is_pro al aceptar)
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

  -- Insignia Pro del paseador que acepta (la decide la base, no el teléfono)
  if v_new = 'accepted' and v_old <> 'accepted' and new.walker_id is not null then
    new.walker_is_pro := private.bw_is_pro_walker(new.walker_id::text);
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

commit;

-- ---------------------------------------------------------------------
-- Comprobación (ejecutar aparte): 5 columnas en profiles, 2 en bookings, 1 en walk_requests, 2 triggers
-- ---------------------------------------------------------------------
-- select table_name, column_name from information_schema.columns
--  where table_schema = 'public' and column_name in ('membership_tier','membership_status','stripe_customer_id',
--        'stripe_subscription_id','membership_current_period_end','per_day_list_cents','member_discount_pct','walker_is_pro')
--  order by 1, 2;
-- select tgrelid::regclass, tgname from pg_trigger where tgname in ('bw_profiles_guard', 'bw_walk_requests_guard');
