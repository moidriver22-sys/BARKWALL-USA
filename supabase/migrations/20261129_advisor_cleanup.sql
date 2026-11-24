-- Limpieza de avisos menores del Security Advisor de Supabase (2026-11-24).
-- No cambia el comportamiento de la app: solo fija search_path y quita permisos de ejecución que nadie usa.

-- 1) "Function Search Path Mutable": fija un search_path vacío.
--    Estas funciones solo usan funciones internas de Postgres (pg_catalog siempre está disponible).
alter function private.bw_payout_hold() set search_path = '';
alter function private.bw_min_walk_minutes(text) set search_path = '';
alter function private.bw_consent_rules() set search_path = '';
alter function public.protect_stripe_account_id() set search_path = '';

-- 2) "Public Can Execute SECURITY DEFINER Function".
--    handle_new_user (trigger de auth.users) y rls_auto_enable (event trigger) no deben llamarse por /rpc.
--    Postgres no revisa EXECUTE al disparar triggers, así que siguen funcionando igual.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
--    is_admin(): solo la usan políticas RLS del rol authenticated; un visitante sin sesión no la necesita.
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- No se tocan (intencionales o no movibles):
--  · RPC SECURITY DEFINER para usuarios con sesión (admin_*, bw_*, set_home_access…): validan permisos por dentro.
--  · Tablas con RLS sin políticas (dispatch_alerts, home_access, private.bw_signup_intents): solo el servidor
--    (service_role) las usa; sin políticas = nadie más puede leerlas, que es lo deseado.
--  · pg_net en el esquema public: la extensión no se puede mover de esquema (no es relocatable).
--  · Leaked Password Protection: se activa en el panel de Supabase (Authentication → Password security).
