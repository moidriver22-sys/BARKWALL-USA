// Vercel Serverless Function: POST /api/walker-payout
// ---------------------------------------------------------------------------
// Transfiere al paseador (Stripe Connect) su parte de los paseos COMPLETADOS y PAGADOS.
//   Authorization: Bearer <access_token de Supabase del paseador>
//   { "walkId": "<id de walk_requests>" }   // opcional; sin walkId paga todos sus días pendientes
// La app lo llama al terminar un paseo. Es seguro llamarlo varias veces: cada día se paga una sola vez.
// Todo se valida en el servidor (paseador asignado, estado 'completed', reserva pagada, cuenta activa);
// el monto sale de bookings.per_day_cents × WALKER_PAYOUT_PERCENT, nunca del navegador.
// Respuesta: { status, paid: [{ walkId, amount, transferId }], failed: [{ walkId, error }] }
//   status: 'ok' | 'no_account' | 'account_incomplete' | 'not_configured' | 'not_walker'
// ---------------------------------------------------------------------------
const { send, readJsonBody, bearerToken } = require('./_lib/http');
const { isConfigured, getUserFromToken } = require('./_lib/supabase');
const { stripeKeyValid, getStripe, payoutCompletedWalks } = require('./_lib/connect');

const WALK_ID = /^[A-Za-z0-9-]{1,64}$/;

async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'method_not_allowed' }); }
  if (!stripeKeyValid(process.env.STRIPE_SECRET_KEY) || !isConfigured()) return send(res, 503, { error: 'not_configured' });

  const user = await getUserFromToken(bearerToken(req)).catch(() => null);
  if (!user) return send(res, 401, { error: 'unauthorized' });

  let b;
  try { b = await readJsonBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
  const walkId = b.walkId == null || b.walkId === '' ? undefined : String(b.walkId);
  if (walkId && !WALK_ID.test(walkId)) return send(res, 400, { error: 'invalid_walk_id' });

  try {
    const r = await payoutCompletedWalks(getStripe(), user.id, { walkId });
    return send(res, r.status === 'not_walker' ? 403 : 200, r);
  } catch (e) {
    console.error('walker-payout:', e.message);
    return send(res, 500, { error: 'internal_error' });
  }
}

module.exports = handler;
