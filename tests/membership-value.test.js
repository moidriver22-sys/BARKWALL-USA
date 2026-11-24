// Pruebas del valor de membresías (membership-value.js): mismas cuentas que el servidor. Ejecuta: npm test
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const MV = require(path.join(ROOT, 'membership-value.js'));
const pricing = require(path.join(ROOT, 'api', '_lib', 'pricing.js'));
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const NOW = Date.parse('2026-11-24T15:00:00Z');
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('✓', name); };

t('el descuento Club coincide con el servidor (computeQuote) en precios de distintos tamaños', () => {
  assert.equal(MV.CLUB.pct, pricing.MEMBER_DISCOUNT_PCT);
  for (const list of [1600, 1999, 2400, 3801, 5500]) {
    const sel = { serviceId: 'walk_std', variantIdx: 0, petsCount: 1, dates: ['2026-12-01'] };
    const q = pricing.computeQuote(sel, { today: '2026-11-24', memberDiscountPct: 10 });
    const esperado = q.perDayListCents - q.perDayCents;
    assert.equal(MV.clubDiscountCents(q.perDayListCents), esperado);
    assert.equal(MV.clubDiscountCents(list), list - Math.round(list * 0.9));
  }
});
t('Pro: +5 % sobre el precio de lista con el mismo redondeo que earnings.js', () => {
  process.env.WALKER_PAYOUT_PERCENT = '75';
  const { walkerEarningCents } = require(path.join(ROOT, 'api', '_lib', 'earnings.js'));
  for (const list of [1600, 2400, 3333]) {
    const b = { per_day_cents: list };
    assert.equal(MV.proExtraCents(list), walkerEarningCents(b, { pro: true }) - walkerEarningCents(b, { pro: false }));
  }
});
t('punto de equilibrio honesto: Club 9 paseos de $16/mes, Pro 25 paseos de $16/mes', () => {
  assert.equal(MV.breakEven(MV.CLUB.priceCents, MV.clubDiscountCents(1600)), 9);
  assert.equal(MV.breakEven(MV.PRO.priceCents, MV.proExtraCents(1600)), 25);
  assert.equal(MV.breakEven(1299, 0), null);
});
t('clubStats: ahorro real del socio, ahorro posible del no socio (30 días) y reembolsos excluidos', () => {
  const s = MV.clubStats([
    { payment_status: 'paid', per_day_cents: 1440, per_day_list_cents: 1600, member_discount_pct: 10, dates: ['a', 'b'], created_at: '2026-11-20' },
    { payment_status: 'paid', per_day_cents: 2400, member_discount_pct: 0, dates: ['c'], created_at: '2026-11-22' },
    { payment_status: 'paid', per_day_cents: 1600, member_discount_pct: 0, dates: ['d'], created_at: '2026-09-01' },
    { payment_status: 'paid', per_day_cents: 1600, total_cents: 1600, refunded_cents: 1600, dates: ['e'], created_at: '2026-11-23' },
    { payment_status: 'pending', per_day_cents: 9900, dates: ['f'], created_at: '2026-11-23' },
  ], { now: NOW });
  assert.equal(s.savedCents, 320);          // (1600-1440) × 2 días
  assert.equal(s.missedCents, 240 + 160);   // 10 % de 2400 + 10 % de 1600
  assert.equal(s.missed30Cents, 240);       // solo la reserva de los últimos 30 días
  assert.equal(s.paidBookings, 3);
});
t('proStats: extra ganado (paseos Pro) y extra perdido (no Pro) solo de este mes', () => {
  const s = MV.proStats([
    { status: 'completed', completed_at: '2026-11-10T12:00:00Z', walker_is_pro: true, walker_earning_std_cents: 1200, walker_earning_pro_cents: 1280 },
    { status: 'completed', completed_at: '2026-11-12T12:00:00Z', walker_is_pro: false, walker_earning_std_cents: 1800, walker_earning_pro_cents: 1920 },
    { status: 'completed', completed_at: '2026-10-30T12:00:00Z', walker_is_pro: false, walker_earning_std_cents: 1800, walker_earning_pro_cents: 1920 },
    { status: 'accepted', completed_at: null, walker_earning_std_cents: 1200, walker_earning_pro_cents: 1280 },
  ], { now: NOW });
  assert.equal(s.walksThisMonth, 2); assert.equal(s.extraEarnedCents, 80); assert.equal(s.extraMissedCents, 120);
});
t('tarjetas: socio ve su ahorro/extra; no socio ve lo que habría ganado y cuándo se paga solo', () => {
  const club = MV.clubValueHtml({ savedCents: 320, missedCents: 0, missed30Cents: 0, typicalPerDayCents: 1600, breakEvenWalks: 9 }, { member: true });
  assert.match(club, /\$3\.20<\/b> ahorrados con Club/); assert.match(club, /9 paseos de \$16\.00 al mes/);
  const noSocio = MV.clubValueHtml({ savedCents: 0, missedCents: 400, missed30Cents: 240, typicalPerDayCents: 1600, breakEvenWalks: 9 }, { member: false, lang: 'en' });
  assert.match(noSocio, /\$2\.40<\/b> you could have saved in the last 30 days/);
  const pro = MV.proValueHtml({ walksThisMonth: 2, extraEarnedCents: 80, extraMissedCents: 0, breakEvenWalks: 25, extraPerWalkCents: 80 }, { member: true });
  assert.match(pro, /\+\$0\.80<\/b> extra este mes por ser Pro · 2 paseos/); assert.match(pro, /25 paseos al mes \(\+\$0\.80 por paseo\)/);
  assert.match(MV.proValueHtml(null, {}), /80 % de cada paseo/, 'sin datos todavía también muestra beneficios');
});
t('revisión del booking: "Ahorras" para socios y "ahorrarías" para no socios, multiplicado por los días', () => {
  assert.match(MV.bookingNote({ memberDiscount: 1.6, days: 3 }, { member: true }).html, /Ahorras <b>\$4\.80/);
  const n = MV.bookingNote({ perDay: 24, days: 2 }, { member: false });
  assert.equal(n.kind, 'upsell'); assert.match(n.html, /ahorrarías <b>\$4\.80<\/b> en esta reserva/);
  assert.equal(MV.bookingNote({ memberDiscount: 0, days: 1 }, { member: true }), null);
});
t('index.html: carga el módulo, lee solo filas propias y no redibuja la casilla de Términos', () => {
  assert.match(HTML, /<script src="\/membership-value\.js\?v=\d+" defer><\/script>\s*<script src="\/booking-flow\.js/);
  assert.match(HTML, /from\('bookings'\)\.select\('per_day_cents[^']*'\)\s*\.eq\('client_id', u\.id\)/);
  assert.match(HTML, /from\('walk_requests'\)\.select\('status,completed_at,walker_is_pro,walker_earning_std_cents,walker_earning_pro_cents'\)\s*\.eq\('walker_id', u\.id\)/);
  assert.match(HTML, /caja\.outerHTML = membershipValueHtml/);
  assert.match(HTML, /window\.isClubMember = isClubMember;/);
});
t('funciona cargado en el navegador (window.BWMembershipValue)', () => {
  const ctx = { self: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'membership-value.js'), 'utf8'), ctx);
  assert.equal(typeof ctx.self.BWMembershipValue.clubStats, 'function');
});

console.log(`\n${passed} pruebas OK`);
