-- =====================================================================
-- Barkwalk USA · Migración 2026-11-24 · Identidad del paseador (ID vigente + selfie) y agente auditor
--   1. Bucket PRIVADO 'walker-docs' (JPEG/PNG/WEBP, máx. 5 MB). Cada paseador sube solo a su carpeta
--      (<uid>/…); lo ven únicamente él y el admin (URLs firmadas de corta duración). Sin UPDATE ni DELETE:
--      la evidencia nunca se sobrescribe; un reenvío usa archivos nuevos.
--   2. public.walker_applications: una fila por ENVÍO (historial completo). La escribe solo el servidor
--      (/api/signup action=walker_application) y el agente guarda su reporte (agent_report). Nunca aprueba.
--   3. admin_set_walker_status: aprobar exige una postulación enviada con ID vigente y Términos vigentes;
--      marca la postulación como aprobada/rechazada y deja la decisión en walker_reviews.
--   4. bw_is_verified_walker(): además exige una postulación APROBADA con ID no vencido.
-- No se modifica ningún trigger ni ninguna política RLS existente (solo se AGREGAN políticas del bucket nuevo).
-- =====================================================================
begin;

-- 0. Versiones vigentes: Términos/Acuerdo 2026-11-24.2 y Privacidad 2026-11-24 (añaden ID + selfie del paseador).
--    La ÚLTIMA de cada lista es la vigente: todos vuelven a aceptar en el bloqueo de la app.
create or replace function private.bw_consent_rules()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'min_age', 19,
    'terms', jsonb_build_array('2026-11-14', '2026-11-24', '2026-11-24.2'),
    'privacy', jsonb_build_array('2026-11-16', '2026-11-24'),
    'waiver', jsonb_build_array('2026-11-16'),
    'contractor', jsonb_build_array('2026-11-14', '2026-11-24', '2026-11-24.2'));
$$;

-- 1. Bucket privado
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('walker-docs', 'walker-docs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "walker-docs: walker uploads own" on storage.objects;
create policy "walker-docs: walker uploads own" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'walker-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
    and lower(storage.extension(name)) = any (array['jpg', 'jpeg', 'png', 'webp'])
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('walker', 'shopper'))
  );
drop policy if exists "walker-docs: owner or admin reads" on storage.objects;
create policy "walker-docs: owner or admin reads" on storage.objects for select to authenticated
  using (bucket_id = 'walker-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.bw_is_admin()));

-- 2. Postulaciones (historial: cada envío es una fila nueva; las anteriores quedan como 'superseded')
create table if not exists public.walker_applications (
  id             bigint generated always as identity primary key,
  walker_id      uuid not null references public.profiles(id) on delete cascade,
  legal_name     text not null check (length(legal_name) between 3 and 120),
  phone          text not null check (phone ~ '^\+?1?\d{10}$'),
  city           text not null check (length(city) between 2 and 80),
  zip            text not null check (zip ~ '^\d{5}$'),
  id_type        text not null check (id_type in ('drivers_license', 'state_id')),
  id_expiry      date not null,
  id_photo_path  text not null,
  selfie_path    text not null,
  status         text not null default 'submitted' check (status in ('submitted', 'superseded', 'approved', 'rejected')),
  submitted_at   timestamptz not null default now(),
  decided_at     timestamptz,
  agent_report   jsonb,
  agent_risk     text check (agent_risk in ('low', 'medium', 'high')),
  agent_ran_at   timestamptz,
  ip_address     text,
  user_agent     text,
  check (id_photo_path like walker_id::text || '/%' and selfie_path like walker_id::text || '/%'),
  check (id_photo_path <> selfie_path)
);
create index if not exists walker_applications_walker_idx on public.walker_applications (walker_id, submitted_at desc);
create unique index if not exists walker_applications_one_open on public.walker_applications (walker_id) where status = 'submitted';
alter table public.walker_applications enable row level security;
revoke all on public.walker_applications from anon;
revoke insert, update, delete, truncate on public.walker_applications from authenticated;
grant select on public.walker_applications to authenticated;
drop policy if exists "walker_applications: walker reads own" on public.walker_applications;
create policy "walker_applications: walker reads own" on public.walker_applications for select to authenticated using (walker_id = auth.uid());
drop policy if exists "walker_applications: admin reads" on public.walker_applications;
create policy "walker_applications: admin reads" on public.walker_applications for select to authenticated using (public.bw_is_admin());

-- 3. Decisión del admin: aprobar exige postulación con ID vigente + Términos vigentes
create or replace function public.admin_set_walker_status(target_id text, new_status text, reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_old text; v_reason text := nullif(btrim(coalesce(reason, '')), '');
  v_app public.walker_applications%rowtype;
begin
  if not public.bw_is_admin() then raise exception 'not admin' using errcode = '42501'; end if;
  if new_status not in ('pending', 'verified', 'suspended', 'rejected') then raise exception 'invalid status' using errcode = '22023'; end if;
  if new_status = 'rejected' and v_reason is null then raise exception 'reason required' using errcode = '22023'; end if;
  select walker_status into v_old from public.profiles where id::text = target_id and role in ('walker', 'shopper');
  if not found then raise exception 'walker not found' using errcode = '22023'; end if;
  select * into v_app from public.walker_applications where walker_id::text = target_id and status = 'submitted' limit 1;

  if new_status = 'verified' then
    if v_app.id is null then raise exception 'application required' using errcode = '22023'; end if;
    if v_app.id_expiry < current_date then raise exception 'id expired' using errcode = '22023'; end if;
    if not private.bw_has_current_consent(target_id::uuid) then raise exception 'terms required' using errcode = '22023'; end if;
    update public.walker_applications set status = 'approved', decided_at = now() where id = v_app.id;
  elsif new_status = 'rejected' and v_app.id is not null then
    update public.walker_applications set status = 'rejected', decided_at = now() where id = v_app.id;
  end if;

  update public.profiles set walker_status = new_status where id::text = target_id;
  -- Historial: cada cambio de estado (y cada renovación de ID aprobada) queda en walker_reviews
  if v_old is distinct from new_status or (new_status = 'verified' and v_app.id is not null) then
    insert into public.walker_reviews (walker_id, status, reason, reviewed_by)
    values (target_id::uuid, new_status,
            left(coalesce(v_reason, case when v_old = 'verified' and new_status = 'verified' then 'Renovación de identificación aprobada' end), 500),
            auth.uid());
    if new_status in ('verified', 'rejected', 'suspended') then
      begin
        perform net.http_post(
          url := 'https://www.barkwalkusa.com/api/dispatch?action=walker_reviews',
          headers := jsonb_build_object('Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'barkwalk_cron_secret')),
          body := '{}'::jsonb, timeout_milliseconds := 30000);
      exception when others then null;
      end;
    end if;
  end if;
end $$;
revoke all on function public.admin_set_walker_status(text, text, text) from public, anon;
grant execute on function public.admin_set_walker_status(text, text, text) to authenticated;

-- 4. Paseador habilitado = verificado + Términos vigentes + postulación aprobada con ID NO vencido
create or replace function public.bw_is_verified_walker()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                 where p.id::text = auth.uid()::text
                   and p.role in ('walker', 'shopper')
                   and p.walker_status = 'verified')
     and private.bw_has_current_consent(auth.uid())
     and exists (select 1 from public.walker_applications a
                 where a.walker_id = auth.uid() and a.status = 'approved' and a.id_expiry >= current_date)
$$;

commit;
