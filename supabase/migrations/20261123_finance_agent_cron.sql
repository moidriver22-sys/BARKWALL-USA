-- =====================================================================
-- Barkwalk USA · Empleado virtual #2: Agente de Cobros y Finanzas (ya aplicado el 2026-11-20)
-- ---------------------------------------------------------------------
-- pg_cron llama a /api/dispatch?action=finance_audit cada 6 h (00:15, 06:15, 12:15, 18:15 UTC).
-- Usa el mismo secreto del Vault que el Agente de Despacho ('barkwalk_cron_secret' = CRON_SECRET de Vercel).
-- Idempotencia: reutiliza public.dispatch_alerts (claves 'fin:<tipo>:<id>' y 'fin-summary:<YYYY-MM-DD>'),
-- creada en 20261122_dispatch_agent.sql. Requiere pg_cron y pg_net (activados en esa misma migración).
-- =====================================================================
select cron.unschedule('barkwalk-finance')
 where exists (select 1 from cron.job where jobname = 'barkwalk-finance');

select cron.schedule('barkwalk-finance', '15 */6 * * *', $$
  select net.http_get(
    url := 'https://www.barkwalkusa.com/api/dispatch?action=finance_audit',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'barkwalk_cron_secret')),
    timeout_milliseconds := 30000);
$$);

-- Verificación:
-- select jobname, schedule, active from cron.job where jobname in ('barkwalk-dispatch', 'barkwalk-finance');
-- select status_code, left(content::text, 200), created from net._http_response order by created desc limit 5;
-- Prueba sin enviar nada: GET /api/dispatch?action=finance_audit&dry=1 (Authorization: Bearer <CRON_SECRET>)
