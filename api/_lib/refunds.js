// Reembolsos y disputas (contracargos) de Stripe → reservas, días de paseo y pagos a paseadores
// ---------------------------------------------------------------------------
// Lo llama /api/stripe-webhook con estos eventos (añádelos al endpoint en Stripe):
//   · charge.refunded         total   → reserva 'refunded'; días no iniciados cancelados; resto sin pago;
//                                        transferencias ya hechas al paseador REVERTIDAS.
//                             parcial → se guarda el monto; días sin pagar quedan en revisión del admin.
//   · charge.dispute.created          → días no iniciados cancelados; días sin pagar en revisión
//                                        (no se revierte nada todavía: la disputa se puede ganar).
//   · charge.dispute.closed   won     → se liberan los días que retuvo la disputa.
//                             lost    → como un reembolso total para los pagos: bloqueo + reversión.
// Todo es idempotente (Stripe reenvía eventos): los cambios se aplican "hacia" un estado y cada reversión
// usa idempotencyKey por día. La migración 20261120_refunds_disputes.sql añade las columnas.
// ---------------------------------------------------------------------------
const { sb, sbOrThrow, enc } = require('./supabase');

const NOT_STARTED = new Set(['pending', 'accepted', 'en_camino']);  // el perro aún no salió con el paseador
const REASON = {
  refund: 'reembolso total al cliente',
  partial: 'reembolso parcial al cliente: revisar el pago',
  dispute: 'disputa abierta (contracargo)',
  lost: 'disputa perdida (contracargo)',
};
// Disputa que aún no se resolvió a favor de Barkwalk (bloquea pagos al paseador)
function disputeBlocks(status) { return !!status && !['won', 'warning_closed'].includes(status); }

function idOf(x) { return typeof x === 'string' ? x : (x && x.id) || null; }
const inList = (ids) => `(${ids.map((id) => `"${String(id).replace(/"/g, '')}"`).join(',')})`;

async function findBooking({ paymentIntentId, chargeId }) {
  if (paymentIntentId) {
    const rows = await sbOrThrow(`/rest/v1/bookings?stripe_payment_intent_id=eq.${enc(paymentIntentId)}&select=*&limit=1`);
    if (rows[0]) return rows[0];
  }
  if (chargeId) { // stripe_charge_id existe tras la migración de Connect; sin ella simplemente no encuentra
    const r = await sb(`/rest/v1/bookings?stripe_charge_id=eq.${enc(chargeId)}&select=*&limit=1`);
    if (r.ok && Array.isArray(r.data) && r.data[0]) return r.data[0];
  }
  return null;
}

async function walksOf(bookingId) {
  return sbOrThrow(`/rest/v1/walk_requests?booking_id=eq.${enc(bookingId)}`
    + '&select=id,status,payment_status,walker_id,walker_payout_status,walker_transfer_id,walker_payout_cents,payout_review_required,payout_review_reason'
    + '&order=created_at.asc&limit=200');
}

async function patchWalks(ids, body) {
  if (!ids.length) return;
  await sbOrThrow(`/rest/v1/walk_requests?id=in.${enc(inList(ids))}`, { method: 'PATCH', body, prefer: 'return=minimal' });
}

// Días que el perro todavía no empezó: se cancelan (el paseador lo ve en tiempo real y sale de su grupo)
async function cancelNotStarted(walks, extra = {}) {
  const ids = walks.filter((w) => NOT_STARTED.has(w.status)).map((w) => w.id);
  await patchWalks(ids, { status: 'cancelled', ...extra });
  return ids;
}

// Días con pago al paseador aún pendiente: quedan en revisión del admin (el cron no los paga)
async function holdUnpaid(walks, reason, extra = {}) {
  const ids = walks
    .filter((w) => w.status !== 'cancelled' && !NOT_STARTED.has(w.status))
    .filter((w) => ['unpaid', 'failed', null, undefined].includes(w.walker_payout_status))
    // Ya retenido por otro motivo (p. ej. sin GPS): se deja igual. Si se sobrescribiera el motivo, al ganar
    // la disputa se liberaría también ese pago, que debe seguir esperando la revisión del admin.
    .filter((w) => !w.payout_review_required || w.payout_review_reason === reason)
    .map((w) => w.id);
  await patchWalks(ids, { payout_review_required: true, payout_review_reason: reason, ...extra });
  return ids;
}

// Revierte las transferencias YA hechas al paseador. Un fallo (p. ej. saldo insuficiente en su cuenta)
// no tumba el webhook: queda anotado para el admin. Los días 'processing' (el cron pagando en este
// instante) se informan para que el webhook pida a Stripe que reintente.
async function reversePaid(stripe, walks, reason) {
  const out = { reversed: [], failed: [], processing: [] };
  if (String(process.env.REVERSE_WALKER_TRANSFERS || 'true').toLowerCase() === 'false') return { ...out, skipped: 'disabled' };
  for (const w of walks) {
    if (w.walker_payout_status === 'processing') { out.processing.push(w.id); continue; }
    if (w.walker_payout_status !== 'paid' || !w.walker_transfer_id) continue;
    try {
      const rev = await stripe.transfers.createReversal(w.walker_transfer_id, {
        description: `Barkwalk · ${reason}`.slice(0, 200),
        metadata: { walk_id: String(w.id), reason },
      }, { idempotencyKey: `bw-reversal-${w.id}` });
      await patchWalks([w.id], {
        walker_payout_status: 'reversed', walker_transfer_reversal_id: rev.id, walker_reversed_at: new Date().toISOString(),
        walker_payout_error: null, payout_review_required: true, payout_review_reason: reason,
      });
      out.reversed.push({ walkId: w.id, amount: rev.amount, reversalId: rev.id });
    } catch (e) {
      console.error(`Reversión de la transferencia ${w.walker_transfer_id} (walk ${w.id}):`, e.message);
      await sb(`/rest/v1/walk_requests?id=eq.${enc(w.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: {
        walker_payout_error: `reversal_failed: ${String(e.message || e)}`.slice(0, 300),
        payout_review_required: true, payout_review_reason: `${reason} — revertir la transferencia manualmente`,
      } });
      out.failed.push({ walkId: w.id, error: String(e.message || e).slice(0, 200) });
    }
  }
  return out;
}

// ---------- charge.refunded ----------
async function handleChargeRefunded(eventCharge, stripe, canCallApi) {
  const charge = canCallApi ? await stripe.charges.retrieve(eventCharge.id) : eventCharge; // fuente de verdad: Stripe
  const booking = await findBooking({ paymentIntentId: idOf(charge.payment_intent), chargeId: charge.id });
  if (!booking) return { ignored: 'booking not found' }; // p. ej. reembolso de una factura de membresía

  const refunded = Number(charge.amount_refunded) || 0;
  const full = charge.refunded === true || refunded >= Number(charge.amount || booking.total_cents);
  const now = new Date().toISOString();
  await sbOrThrow(`/rest/v1/bookings?id=eq.${enc(booking.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: {
    refunded_cents: refunded, refunded_at: now,
    ...(full ? { payment_status: 'refunded', status: 'cancelled' } : {}),
  } });

  const walks = await walksOf(booking.id);
  if (!full) {
    const held = await holdUnpaid(walks, REASON.partial);
    console.log(`Reserva ${booking.id}: reembolso PARCIAL ${refunded}/${charge.amount}; ${held.length} día(s) en revisión.`);
    return { booking: booking.id, refund: 'partial', refundedCents: refunded, held: held.length };
  }
  // Total: nada de esta reserva se vuelve a pagar (walk_requests.payment_status ≠ 'paid' la saca del cron)
  const cancelled = await cancelNotStarted(walks, { payment_status: 'refunded' });
  const resto = walks.filter((w) => w.status !== 'cancelled' && !cancelled.includes(w.id));
  await patchWalks(resto.filter((w) => w.walker_payout_status !== 'paid').map((w) => w.id),
    { payment_status: 'refunded', payout_review_required: true, payout_review_reason: REASON.refund });
  await patchWalks(resto.filter((w) => w.walker_payout_status === 'paid').map((w) => w.id), { payment_status: 'refunded' });
  const rev = await reversePaid(stripe, resto, REASON.refund);
  console.log(`Reserva ${booking.id}: reembolso TOTAL; ${cancelled.length} día(s) cancelados, ${rev.reversed.length} transferencia(s) revertidas, ${rev.failed.length} fallida(s).`);
  return { booking: booking.id, refund: 'full', cancelled: cancelled.length, reversed: rev.reversed.length, reversalFailed: rev.failed.length, processing: rev.processing };
}

// ---------- charge.dispute.created / charge.dispute.closed ----------
async function handleDispute(eventType, eventDispute, stripe, canCallApi) {
  const dispute = canCallApi ? await stripe.disputes.retrieve(eventDispute.id) : eventDispute;
  const chargeId = idOf(dispute.charge);
  let paymentIntentId = idOf(dispute.payment_intent);
  if (!paymentIntentId && chargeId && canCallApi) paymentIntentId = idOf((await stripe.charges.retrieve(chargeId)).payment_intent);
  const booking = await findBooking({ paymentIntentId, chargeId });
  if (!booking) return { ignored: 'booking not found' };

  const status = String(dispute.status || '');
  const walks = await walksOf(booking.id);
  await sbOrThrow(`/rest/v1/bookings?id=eq.${enc(booking.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: {
    dispute_id: dispute.id, dispute_status: status,
    ...(eventType === 'charge.dispute.created' ? { disputed_at: new Date((dispute.created || Date.now() / 1000) * 1000).toISOString() } : {}),
    ...(status === 'lost' ? { payment_status: 'refunded' } : {}),
  } });

  if (status === 'won' || status === 'warning_closed') {
    // Se liberan SOLO los días que retuvo la disputa (no los retenidos por GPS u otros motivos)
    const ids = walks.filter((w) => w.payout_review_required && w.payout_review_reason === REASON.dispute && w.payment_status === 'paid').map((w) => w.id);
    await patchWalks(ids, { payout_review_required: false, payout_review_reason: null });
    console.log(`Reserva ${booking.id}: disputa ${dispute.id} ${status}; ${ids.length} día(s) liberados.`);
    return { booking: booking.id, dispute: status, released: ids.length };
  }
  if (status === 'lost') {
    const activos = walks.filter((w) => w.status !== 'cancelled');
    await patchWalks(activos.filter((w) => w.walker_payout_status !== 'paid').map((w) => w.id),
      { payment_status: 'refunded', payout_review_required: true, payout_review_reason: REASON.lost });
    await patchWalks(activos.filter((w) => w.walker_payout_status === 'paid').map((w) => w.id), { payment_status: 'refunded' });
    const rev = await reversePaid(stripe, activos, REASON.lost);
    console.log(`Reserva ${booking.id}: disputa ${dispute.id} PERDIDA; ${rev.reversed.length} transferencia(s) revertidas, ${rev.failed.length} fallida(s).`);
    return { booking: booking.id, dispute: status, reversed: rev.reversed.length, reversalFailed: rev.failed.length, processing: rev.processing };
  }
  // Abierta (needs_response, under_review, warning_*): no seguir prestando ni pagando el servicio en disputa
  const cancelled = await cancelNotStarted(walks);
  const held = await holdUnpaid(walks.filter((w) => !cancelled.includes(w.id)), REASON.dispute);
  console.log(`Reserva ${booking.id}: disputa ${dispute.id} (${status}); ${cancelled.length} día(s) cancelados, ${held.length} en revisión.`);
  return { booking: booking.id, dispute: status, cancelled: cancelled.length, held: held.length };
}

module.exports = { handleChargeRefunded, handleDispute, disputeBlocks, REASON, NOT_STARTED };
