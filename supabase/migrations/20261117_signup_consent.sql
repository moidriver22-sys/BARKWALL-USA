-- =====================================================================
-- Barkwalk USA · Migración 2026-11-17 · Consentimiento legal en el REGISTRO (Alabama)
-- Ejecutar COMPLETO en Supabase → SQL Editor. Idempotente.
-- REEMPLAZA a 20261116_terms_signup_guard.sql (si la ejecutaste, esta quita su trigger; si no, ya no hace falta).
--
-- Cómo funciona:
--   1. index.html envía el registro a /api/signup (servidor de Vercel), nunca directo a Supabase.
--   2. El servidor valida edad (19+, mayoría de edad en Alabama), Términos, Privacidad, exención de responsabilidad y, si es paseador,
--      el Acuerdo de Contratista Independiente; anota la IP REAL del usuario y su navegador en
--      private.bw_signup_intents (solo la clave service_role puede hacerlo) y obtiene un "nonce".
--   3. El servidor crea la cuenta en Supabase Auth con ese nonce en los metadatos.
--   4. El trigger de auth.users exige un nonce válido (mismo correo, < 30 min): sin él la cuenta NO se crea.
--      Así nadie puede registrarse saltándose la página ni falsear la IP o la fecha.
--   5. El trigger copia la constancia a public.legal_consents (solo lectura, no se puede editar ni borrar
--      desde la app) y a las columnas de public.profiles.
-- Excepción: cuentas creadas por el servidor con la API de administración y app_metadata.bw_admin_created = true.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 0. Quitar la guardia anterior (20261116), reemplazada por esta
-- ---------------------------------------------------------------------
drop trigger if exists bw_require_terms_on_signup on auth.users;
drop function if exists private.bw_require_terms_on_signup();

-- ---------------------------------------------------------------------
-- 1. Columnas de consentimiento en profiles (solo las lee el dueño y el admin: RLS de 20261112)
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists birth_date                       date,
  add column if not exists terms_version                    text,
  add column if not exists terms_accepted_at                timestamptz,
  add column if not exists privacy_accepted_at              timestamptz,
  add column if not exists contractor_agreement_accepted_at timestamptz,
  add column if not exists ip_address                       text;

-- ---------------------------------------------------------------------
-- 2. Constancia inmutable de cada aceptación
-- ---------------------------------------------------------------------
create table if not exists public.legal_consents (
  id                        bigint generated always as identity primary key,
  user_id                   uuid not null,                 -- sin FK: la constancia se conserva aunque se borre la cuenta
  role                      text not null check (role in ('client', 'walker')),
  email                     text not null,
  birth_date                date not null,
  ip_address                text not null,
  user_agent                text,
  terms_doc                 text not null,                 -- terminos-clientes | terminos-paseadores
  terms_version             text not null,
  terms_accepted_at         timestamptz not null,
  privacy_version           text not null,
  privacy_accepted_at       timestamptz not null,
  liability_waiver_version  text not null,
  contractor_version        text,                          -- solo paseadores
  contractor_accepted_at    timestamptz,
  created_at                timestamptz not null default now()
);
create index if not exists legal_consents_user_idx on public.legal_consents (user_id);

alter table public.legal_consents enable row level security;
revoke all on public.legal_consents from anon, authenticated;
grant select on public.legal_consents to authenticated;
drop policy if exists "legal_consents: own read" on public.legal_consents;
create policy "legal_consents: own read" on public.legal_consents for select to authenticated
  using (user_id::text = auth.uid()::text);
drop policy if exists "legal_consents: admin read" on public.legal_consents;
create policy "legal_consents: admin read" on public.legal_consents for select to authenticated
  using (public.bw_is_admin());
-- Sin políticas de INSERT/UPDATE/DELETE: desde la app nadie puede escribir ni borrar constancias.

-- ---------------------------------------------------------------------
-- 3. Intenciones de registro (las crea solo el servidor; caducan a los 30 min)
-- ---------------------------------------------------------------------
create table if not exists private.bw_signup_intents (
  nonce                     uuid primary key default gen_random_uuid(),
  email                     text not null,
  role                      text not null check (role in ('client', 'walker')),
  birth_date                date not null,
  ip_address                text not null,
  user_agent                text,
  terms_doc                 text not null,
  terms_version             text not null,
  terms_accepted_at         timestamptz not null,
  privacy_version           text not null,
  privacy_accepted_at       timestamptz not null,
  liability_waiver_version  text not null,
  contractor_version        text,
  contractor_accepted_at    timestamptz,
  created_at                timestamptz not null default now()
);
revoke all on private.bw_signup_intents from public, anon, authenticated;

-- Versiones vigentes y edad mínima (cámbialas aquí, en api/signup.js y en index.html a la vez)
create or replace function private.bw_consent_rules()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'min_age', 19,
    'terms', jsonb_build_array('2026-11-14'),
    'privacy', jsonb_build_array('2026-11-16'),
    'waiver', jsonb_build_array('2026-11-16'),
    'contractor', jsonb_build_array('2026-11-14'));
$$;

create or replace function public.bw_create_signup_intent(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  r      jsonb := private.bw_consent_rules();
  v_role text  := coalesce(p ->> 'role', '');
  v_bd   date;
  v_id   uuid;
begin
  delete from private.bw_signup_intents where created_at < now() - interval '1 day'; -- limpieza
  begin v_bd := (p ->> 'birth_date')::date; exception when others then v_bd := null; end;
  if v_role not in ('client', 'walker') then raise exception 'role inválido' using errcode = '22023'; end if;
  if coalesce(p ->> 'email', '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'email inválido' using errcode = '22023'; end if;
  if coalesce(p ->> 'ip_address', '') = '' then raise exception 'falta la IP' using errcode = '22023'; end if;
  if v_bd is null or v_bd < date '1900-01-01'
     or v_bd > (current_date - make_interval(years => (r ->> 'min_age')::int))::date then
    raise exception 'edad mínima no cumplida' using errcode = '22023';
  end if;
  if not (r -> 'terms') ? coalesce(p ->> 'terms_version', '') or not (r -> 'privacy') ? coalesce(p ->> 'privacy_version', '')
     or not (r -> 'waiver') ? coalesce(p ->> 'liability_waiver_version', '') then
    raise exception 'versión de documentos no vigente' using errcode = '22023';
  end if;
  if v_role = 'walker' and (not (r -> 'contractor') ? coalesce(p ->> 'contractor_version', '')
                            or coalesce(p ->> 'contractor_accepted_at', '') = '') then
    raise exception 'falta el Acuerdo de Contratista Independiente' using errcode = '22023';
  end if;

  insert into private.bw_signup_intents (email, role, birth_date, ip_address, user_agent, terms_doc, terms_version,
    terms_accepted_at, privacy_version, privacy_accepted_at, liability_waiver_version, contractor_version, contractor_accepted_at)
  values (lower(p ->> 'email'), v_role, v_bd, p ->> 'ip_address', left(p ->> 'user_agent', 500),
    case when v_role = 'walker' then 'terminos-paseadores' else 'terminos-clientes' end,
    p ->> 'terms_version', (p ->> 'terms_accepted_at')::timestamptz,
    p ->> 'privacy_version', (p ->> 'privacy_accepted_at')::timestamptz,
    p ->> 'liability_waiver_version',
    case when v_role = 'walker' then p ->> 'contractor_version' end,
    case when v_role = 'walker' then (p ->> 'contractor_accepted_at')::timestamptz end)
  returning nonce into v_id;
  return v_id;
end $$;
revoke all on function public.bw_create_signup_intent(jsonb) from public, anon, authenticated;
grant execute on function public.bw_create_signup_intent(jsonb) to service_role;

-- ---------------------------------------------------------------------
-- 4. Trigger en auth.users: sin constancia válida no hay cuenta
-- ---------------------------------------------------------------------
create or replace function private.bw_record_signup_consent()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_meta  jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_app   jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  v_nonce uuid;
  i       private.bw_signup_intents%rowtype;
begin
  if coalesce(v_app ->> 'bw_admin_created', '') = 'true' then return new; end if; -- alta hecha por el servidor
  if coalesce(v_app ->> 'provider', 'email') <> 'email' then return new; end if;    -- (la app solo usa correo)

  begin v_nonce := (v_meta ->> 'bw_signup_nonce')::uuid; exception when others then v_nonce := null; end;
  select * into i from private.bw_signup_intents
   where nonce = v_nonce and email = lower(new.email) and created_at > now() - interval '30 minutes'
   for update;
  if not found then
    raise exception 'Registro no válido: crea tu cuenta desde barkwalkusa.com aceptando los documentos legales. / Invalid signup: create your account at barkwalkusa.com and accept the legal documents.'
      using errcode = '42501';
  end if;
  if coalesce(v_meta ->> 'role', 'client') <> i.role then
    raise exception 'Registro no válido (rol). / Invalid signup (role).' using errcode = '42501';
  end if;

  insert into public.legal_consents (user_id, role, email, birth_date, ip_address, user_agent, terms_doc, terms_version,
    terms_accepted_at, privacy_version, privacy_accepted_at, liability_waiver_version, contractor_version, contractor_accepted_at)
  values (new.id, i.role, i.email, i.birth_date, i.ip_address, i.user_agent, i.terms_doc, i.terms_version,
    i.terms_accepted_at, i.privacy_version, i.privacy_accepted_at, i.liability_waiver_version, i.contractor_version, i.contractor_accepted_at);

  -- Si el perfil ya existe (otro trigger lo creó antes), completarlo; si no, lo completa bw_profiles_consent_fill
  update public.profiles set
    birth_date = i.birth_date, terms_version = i.terms_version, terms_accepted_at = i.terms_accepted_at,
    privacy_accepted_at = i.privacy_accepted_at, contractor_agreement_accepted_at = i.contractor_accepted_at,
    ip_address = i.ip_address
  where id = new.id;

  delete from private.bw_signup_intents where nonce = i.nonce;
  return new;
end $$;
revoke all on function private.bw_record_signup_consent() from public, anon, authenticated;

drop trigger if exists bw_record_signup_consent on auth.users;
create trigger bw_record_signup_consent after insert on auth.users
  for each row execute function private.bw_record_signup_consent();

-- ---------------------------------------------------------------------
-- 5. Al crearse el perfil (trigger del registro o respaldo desde la app), las columnas de
--    consentimiento salen SIEMPRE de legal_consents: nadie puede escribirlas a mano.
-- ---------------------------------------------------------------------
create or replace function private.bw_profiles_consent_fill()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c public.legal_consents%rowtype;
begin
  select * into c from public.legal_consents where user_id::text = new.id::text order by created_at desc limit 1;
  new.birth_date                       := c.birth_date;
  new.terms_version                    := c.terms_version;
  new.terms_accepted_at                := c.terms_accepted_at;
  new.privacy_accepted_at              := c.privacy_accepted_at;
  new.contractor_agreement_accepted_at := c.contractor_accepted_at;
  new.ip_address                       := c.ip_address;
  return new;
end $$;
revoke all on function private.bw_profiles_consent_fill() from public, anon, authenticated;

drop trigger if exists bw_profiles_consent_fill on public.profiles;
create trigger bw_profiles_consent_fill before insert on public.profiles
  for each row execute function private.bw_profiles_consent_fill();

-- ---------------------------------------------------------------------
-- 6. Guardia de profiles (reemplaza la de 20261115, idéntica + columnas de consentimiento)
-- ---------------------------------------------------------------------
create or replace function private.bw_profiles_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() = 'service_role' or auth.uid() is null then return new; end if; -- servidor / SQL Editor / Auth
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
  -- Consentimiento legal: solo lo escribe el registro (trigger), nunca la app
  if new.birth_date                          is distinct from old.birth_date
     or new.terms_version                    is distinct from old.terms_version
     or new.terms_accepted_at                is distinct from old.terms_accepted_at
     or new.privacy_accepted_at              is distinct from old.privacy_accepted_at
     or new.contractor_agreement_accepted_at is distinct from old.contractor_agreement_accepted_at
     or new.ip_address                       is distinct from old.ip_address then
    raise exception 'profiles: los datos de consentimiento no se pueden modificar' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists bw_profiles_guard on public.profiles;
create trigger bw_profiles_guard before update on public.profiles
  for each row execute function private.bw_profiles_guard();

commit;

-- Comprobación (ejecutar aparte): debe devolver 3 filas
-- select tgname from pg_trigger where tgname in ('bw_record_signup_consent', 'bw_profiles_consent_fill', 'bw_profiles_guard');
-- Y 0 filas (la guardia vieja ya no existe):
-- select tgname from pg_trigger where tgname = 'bw_require_terms_on_signup';
--
-- OJO: "Add user" del panel de Supabase queda bloqueado (no trae constancia). Para crear una cuenta a mano usa
-- la API de administración con app_metadata { bw_admin_created: true }.
