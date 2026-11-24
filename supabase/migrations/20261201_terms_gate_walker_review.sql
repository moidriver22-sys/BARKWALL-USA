-- =====================================================================
-- Barkwalk USA · Migración 2026-11-24 · Aceptación obligatoria de Términos + revisión de postulaciones
--   1. Versiones vigentes: Términos para Clientes / Acuerdo para Paseadores 2026-11-24 (la ÚLTIMA de cada lista
--      es la vigente; las anteriores solo se aceptan para registros que ya estaban en curso).
--   2. private.bw_has_current_consent(): ¿la constancia (legal_consents) cubre las versiones vigentes?
--   3. public.bw_is_verified_walker() (la usan las políticas existentes, que NO cambian): ahora además exige
--      la aceptación vigente de Términos + Acuerdo para Paseadores. Sin eso, el paseador no ve ni acepta paseos.
--   4. Postulaciones: estado 'rejected' + historial public.walker_reviews (decisión, motivo, quién y cuándo).
--      admin_set_walker_status(target_id, new_status, reason) guarda la decisión y avisa al paseador.
-- No se modifica ningún trigger ni ninguna política RLS existente.
-- =====================================================================
begin;

-- 1. Versiones (también en api/_lib/terms.js e index.html)
create or replace function private.bw_consent_rules()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'min_age', 19,
    'terms', jsonb_build_array('2026-11-14', '2026-11-24'),
    'privacy', jsonb_build_array('2026-11-16'),
    'waiver', jsonb_build_array('2026-11-16'),
    'contractor', jsonb_build_array('2026-11-14', '2026-11-24'));
$$;

-- 2. Aceptación vigente (última versión de cada documento; Acuerdo para Paseadores solo para paseadores)
create or replace function private.bw_has_current_consent(p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  with r as (select private.bw_consent_rules() j),
       p as (select role from public.profiles where id = p_uid)
  select exists (
    select 1 from public.legal_consents lc, r, p
     where lc.user_id = p_uid
       and lc.terms_version   = (r.j -> 'terms')   ->> -1 and lc.terms_accepted_at   is not null
       and lc.privacy_version = (r.j -> 'privacy') ->> -1 and lc.privacy_accepted_at is not null
       and (p.role not in ('walker', 'shopper')
            or (lc.contractor_version = (r.j -> 'contractor') ->> -1 and lc.contractor_accepted_at is not null)))
$$;
revoke all on function private.bw_has_current_consent(uuid) from public, anon, authenticated;

-- 3. Paseador habilitado = verificado por Barkwalk + Términos/Acuerdo vigentes aceptados
create or replace function public.bw_is_verified_walker()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                 where p.id::text = auth.uid()::text
                   and p.role in ('walker', 'shopper')
                   and p.walker_status = 'verified')
     and private.bw_has_current_consent(auth.uid())
$$;

-- 4a. Estado 'rejected' (postulación no aprobada)
alter table public.profiles drop constraint if exists profiles_walker_status_check;
alter table public.profiles add constraint profiles_walker_status_check
  check (walker_status = any (array['pending', 'verified', 'suspended', 'rejected']));

-- 4b. Historial de decisiones (lo escribe solo admin_set_walker_status; el paseador ve las suyas)
create table if not exists public.walker_reviews (
  id          bigint generated always as identity primary key,
  walker_id   uuid not null references public.profiles(id) on delete cascade,
  status      text not null check (status in ('pending', 'verified', 'suspended', 'rejected')),
  reason      text check (reason is null or length(reason) <= 500),
  reviewed_by uuid,
  created_at  timestamptz not null default now(),
  notified_at timestamptz,
  notify_error text
);
create index if not exists walker_reviews_walker_idx on public.walker_reviews (walker_id, created_at desc);
create index if not exists walker_reviews_pending_notice_idx on public.walker_reviews (created_at) where notified_at is null;
alter table public.walker_reviews enable row level security;
revoke all on public.walker_reviews from anon;
revoke insert, update, delete, truncate on public.walker_reviews from authenticated;
grant select on public.walker_reviews to authenticated;
drop policy if exists "walker_reviews: walker reads own" on public.walker_reviews;
create policy "walker_reviews: walker reads own" on public.walker_reviews for select to authenticated using (walker_id = auth.uid());
drop policy if exists "walker_reviews: admin reads" on public.walker_reviews;
create policy "walker_reviews: admin reads" on public.walker_reviews for select to authenticated using (public.bw_is_admin());

-- 4c. Decisión del admin (con motivo) + aviso inmediato al paseador (pg_net; el cron de 10 min es el respaldo)
drop function if exists public.admin_set_walker_status(text, text);
create or replace function public.admin_set_walker_status(target_id text, new_status text, reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old text; v_reason text := nullif(btrim(coalesce(reason, '')), '');
begin
  if not public.bw_is_admin() then raise exception 'not admin' using errcode = '42501'; end if;
  if new_status not in ('pending', 'verified', 'suspended', 'rejected') then raise exception 'invalid status' using errcode = '22023'; end if;
  if new_status = 'rejected' and v_reason is null then raise exception 'reason required' using errcode = '22023'; end if;
  select walker_status into v_old from public.profiles where id::text = target_id and role in ('walker', 'shopper');
  if not found then raise exception 'walker not found' using errcode = '22023'; end if;
  update public.profiles set walker_status = new_status where id::text = target_id;
  if v_old is distinct from new_status then
    insert into public.walker_reviews (walker_id, status, reason, reviewed_by)
    values (target_id::uuid, new_status, left(v_reason, 500), auth.uid());
    if new_status in ('verified', 'rejected', 'suspended') then
      begin
        perform net.http_post(
          url := 'https://www.barkwalkusa.com/api/dispatch?action=walker_reviews',
          headers := jsonb_build_object('Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'barkwalk_cron_secret')),
          body := '{}'::jsonb, timeout_milliseconds := 30000);
      exception when others then null; -- nunca bloquea la decisión
      end;
    end if;
  end if;
end $$;
revoke all on function public.admin_set_walker_status(text, text, text) from public, anon;
grant execute on function public.admin_set_walker_status(text, text, text) to authenticated;

commit;
