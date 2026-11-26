// Vercel Serverless Function: POST /api/customer-portal
// ---------------------------------------------------------------------------
// Portal de facturación de Stripe: el usuario ve su plan, cambia su tarjeta, descarga facturas o cancela.
//   Authorization: Bearer <access_token de Supabase>
// Respuesta: { url } → redirigir a Stripe. Los cambios vuelven por el webhook (customer.subscription.*).
// Requiere el portal configurado en Stripe Dashboard → Settings → Billing → Customer portal.
// ---------------------------------------------------------------------------
const { send, bearerToken, cors } = require('./_lib/http');
const { rateLimit } = require('./_lib/rate-limit');
const { isConfigured, getUserFromToken } = require('./_lib/supabase');
const { stripeKeyValid, getStripe, siteUrl } = require('./_lib/connect');
const { getMembership } = require('./_lib/membership');

async function handler(req, res) {
  if (cors(req, res, { methods: 'POST' })) return;
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'method_not_allowed' }); }
  if (!stripeKeyValid(process.env.STRIPE_SECRET_KEY) || !isConfigured()) return send(res, 503, { error: 'not_configured' });

  const user = await getUserFromToken(bearerToken(req)).catch(() => null);
  if (!user) return send(res, 401, { error: 'unauthorized' });
  if (!(await rateLimit('stripe_user', user.id))) return send(res, 429, { error: 'rate_limited' });

  try {
    const profile = await getMembership(user.id);
    if (!profile) return send(res, 503, { error: 'not_configured' });
    if (!profile.stripe_customer_id) return send(res, 404, { error: 'no_subscription' });
    const portal = await getStripe().billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${siteUrl()}/?membership=portal`,
    });
    return send(res, 200, { url: portal.url });
  } catch (e) {
    if (e && e.type && String(e.type).startsWith('Stripe')) {
      console.error('Stripe (portal):', e.type, e.message);
      return send(res, 402, { error: 'stripe_rejected', message: e.type === 'StripeCardError' ? e.message : undefined }); // solo rechazos de tarjeta: sin detalles de configuración
    }
    console.error('customer-portal:', e.message);
    return send(res, 500, { error: 'internal_error' });
  }
}

module.exports = handler;
