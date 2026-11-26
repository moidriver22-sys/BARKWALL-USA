-- Firma del Independent Contractor Agreement (1099) en la postulación del paseador (Etapa 1 del onboarding)
-- ---------------------------------------------------------------------------
-- Cada envío de public.walker_applications guarda su propia constancia de aceptación del Acuerdo para Paseadores
-- (terminos-paseadores.html, sección 2: contratista independiente):
--   · contractor_agreement_accepted    = true (obligatorio en cada envío nuevo)
--   · contractor_agreement_accepted_at = hora EXACTA del servidor (now(); la app no puede fijarla)
--   · contractor_agreement_version     = versión firmada (la vigente la valida /api/signup con api/_lib/terms.js)
--   · contractor_signature_name        = nombre legal escrito como firma electrónica
--   · contractor_signer_email          = correo del perfil del postulante (lo pone el servidor, no la app)
-- Las filas anteriores quedan con NULL (su aceptación consta en legal_consents desde el registro).
-- No cambia RLS: la app solo LEE sus envíos; los inserta /api/signup con la clave de servicio.
-- No toca la aprobación del admin (admin_set_walker_status) ni bw_is_verified_walker().
-- ---------------------------------------------------------------------------

alter table public.walker_applications
  add column if not exists contractor_agreement_accepted boolean,
  add column if not exists contractor_agreement_accepted_at timestamptz,
  add column if not exists contractor_agreement_version text,
  add column if not exists contractor_signature_name text,
  add column if not exists contractor_signer_email text;

-- INSERT: sin aceptación completa no hay postulación nueva; la hora la pone la base.
create or replace function private.bw_walker_app_contractor_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.contractor_agreement_accepted is not true
     or coalesce(btrim(new.contractor_agreement_version), '') = ''
     or length(btrim(coalesce(new.contractor_signature_name, ''))) not between 3 and 120
     or coalesce(btrim(new.contractor_signer_email), '') !~ '^[^@\s]+@[^@\s]+$' then
    raise exception 'walker_applications: falta la aceptación del Independent Contractor Agreement' using errcode = '23514';
  end if;
  new.contractor_signature_name := btrim(regexp_replace(new.contractor_signature_name, '\s+', ' ', 'g'));
  new.contractor_signer_email := lower(btrim(new.contractor_signer_email));
  new.contractor_agreement_accepted_at := now();
  return new;
end $$;

-- UPDATE: la constancia firmada nunca se modifica (ni siquiera con la clave de servicio).
-- Los cambios de estado del admin, "superseded" y el reporte del agente no tocan estas columnas.
create or replace function private.bw_walker_app_contractor_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.contractor_agreement_accepted    is distinct from old.contractor_agreement_accepted
     or new.contractor_agreement_accepted_at is distinct from old.contractor_agreement_accepted_at
     or new.contractor_agreement_version  is distinct from old.contractor_agreement_version
     or new.contractor_signature_name     is distinct from old.contractor_signature_name
     or new.contractor_signer_email       is distinct from old.contractor_signer_email then
    raise exception 'walker_applications: la firma del Independent Contractor Agreement no se puede modificar' using errcode = '42501';
  end if;
  return new;
end $$;

revoke execute on function private.bw_walker_app_contractor_insert() from public, anon, authenticated;
revoke execute on function private.bw_walker_app_contractor_immutable() from public, anon, authenticated;

drop trigger if exists bw_walker_app_contractor_insert on public.walker_applications;
create trigger bw_walker_app_contractor_insert
  before insert on public.walker_applications
  for each row execute function private.bw_walker_app_contractor_insert();

drop trigger if exists bw_walker_app_contractor_immutable on public.walker_applications;
create trigger bw_walker_app_contractor_immutable
  before update on public.walker_applications
  for each row execute function private.bw_walker_app_contractor_immutable();

comment on column public.walker_applications.contractor_agreement_accepted_at is
  'Hora exacta (servidor) en que el postulante firmó el Independent Contractor Agreement en este envío';
