// Ganancia NETA del paseador por día de paseo · fuente única del cálculo
// ---------------------------------------------------------------------------
// Fórmula (la misma con la que se le transfiere el dinero en _lib/connect.js):
//   ganancia = floor( precio de LISTA por día × porcentaje / 100 )
//   · porcentaje estándar: WALKER_PAYOUT_PERCENT (p. ej. 75)
//   · porcentaje Walker Pro: WALKER_PRO_PAYOUT_PERCENT (80 por defecto), según walk_requests.walker_is_pro,
//     que la base fija AL ACEPTAR el paseo (si era socio Pro en ese momento)
//   · precio de lista: el descuento del Barkwalk Club lo absorbe Barkwalk, no el paseador
// Privacidad: al paseador solo le llega su ganancia. El precio que pagó el cliente vive en public.bookings
// (solo dueño y admin) y walk_requests.total_price queda siempre vacío (migración 20261127_walker_net_pay.sql).
// ---------------------------------------------------------------------------
const { proPayoutPercent } = require('./membership');

function payoutPercent() {
  const p = Number(process.env.WALKER_PAYOUT_PERCENT);
  return Number.isFinite(p) && p > 0 && p <= 100 ? p : null;
}

// Precio de LISTA por día. Solo se usa per_day_list_cents si es coherente con lo cobrado; si no, lo cobrado.
function listPriceCents(booking) {
  const cobrado = Number(booking && booking.per_day_cents) || 0;
  const lista = Number(booking && booking.per_day_list_cents) || 0;
  const pct = Number(booking && booking.member_discount_pct) || 0;
  if (lista > cobrado && pct > 0 && Math.round(lista * (100 - pct) / 100) === cobrado) return lista;
  return cobrado;
}

// Porcentaje aplicable a un paseo (pro = walk_requests.walker_is_pro)
function percentFor(pro) {
  const base = payoutPercent();
  if (!base) return null;
  const proPct = proPayoutPercent();
  return pro === true && proPct ? proPct : base;
}

// Ganancia en centavos de un día de esta reserva. null si falta el porcentaje en la configuración.
function walkerEarningCents(booking, { pro = false } = {}) {
  const pct = percentFor(pro);
  if (!pct) return null;
  return Math.floor(listPriceCents(booking) * pct / 100);
}

// Las dos ganancias posibles de un día (se guardan en walk_requests al crear los días de la reserva)
function earningColumns(booking) {
  const std = walkerEarningCents(booking, { pro: false });
  const pro = walkerEarningCents(booking, { pro: true });
  return std == null ? {} : { walker_earning_std_cents: std, walker_earning_pro_cents: pro };
}

// Lo que el paseador debe ver de un paseo: su ganancia (exacta si ya se le pagó; si no, la de su tarifa)
//   walk: fila de walk_requests · walkerIsPro: membresía Pro ACTUAL del paseador (para paseos aún sin aceptar)
function walkerNetCents(walk, { walkerIsPro = false } = {}) {
  const w = walk || {};
  if (Number(w.walker_payout_cents) > 0) return Number(w.walker_payout_cents);
  const pro = w.walker_id ? w.walker_is_pro === true : walkerIsPro === true;
  const v = pro ? (w.walker_earning_pro_cents ?? w.walker_earning_std_cents) : w.walker_earning_std_cents;
  return v == null ? null : Number(v);
}

// Columnas del cliente que NUNCA deben llegar al paseador
const CLIENT_PRICE_FIELDS = ['total_price', 'per_day_cents', 'per_day_list_cents', 'total_cents', 'member_discount_pct', 'quote', 'walker_payout_amount'];
function walkForWalker(walk, opts) {
  const out = { ...(walk || {}) };
  for (const k of CLIENT_PRICE_FIELDS) delete out[k];
  out.walker_net_cents = walkerNetCents(walk, opts);
  return out;
}

// Rellena walker_earning_*_cents en días ya creados (antes de esta versión). /api/dispatch?action=backfill_earnings
async function backfillEarnings({ limit = 500 } = {}) {
  const { sbOrThrow, enc } = require('./supabase');
  if (!payoutPercent()) return { status: 'not_configured', updated: 0 };
  const walks = await sbOrThrow(`/rest/v1/walk_requests?booking_id=not.is.null&walker_earning_std_cents=is.null&select=id,booking_id&limit=${limit}`);
  const ids = [...new Set(walks.map((w) => String(w.booking_id)))];
  const bookings = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const lote = ids.slice(i, i + 100).map((id) => `"${id.replace(/"/g, '')}"`).join(',');
    const rows = await sbOrThrow(`/rest/v1/bookings?id=in.(${enc(lote)})&select=id,per_day_cents,per_day_list_cents,member_discount_pct`);
    rows.forEach((b) => bookings.set(String(b.id), b));
  }
  let updated = 0, missing = 0;
  for (const w of walks) {
    const b = bookings.get(String(w.booking_id));
    if (!b) { missing++; continue; }
    await sbOrThrow(`/rest/v1/walk_requests?id=eq.${enc(w.id)}`, { method: 'PATCH', body: earningColumns(b), prefer: 'return=minimal' });
    updated++;
  }
  return { status: 'ok', checked: walks.length, updated, missingBooking: missing };
}

module.exports = { payoutPercent, listPriceCents, percentFor, walkerEarningCents, earningColumns, walkerNetCents, walkForWalker, CLIENT_PRICE_FIELDS, backfillEarnings };
