-- =====================================================================
-- Barkwalk USA · FIX: default de walk_requests.walker_payout_status
-- ---------------------------------------------------------------------
-- La columna ya existía antes de 20261113/20261114 con default 'pending', así que
-- "add column if not exists … default 'unpaid'" no se aplicó. Ese valor viola
-- walk_requests_walker_payout_status_check ('unpaid','processing','paid','failed','reversed'):
-- el webhook de Stripe NO podía insertar los días de una reserva pagada (no fija esa columna).
-- No borra ni cambia datos válidos. Se puede ejecutar más de una vez.
-- =====================================================================
alter table public.walk_requests alter column walker_payout_status set default 'unpaid';
update public.walk_requests set walker_payout_status = 'unpaid' where walker_payout_status is null;
alter table public.walk_requests alter column walker_payout_status set not null;

-- Verificación (debe devolver 'unpaid'::text | NO):
-- select column_default, is_nullable from information_schema.columns
--  where table_schema = 'public' and table_name = 'walk_requests' and column_name = 'walker_payout_status';
