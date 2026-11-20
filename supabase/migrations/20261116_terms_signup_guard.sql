-- =====================================================================
-- Barkwalk USA · Migración 2026-11-16 · Términos obligatorios en el REGISTRO (lado servidor)
-- ⚠️ SUPERADA por 20261117_signup_consent.sql: NO ejecutar este archivo (se conserva solo como historial).
-- Ejecutar completo en Supabase → SQL Editor. Idempotente.
--
-- El registro se hace con supabase.auth.signUp() desde el navegador (clave pública). La casilla de
-- index.html no basta: alguien podría llamar a la API de Auth sin pasar por la página.
-- Este trigger rechaza en la base de datos toda alta por correo que no traiga la aceptación de la
-- versión vigente de los Términos en raw_user_meta_data (terms_version + terms_accepted_at).
--
-- Nota: el servicio de Auth de Supabase escribe en auth.users sin el JWT de quien llama, así que
-- aquí NO se puede distinguir por auth.role(). La única excepción es explícita: cuentas creadas por
-- el servidor con la API de administración y app_metadata.bw_admin_created = true
-- (app_metadata solo lo puede fijar la clave service_role, nunca el navegador).
--
-- Si cambias la versión de los Términos: actualiza TERMS_VERSION en index.html,
-- api/create-subscription.js y la lista de versiones válidas de abajo.
-- =====================================================================
begin;

create or replace function private.bw_require_terms_on_signup()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_app  jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
begin
  if coalesce(v_app ->> 'bw_admin_created', '') = 'true' then return new; end if; -- alta hecha por el servidor
  if coalesce(v_app ->> 'provider', 'email') <> 'email' then return new; end if;    -- (la app solo usa correo)
  if coalesce(v_meta ->> 'terms_version', '') not in ('2026-11-14')
     or coalesce(v_meta ->> 'terms_accepted_at', '') = '' then
    raise exception 'Debes aceptar los Términos y Condiciones para crear tu cuenta. / You must accept the Terms and Conditions.'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.bw_require_terms_on_signup() from public, anon, authenticated;

drop trigger if exists bw_require_terms_on_signup on auth.users;
create trigger bw_require_terms_on_signup before insert on auth.users
  for each row execute function private.bw_require_terms_on_signup();

commit;

-- Comprobación (ejecutar aparte): debe devolver 1 fila
-- select tgname from pg_trigger where tgname = 'bw_require_terms_on_signup';
--
-- OJO: "Add user" del panel de Supabase crea cuentas sin esos datos y quedará bloqueado.
-- Para crear una cuenta a mano usa la API de administración con app_metadata { bw_admin_created: true }.
