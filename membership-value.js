// Valor de las membresías en pantalla: cuánto ahorra (Barkwalk Club) o cuánto más gana (Socio Pro) cada usuario.
// Solo MUESTRA información: los descuentos y porcentajes reales los aplica el servidor (api/_lib/pricing.js y earnings.js).
// Módulo UMD: funciona en Node (pruebas) y en el navegador (window.BWMembershipValue).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BWMembershipValue = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Deben coincidir con el servidor: pricing.js (MEMBER_DISCOUNT_PCT), earnings.js (75 / 80) y los precios de Stripe
  const CLUB = { priceCents: 1299, pct: 10 };
  const PRO = { priceCents: 1999, stdPct: 75, proPct: 80 };
  const STANDARD_WALK_CENTS = 1600; // Paseo Estándar 15 min, referencia cuando aún no hay historial

  const money = (c) => `$${(Math.max(0, Math.round(c)) / 100).toFixed(2)}`;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const pick = (lang, es, en) => (lang === 'en' ? en : es);

  // Descuento Club por día, con el MISMO redondeo que el servidor
  function clubDiscountCents(perDayListCents) {
    const l = Math.max(0, Math.round(Number(perDayListCents) || 0));
    return l - Math.round(l * (100 - CLUB.pct) / 100);
  }
  // Ganancia del paseador por día (floor, como earnings.js)
  const earning = (listCents, pct) => Math.floor((Math.max(0, Number(listCents) || 0) * pct) / 100);
  function proExtraCents(listCents) { return earning(listCents, PRO.proPct) - earning(listCents, PRO.stdPct); }

  // ¿Con cuántos servicios al mes se paga sola la membresía? (null si no aplica)
  function breakEven(feeCents, perServiceGainCents) {
    return perServiceGainCents > 0 ? Math.ceil(feeCents / perServiceGainCents) : null;
  }

  const daysOf = (b) => (Array.isArray(b.dates) ? b.dates.length : 0) || 1;
  const fullyRefunded = (b) => Number(b.refunded_cents) > 0 && Number(b.refunded_cents) >= Number(b.total_cents);

  // Reservas PAGADAS del cliente → ahorro real (con Club) y ahorro posible (sin Club)
  function clubStats(bookings, { now = Date.now() } = {}) {
    const desde30 = now - 30 * 864e5;
    const s = { savedCents: 0, missedCents: 0, missed30Cents: 0, paidBookings: 0, typicalPerDayCents: 0 };
    const precios = [];
    for (const b of bookings || []) {
      if (!b || b.payment_status !== 'paid' || fullyRefunded(b)) continue;
      const paid = Number(b.per_day_cents) || 0;
      const pct = Number(b.member_discount_pct) || 0;
      const list = pct > 0 && Number(b.per_day_list_cents) > paid ? Number(b.per_day_list_cents) : paid;
      const dias = daysOf(b);
      s.paidBookings++;
      precios.push(list);
      if (pct > 0) s.savedCents += (list - paid) * dias;
      else {
        const posible = clubDiscountCents(list) * dias;
        s.missedCents += posible;
        if (Date.parse(b.created_at) >= desde30) s.missed30Cents += posible;
      }
    }
    precios.sort((a, b) => a - b);
    s.typicalPerDayCents = precios.length ? precios[Math.floor(precios.length / 2)] : STANDARD_WALK_CENTS;
    s.breakEvenWalks = breakEven(CLUB.priceCents, clubDiscountCents(s.typicalPerDayCents));
    return s;
  }

  // Paseos COMPLETADOS del paseador este mes → extra real (Pro) y extra posible (sin Pro)
  function proStats(walks, { now = Date.now() } = {}) {
    const d = new Date(now); const inicioMes = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const s = { walksThisMonth: 0, extraEarnedCents: 0, extraMissedCents: 0, typicalListCents: 0 };
    const extras = [];
    for (const w of walks || []) {
      if (!w || w.status !== 'completed' || !(Date.parse(w.completed_at) >= inicioMes)) continue;
      const std = Number(w.walker_earning_std_cents), pro = Number(w.walker_earning_pro_cents);
      if (!Number.isFinite(std) || !Number.isFinite(pro) || pro < std) continue;
      s.walksThisMonth++;
      extras.push(pro - std);
      if (w.walker_is_pro === true) s.extraEarnedCents += pro - std;
      else s.extraMissedCents += pro - std;
    }
    extras.sort((a, b) => a - b);
    const extraTipico = extras.length ? extras[Math.floor(extras.length / 2)] : proExtraCents(STANDARD_WALK_CENTS);
    s.breakEvenWalks = breakEven(PRO.priceCents, extraTipico);
    s.extraPerWalkCents = extraTipico;
    return s;
  }

  // ---------- HTML (texto escapado; los números vienen de la base o del catálogo) ----------
  const row = (icon, text) => `<li class="mv-row"><span class="mv-ic" aria-hidden="true">${icon}</span><span>${text}</span></li>`;

  function clubValueHtml(stats, { member = false, lang = 'es' } = {}) {
    const s = stats || clubStats([]);
    const t = (es, en) => pick(lang, es, en);
    const destacado = member
      ? (s.savedCents > 0
        ? `<p class="mv-kpi"><b>${money(s.savedCents)}</b> ${esc(t('ahorrados con Club hasta hoy', 'saved with Club so far'))}</p>`
        : `<p class="mv-kpi">${esc(t('Tu 10 % se aplica solo en tu próxima reserva.', 'Your 10% applies automatically on your next booking.'))}</p>`)
      : (s.missedCents > 0
        ? `<p class="mv-kpi"><b>${money(s.missed30Cents || s.missedCents)}</b> ${esc(s.missed30Cents ? t('habrías ahorrado en los últimos 30 días', 'you could have saved in the last 30 days') : t('habrías ahorrado en tus reservas', 'you could have saved on your bookings'))}</p>`
        : '');
    const pagaSola = s.breakEvenWalks
      ? row('📈', esc(t(`Se paga solo con ${s.breakEvenWalks} paseos de ${money(s.typicalPerDayCents)} al mes`, `Pays for itself at ${s.breakEvenWalks} walks of ${money(s.typicalPerDayCents)} a month`)))
      : '';
    return `<div class="mv-box" data-mv="club">${destacado}<ul class="mv-list">
      ${row('✓', esc(t('10 % menos en cada día de servicio, automático y sin códigos', '10% off every service day, automatic, no codes')))}
      ${row('✓', esc(t('Tu paseador cobra completo: Barkwalk absorbe el descuento', 'Your walker is paid in full: Barkwalk covers the discount')))}
      ${row('✓', esc(t('Cancela cuando quieras desde el portal de Stripe', 'Cancel anytime from the Stripe portal')))}
      ${pagaSola}</ul></div>`;
  }

  function proValueHtml(stats, { member = false, lang = 'es' } = {}) {
    const s = stats || proStats([]);
    const t = (es, en) => pick(lang, es, en);
    const destacado = member
      ? `<p class="mv-kpi"><b>+${money(s.extraEarnedCents)}</b> ${esc(t('extra este mes por ser Pro', 'extra this month for being Pro'))}${s.walksThisMonth ? ` · ${s.walksThisMonth} ${esc(t(s.walksThisMonth === 1 ? 'paseo' : 'paseos', s.walksThisMonth === 1 ? 'walk' : 'walks'))}` : ''}</p>`
      : (s.extraMissedCents > 0
        ? `<p class="mv-kpi"><b>+${money(s.extraMissedCents)}</b> ${esc(t('habrías ganado este mes con Pro', 'you would have earned this month with Pro'))}</p>`
        : '');
    const pagaSola = s.breakEvenWalks
      ? row('📈', esc(t(`Se paga solo a partir de ${s.breakEvenWalks} paseos al mes (+${money(s.extraPerWalkCents)} por paseo)`, `Pays for itself from ${s.breakEvenWalks} walks a month (+${money(s.extraPerWalkCents)} per walk)`)))
      : '';
    return `<div class="mv-box" data-mv="pro">${destacado}<ul class="mv-list">
      ${row('✓', esc(t('80 % de cada paseo en lugar del 75 %', '80% of every walk instead of 75%')))}
      ${row('✓', esc(t('Insignia dorada "Paseador Pro" visible para tus clientes', 'Gold "Pro walker" badge your clients can see')))}
      ${row('✓', esc(t('El 80 % queda fijo en cada paseo que aceptes mientras seas Pro', 'The 80% is locked in for every walk you accept while Pro')))}
      ${pagaSola}</ul></div>`;
  }

  // Línea para la revisión del booking: ahorro real (socio) o ahorro posible (no socio)
  function bookingNote(summary, { member = false, lang = 'es' } = {}) {
    const s = summary || {};
    const dias = Math.max(1, Number(s.days) || 0);
    const t = (es, en) => pick(lang, es, en);
    if (member) {
      const ahorro = Math.round((Number(s.memberDiscount) || 0) * 100) * dias;
      return ahorro > 0 ? { kind: 'saved', html: `💎 ${esc(t('Ahorras', 'You save'))} <b>${money(ahorro)}</b> ${esc(t('con Barkwalk Club', 'with Barkwalk Club'))}` } : null;
    }
    const posible = clubDiscountCents(Math.round((Number(s.perDay) || 0) * 100)) * dias;
    return posible > 0 ? { kind: 'upsell', html: `💎 ${esc(t('Con Barkwalk Club ahorrarías', 'With Barkwalk Club you would save'))} <b>${money(posible)}</b> ${esc(t('en esta reserva', 'on this booking'))}` } : null;
  }

  const CSS = `
  .mv-box{margin:0 0 18px;padding:14px;border-radius:16px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1)}
  .mv-kpi{margin:0 0 10px;font-size:13px;color:#E2E8F0;line-height:1.35}
  .mv-kpi b{font-size:22px;font-weight:900;color:#fff;letter-spacing:-.01em;margin-right:4px}
  .mv-list{list-style:none;margin:0;padding:0;display:grid;gap:7px}
  .mv-row{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;line-height:1.35;color:#CBD5E1}
  .mv-ic{flex:none;width:18px;height:18px;border-radius:999px;display:grid;place-items:center;font-size:10px;font-weight:900;background:rgba(52,211,153,.18);color:#6EE7B7}
  .bk-club-note{display:block;margin:0 16px 12px;padding:10px 12px;border-radius:14px;font-size:12px;font-weight:700;line-height:1.35}
  .bk-club-note b{font-weight:900}
  .bk-club-note[data-kind="saved"]{background:#E7F6EE;color:#05603A}
  .bk-club-note[data-kind="upsell"]{background:#EEF2FF;color:#3730A3}
  html.dark .bk-club-note[data-kind="saved"]{background:rgba(16,185,129,.14);color:#A7F3D0}
  html.dark .bk-club-note[data-kind="upsell"]{background:rgba(99,102,241,.16);color:#C7D2FE}`;
  function injectCss() {
    if (typeof document === 'undefined' || document.getElementById('bwMvCss')) return;
    const st = document.createElement('style'); st.id = 'bwMvCss'; st.textContent = CSS; document.head.appendChild(st);
  }

  return { CLUB, PRO, STANDARD_WALK_CENTS, clubDiscountCents, proExtraCents, breakEven, clubStats, proStats, clubValueHtml, proValueHtml, bookingNote, CSS, injectCss };
});
