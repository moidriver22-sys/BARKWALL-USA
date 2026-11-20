// Pruebas del webhook de Stripe (reembolsos, disputas y eventos existentes) con Supabase y Stripe simulados. Ejecuta: npm test
const path = require('path');
const assert = require('assert');
const ROOT = process.argv[2] || path.join(__dirname, "..");
process.env.SUPABASE_URL = 'http://fake.supabase';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret_for_local_tests';
process.env.STRIPE_SECRET_KEY = 'sk_test_' + 'x'.repeat(24);
process.env.RESEND_API_KEY = ''; process.env.EMAIL_FROM = '';

// ---------- in-memory PostgREST ----------
let DB;
function reset() {
  DB = {
    bookings: [
      { id: 'b1', client_id: 'c1', payment_status: 'paid', status: 'paid', total_cents: 5000, stripe_payment_intent_id: 'pi_1', stripe_charge_id: 'ch_1', dispute_status: null },
    ],
    walk_requests: [
      { id: 'w1', booking_id: 'b1', created_at: '1', status: 'completed', payment_status: 'paid', walker_payout_status: 'paid', walker_transfer_id: 'tr_1', walker_payout_cents: 750, payout_review_required: false, payout_review_reason: null },
      { id: 'w2', booking_id: 'b1', created_at: '2', status: 'completed', payment_status: 'paid', walker_payout_status: 'unpaid', walker_transfer_id: null, payout_review_required: false, payout_review_reason: null },
      { id: 'w3', booking_id: 'b1', created_at: '3', status: 'accepted', payment_status: 'paid', walker_payout_status: 'unpaid', payout_review_required: false },
      { id: 'w4', booking_id: 'b1', created_at: '4', status: 'pending', payment_status: 'paid', walker_payout_status: 'unpaid', payout_review_required: false },
      { id: 'w5', booking_id: 'b1', created_at: '5', status: 'cancelled', payment_status: 'paid', walker_payout_status: 'unpaid', payout_review_required: false },
      { id: 'w6', booking_id: 'b1', created_at: '6', status: 'in_progress', payment_status: 'paid', walker_payout_status: 'unpaid', payout_review_required: false },
    ],
  };
}
function match(row, key, expr) {
  const v = row[key];
  if (expr.startsWith('eq.')) return String(v) === decodeURIComponent(expr.slice(3));
  if (expr.startsWith('neq.')) return String(v) !== decodeURIComponent(expr.slice(4));
  if (expr === 'is.null') return v == null;
  if (expr === 'not.is.null') return v != null;
  if (expr.startsWith('is.false')) return v === false;
  if (expr.startsWith('in.(')) return decodeURIComponent(expr.slice(4, -1)).split(',').map(s => s.replace(/"/g, '')).includes(String(v));
  throw new Error('unsupported filter ' + key + '=' + expr);
}
let RESEND = { calls: [], status: 200 };
global.fetch = async (url, opts = {}) => {
  if (String(url).startsWith('https://api.resend.com/')) { // Resend simulado
    RESEND.calls.push({ headers: opts.headers, body: JSON.parse(opts.body) });
    return resp(RESEND.status, RESEND.status < 300 ? { id: 'email_' + RESEND.calls.length } : { message: 'simulated error' });
  }
  const u = new URL(url);
  const table = u.pathname.replace('/rest/v1/', '');
  const rows = DB[table];
  if (!rows) return resp(404, { code: 'PGRST205' });
  if (opts.method === 'POST') { // insert con on_conflict=booking_id,scheduled_date + ignore-duplicates
    const nuevos = JSON.parse(opts.body), creados = [];
    for (const n of [].concat(nuevos)) {
      const dup = rows.find(r => r.booking_id === n.booking_id && r.scheduled_date === n.scheduled_date && n.scheduled_date);
      if (dup) continue;
      const row = { id: 'w' + (rows.length + 100), walker_payout_status: 'unpaid', payout_review_required: false, created_at: String(Date.now()), ...n };
      rows.push(row); creados.push(row);
    }
    return resp(201, creados);
  }
  const filters = [...u.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'on_conflict'].includes(k));
  const hit = rows.filter(r => filters.every(([k, e]) => match(r, k, e))); // searchParams ya decodifica
  if ((opts.method || 'GET') === 'GET') return resp(200, hit.slice(0, Number(u.searchParams.get('limit')) || 1000));
  if (opts.method === 'PATCH') { const b = JSON.parse(opts.body); hit.forEach(r => Object.assign(r, b)); return resp(200, (opts.headers.Prefer || '').includes('representation') ? hit : null); }
  throw new Error('unsupported ' + opts.method);
};
function resp(status, data) { const t = data == null ? '' : JSON.stringify(data); return { ok: status < 300, status, text: async () => t, json: async () => data }; }

// ---------- fake Stripe (real webhooks.constructEvent; fake API calls) ----------
const stripeMod = require.resolve('stripe', { paths: [ROOT] });
const RealStripe = require(stripeMod);
let REVERSALS, CHARGE, DISPUTE, PI, SUB;
process.env.STRIPE_PRICE_CLUB = 'price_CLUBtest1234'; process.env.STRIPE_PRICE_WALKER_PRO = 'price_PROtest12345';
function FakeStripe(key, o) {
  const s = RealStripe(key, o);
  s.transfers.createReversal = async (tr, params, { idempotencyKey }) => {
    if (REVERSALS.keys.has(idempotencyKey)) return REVERSALS.keys.get(idempotencyKey);
    if (tr === 'tr_fail') throw new Error('Insufficient funds in the connected account');
    const r = { id: 'trr_' + (REVERSALS.n++), amount: 750, transfer: tr }; REVERSALS.keys.set(idempotencyKey, r); REVERSALS.calls++; return r;
  };
  s.charges.retrieve = async () => CHARGE;
  s.disputes.retrieve = async () => DISPUTE;
  s.paymentIntents.retrieve = async () => PI;
  s.subscriptions.retrieve = async () => SUB;
  return s;
}
Object.assign(FakeStripe, RealStripe);
require.cache[stripeMod] = { id: stripeMod, filename: stripeMod, loaded: true, exports: FakeStripe };

const { handleChargeRefunded, handleDispute, disputeBlocks } = require(path.join(ROOT, 'api/_lib/refunds.js'));
const webhook = require(path.join(ROOT, 'api/stripe-webhook.js'));
const W = (id) => DB.walk_requests.find(w => w.id === id);
const fake = () => FakeStripe(process.env.STRIPE_SECRET_KEY);
let passed = 0;
const t = async (name, fn) => { reset(); REVERSALS = { n: 1, keys: new Map(), calls: 0 }; await fn(); passed++; console.log('✓', name); };

async function callWebhook(type, object) {
  const payload = JSON.stringify({ id: 'evt_' + Math.random(), object: 'event', type, created: Math.floor(Date.now() / 1000), data: { object } });
  const header = RealStripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const { Readable } = require('stream');
  const req = Readable.from([Buffer.from(payload)]); req.method = 'POST'; req.headers = { 'stripe-signature': header };
  const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await webhook(req, res);
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

(async () => {
  await t('reembolso total: cancela no iniciados, bloquea pendientes, revierte pagados, no toca cancelados', async () => {
    CHARGE = { id: 'ch_1', payment_intent: 'pi_1', amount: 5000, amount_refunded: 5000, refunded: true };
    const r = await handleChargeRefunded(CHARGE, fake(), true);
    const b = DB.bookings[0];
    assert.equal(b.payment_status, 'refunded'); assert.equal(b.status, 'cancelled'); assert.equal(b.refunded_cents, 5000);
    assert.equal(W('w3').status, 'cancelled'); assert.equal(W('w4').status, 'cancelled'); assert.equal(W('w3').payment_status, 'refunded');
    assert.equal(W('w2').payment_status, 'refunded'); assert.equal(W('w2').payout_review_required, true);
    assert.equal(W('w6').status, 'in_progress'); assert.equal(W('w6').payment_status, 'refunded'); // no se corta un paseo en curso
    assert.equal(W('w1').walker_payout_status, 'reversed'); assert.ok(W('w1').walker_transfer_reversal_id);
    assert.deepEqual(W('w5'), { id: 'w5', booking_id: 'b1', created_at: '5', status: 'cancelled', payment_status: 'paid', walker_payout_status: 'unpaid', payout_review_required: false });
    assert.equal(r.reversed, 1); assert.equal(r.cancelled, 2);
    // Reentrega del mismo evento: nada nuevo
    const r2 = await handleChargeRefunded(CHARGE, fake(), true);
    assert.equal(REVERSALS.calls, 1); assert.equal(r2.reversed, 0); assert.equal(r2.cancelled, 0);
  });

  await t('reembolso parcial: solo retiene pagos pendientes, no cancela ni revierte', async () => {
    CHARGE = { id: 'ch_1', payment_intent: 'pi_1', amount: 5000, amount_refunded: 1000, refunded: false };
    const r = await handleChargeRefunded(CHARGE, fake(), true);
    assert.equal(DB.bookings[0].payment_status, 'paid'); assert.equal(DB.bookings[0].refunded_cents, 1000);
    assert.equal(W('w3').status, 'accepted'); assert.equal(W('w2').payout_review_required, true); assert.equal(W('w6').payout_review_required, true);
    assert.equal(W('w1').walker_payout_status, 'paid'); assert.equal(REVERSALS.calls, 0); assert.equal(r.held, 2);
  });

  await t('disputa abierta → ganada: cancela no iniciados, retiene y luego libera SOLO lo retenido por la disputa', async () => {
    W('w6').status = 'completed'; W('w6').payout_review_required = true; W('w6').payout_review_reason = 'sin señal GPS durante el paseo';
    DISPUTE = { id: 'dp_1', charge: 'ch_1', payment_intent: 'pi_1', status: 'needs_response', created: 1 };
    await handleDispute('charge.dispute.created', DISPUTE, fake(), true);
    assert.equal(DB.bookings[0].dispute_status, 'needs_response'); assert.equal(W('w4').status, 'cancelled');
    assert.equal(W('w2').payout_review_reason, 'disputa abierta (contracargo)'); assert.equal(REVERSALS.calls, 0);
    assert.ok(disputeBlocks(DB.bookings[0].dispute_status));
    DISPUTE = { ...DISPUTE, status: 'won' };
    const r = await handleDispute('charge.dispute.closed', DISPUTE, fake(), true);
    assert.equal(W('w2').payout_review_required, false); assert.equal(r.released, 1);
    assert.equal(W('w6').payout_review_required, true, 'la retención por GPS se mantiene');
    assert.ok(!disputeBlocks(DB.bookings[0].dispute_status));
  });

  await t('disputa perdida: bloquea pagos y revierte transferencias', async () => {
    DISPUTE = { id: 'dp_1', charge: 'ch_1', payment_intent: 'pi_1', status: 'lost', created: 1 };
    const r = await handleDispute('charge.dispute.closed', DISPUTE, fake(), true);
    assert.equal(DB.bookings[0].payment_status, 'refunded'); assert.equal(W('w1').walker_payout_status, 'reversed');
    assert.equal(W('w2').payment_status, 'refunded'); assert.equal(r.reversed, 1);
  });

  await t('reversión fallida (saldo insuficiente) queda anotada para el admin y no lanza', async () => {
    W('w1').walker_transfer_id = 'tr_fail';
    CHARGE = { id: 'ch_1', payment_intent: 'pi_1', amount: 5000, amount_refunded: 5000, refunded: true };
    const r = await handleChargeRefunded(CHARGE, fake(), true);
    assert.equal(r.reversalFailed, 1); assert.equal(W('w1').walker_payout_status, 'paid');
    assert.match(W('w1').walker_payout_error, /reversal_failed/); assert.equal(W('w1').payout_review_required, true);
  });

  await t('webhook firmado: reembolso de una factura (sin reserva) → 200 ignorado', async () => {
    CHARGE = { id: 'ch_sub', payment_intent: 'pi_sub', amount: 1299, amount_refunded: 1299, refunded: true };
    const r = await callWebhook('charge.refunded', CHARGE);
    assert.equal(r.status, 200); assert.equal(r.body.ignored, 'booking not found');
  });

  await t('webhook firmado: reembolso total → 200 y transferencia revertida', async () => {
    CHARGE = { id: 'ch_1', payment_intent: 'pi_1', amount: 5000, amount_refunded: 5000, refunded: true };
    const r = await callWebhook('charge.refunded', CHARGE);
    assert.equal(r.status, 200); assert.equal(r.body.refund, 'full'); assert.equal(W('w1').walker_payout_status, 'reversed');
  });

  await t('webhook firmado: pago al paseador en curso → 500 para que Stripe reintente', async () => {
    W('w1').walker_payout_status = 'processing';
    CHARGE = { id: 'ch_1', payment_intent: 'pi_1', amount: 5000, amount_refunded: 5000, refunded: true };
    const r = await callWebhook('charge.refunded', CHARGE);
    assert.equal(r.status, 500); assert.equal(r.body.error, 'payout_in_progress');
    W('w1').walker_payout_status = 'paid'; // el cron terminó; Stripe reintenta
    const r2 = await callWebhook('charge.refunded', CHARGE);
    assert.equal(r2.status, 200); assert.equal(W('w1').walker_payout_status, 'reversed');
  });

  await t('webhook: firma inválida → 400', async () => {
    const { Readable } = require('stream');
    const req = Readable.from([Buffer.from('{}')]); req.method = 'POST'; req.headers = { 'stripe-signature': 't=1,v1=bad' };
    const res = { setHeader() {}, end(b) { this.body = b; } };
    await webhook(req, res); assert.equal(res.statusCode, 400);
  });

  // ---------- Regresión: eventos que ya existían ----------
  const bookingNuevo = () => {
    DB.bookings.push({ id: 'b2', client_id: 'c2', payment_status: 'pending', status: 'awaiting_payment', total_cents: 4400, per_day_cents: 2200, currency: 'usd',
      dates: ['2026-12-01', '2026-12-02'], pets: [{ id: 'p1', name: 'Luna' }], pets_count: 1, service_label: '🚶 Standard Walk · 30 min', scheduled_time: '09:00', address: '1 Main St' });
    DB.profiles = [{ id: 'c2', full_name: 'Ana', role: 'client', stripe_customer_id: 'cus_2', stripe_subscription_id: null, membership_tier: 'free', membership_status: 'inactive' }];
  };
  await t('regresión payment_intent.succeeded: marca pagada, crea 2 días, sin duplicar en reintento', async () => {
    bookingNuevo();
    PI = { id: 'pi_2', status: 'succeeded', amount_received: 4400, currency: 'usd', created: 1, latest_charge: 'ch_2', metadata: { booking_id: 'b2' } };
    const r = await callWebhook('payment_intent.succeeded', PI);
    assert.equal(r.status, 200); assert.equal(r.body.paid, true);
    const b = DB.bookings.find(x => x.id === 'b2');
    assert.equal(b.payment_status, 'paid'); assert.ok(b.walks_created_at);
    assert.equal(DB.walk_requests.filter(w => w.booking_id === 'b2').length, 2);
    b.walks_created_at = null; // fuerza que el reintento vuelva a intentar insertar
    await callWebhook('payment_intent.succeeded', PI);
    assert.equal(DB.walk_requests.filter(w => w.booking_id === 'b2').length, 2, 'sin días duplicados');
  });
  await t('regresión payment_intent.succeeded con monto distinto: NO se marca pagada', async () => {
    bookingNuevo();
    PI = { id: 'pi_2', status: 'succeeded', amount_received: 100, currency: 'usd', metadata: { booking_id: 'b2' } };
    const r = await callWebhook('payment_intent.succeeded', PI);
    assert.equal(r.status, 200); assert.equal(r.body.reason, 'amount_mismatch');
    assert.equal(DB.bookings.find(x => x.id === 'b2').payment_status, 'pending');
  });
  await t('regresión customer.subscription.updated: activa Barkwalk Club', async () => {
    bookingNuevo();
    SUB = { id: 'sub_2', customer: 'cus_2', status: 'active', metadata: {}, items: { data: [{ price: { id: 'price_CLUBtest1234' }, current_period_end: 1893456000 }] } };
    const r = await callWebhook('customer.subscription.updated', SUB);
    assert.equal(r.status, 200); assert.equal(r.body.membership, 'ok');
    assert.equal(DB.profiles[0].membership_tier, 'club'); assert.equal(DB.profiles[0].stripe_subscription_id, 'sub_2');
  });
  await t('regresión checkout.session.completed (suscripción) → sincroniza; (pago único) → ignorado', async () => {
    bookingNuevo();
    SUB = { id: 'sub_3', customer: 'cus_2', status: 'active', metadata: {}, items: { data: [{ price: { id: 'price_CLUBtest1234' } }] } };
    const r = await callWebhook('checkout.session.completed', { id: 'cs_1', mode: 'subscription', subscription: 'sub_3' });
    assert.equal(r.status, 200); assert.equal(DB.profiles[0].stripe_subscription_id, 'sub_3');
    const r2 = await callWebhook('checkout.session.completed', { id: 'cs_2', mode: 'payment' });
    assert.equal(r2.status, 200); assert.equal(r2.body.ignored, 'checkout_not_subscription');
  });
  await t('regresión customer.subscription.deleted: vuelve a plan gratuito', async () => {
    bookingNuevo(); DB.profiles[0].stripe_subscription_id = 'sub_2'; DB.profiles[0].membership_tier = 'club';
    SUB = { id: 'sub_2', customer: 'cus_2', status: 'canceled', metadata: {}, items: { data: [{ price: { id: 'price_CLUBtest1234' } }] } };
    const r = await callWebhook('customer.subscription.deleted', SUB);
    assert.equal(r.status, 200); assert.equal(DB.profiles[0].membership_tier, 'free'); assert.equal(DB.profiles[0].stripe_subscription_id, null);
  });
  await t('regresión: evento no manejado → 200 ignorado', async () => {
    const r = await callWebhook('invoice.paid', { id: 'in_1' });
    assert.equal(r.status, 200); assert.equal(r.body.ignored, 'invoice.paid');
  });

  // ---------- Correo de reembolso al cliente (Resend) ----------
  const conResend = async (fn) => {
    process.env.RESEND_API_KEY = 're_test_key'; RESEND = { calls: [], status: 200 };
    DB.profiles = [{ id: 'c1', full_name: 'Ana Pérez', email: 'ana.perfil@example.com', role: 'client' }];
    DB.walk_requests.forEach((w, i) => { w.scheduled_date = `2026-12-0${i + 1}`; w.scheduled_time = '09:30:00'; });
    try { await fn(); } finally { process.env.RESEND_API_KEY = ''; }
  };
  await t('correo de reembolso total: soporte@, monto, referencia y días cancelados', async () => conResend(async () => {
    CHARGE = { id: 'ch_1', payment_intent: 'pi_1', amount: 5000, amount_refunded: 5000, refunded: true, currency: 'usd', billing_details: { email: 'ana@cliente.com' } };
    const r = await callWebhook('charge.refunded', CHARGE);
    assert.equal(r.status, 200); assert.equal(r.body.email, 'sent'); assert.equal(r.body.notify, undefined, 'sin datos del cliente en la respuesta');
    assert.equal(RESEND.calls.length, 1);
    const { body, headers } = RESEND.calls[0];
    assert.equal(body.from, 'Barkwalk USA <soporte@barkwalkusa.com>'); assert.deepEqual(body.to, ['ana@cliente.com']);
    assert.equal(body.reply_to, 'soporte@barkwalkusa.com'); assert.equal(headers['Idempotency-Key'], 'refund-ch_1-5000');
    assert.match(body.subject, /Reembolso confirmado \(\$50\.00\) · #b1/);
    assert.match(body.html, /email-logo\.png/); assert.match(body.html, /\$50\.00/); assert.match(body.html, /#b1/);
    assert.match(body.html, /quedaron <strong>cancelados<\/strong>/);
    assert.equal((body.html.match(/>Cancelado</g) || []).length, 3, 'w3 y w4 cancelados ahora + w5 que ya lo estaba');
    assert.equal((body.html.match(/>Completado</g) || []).length, 2, 'w1 y w2 ya se hicieron');
    assert.equal((body.html.match(/>En curso</g) || []).length, 1, 'w6 en curso no se corta');
    assert.ok(!/Sigue activo/.test(body.html), 'en un reembolso total nada figura como activo');
    assert.match(body.text, /Días cancelados:/);
  }));
  await t('correo de reembolso: sin email en Stripe → usa el de profiles', async () => conResend(async () => {
    CHARGE = { id: 'ch_1', payment_intent: 'pi_1', amount: 5000, amount_refunded: 5000, refunded: true, currency: 'usd', billing_details: { email: null }, receipt_email: null };
    await callWebhook('charge.refunded', CHARGE);
    assert.deepEqual(RESEND.calls[0].body.to, ['ana.perfil@example.com']);
    assert.match(RESEND.calls[0].body.html, /Hola Ana Pérez/);
  }));
  await t('correo de reembolso parcial: texto de reserva activa', async () => conResend(async () => {
    CHARGE = { id: 'ch_1', payment_intent: 'pi_1', amount: 5000, amount_refunded: 1000, refunded: false, currency: 'usd', receipt_email: 'ana@cliente.com' };
    await callWebhook('charge.refunded', CHARGE);
    assert.match(RESEND.calls[0].body.subject, /Reembolso parcial confirmado \(\$10\.00\)/);
    assert.match(RESEND.calls[0].body.html, /tu reserva sigue activa/);
    assert.equal(RESEND.calls[0].headers['Idempotency-Key'], 'refund-ch_1-1000');
  }));
  await t('correo de reembolso: Resend 5xx → 500 para que Stripe reintente; 4xx → 200 sin reintento', async () => conResend(async () => {
    CHARGE = { id: 'ch_1', payment_intent: 'pi_1', amount: 5000, amount_refunded: 5000, refunded: true, currency: 'usd', receipt_email: 'ana@cliente.com' };
    RESEND.status = 503;
    const r = await callWebhook('charge.refunded', CHARGE);
    assert.equal(r.status, 500); assert.equal(r.body.error, 'email_retry');
    RESEND.status = 422;
    const r2 = await callWebhook('charge.refunded', CHARGE);
    assert.equal(r2.status, 200); assert.equal(r2.body.email, 'failed');
    assert.equal(DB.bookings[0].payment_status, 'refunded', 'el reembolso queda aplicado aunque falle el correo');
  }));
  await t('correo de reembolso: cargo sin reserva (p. ej. membresía) → no se envía', async () => conResend(async () => {
    CHARGE = { id: 'ch_sub', payment_intent: 'pi_sub', amount: 1299, amount_refunded: 1299, refunded: true, receipt_email: 'x@y.com' };
    const r = await callWebhook('charge.refunded', CHARGE);
    assert.equal(r.status, 200); assert.equal(RESEND.calls.length, 0);
  }));
  await t('correo de reembolso: sin RESEND_API_KEY → 200 y "skipped"', async () => {
    CHARGE = { id: 'ch_1', payment_intent: 'pi_1', amount: 5000, amount_refunded: 5000, refunded: true, receipt_email: 'ana@cliente.com' };
    const r = await callWebhook('charge.refunded', CHARGE);
    assert.equal(r.status, 200); assert.equal(r.body.email, 'skipped');
  });

  console.log(`\n${passed} pruebas OK`);
})().catch(e => { console.error('✗ FALLO:', e.message); process.exit(1); });
