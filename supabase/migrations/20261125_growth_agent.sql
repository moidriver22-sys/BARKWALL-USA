-- =====================================================================
-- Barkwalk USA · Empleado virtual #3: Agente de Fidelización y Crecimiento (aplicado el 2026-11-23)
-- ---------------------------------------------------------------------
-- 1. profiles.growth_opt_out_at: si tiene fecha, el cliente NO recibe agradecimientos ni recordatorios de
--    reactivación (los avisos operativos del paseo siguen llegando). Se marca cuando el cliente responde "BAJA":
--      update public.profiles set growth_opt_out_at = now() where lower(email) = lower('<correo>');
-- 2. pg_cron llama a /api/dispatch?action=growth cada hora (minuto 40). El agente solo envía entre las 9:00 y las
--    20:00 de Birmingham; fuera de ese horario no hace nada. Mismo secreto del Vault que los otros agentes.
-- Idempotencia: reutiliza public.dispatch_alerts (claves 'grow:thanks:<reserva>' y 'grow:reactivate:<cliente>:<paseo>').
-- Solo AÑADE objetos; no toca datos existentes. Se puede ejecutar más de una vez.
-- =====================================================================
alter table public.profiles add column if not exists growth_opt_out_at timestamptz;

select cron.unschedule('barkwalk-growth')
 where exists (select 1 from cron.job where jobname = 'barkwalk-growth');

select cron.schedule('barkwalk-growth', '40 * * * *', $$
  select net.http_get(
    url := 'https://www.barkwalkusa.com/api/dispatch?action=growth',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'barkwalk_cron_secret')),
    timeout_milliseconds := 30000);
$$);

-- Verificación:
-- select jobname, schedule, active from cron.job where jobname like 'barkwalk-%';
-- select kind, count(*) from public.dispatch_alerts where kind like 'growth_%' group by kind;
-- Prueba sin enviar nada: GET /api/dispatch?action=growth&dry=1 (Authorization: Bearer <CRON_SECRET>)
