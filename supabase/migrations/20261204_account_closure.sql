-- =====================================================================
-- Barkwalk USA · Migración 2026-11-24 · Cierre de cuenta
--   public.account_closures: constancia del cierre (closed_at, rol, si operó como paseador, IP, navegador) y del
--   borrado posterior de las fotos de identidad (docs_deleted_at / docs_deleted_count).
--   La escribe SOLO el servidor (/api/signup action=close_account y la tarea de retención de /api/dispatch).
--   Se guarda aparte del perfil: el usuario no puede "reabrirse" editando su perfil.
-- Solo AGREGA una tabla con sus políticas: no cambia triggers ni políticas RLS existentes.
-- =====================================================================
begin;

create table if not exists public.account_closures (
  user_id            uuid primary key references public.profiles(id) on delete restrict,
  role               text not null,
  closed_at          timestamptz not null default now(),
  operated           boolean not null default false,  -- paseador que tuvo al menos un paseo asignado
  reason             text check (reason is null or length(reason) <= 500),
  ip_address         text,
  user_agent         text,
  docs_deleted_at    timestamptz,                      -- cuándo se borraron sus fotos de ID/selfie (retención)
  docs_deleted_count int
);
create index if not exists account_closures_docs_pending_idx on public.account_closures (closed_at) where docs_deleted_at is null;

alter table public.account_closures enable row level security;
revoke all on public.account_closures from anon;
revoke insert, update, delete, truncate on public.account_closures from authenticated;
grant select on public.account_closures to authenticated;
drop policy if exists "account_closures: own read" on public.account_closures;
create policy "account_closures: own read" on public.account_closures for select to authenticated using (user_id = auth.uid());
drop policy if exists "account_closures: admin read" on public.account_closures;
create policy "account_closures: admin read" on public.account_closures for select to authenticated using (public.bw_is_admin());

commit;
