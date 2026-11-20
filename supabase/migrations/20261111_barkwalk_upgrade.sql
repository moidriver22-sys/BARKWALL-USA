-- =====================================================================
-- Barkwalk USA · Migración 2026-11-11
-- Ejecutar completo en Supabase → SQL Editor (es idempotente: se puede correr más de una vez).
--   1. bookings: reserva/pedido con varios días y varias mascotas (la crea /api/create-payment-intent)
--   2. walk_requests: un registro por día (lo crea /api/stripe-webhook al confirmarse el pago)
--   3. Fotos de mascotas: pets.dog_photo_url + bucket público "pet-photos"
--   4. Códigos de acceso CIFRADOS (pgcrypto + Vault); visibles solo al paseador asignado 1 h antes
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. BOOKINGS (pedido). Solo el servidor (service_role) escribe; el dueño y el admin leen.
-- ---------------------------------------------------------------------
create table if not exists public.bookings (
  id                          uuid primary key default gen_random_uuid(),
  client_id                   uuid not null references auth.users(id) on delete cascade,
  checkout_id                 uuid not null,
  status                      text not null default 'awaiting_payment'
                              check (status in ('awaiting_payment', 'paid', 'cancelled', 'amount_mismatch')),
  payment_status              text not null default 'pending' check (payment_status in ('pending', 'paid', 'refunded')),
  service_id                  text not null,
  variant_idx                 int  not null,
  service_label               text,
  grooming                    text[] not null default '{}',
  large_dog                   boolean not null default false,
  pets                        jsonb not null default '[]'::jsonb,   -- [{id, name, breed, notes, photo}]
  pets_count                  int  not null check (pets_count between 1 and 4),
  dates                       date[] not null,                     -- cada fecha = un servicio
  scheduled_time              time not null,                       -- hora local de Birmingham
  address                     text not null,
  notes                       text,
  lang                        text not null default 'es',
  pickup_lat                  double precision,
  pickup_lng                  double precision,
  per_day_cents               int  not null check (per_day_cents > 0),
  total_cents                 int  not null check (total_cents > 0),
  currency                    text not null default 'usd',
  quote                       jsonb,
  liability_accepted_at       timestamptz not null,
  liability_version           text,
  stripe_payment_intent_id    text unique,
  paid_at                     timestamptz,
  walks_created_at            timestamptz,
  confirmation_email_sent_at  timestamptz,
  created_at                  timestamptz not null default now(),
  unique (client_id, checkout_id)
);
alter table public.bookings enable row level security;
drop policy if exists "bookings: owner reads" on public.bookings;
create policy "bookings: owner reads" on public.bookings for select to authenticated
  using (client_id = auth.uid());
drop policy if exists "bookings: admin reads" on public.bookings;
create policy "bookings: admin reads" on public.bookings for select to authenticated
  using (exists (select 1 from public.profiles p where p.id::text = auth.uid()::text and coalesce(p.is_admin, false)));
revoke insert, update, delete on public.bookings from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. WALK_REQUESTS: un registro por día de servicio
-- ---------------------------------------------------------------------
alter table public.walk_requests
  add column if not exists booking_id             uuid references public.bookings(id) on delete set null,
  add column if not exists scheduled_date         date,
  add column if not exists scheduled_time         time,
  add column if not exists scheduled_at           timestamptz,
  add column if not exists pet_ids                jsonb,
  add column if not exists pets_count             int default 1,
  add column if not exists pet_photo_url          text,
  add column if not exists payment_status         text default 'pending',
  add column if not exists paid_at                timestamptz,
  add column if not exists payment_method         text,
  add column if not exists payment_ref            text,
  add column if not exists liability_accepted_at  timestamptz,
  add column if not exists special_notes          text;

-- Un mismo día no se crea dos veces aunque Stripe reenvíe el webhook
create unique index if not exists walk_requests_booking_day_uniq on public.walk_requests (booking_id, scheduled_date);
create index if not exists walk_requests_scheduled_at_idx on public.walk_requests (scheduled_at);

alter table public.walk_requests drop constraint if exists walk_requests_payment_method_check;
alter table public.walk_requests add constraint walk_requests_payment_method_check
  check (payment_method is null or payment_method in ('card', 'bank', 'applepay', 'paypal', 'cash'));

-- ---------------------------------------------------------------------
-- 3. FOTOS DE MASCOTAS
-- ---------------------------------------------------------------------
alter table public.pets add column if not exists dog_photo_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pet-photos', 'pet-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Cada usuario solo escribe dentro de su carpeta: pet-photos/<auth.uid()>/archivo.jpg
drop policy if exists "pet-photos: owner uploads" on storage.objects;
create policy "pet-photos: owner uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'pet-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "pet-photos: owner updates" on storage.objects;
create policy "pet-photos: owner updates" on storage.objects for update to authenticated
  using (bucket_id = 'pet-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "pet-photos: owner deletes" on storage.objects;
create policy "pet-photos: owner deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'pet-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- 4. CÓDIGOS DE ACCESO CIFRADOS
--    La clave vive en Supabase Vault (nunca en el navegador ni en el repositorio).
--    Los códigos se guardan con pgp_sym_encrypt; el texto plano se elimina.
-- ---------------------------------------------------------------------
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'base64'), 'home_access_key',
                           'Barkwalk: clave para cifrar los códigos de acceso de home_access')
where not exists (select 1 from vault.secrets where name = 'home_access_key');

create or replace function private.home_access_key()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'home_access_key' limit 1
$$;
revoke all on function private.home_access_key() from public, anon, authenticated;

alter table public.home_access
  add column if not exists access_code_enc bytea,
  add column if not exists alarm_code_enc  bytea;

-- Migra los códigos existentes y borra el texto plano (si las columnas antiguas todavía existen)
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'home_access' and column_name = 'access_code') then
    execute $m$
      update public.home_access set
        access_code_enc = case when nullif(trim(access_code), '') is null then access_code_enc
                               else extensions.pgp_sym_encrypt(access_code, private.home_access_key()) end,
        alarm_code_enc  = case when nullif(trim(alarm_code), '') is null then alarm_code_enc
                               else extensions.pgp_sym_encrypt(alarm_code, private.home_access_key()) end
    $m$;
    alter table public.home_access drop column access_code;
    alter table public.home_access drop column alarm_code;
  end if;
end $$;

-- Sin acceso directo a la tabla: todo pasa por las funciones de abajo
alter table public.home_access enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'home_access' loop
    execute format('drop policy %I on public.home_access', p.policyname);
  end loop;
end $$;
revoke all on public.home_access from anon, authenticated;

-- Dueño: guardar (cifra en el servidor)
create or replace function public.set_home_access(p_entry_method text, p_access_code text, p_alarm_code text, p_special_notes text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_key   text := private.home_access_key();
  v_code  text := nullif(left(trim(coalesce(p_access_code, '')), 300), '');
  v_alarm text := nullif(left(trim(coalesce(p_alarm_code, '')), 20), '');
  v_notes text := nullif(left(trim(coalesce(p_special_notes, '')), 500), '');
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if coalesce(p_entry_method, '') not in ('lockbox', 'smartlock', 'concierge') then
    raise exception 'invalid entry method' using errcode = '22023';
  end if;
  if v_key is null then raise exception 'encryption key missing in Vault' using errcode = 'P0001'; end if;
  update public.home_access set
    entry_method    = p_entry_method,
    access_code_enc = case when v_code  is null then null else extensions.pgp_sym_encrypt(v_code,  v_key) end,
    alarm_code_enc  = case when v_alarm is null then null else extensions.pgp_sym_encrypt(v_alarm, v_key) end,
    special_notes   = v_notes
  where client_id::text = v_uid::text;
  if not found then
    insert into public.home_access (client_id, entry_method, access_code_enc, alarm_code_enc, special_notes)
    values (v_uid,
            p_entry_method,
            case when v_code  is null then null else extensions.pgp_sym_encrypt(v_code,  v_key) end,
            case when v_alarm is null then null else extensions.pgp_sym_encrypt(v_alarm, v_key) end,
            v_notes);
  end if;
end $$;

-- Dueño: leer lo suyo (para editarlo)
create or replace function public.get_my_home_access()
returns table (entry_method text, access_code text, alarm_code text, special_notes text)
language sql stable security definer set search_path = '' as $$
  select h.entry_method,
         case when h.access_code_enc is null then null else extensions.pgp_sym_decrypt(h.access_code_enc, private.home_access_key()) end,
         case when h.alarm_code_enc  is null then null else extensions.pgp_sym_decrypt(h.alarm_code_enc,  private.home_access_key()) end,
         h.special_notes
  from public.home_access h
  where auth.uid() is not null and h.client_id::text = auth.uid()::text
  limit 1
$$;

-- Paseador: solo el ASIGNADO, con el paseo activo y desde 1 hora antes de la cita
create or replace function public.get_home_access_for_walk(p_walk_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  w       record;
  h       record;
  v_desde timestamptz;
begin
  if v_uid is null then return jsonb_build_object('status', 'unauthorized'); end if;
  select r.client_id, r.walker_id, r.status, r.scheduled_at into w
  from public.walk_requests r where r.id::text = p_walk_id limit 1;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if w.walker_id is null or w.walker_id::text <> v_uid::text then return jsonb_build_object('status', 'not_assigned'); end if;
  if w.status not in ('accepted', 'en_camino', 'in_progress') then return jsonb_build_object('status', 'not_active'); end if;
  -- Paseos programados: se revela 1 h antes. Paseos inmediatos (sin fecha): al estar activos.
  v_desde := coalesce(w.scheduled_at, now()) - interval '1 hour';
  if now() < v_desde then return jsonb_build_object('status', 'too_early', 'available_at', v_desde); end if;
  select * into h from public.home_access where client_id::text = w.client_id::text limit 1;
  if not found then return jsonb_build_object('status', 'none'); end if;
  return jsonb_build_object(
    'status', 'ok',
    'entry_method', h.entry_method,
    'access_code', case when h.access_code_enc is null then null else extensions.pgp_sym_decrypt(h.access_code_enc, private.home_access_key()) end,
    'alarm_code',  case when h.alarm_code_enc  is null then null else extensions.pgp_sym_decrypt(h.alarm_code_enc,  private.home_access_key()) end,
    'special_notes', h.special_notes);
end $$;

revoke all on function public.set_home_access(text, text, text, text) from public, anon;
revoke all on function public.get_my_home_access() from public, anon;
revoke all on function public.get_home_access_for_walk(text) from public, anon;
grant execute on function public.set_home_access(text, text, text, text) to authenticated;
grant execute on function public.get_my_home_access() to authenticated;
grant execute on function public.get_home_access_for_walk(text) to authenticated;

-- Comprobación rápida (debe devolver 0 filas con texto plano):
-- select column_name from information_schema.columns where table_name = 'home_access';
