-- Cierre de cuenta del paseador con servicios asignados: garantía en la base (2026-11-26)
-- ---------------------------------------------------------------------------
-- /api/signup ya revisa los bloqueos antes de cerrar (api/_lib/account-closure.js → closureBlockers), pero entre
-- esa revisión y la constancia de cierre un paseador podría aceptar un paseo. Aquí se cierra ese hueco:
--   1) account_closures: no se puede insertar el cierre si la persona tiene paseos asignados como paseador que no
--      terminaron (pending con paseador asignado, accepted, en_camino, in_progress). El error lleva el código
--      'active_walks_as_walker', que la API traduce al mismo mensaje de bloqueo de la app.
--   2) walk_requests: no se puede asignar ni aceptar un paseo para un paseador cuya cuenta ya está cerrada
--      (ni siquiera el admin o el servidor).
-- Ambos triggers toman el mismo candado por paseador (pg_advisory_xact_lock), así un cierre y una aceptación
-- simultáneos no pueden colarse a la vez: el segundo espera y ve lo que hizo el primero.
-- No cambia RLS, la retención de documentos ni los registros legales/financieros.
-- ---------------------------------------------------------------------------

-- Lista única de estados "aún no terminó" para un paseador (la misma que WALKER_ACTIVE en la API)
create or replace function private.bw_walker_active_walks(p_user uuid)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  select count(*)::int from public.walk_requests r
  where r.walker_id::text = p_user::text
    and coalesce(r.status, 'pending') in ('pending', 'accepted', 'en_camino', 'in_progress');
$$;

create or replace function private.bw_account_closure_walker_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare n int;
begin
  -- Mismo candado que al aceptar/asignar: cierre y aceptación simultáneos se ejecutan uno tras otro
  perform pg_advisory_xact_lock(hashtext('bw_walker:' || new.user_id::text));
  n := private.bw_walker_active_walks(new.user_id);
  if n > 0 then
    raise exception 'active_walks_as_walker: % servicio(s) asignado(s) sin terminar', n
      using errcode = 'P0001', hint = 'Completa o resuelve tus servicios asignados antes de cerrar la cuenta.';
  end if;
  return new;
end $$;

create or replace function private.bw_walk_requests_closed_walker_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.walker_id is null or (tg_op = 'UPDATE' and new.walker_id is not distinct from old.walker_id) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('bw_walker:' || new.walker_id::text));
  if exists (select 1 from public.account_closures c where c.user_id::text = new.walker_id::text) then
    raise exception 'walk_requests: la cuenta de este paseador está cerrada' using errcode = '42501';
  end if;
  return new;
end $$;

revoke execute on function private.bw_walker_active_walks(uuid) from public, anon, authenticated;
revoke execute on function private.bw_account_closure_walker_guard() from public, anon, authenticated;
revoke execute on function private.bw_walk_requests_closed_walker_guard() from public, anon, authenticated;

drop trigger if exists bw_account_closure_walker_guard on public.account_closures;
create trigger bw_account_closure_walker_guard
  before insert on public.account_closures
  for each row execute function private.bw_account_closure_walker_guard();

drop trigger if exists bw_walk_requests_closed_walker on public.walk_requests;
create trigger bw_walk_requests_closed_walker
  before insert or update of walker_id on public.walk_requests
  for each row execute function private.bw_walk_requests_closed_walker_guard();
