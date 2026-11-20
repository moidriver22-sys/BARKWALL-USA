-- =====================================================================
-- ⚠️ SUPERADA por 20261114_walk_completion_hold.sql, que incluye todo su contenido
--    (columnas de Connect y trigger bw_profiles_guard). NO volver a ejecutar:
--    su versión de bw_profiles_guard es anterior. Se conserva solo como historial.
-- =====================================================================
-- Barkwalk USA · Migración 2026-11-13 · Stripe Connect (Express) para paseadores
-- Ejecutar completo en Supabase → SQL Editor. Idempotente, en una transacción.
-- Requiere haber aplicado antes 20261112_rls_lockdown.sql.
--
-- Modelo: "separate charges and transfers"
--   1. El cliente paga a la cuenta principal de Barkwalk (como hoy).
--   2. Al COMPLETAR cada paseo, /api/walker-payout transfiere la parte del paseador
--      a su cuenta conectada (Express). El resto queda en el saldo de Barkwalk,
--      que Stripe deposita en la cuenta bancaria configurada en el Dashboard (Truist).
-- Todas estas columnas las escribe SOLO el servidor (service_role).
-- =====================================================================
begin;

-- 1. PROFILES: cuenta conectada del paseador
alter table public.profiles
  add column if not exists stripe_account_id        text,
  add column if not exists stripe_details_submitted boolean not null default false,
  add column if not exists stripe_payouts_enabled   boolean not null default false,
  add column if not exists stripe_transfers_active  boolean not null default false,
  add column if not exists stripe_onboarded_at      timestamptz;
create unique index if not exists profiles_stripe_account_id_uniq
  on public.profiles (stripe_account_id) where stripe_account_id is not null;

-- 2. BOOKINGS: cargo de Stripe (origen de las transferencias)
alter table public.bookings
  add column if not exists stripe_charge_id text,
  add column if not exists transfer_group   text;

-- 3. WALK_REQUESTS: pago al paseador por cada día
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

-- 4. Guardia de profiles: además de id/role/is_admin/walker_status, nadie (salvo el servidor)
--    puede escribir las columnas de Stripe. Así un usuario no puede apuntar los pagos a otra cuenta.
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
  return new;
end $$;

-- En el INSERT de respaldo del registro tampoco se pueden fijar
drop policy if exists "profiles: own insert" on public.profiles;
create policy "profiles: own insert" on public.profiles for insert to authenticated
  with check (id::text = auth.uid()::text
              and role in ('client', 'walker')
              and not coalesce(is_admin, false)
              and coalesce(walker_status, 'pending') = 'pending'
              and stripe_account_id is null
              and not stripe_details_submitted and not stripe_payouts_enabled and not stripe_transfers_active);

-- (walk_requests: el trigger bw_walk_requests_guard ya impide que cliente o paseador
--  toquen columnas fuera de su lista, así que las walker_payout_* quedan protegidas.)

commit;
