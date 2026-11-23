// Vercel Serverless Function: GET /api/walker-earnings
// ---------------------------------------------------------------------------
// Ganancias NETAS del paseador (su parte, no lo que pagó el cliente), para la tarjeta del wallet.
//   Authorization: Bearer <access_token de Supabase del paseador>
// Respuesta: {
//   paidCents,      // ya transferido a su Stripe (walk_requests.walker_payout_cents de los días 'paid')
//   pendingCents,   // días completados y cobrados aún sin transferir (retención de 48 h, revisión o sin cuenta)
//   paidWeekCents,  // transferido en los últimos 7 días
//   percent, proPercent, currency
// }
// El pendiente se estima con la MISMA fórmula que el pago real (_lib/connect.js → payoutCompletedWalks):
//   precio de LISTA por día (el descuento del Club lo absorbe Barkwalk) × porcentaje (Socio Pro o base).
// Variables: SUPABASE_*, WALKER_PAYOUT_PERCENT, WALKER_PRO_PAYOUT_PERCENT (opcional)
// ---------------------------------------------------------------------------
const { send, bearerToken } = require('./_lib/http');
const { rateLimit } = require('./_lib/rate-limit');
const { isConfigured, sb, sbOrThrow, getUserFromToken, enc } = require('./_lib/supabase');
const { WALKER_ROLES, payoutPercent } = require('./_lib/connect');
const { walkerEarningCents } = require('./_lib/earnings');
const { proPayoutPercent } = require('./_lib/membership');

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { error: 'method_not_allowed' }); }
  if (!isConfigured()) return send(res, 503, { error: 'not_configured' });

  const user = await getUserFromToken(bearerToken(req)).catch(() => null);
  if (!user) return send(res, 401, { error: 'unauthorized' });
  if (!(await rateLimit('earnings_user', user.id))) return send(res, 429, { error: 'rate_limited' });

  try {
    const prof = (await sbOrThrow(`/rest/v1/profiles?id=eq.${enc(user.id)}&select=role&limit=1`))[0];
    if (!prof || !WALKER_ROLES.has(prof.role)) return send(res, 403, { error: 'not_walker' });

    const pct = payoutPercent();
    const proPct = proPayoutPercent();
    const base = `/rest/v1/walk_requests?walker_id=eq.${enc(user.id)}&status=eq.completed&booking_id=not.is.null`;

    // 1) Ya pagado (monto exacto que se transfirió)
    const pagados = await sbOrThrow(`${base}&walker_payout_status=eq.paid&select=walker_payout_cents,walker_paid_at&limit=5000`);
    const semana = Date.now() - 7 * 864e5;
    let paidCents = 0, paidWeekCents = 0;
    for (const w of pagados) {
      const c = Number(w.walker_payout_cents) || 0;
      paidCents += c;
      if (w.walker_paid_at && Date.parse(w.walker_paid_at) >= semana) paidWeekCents += c;
    }

    // 2) Pendiente: completado, cobrado al cliente y sin transferir
    const cols = 'id,booking_id,walker_payout_status,walker_payout_cents,walker_is_pro';
    const filtro = `${base}&payment_status=eq.paid&walker_transfer_id=is.null&select=`;
    let r = await sb(`${filtro}${cols}&limit=1000`);
    if (!r.ok && r.data && r.data.code === '42703') r = await sb(`${filtro}id,booking_id,walker_payout_status,walker_payout_cents&limit=1000`); // sin migración de membresías
    if (!r.ok) throw new Error(`Supabase walk_requests ${r.status}: ${JSON.stringify(r.data)}`);
    const pendientes = r.data || [];

    let pendingCents = null;
    if (pct) {
      pendingCents = 0;
      const ids = [...new Set(pendientes.map((w) => String(w.booking_id)))];
      const bookings = new Map();
      for (let i = 0; i < ids.length; i += 100) {
        const lote = ids.slice(i, i + 100).map((id) => `"${id.replace(/"/g, '')}"`).join(',');
        const rows = await sbOrThrow(`/rest/v1/bookings?id=in.(${enc(lote)})&select=id,per_day_cents,per_day_list_cents,member_discount_pct,payment_status`);
        rows.forEach((b) => bookings.set(String(b.id), b));
      }
      for (const w of pendientes) {
        if (w.walker_payout_status === 'processing' && Number(w.walker_payout_cents) > 0) { pendingCents += Number(w.walker_payout_cents); continue; }
        const b = bookings.get(String(w.booking_id));
        if (!b || b.payment_status !== 'paid') continue;
        pendingCents += walkerEarningCents(b, { pro: w.walker_is_pro === true }) || 0;
      }
    }

    return send(res, 200, { paidCents, pendingCents, paidWeekCents, percent: pct, proPercent: proPct, currency: 'usd' });
  } catch (e) {
    console.error('walker-earnings:', e.message);
    return send(res, 500, { error: 'internal_error' });
  }
}

module.exports = handler;
