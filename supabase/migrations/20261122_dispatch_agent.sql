-- =====================================================================
-- Barkwalk USA · Agente de Operaciones y Despacho
-- ---------------------------------------------------------------------
-- 1. public.dispatch_alerts: registro de alertas enviadas (idempotencia). Clave única (walk_id, kind):
--    /api/dispatch "reclama" la fila ANTES de enviar; si ya existe, no vuelve a avisar.
--    Solo la usa el servidor (service_role): RLS activado y sin políticas → nadie más la lee ni escribe.
-- 2. (Parte B, aparte) pg_cron + pg_net llaman a /api/dispatch cada 10 min con el CRON_SECRET guardado
--    en Supabase Vault con el nombre 'barkwalk_cron_secret' (el secreto nunca queda escrito en el SQL).
-- Solo AÑADE objetos; no toca datos existentes. Se puede ejecutar más de una vez.
-- =====================================================================

-- ---------- Parte A: tabla de idempotencia ----------
create table if not exists public.dispatch_alerts (
  id             bigserial primary key,
  walk_id        text        not null,
  kind           text        not null,
  recipient_role text,
  created_at     timestamptz not null default now(),
  unique (walk_id, kind)
);
alter table public.dispatch_alerts enable row level security;
revoke all on public.dispatch_alerts from anon, authenticated;
create index if not exists dispatch_alerts_created_idx on public.dispatch_alerts (created_at desc);

-- ---------- Parte B: programación cada 10 min (requiere el secreto en Vault) ----------
-- Antes: Supabase → Project Settings → Vault → "Add new secret"
--        Name: barkwalk_cron_secret   ·   Secret: el mismo valor que CRON_SECRET en Vercel
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
-- select cron.unschedule('barkwalk-dispatch') where exists (select 1 from cron.job where jobname = 'barkwalk-dispatch');
-- select cron.schedule('barkwalk-dispatch', '*/10 * * * *', $$
--   select net.http_post(
--     url := 'https://www.barkwalkusa.com/api/dispatch',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
--       'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'barkwalk_cron_secret')),
--     body := '{}'::jsonb, timeout_milliseconds := 30000);
-- $$);

-- Verificación:
-- select jobname, schedule, active from cron.job where jobname = 'barkwalk-dispatch';
-- select status_code, created from net._http_response order by created desc limit 5;   -- 200 = OK, 401 = secreto
-- select kind, count(*) from public.dispatch_alerts group by kind;
