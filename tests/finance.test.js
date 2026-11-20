// Pruebas del Agente de Cobros y Finanzas (api/_lib/finance-agent.js + /api/dispatch?action=finance_audit)
// Supabase REST, Stripe y Resend simulados; reloj fijo. Ejecuta: npm test
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
process.env.SUPABASE_URL = 'http://fake.supabase';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
process.env.CRON_SECRET = 'cron-secret-for-tests-1234';
process.env.RESEND_API_KEY = 're_test';
process.env.OPS_ALERT_EMAIL = 'ops@barkwalkusa.com';
process.env.STRIPE_SECRET_KEY = ''; // el endpoint no crea un cliente real de Stripe en las pruebas

const H = 3600 * 1000;
const NOW = Date.parse('2026-11-21T14:00:00Z');           // 8:00 AM Birmingham → cierre del 2026-11-20
const iso = (h) => new Date(NOW + h * H).toISOString();
const sec = (isoStr) => Math.floor(Date.parse(isoStr) / 1000);

let DB, RESEND;
function reset() {
  DB = {
    dispatch_alerts: [],
    walk_requests: [
      { id: 'w-over', booking_id: 'b-good', status: 'completed', payment_status: 'paid', completed_at: iso(-80), walker_payout_status: 'unpaid', payout_review_required: false, payout_eligible_at: iso(-30) },
      { id: 'w-fail', booking_id: 'b-good', status: 'completed', payment_status: 'paid', completed_at: iso(-80), walker_payout_status: 'failed', walker_payout_error: 'account closed', payout_review_required: false, payout_eligible_at: iso(-30) },
      { id: 'w-stuck', booking_id: 'b-good', status: 'completed', payment_status: 'paid', completed_at: iso(-60), walker_payout_status: 'processing', payout_review_required: false, payout_eligible_at: iso(-5) },
      { id: 'w-review', booking_id: 'b-good', status: 'completed', payment_status: 'paid', completed_at: iso(-130), walker_payout_status: 'unpaid', payout_review_required: true, payout_review_reason: 'sin señal GPS', payout_eligible_at: iso(-80) },
      { id: 'w-review-new', booking_id: 'b-good', status: 'completed', payment_status: 'paid', completed_at: iso(-58), walker_payout_status: 'unpaid', payout_review_required: true, payout_eligible_at: iso(-10) },
      { id: 'w-paid', booking_id: 'b-good', status: 'completed', payment_status: 'paid', completed_at: iso(-70), walker_payout_status: 'paid', walker_transfer_id: 'tr_1', walker_payout_cents: 1200, walker_paid_at: '2026-11-20T18:00:00Z', payout_eligible_at: iso(-22) },
      { id: 'w-future', booking_id: 'b-good', status: 'completed', payment_status: 'paid', completed_at: iso(-2), walker_payout_status: 'unpaid', payout_review_required: false, payout_eligible_at: iso(46) },
      { id: 'w-refunded', booking_id: 'b-ref', status: 'completed', payment_status: 'refunded', completed_at: iso(-90), walker_payout_status: 'unpaid', payout_review_required: true, payout_eligible_at: iso(-80) },
    ],
    bookings: [
      { id: 'b-good', status: 'paid', payment_status: 'paid', total_cents: 2200, refunded_cents: 0, paid_at: '2026-11-20T15:00:00Z', created_at: iso(-30), stripe_payment_intent_id: 'pi_good', walks_created_at: iso(-30) },
      { id: 'b-nowalks', status: 'paid', payment_status: 'paid', total_cents: 1600, refunded_cents: 0, paid_at: iso(-3), created_at: iso(-3), stripe_payment_intent_id: 'pi_nw', walks_created_at: null },
      { id: 'b-await', status: 'awaiting_payment', payment_status: 'pending', total_cents: 1600, refunded_cents: 0, created_at: iso(-3), stripe_payment_intent_id: 'pi_await' },
      { id: 'b-ref', status: 'paid', payment_status: 'paid', total_cents: 1600, refunded_cents: 0, paid_at: iso(-20), created_at: iso(-20), stripe_payment_intent_id: 'pi_ref', walks_created_at: iso(-20) },
    ],
  };
  RESEND = { calls: [], status: 200 };
}
const CHARGES = () => [
  { id: 'ch_good', payment_intent: 'pi_good', amount: 2200, status: 'succeeded', paid: true, created: sec('2026-11-20T15:00:00Z'), amount_refunded: 0, metadata: { booking_id: 'b-good' } },
  { id: 'ch_nw', payment_intent: 'pi_nw', amount: 1600, status: 'succeeded', paid: true, created: sec(iso(-3)), amount_refunded: 0, metadata: { booking_id: 'b-nowalks' } },
  { id: 'ch_await', payment_intent: 'pi_await', amount: 1600, status: 'succeeded', paid: true, created: sec(iso(-2)), amount_refunded: 0, metadata: { booking_id: 'b-await' } },
  { id: 'ch_ref', payment_intent: 'pi_ref', amount: 1600, status: 'succeeded', paid: true, refunded: true, created: sec('2026-11-20T20:00:00Z'), amount_refunded: 1600, metadata: { booking_id: 'b-ref' } },
  { id: 'ch_orphan', payment_intent: 'pi_x', amount: 3000, status: 'succeeded', paid: true, created: sec('2026-11-20T21:00:00Z'), amount_refunded: 0, metadata: { booking_id: 'b-missing' } },
  { id: 'ch_orphan_ref', payment_intent: 'pi_y', amount: 1600, status: 'succeeded', paid: true, refunded: true, created: sec(iso(-50)), amount_refunded: 1600, metadata: { booking_id: 'b-gone' } },
  { id: 'ch_member', payment_intent: 'pi_m', amount: 1299, status: 'succeeded', paid: true, created: sec('2026-11-20T12:00:00Z'), amount_refunded: 0, metadata: {} },
  { id: 'ch_fail', payment_intent: 'pi_f', amount: 900, status: 'failed', paid: false, created: sec('2026-11-20T13:00:00Z'), amount_refunded: 0, metadata: {} },
];
const REFUNDS = () => [{ id: 're_1', amount: 1600, status: 'succeeded', created: sec('2026-11-20T20:05:00Z') }];
// Stripe simulado con paginación (2 elementos por página)
function fakeStripe(charges = CHARGES(), refunds = REFUNDS(), fail = false) {
  const lister = (all) => async (p) => {
    if (fail) throw new Error('Stripe caído');
    const desde = p.created.gte; const lista = all.filter((x) => x.created >= desde);
    const i = p.starting_after ? lista.findIndex((x) => x.id === p.starting_after) + 1 : 0;
    const data = lista.slice(i, i + 2); return { data, has_more: i + 2 < lista.length };
  };
  return { charges: { list: lister(charges) }, refunds: { list: lister(refunds) } };
}

const resp = (status, data) => { const t = data == null ? '' : JSON.stringify(data); return { ok: status < 300, status, text: async () => t, json: async () => data }; };
function cmp(row, key, expr) {
  const v = row[key];
  if (expr === 'not.is.null') return v != null;
  const [op, ...rest] = expr.split('.'); const val = rest.join('.');
  if (op === 'eq') return String(v) === val;
  if (op === 'gte') return v != null && Date.parse(v) >= Date.parse(val);
  throw new Error('filtro no soportado ' + key + '=' + expr);
}
global.fetch = async (url, opts = {}) => {
  if (String(url).startsWith('https://api.resend.com/')) {
    RESEND.calls.push({ headers: opts.headers, body: JSON.parse(opts.body) });
    return resp(RESEND.status, RESEND.status < 300 ? { id: 'e' + RESEND.calls.length } : { message: 'fail' });
  }
  const u = new URL(url); const table = u.pathname.replace('/rest/v1/', ''); const rows = DB[table];
  const method = opts.method || 'GET';
  if (method === 'POST') {
    const n = JSON.parse(opts.body);
    if (rows.some((r) => r.walk_id === n.walk_id && r.kind === n.kind)) return resp(201, []);
    rows.push(n); return resp(201, [n]);
  }
  const filters = [...u.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'on_conflict'].includes(k));
  const hit = rows.filter((r) => filters.every(([k, e]) => cmp(r, k, e)));
  if (method === 'GET') return resp(200, hit);
  if (method === 'DELETE') { DB[table] = rows.filter((r) => !hit.includes(r)); return resp(204, null); }
  throw new Error('método ' + method);
};

const F = require(path.join(ROOT, 'api/_lib/finance-agent.js'));
const handler = require(path.join(ROOT, 'api/dispatch.js'));
let passed = 0;
const t = async (name, fn) => { reset(); await fn(); passed++; console.log('✓', name); };

(async () => {
  await t('día de cierre en hora de Birmingham (incluye horario de invierno)', async () => {
    assert.equal(F.chicagoYmd(NOW - 24 * H), '2026-11-20');
    const b = F.dayBounds('2026-11-20');
    assert.equal(new Date(b.start).toISOString(), '2026-11-20T06:00:00.000Z'); assert.equal(new Date(b.end).toISOString(), '2026-11-21T06:00:00.000Z');
  });

  await t('detecta las 8 anomalías (y no los falsos positivos)', async () => {
    const r = await F.runFinanceAudit({ now: NOW, dryRun: true, stripe: fakeStripe() });
    assert.deepEqual(r.byType, { payout_overdue: 1, payout_failed: 1, payout_stuck: 1, review_stale: 1, paid_without_walks: 1,
      paid_not_recorded: 1, refund_not_recorded: 1, charge_without_booking: 1 });
    assert.equal(r.stripe, 'ok'); assert.equal(RESEND.calls.length, 0); assert.equal(DB.dispatch_alerts.length, 0, 'dry run no reclama');
  });

  await t('resumen del día: brutos, reembolsos y pagos a paseadores', async () => {
    const r = await F.runFinanceAudit({ now: NOW, dryRun: true, stripe: fakeStripe() });
    // 2200 + 1600 + 3000 + 1299 (el cobro fallido y los de otros días no cuentan)
    assert.deepEqual(r.totals, { grossCents: 8099, refundCents: 1600, payoutCents: 1200 });
    assert.equal(r.summaryDay, '2026-11-20');
  });

  await t('envía 1 correo de alertas + 1 cierre, con el diseño oficial; la 2.ª ejecución no repite nada', async () => {
    const r1 = await F.runFinanceAudit({ now: NOW, stripe: fakeStripe() });
    assert.equal(r1.alertEmail, 'sent'); assert.equal(r1.newAlerts, 8); assert.equal(r1.summaryEmail, 'sent');
    assert.equal(RESEND.calls.length, 2);
    const [alerta, cierre] = RESEND.calls.map((c) => c.body);
    assert.deepEqual(alerta.to, ['ops@barkwalkusa.com']); assert.match(alerta.subject, /^\[Finanzas\] 8 alerta\(s\)/);
    assert.match(alerta.html, /email-logo\.png/); assert.match(alerta.html, /Liquidación fallida/); assert.match(alerta.html, /account closed/);
    assert.match(cierre.subject, /^\[Finanzas\] Cierre 2026-11-20: \$80\.99 brutos · 8 alerta\(s\)$/);
    assert.match(cierre.html, /−\$16\.00/); assert.match(cierre.html, /−\$12\.00/);
    const r2 = await F.runFinanceAudit({ now: NOW + 6 * H, stripe: fakeStripe() });
    assert.equal(r2.alertEmail, 'none'); assert.equal(r2.summaryEmail, 'already_sent'); assert.equal(RESEND.calls.length, 2, 'sin duplicados');
  });

  await t('una anomalía nueva más tarde: solo se avisa esa', async () => {
    await F.runFinanceAudit({ now: NOW, stripe: fakeStripe() });
    DB.walk_requests.push({ id: 'w-new-fail', booking_id: 'b-good', status: 'completed', payment_status: 'paid', completed_at: iso(-40), walker_payout_status: 'failed', payout_review_required: false });
    const r = await F.runFinanceAudit({ now: NOW + H, stripe: fakeStripe() });
    assert.equal(r.newAlerts, 1); assert.equal(RESEND.calls.length, 3);
    assert.match(RESEND.calls[2].body.subject, /^\[Finanzas\] 1 alerta\(s\): Liquidación fallida/);
  });

  await t('sin actividad ni anomalías no envía cierre (salvo FINANCE_SUMMARY_ALWAYS=true)', async () => {
    DB.walk_requests = []; DB.bookings = [];
    const r = await F.runFinanceAudit({ now: NOW, stripe: fakeStripe([], []) });
    assert.equal(r.summaryEmail, 'no_activity'); assert.equal(RESEND.calls.length, 0);
    process.env.FINANCE_SUMMARY_ALWAYS = 'true';
    try {
      const r2 = await F.runFinanceAudit({ now: NOW, stripe: fakeStripe([], []) });
      assert.equal(r2.summaryEmail, 'sent'); assert.match(RESEND.calls[0].body.subject, /Cierre 2026-11-20: \$0\.00 brutos · 0 alerta/);
    } finally { delete process.env.FINANCE_SUMMARY_ALWAYS; }
  });

  await t('si Resend falla, libera los reclamos y reintenta en la siguiente ejecución', async () => {
    RESEND.status = 500;
    const r1 = await F.runFinanceAudit({ now: NOW, stripe: fakeStripe() });
    assert.equal(r1.alertEmail, 'failed'); assert.equal(r1.summaryEmail, 'failed'); assert.equal(DB.dispatch_alerts.length, 0);
    RESEND.status = 200;
    const r2 = await F.runFinanceAudit({ now: NOW + H, stripe: fakeStripe() });
    assert.equal(r2.alertEmail, 'sent'); assert.equal(r2.newAlerts, 8); assert.equal(r2.summaryEmail, 'sent');
  });

  await t('sin Stripe: omite el cruce con Stripe y resume desde Supabase', async () => {
    const r = await F.runFinanceAudit({ now: NOW, dryRun: true, stripe: null });
    assert.equal(r.stripe, 'not_configured'); assert.equal(r.anomalies, 5, 'solo las 5 de Supabase');
    // Desde Supabase: reservas con paid_at de ayer (b-good 2200 + b-ref 1600); b-ref aún no tiene refunded_at
    assert.deepEqual(r.totals, { grossCents: 3800, refundCents: 0, payoutCents: 1200 });
  });

  await t('Stripe caído: sigue con las anomalías de Supabase y lo indica', async () => {
    const r = await F.runFinanceAudit({ now: NOW, dryRun: true, stripe: fakeStripe(undefined, undefined, true) });
    assert.match(r.stripe, /^error: Stripe caído/); assert.equal(r.anomalies, 5);
  });

  const call = async (headers, url) => {
    const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
    await handler({ method: 'GET', url, headers }, res);
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
  await t('endpoint action=finance_audit: exige CRON_SECRET y no expone datos personales', async () => {
    assert.equal((await call({}, '/api/dispatch?action=finance_audit')).status, 401);
    const r = await call({ authorization: `Bearer ${process.env.CRON_SECRET}` }, '/api/dispatch?action=finance_audit&dry=1');
    assert.equal(r.status, 200); assert.equal(r.body.dryRun, true); assert.equal(r.body.stripe, 'not_configured');
    assert.ok(!/@/.test(JSON.stringify(r.body)));
  });

  console.log(`\n${passed} pruebas OK`);
})().catch((e) => { console.error('✗ FALLO:', e.message); process.exit(1); });
