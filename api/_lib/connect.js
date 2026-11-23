// Stripe Connect (Express): utilidades compartidas por /api/create-connect-account y /api/walker-payout
// ---------------------------------------------------------------------------
// Modelo "separate charges and transfers":
//   · El cliente paga a la cuenta principal de Barkwalk (/api/create-payment-intent).
//   · Al completar cada día de paseo se transfiere WALKER_PAYOUT_PERCENT % del precio de ese día
//     a la cuenta conectada del paseador. El resto se queda en el saldo de Barkwalk.
// Variables: STRIPE_SECRET_KEY, WALKER_PAYOUT_PERCENT (p. ej. 75), SUPABASE_* (ver supabase.js)
// ---------------------------------------------------------------------------
const Stripe = require('stripe');
const { sb, sbOrThrow, enc } = require('./supabase');
const { proPayoutPercent } = require('./membership');
// Cálculo de la ganancia del paseador: fuente única en _lib/earnings.js (también lo usan la app y el webhook)
const { payoutPercent, listPriceCents, walkerEarningCents } = require('./earnings');
const { disputeBlocks } = require('./refunds');

const WALKER_ROLES = new Set(['walker', 'shopper']);

// Día pagable: completado, cobrado al cliente, sin pagar al paseador, pasada la retención de 48 h
// (payout_eligible_at lo fija la base al completar) y sin revisión pendiente (sin GPS / reporte del cliente).
const ELIGIBLE_FILTER = () =>
  'status=eq.completed&payment_status=eq.paid&booking_id=not.is.null'
  + '&walker_transfer_id=is.null&walker_payout_status=in.(unpaid,failed)'
  + `&payout_eligible_at=lt.${encodeURIComponent(new Date().toISOString())}`
  + '&payout_review_required=is.false&client_issue_at=is.null';

function stripeKeyValid(k) { return /^(sk|rk)_(live|test)_[A-Za-z0-9]{20,}$/.test(k || ''); }

function getStripe() {
  return Stripe(process.env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2 });
}


function siteUrl() {
  return (process.env.PUBLIC_SITE_URL || 'https://www.barkwalkusa.com').replace(/\/+$/, '');
}

async function getProfile(userId) {
  const rows = await sbOrThrow(`/rest/v1/profiles?id=eq.${enc(userId)}&select=id,full_name,email,role,walker_status,stripe_account_id,stripe_details_submitted,stripe_payouts_enabled,stripe_transfers_active,stripe_onboarded_at&limit=1`);
  return rows[0] || null;
}

// Lee la cuenta en Stripe y guarda su estado en profiles (fuente de verdad: Stripe)
async function syncAccountStatus(stripe, profile) {
  const acct = await stripe.accounts.retrieve(profile.stripe_account_id);
  const estado = {
    stripe_details_submitted: !!acct.details_submitted,
    stripe_payouts_enabled: !!acct.payouts_enabled,
    stripe_transfers_active: !!(acct.capabilities && acct.capabilities.transfers === 'active'),
  };
  if (estado.stripe_details_submitted && estado.stripe_transfers_active && !profile.stripe_onboarded_at) {
    estado.stripe_onboarded_at = new Date().toISOString();
  }
  await sbOrThrow(`/rest/v1/profiles?id=eq.${enc(profile.id)}`, { method: 'PATCH', body: estado, prefer: 'return=minimal' });
  return { ...profile, ...estado, account: acct };
}


// Id del cargo (ch_…) del pago de la reserva; se usa como source_transaction de la transferencia
async function chargeIdForBooking(stripe, booking) {
  if (booking.stripe_charge_id) return booking.stripe_charge_id;
  if (!booking.stripe_payment_intent_id) return null;
  const pi = await stripe.paymentIntents.retrieve(booking.stripe_payment_intent_id);
  const ch = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge && pi.latest_charge.id;
  if (pi.status !== 'succeeded' || !ch) return null;
  await sb(`/rest/v1/bookings?id=eq.${enc(booking.id)}`, { method: 'PATCH', body: { stripe_charge_id: ch }, prefer: 'return=minimal' });
  return ch;
}

// Transfiere al paseador los días COMPLETADOS y PAGADOS que aún no se le han pagado.
// Idempotente: cada día se "reclama" en la base antes de transferir y Stripe recibe una idempotencyKey por día.
async function payoutCompletedWalks(stripe, walkerId, { walkId } = {}) {
  const pct = payoutPercent();
  if (!pct) return { status: 'not_configured', paid: [], failed: [] };

  let profile = await getProfile(walkerId);
  if (!profile || !WALKER_ROLES.has(profile.role)) return { status: 'not_walker', paid: [], failed: [] };
  if (!profile.stripe_account_id) return { status: 'no_account', paid: [], failed: [] };
  if (!profile.stripe_transfers_active) profile = await syncAccountStatus(stripe, profile);
  if (!profile.stripe_transfers_active) return { status: 'account_incomplete', paid: [], failed: [] };

  const proPct = proPayoutPercent();
  const consulta = (cols) => `/rest/v1/walk_requests?walker_id=eq.${enc(walkerId)}&${ELIGIBLE_FILTER()}`
        + `&select=${cols}&order=created_at.asc&limit=50` + (walkId ? `&id=eq.${enc(walkId)}` : '');
  // walker_is_pro existe tras la migración de membresías; antes, todos cobran el porcentaje base
  let r0 = await sb(consulta('id,booking_id,scheduled_date,walker_is_pro'));
  if (!r0.ok && r0.data && r0.data.code === '42703') r0 = await sb(consulta('id,booking_id,scheduled_date'));
  if (!r0.ok) throw new Error(`Supabase walk_requests ${r0.status}: ${JSON.stringify(r0.data)}`);
  const walks = r0.data || [];

  const bookings = new Map();
  const paid = [], failed = [];
  for (const w of walks) {
    try {
      if (!bookings.has(w.booking_id)) {
        const b = (await sbOrThrow(`/rest/v1/bookings?id=eq.${enc(w.booking_id)}&select=*&limit=1`))[0] || null;
        bookings.set(w.booking_id, b);
      }
      const booking = bookings.get(w.booking_id);
      if (!booking || booking.payment_status !== 'paid') throw new Error('booking_not_paid');
      // Contracargo sin resolver: no se paga aunque el día se haya liberado (ver _lib/refunds.js)
      if (disputeBlocks(booking.dispute_status)) throw new Error('booking_disputed');
      // Socio Pro AL ACEPTAR el paseo (walk_requests.walker_is_pro, lo fija la base): 80 %; si no, el base (75 %)
      const pctPaseo = w.walker_is_pro === true && proPct ? proPct : pct;
      const amount = walkerEarningCents(booking, { pro: w.walker_is_pro === true });
      if (amount < 1) throw new Error('invalid_amount');
      const chargeId = await chargeIdForBooking(stripe, booking);
      if (!chargeId) throw new Error('charge_not_found');

      // Reclamo atómico: solo una petición puede pasar el día a 'processing'
      // (repite los filtros de elegibilidad: si el cliente reportó un problema hace un instante, no se paga)
      const claim = await sbOrThrow(
        `/rest/v1/walk_requests?id=eq.${enc(w.id)}&${ELIGIBLE_FILTER()}`,
        { method: 'PATCH', body: { walker_payout_status: 'processing', walker_payout_cents: amount, walker_payout_error: null }, prefer: 'return=representation' });
      if (!claim.length) continue; // otra petición ya lo está pagando

      try {
        const tr = await stripe.transfers.create({
          amount,
          currency: booking.currency || 'usd',
          destination: profile.stripe_account_id,
          source_transaction: chargeId, // los fondos salen de ESTE cobro (no del saldo disponible)
          transfer_group: booking.transfer_group || `booking_${booking.id}`,
          description: `Barkwalk · ${booking.service_label || 'Walk'} · ${w.scheduled_date || ''}`.slice(0, 200),
          metadata: { walk_id: String(w.id), booking_id: String(booking.id), walker_id: String(walkerId), percent: String(pctPaseo), pro: String(pctPaseo !== pct) },
        }, { idempotencyKey: `bw-payout-${w.id}` });
        await sbOrThrow(`/rest/v1/walk_requests?id=eq.${enc(w.id)}`, {
          method: 'PATCH', body: { walker_payout_status: 'paid', walker_transfer_id: tr.id, walker_paid_at: new Date().toISOString() }, prefer: 'return=minimal' });
        paid.push({ walkId: w.id, amount, transferId: tr.id });
      } catch (e) {
        await sb(`/rest/v1/walk_requests?id=eq.${enc(w.id)}`, {
          method: 'PATCH', body: { walker_payout_status: 'failed', walker_payout_error: String(e.message || e).slice(0, 300) }, prefer: 'return=minimal' });
        throw e;
      }
    } catch (e) {
      console.error(`Pago al paseador (walk ${w.id}):`, e.message);
      failed.push({ walkId: w.id, error: String(e.message || e).slice(0, 200) });
    }
  }
  return { status: 'ok', percent: pct, proPercent: proPct, paid, failed };
}

// Paseadores con al menos un día pagable (para el cron diario)
async function walkersWithDuePayouts(limit = 200) {
  const rows = await sbOrThrow(`/rest/v1/walk_requests?${ELIGIBLE_FILTER()}&walker_id=not.is.null&select=walker_id&limit=1000`);
  return [...new Set(rows.map((r) => String(r.walker_id)))].slice(0, limit);
}

module.exports = { ELIGIBLE_FILTER, listPriceCents, walkersWithDuePayouts, WALKER_ROLES, stripeKeyValid, getStripe, payoutPercent, siteUrl, getProfile, syncAccountStatus, payoutCompletedWalks };
