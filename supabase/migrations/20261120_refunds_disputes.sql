-- =====================================================================
-- Barkwalk USA · Reembolsos y disputas (contracargos) de Stripe
-- ---------------------------------------------------------------------
-- La usa /api/stripe-webhook (charge.refunded, charge.dispute.created, charge.dispute.closed):
--   · bookings: cuánto se reembolsó y el estado de la disputa.
--   · walk_requests: transferencia al paseador revertida ('reversed') y su id de reversión.
-- Solo AÑADE columnas y amplía una restricción: no borra ni modifica datos. Se puede ejecutar más de una vez.
-- Todas estas columnas las escribe SOLO el servidor (service_role); los guards de 20261114/20261115 ya
-- impiden que el paseador o el cliente las cambien (no están en sus listas de columnas permitidas).
-- =====================================================================

alter table public.bookings
  add column if not exists refunded_cents int not null default 0,
  add column if not exists refunded_at    timestamptz,
  add column if not exists dispute_id     text,
  add column if not exists dispute_status text,      -- estado de Stripe: needs_response, under_review, won, lost, warning_*…
  add column if not exists disputed_at    timestamptz;

alter table public.walk_requests
  add column if not exists walker_transfer_reversal_id text,
  add column if not exists walker_reversed_at          timestamptz;

-- 'reversed': la transferencia al paseador se revirtió (reembolso total o disputa perdida).
-- Queda fuera de los pagos automáticos (ELIGIBLE_FILTER solo toma 'unpaid' y 'failed').
alter table public.walk_requests drop constraint if exists walk_requests_walker_payout_status_check;
alter table public.walk_requests add constraint walk_requests_walker_payout_status_check
  check (walker_payout_status in ('unpaid', 'processing', 'paid', 'failed', 'reversed'));

create index if not exists bookings_stripe_payment_intent_idx on public.bookings (stripe_payment_intent_id);

-- Verificación:
-- select column_name from information_schema.columns
--  where table_schema = 'public' and table_name = 'bookings' and column_name in ('refunded_cents', 'dispute_status');
