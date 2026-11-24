// Pruebas de reembolsos por cancelación (api/_lib/cancellations.js) y del reembolso parcial por días (refunds.js).
// Supabase REST, Stripe y Resend simulados en memoria. Ejecuta: npm test
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
process.env.SUPABASE_URL = 'http://fake.supabase';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
process.env.RESEND_API_KEY = 're_test';
process.env.OPS_ALERT_EMAIL = 'ops@barkwalkusa.com';
const C = require(path.join(ROOT, 'api/_lib/cancellations.js'));
const { handleChargeRefunded, REASON } = require(path.join(ROOT, 'api/_lib/refunds.js'));
require(path.join(ROOT, 'api/_lib/push.js')).setPushSender(async () => ({ statusCode: 201 }));

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('✓', name); };
const B = { id: 'bk1', per_day_cents: 1600, total_cents: 4800, refunded_cents: 0, payment_status: 'paid', dispute_status: null, stripe_payment_intent_id: 'pi_1', currency: 'usd' };
const can = (o) => ({ walk_id: 'w', booking_id: 'bk1', cancelled_by: 'client', walker_assigned: false, hours_before: 3, prev_status: 'pending', ...o });

// ---------- PostgREST simulado ----------
let DB, RESEND, REFUNDS;
function reset() {
  DB = { walk_cancellations: [], bookings: [{ ...B }], walk_requests: [], profiles: [{ id: 'adm', is_admin: true }], push_subscriptions: [] };
  RESEND = []; REFUNDS = [];
}
const resp = (status, data) => { const s = data == null ? '' : JSON.stringify(data); return { ok: status < 300, status, text: async () => s, json: async () => data }; };
function match(row, k, e) {
  const [op, ...r] = e.split('.'); const v = r.join('.');
  if (op === 'eq') return String(row[k]) === v;
  if (op === 'is') return v === 'null' ? row[k] == null : String(row[k]) === v;
  if (op === 'in') return v.slice(1, -1).split(',').map((x) => x.replace(/"/g, '')).includes(String(row[k]));
  throw new Error('filtro ' + k + '=' + e);
}
global.fetch = async (url, opts = {}) => {
  if (String(url).startsWith('https://api.resend.com/')) { RESEND.push(JSON.parse(opts.body)); return resp(200, { id: 'e' }); }
  const u = new URL(url); const table = u.pathname.replace('/rest/v1/', ''); const rows = DB[table];
  if (!rows) return resp(404, { code: 'PGRST205' });
  const f = [...u.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'on_conflict'].includes(k));
  const hit = rows.filter((r) => f.every(([k, e]) => match(r, k, e)));
  const m = opts.method || 'GET';
  if (m === 'GET') return resp(200, hit);
  if (m === 'PATCH') { const body = JSON.parse(opts.body); hit.forEach((r) => Object.assign(r, body)); return resp(200, hit); }
  return resp(405, {});
};
const stripe = { refunds: { create: async (p, o) => { if (stripe.fail) throw new Error('insufficient'); REFUNDS.push({ ...p, key: o.idempotencyKey }); return { id: 're_' + REFUNDS.length }; } } };

(async () => {
  // ---------- Reglas (Términos sección 6) ----------
  await t('100 % automático: antes de que alguien acepte, con ≥ 24 h, o si cancela el Paseador / Barkwalk', async () => {
    assert.deepEqual(C.decideRefund(can({ walker_assigned: false, hours_before: 1 }), B), { action: 'refund', reason: 'before_acceptance', cents: 1600 });
    assert.deepEqual(C.decideRefund(can({ walker_assigned: true, hours_before: 24 }), B), { action: 'refund', reason: 'at_least_24h', cents: 1600 });
    assert.equal(C.decideRefund(can({ cancelled_by: 'walker', walker_assigned: true, hours_before: 1 }), B).cents, 1600);
    assert.equal(C.decideRefund(can({ cancelled_by: 'admin', walker_assigned: true, hours_before: 0.5 }), B).reason, 'barkwalk_cancelled');
  });
  await t('50 %: aviso al equipo con el monto exacto (cliente, < 24 h, con paseador)', async () => {
    assert.deepEqual(C.decideRefund(can({ walker_assigned: true, hours_before: 23.9, prev_status: 'accepted' }), B),
      { action: 'review', reason: 'late_cancellation_50', suggestedCents: 800 });
  });
  await t('casos especiales → aviso: disputa abierta, reserva no pagada, excede lo que queda, sin hora; servidor → se ignora', async () => {
    assert.equal(C.decideRefund(can(), { ...B, dispute_status: 'needs_response' }).reason, 'dispute_open');
    assert.equal(C.decideRefund(can(), { ...B, payment_status: 'refunded' }).reason, 'booking_not_paid');
    assert.deepEqual(C.decideRefund(can(), { ...B, refunded_cents: 4000 }), { action: 'review', reason: 'exceeds_remaining', suggestedCents: 800 });
    assert.equal(C.decideRefund(can({ walker_assigned: true, hours_before: null }), B).reason, 'special_case');
    assert.equal(C.decideRefund(can({ cancelled_by: 'system' }), B).action, 'skip');
    assert.equal(C.decideRefund(can({ walker_assigned: false, hours_before: 3 }), { ...B, dispute_status: 'won' }).action, 'refund', 'disputa ganada no bloquea');
  });

  // ---------- Ejecución ----------
  await t('ejecución: reembolsa en Stripe (idempotente por día), avisa el 50 % y no repite en la siguiente ronda', async () => {
    reset();
    DB.walk_cancellations.push({ ...can({ walk_id: 'w1' }), status: 'pending', cancelled_at: '1' },
      { ...can({ walk_id: 'w2', walker_assigned: true, hours_before: 5, prev_status: 'accepted' }), status: 'pending', cancelled_at: '2' },
      { ...can({ walk_id: 'w3', cancelled_by: 'system' }), status: 'pending', cancelled_at: '3' });
    DB.walk_requests.push({ id: 'w1', scheduled_date: '2099-01-01' }, { id: 'w2', scheduled_date: '2099-01-02', scheduled_time: '10:00' }, { id: 'w3' });
    const r = await C.processCancellations({ stripe });
    assert.deepEqual([r.refunded, r.review, r.skipped, r.failed], [1, 1, 1, 0]);
    assert.deepEqual(REFUNDS.map((x) => [x.payment_intent, x.amount, x.key, x.metadata.kind]), [['pi_1', 1600, 'bw-cancel-refund-w1', 'walk_cancellation']]);
    const w = (id) => DB.walk_cancellations.find((c) => c.walk_id === id);
    assert.equal(w('w1').status, 'refunded'); assert.equal(w('w1').refund_cents, 1600); assert.equal(w('w1').stripe_refund_id, 're_1');
    assert.equal(w('w2').status, 'needs_review'); assert.equal(w('w2').suggested_cents, 800); assert.ok(w('w2').notified_at);
    assert.equal(w('w3').status, 'skipped');
    assert.equal(RESEND.length, 1); assert.match(RESEND[0].subject, /reembolso sugerido \$8\.00/); assert.deepEqual(RESEND[0].to, ['ops@barkwalkusa.com']);
    const r2 = await C.processCancellations({ stripe });
    assert.equal(r2.checked, 0); assert.equal(REFUNDS.length, 1, 'sin doble reembolso');
  });
  await t('si Stripe rechaza el reembolso: queda en revisión y se avisa al equipo (nunca se pierde)', async () => {
    reset(); stripe.fail = true;
    DB.walk_cancellations.push({ ...can({ walk_id: 'w1' }), status: 'pending' });
    const r = await C.processCancellations({ stripe });
    stripe.fail = false;
    assert.equal(r.failed, 1);
    const c = DB.walk_cancellations[0];
    assert.equal(c.status, 'needs_review'); assert.equal(c.decision, 'refund_failed'); assert.equal(c.suggested_cents, 1600); assert.equal(c.refund_cents, null);
    assert.equal(RESEND.length, 1);
  });
  await t('modo prueba (dry): solo informa, no reembolsa ni cambia nada', async () => {
    reset();
    DB.walk_cancellations.push({ ...can({ walk_id: 'w1' }), status: 'pending' });
    const r = await C.processCancellations({ stripe, dryRun: true });
    assert.deepEqual(r.items.map((i) => i.action), ['refund']); assert.equal(REFUNDS.length, 0); assert.equal(DB.walk_cancellations[0].status, 'pending');
  });

  // ---------- Reembolso parcial: los demás días NO se bloquean ----------
  await t('explainPartialRefund: automáticos, 50 % hecho a mano por el monto sugerido, y monto que no cuadra', async () => {
    const rows = [{ walk_id: 'a', status: 'refunded', refund_cents: 1600 }, { walk_id: 'b', status: 'needs_review', suggested_cents: 800 }];
    assert.deepEqual(C.explainPartialRefund(1600, rows), { explained: true, manualIds: [] });
    assert.deepEqual(C.explainPartialRefund(2400, rows), { explained: true, manualIds: ['b'] });
    assert.deepEqual(C.explainPartialRefund(2000, rows), { explained: false, manualIds: [] });
    assert.deepEqual(C.explainPartialRefund(1600, [{ walk_id: 'a', status: 'refunding', refund_cents: 1600 }]).explained, true, 'el webhook puede llegar antes de anotar "refunded"');
  });
  const walks = () => [
    { id: 'w1', booking_id: 'bk1', status: 'cancelled', payment_status: 'paid', walker_payout_status: 'unpaid' },
    { id: 'w2', booking_id: 'bk1', status: 'completed', payment_status: 'paid', walker_payout_status: 'unpaid' },
    { id: 'w3', booking_id: 'bk1', status: 'accepted', payment_status: 'paid', walker_payout_status: 'unpaid' },
  ];
  await t('charge.refunded parcial por un día cancelado: el día completado sigue pagable al paseador', async () => {
    reset();
    DB.walk_requests = walks();
    DB.walk_cancellations.push({ walk_id: 'w1', booking_id: 'bk1', status: 'refunded', refund_cents: 1600 });
    const r = await handleChargeRefunded({ id: 'ch_1', payment_intent: 'pi_1', amount: 4800, amount_refunded: 1600, refunded: false, currency: 'usd' }, null, false);
    assert.equal(r.explainedByCancellations, true); assert.equal(r.held, 0);
    assert.ok(DB.walk_requests.every((w) => !w.payout_review_required), 'ningún día retenido');
    assert.equal(DB.bookings[0].refunded_cents, 1600); assert.equal(DB.bookings[0].payment_status, 'paid', 'la reserva sigue pagada');
  });
  await t('el 50 % reembolsado a mano por el monto exacto se reconoce y queda como "refunded_manual"', async () => {
    reset();
    DB.walk_requests = walks();
    DB.walk_cancellations.push({ walk_id: 'w1', booking_id: 'bk1', status: 'needs_review', suggested_cents: 800 });
    const r = await handleChargeRefunded({ id: 'ch_1', payment_intent: 'pi_1', amount: 4800, amount_refunded: 800, refunded: false }, null, false);
    assert.equal(r.held, 0); assert.equal(DB.walk_cancellations[0].status, 'refunded_manual'); assert.equal(DB.walk_cancellations[0].refund_cents, 800);
  });
  await t('un reembolso parcial que NO se explica por cancelaciones sigue reteniendo para revisión (como antes)', async () => {
    reset();
    DB.walk_requests = walks();
    const r = await handleChargeRefunded({ id: 'ch_1', payment_intent: 'pi_1', amount: 4800, amount_refunded: 1000, refunded: false }, null, false);
    assert.equal(r.held, 1); assert.equal(DB.walk_requests[1].payout_review_reason, REASON.partial);
  });

  console.log(`\n${n} pruebas OK`);
})().catch((e) => { console.error('✗ FALLO:', e.stack); process.exit(1); });
