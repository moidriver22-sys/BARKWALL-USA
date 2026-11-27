-- Reverso del ID en la postulación del paseador (Etapa 1 del onboarding)
-- ---------------------------------------------------------------------------
-- public.walker_applications.id_back_path: foto del REVERSO del ID oficial, en el mismo bucket privado
-- 'walker-docs' y en la carpeta del propio paseador (las políticas de Storage existentes ya lo cubren).
--   · Envíos anteriores: quedan con NULL (no se tocan ni se invalidan; la aprobación no cambia).
--   · Envíos NUEVOS: el reverso es obligatorio (trigger BEFORE INSERT), igual que en /api/signup.
-- No cambia RLS, ni admin_set_walker_status(), ni bw_is_verified_walker(), ni los triggers de la firma del
-- Independent Contractor Agreement (20261207). No hay comparación facial automática: la revisión es del admin.
-- ---------------------------------------------------------------------------

alter table public.walker_applications add column if not exists id_back_path text;

alter table public.walker_applications drop constraint if exists walker_applications_id_back_path_check;
alter table public.walker_applications add constraint walker_applications_id_back_path_check check (
  id_back_path is null
  or (id_back_path like walker_id::text || '/%' and id_back_path <> id_photo_path and id_back_path <> selfie_path)
);

-- INSERT: todo envío nuevo debe traer el reverso del ID
create or replace function private.bw_walker_app_id_back_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(btrim(new.id_back_path), '') = '' then
    raise exception 'walker_applications: falta la foto del reverso del ID' using errcode = '23514';
  end if;
  return new;
end $$;

revoke execute on function private.bw_walker_app_id_back_insert() from public, anon, authenticated;

drop trigger if exists bw_walker_app_id_back_insert on public.walker_applications;
create trigger bw_walker_app_id_back_insert
  before insert on public.walker_applications
  for each row execute function private.bw_walker_app_id_back_insert();

comment on column public.walker_applications.id_back_path is
  'Ruta en walker-docs de la foto del REVERSO del ID (obligatoria desde 2026-11-26; NULL en envíos anteriores)';
