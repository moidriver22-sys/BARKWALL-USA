// Pruebas: el paseador solo ve (y cobra) SU ganancia neta, estándar o Walker Pro; nunca el monto bruto del cliente.
// api/_lib/earnings.js + pago real de _lib/connect.js + /api/walker-earnings + la vista de la app. Ejecuta: npm test
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
process.env.SUPABASE_URL = 'http://fake.supabase';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
process.env.WALKER_PAYOUT_PERCENT = '75';
process.env.WALKER_PRO_PAYOUT_PERCENT = '80';

const E = require(path.join(ROOT, 'api/_lib/earnings.js'));
const connect = require(path.join(ROOT, 'api/_lib/connect.js'));

// ---------- PostgREST en memoria (lo justo para pagos y ganancias) ----------
let DB;
const resp = (status, data) => { const t = data == null ? '' : JSON.stringify(data); return { ok: status < 300, status, text: async () => t, json: async () => data }; };
function cmp(row, key, expr) {
  const v = row[key];
  if (expr === 'is.null') return v == null;
  if (expr === 'not.is.null') return v != null;
  if (expr === 'is.false') return v === false;
  const m = expr.match(/^in\.\((.*)\)$/); if (m) return m[1].split(',').map((x) => x.replace(/^"|"$/g, '')).includes(String(v));
  const [op, ...rest] = expr.split('.'); const val = decodeURIComponent(rest.join('.'));
  if (op === 'eq') return String(v) === val;
  if (op === 'lt') return v != null && Date.parse(v) < Date.parse(val);
  throw new Error(`filtro no soportado ${key}=${expr}`);
}
global.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  if (u.pathname === '/auth/v1/user') return resp(200, { id: 'wk-pro' === opts.headers.Authorization.slice(7) ? 'wk-pro' : 'wk-std' });
  const table = u.pathname.replace('/rest/v1/', ''); const rows = DB[table];
  if (!rows) throw new Error('tabla inesperada ' + table);
  const filters = [...u.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit'].includes(k));
  const hit = rows.filter((r) => filters.every(([k, e]) => cmp(r, k, e)));
  const method = opts.method || 'GET';
  if (method === 'GET') return resp(200, hit);
  if (method === 'PATCH') { const b = JSON.parse(opts.body); hit.forEach((r) => Object.assign(r, b)); return resp(200, hit); }
  throw new Error('método ' + method);
};
const PASADO = '2026-11-01T00:00:00Z';
function reset() {
  DB = {
    profiles: [
      { id: 'wk-std', role: 'walker', stripe_account_id: 'acct_std', stripe_transfers_active: true },
      { id: 'wk-pro', role: 'walker', stripe_account_id: 'acct_pro', stripe_transfers_active: true },
    ],
    bookings: [
      // $22.00 por día · $30.00 de lista con 2 perros… y otra con descuento Club 10 %: cobrado $27.00, lista $30.00
      { id: 'b-std', payment_status: 'paid', per_day_cents: 2200, currency: 'usd', stripe_charge_id: 'ch_1' },
      { id: 'b-club', payment_status: 'paid', per_day_cents: 2700, per_day_list_cents: 3000, member_discount_pct: 10, currency: 'usd', stripe_charge_id: 'ch_2' },
    ],
    walk_requests: [
      { id: 'w1', walker_id: 'wk-std', booking_id: 'b-std', status: 'completed', payment_status: 'paid', walker_is_pro: false, walker_transfer_id: null,
        walker_payout_status: 'unpaid', payout_eligible_at: PASADO, payout_review_required: false, client_issue_at: null, created_at: PASADO },
      { id: 'w2', walker_id: 'wk-pro', booking_id: 'b-std', status: 'completed', payment_status: 'paid', walker_is_pro: true, walker_transfer_id: null,
        walker_payout_status: 'unpaid', payout_eligible_at: PASADO, payout_review_required: false, client_issue_at: null, created_at: PASADO },
      { id: 'w3', walker_id: 'wk-pro', booking_id: 'b-club', status: 'completed', payment_status: 'paid', walker_is_pro: true, walker_transfer_id: null,
        walker_payout_status: 'unpaid', payout_eligible_at: PASADO, payout_review_required: false, client_issue_at: null, created_at: PASADO },
    ],
  };
}
const TRANSFERS = [];
const fakeStripe = { transfers: { create: async (p) => { TRANSFERS.push(p); return { id: 'tr_' + TRANSFERS.length }; } }, accounts: { retrieve: async () => ({}) } };

let passed = 0;
const t = async (name, fn) => { reset(); TRANSFERS.length = 0; await fn(); passed++; console.log('✓', name); };

(async () => {
  await t('cálculo: paseador estándar gana 75 % y Walker Pro 80 % del precio por día (redondeo hacia abajo)', async () => {
    const b = { per_day_cents: 2200 };
    assert.equal(E.walkerEarningCents(b), 1650);
    assert.equal(E.walkerEarningCents(b, { pro: true }), 1760);
    assert.equal(E.walkerEarningCents({ per_day_cents: 1999 }), 1499, 'floor(1499.25)');
    assert.equal(E.walkerEarningCents({ per_day_cents: 1999 }, { pro: true }), 1599, 'floor(1599.2)');
    assert.deepEqual(E.earningColumns(b), { walker_earning_std_cents: 1650, walker_earning_pro_cents: 1760 });
  });
  await t('cálculo: con descuento del Club, el paseador cobra sobre el precio de LISTA (el descuento lo absorbe Barkwalk)', async () => {
    const club = { per_day_cents: 2700, per_day_list_cents: 3000, member_discount_pct: 10 };
    assert.equal(E.listPriceCents(club), 3000);
    assert.equal(E.walkerEarningCents(club), 2250); assert.equal(E.walkerEarningCents(club, { pro: true }), 2400);
    // Datos incoherentes → nunca se paga de más: se usa lo cobrado
    assert.equal(E.listPriceCents({ per_day_cents: 2700, per_day_list_cents: 9999, member_discount_pct: 10 }), 2700);
  });
  await t('cálculo: sin WALKER_PAYOUT_PERCENT no se inventa nada; Pro sin porcentaje propio usa el estándar', async () => {
    const saved = process.env.WALKER_PAYOUT_PERCENT; delete process.env.WALKER_PAYOUT_PERCENT;
    try { assert.equal(E.walkerEarningCents({ per_day_cents: 2200 }), null); assert.deepEqual(E.earningColumns({ per_day_cents: 2200 }), {}); }
    finally { process.env.WALKER_PAYOUT_PERCENT = saved; }
    process.env.WALKER_PRO_PAYOUT_PERCENT = 'x';
    try { assert.equal(E.walkerEarningCents({ per_day_cents: 2200 }, { pro: true }), 1650); } finally { process.env.WALKER_PRO_PAYOUT_PERCENT = '80'; }
  });

  await t('lo que ve el paseador: su tarifa según walker_is_pro (aceptado) o su plan actual (solicitud abierta)', async () => {
    const fila = { walker_earning_std_cents: 1650, walker_earning_pro_cents: 1760 };
    assert.equal(E.walkerNetCents({ ...fila, walker_id: null }), 1650, 'abierta · paseador estándar');
    assert.equal(E.walkerNetCents({ ...fila, walker_id: null }, { walkerIsPro: true }), 1760, 'abierta · paseador Pro');
    assert.equal(E.walkerNetCents({ ...fila, walker_id: 'wk', walker_is_pro: true }), 1760, 'aceptada siendo Pro');
    assert.equal(E.walkerNetCents({ ...fila, walker_id: 'wk', walker_is_pro: false }, { walkerIsPro: true }), 1650, 'aceptó antes de ser Pro: manda el paseo');
    assert.equal(E.walkerNetCents({ ...fila, walker_id: 'wk', walker_payout_cents: 1700 }), 1700, 'ya pagado: monto exacto transferido');
    assert.equal(E.walkerNetCents({ walker_id: null }), null);
  });
  await t('el paseador NUNCA recibe el monto bruto del cliente (walkForWalker)', async () => {
    const fila = { id: 'w', walker_id: null, total_price: 22, per_day_cents: 2200, total_cents: 4400, per_day_list_cents: 3000, member_discount_pct: 10,
      quote: { lines: [] }, walker_payout_amount: 16.5, walker_earning_std_cents: 1650, walker_earning_pro_cents: 1760, pet_name: 'Luna' };
    const v = E.walkForWalker(fila);
    for (const k of E.CLIENT_PRICE_FIELDS) assert.ok(!(k in v), `no debe incluir ${k}`);
    assert.equal(v.walker_net_cents, 1650); assert.equal(v.pet_name, 'Luna');
    assert.ok(!JSON.stringify(v).includes('2200') && !JSON.stringify(v).includes('4400'));
  });

  await t('pago real (Stripe Connect) = exactamente la ganancia mostrada: estándar 75 %, Pro 80 %, Club sobre lista', async () => {
    const std = await connect.payoutCompletedWalks(fakeStripe, 'wk-std');
    const pro = await connect.payoutCompletedWalks(fakeStripe, 'wk-pro');
    assert.deepEqual(std.paid.map((x) => [x.walkId, x.amount]), [['w1', 1650]]);
    assert.deepEqual(pro.paid.map((x) => [x.walkId, x.amount]).sort(), [['w2', 1760], ['w3', 2400]]);
    assert.deepEqual(TRANSFERS.map((x) => x.amount).sort(), [1650, 1760, 2400]);
    const brutos = DB.bookings.flatMap((b) => [b.per_day_cents, b.per_day_list_cents].filter(Boolean));
    assert.ok(TRANSFERS.every((x) => !brutos.includes(x.amount)), 'nunca se transfiere el monto bruto del cliente');
    assert.equal(DB.walk_requests.find((w) => w.id === 'w3').walker_payout_cents, 2400);
  });

  await t('/api/walker-earnings: pendiente neto por paseador (estándar vs Pro), sin montos del cliente', async () => {
    const handler = require(path.join(ROOT, 'api/walker-earnings.js'));
    require(path.join(ROOT, 'api/_lib/rate-limit.js')).setRateLimitBackend(() => true);
    const call = async (token) => {
      const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
      await handler({ method: 'GET', url: '/api/walker-earnings', headers: { authorization: `Bearer ${token}` } }, res);
      return JSON.parse(res.body);
    };
    const s = await call('wk-std'); const p = await call('wk-pro');
    assert.equal(s.pendingCents, 1650); assert.equal(p.pendingCents, 1760 + 2400);
    for (const body of [s, p]) assert.ok(!('per_day_cents' in body) && !('total_price' in body) && !JSON.stringify(body).includes('2200'));
  });

  await t('app: las vistas del paseador muestran su ganancia y el cliente/admin leen el precio desde bookings', async () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    // Ninguna vista del paseador usa el precio del cliente
    assert.match(html, /const priceTxt = walkerNetText\(paseo\);/);
    assert.match(html, /const fare = `💵 \$\{tr\('Ganas', 'You earn'\)\} \$\{walkerNetText\(p\)\}/);
    assert.match(html, /\$\{walkerNetText\(p, 0\)\}<\/span>\s*<span class="w-metric-lbl">\$\{es \? 'ganas' : 'you earn'\}/);
    assert.ok(!/Number\(paseo\.total_price\)|Number\(p\.total_price/.test(html), 'sin total_price en tarjetas del paseador');
    // Historial: solo cliente/admin cargan precios
    assert.match(html, /if \(role !== 'walker'\) await attachClientPrices\(HISTORY\.rows\)/);
    assert.match(html, /from\('bookings'\)\.select\('id,per_day_cents'\)/);
    // La misma lógica que el servidor (pagado > Pro/estándar)
    assert.match(html, /const pro = w\.walker_id \? w\.walker_is_pro === true : walkerIsProNow\(\);/);
  });
  await t('webhook y base: los días se crean con la ganancia, sin el precio del cliente', async () => {
    const wh = fs.readFileSync(path.join(ROOT, 'api/stripe-webhook.js'), 'utf8');
    assert.ok(!/total_price:/.test(wh), 'el webhook no escribe total_price'); assert.match(wh, /\.\.\.earningColumns\(booking\)/);
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261127_walker_net_pay.sql'), 'utf8');
    assert.match(sql, /new\.total_price := null;/); assert.match(sql, /update public\.walk_requests set total_price = null/);
  });

  console.log(`\n${passed} pruebas OK`);
})().catch((e) => { console.error('✗ FALLO:', e.stack); process.exit(1); });
