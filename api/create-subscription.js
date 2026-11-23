// Vercel Serverless Function: POST /api/create-subscription
// ---------------------------------------------------------------------------
// Sesión de Stripe Checkout (modo 'subscription') para la membresía que corresponde al ROL:
//   dueño (client) → Barkwalk Club $12.99/mes · paseador (walker/shopper) → Socio Pro $19.99/mes
//   Authorization: Bearer <access_token de Supabase>
// Respuesta: { url } → redirigir a Stripe. La membresía se activa cuando llega el webhook
// (checkout.session.completed / customer.subscription.*), nunca desde el navegador.
// Variables: STRIPE_SECRET_KEY, STRIPE_PRICE_CLUB, STRIPE_PRICE_WALKER_PRO, SUPABASE_*, PUBLIC_SITE_URL (opcional)
// ---------------------------------------------------------------------------
const { send, bearerToken, readJsonBody } = require('./_lib/http');
const { rateLimit } = require('./_lib/rate-limit');

// Versión vigente de los Términos (terminos-clientes.html / terminos-paseadores.html). Cámbiala junto con index.html.
const TERMS_VERSION = '2026-11-14';
const { isConfigured, sbOrThrow, getUserFromToken, enc } = require('./_lib/supabase');
const { stripeKeyValid, getStripe, siteUrl } = require('./_lib/connect');
const { ACTIVE_STATUSES, priceIdValid, prices, tierForRole, getMembership } = require('./_lib/membership');

async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'method_not_allowed' }); }
  const p = prices();
  if (!stripeKeyValid(process.env.STRIPE_SECRET_KEY) || !isConfigured() || !priceIdValid(p.club) || !priceIdValid(p.walker_pro)) {
    console.error('create-subscription: faltan STRIPE_SECRET_KEY, STRIPE_PRICE_CLUB, STRIPE_PRICE_WALKER_PRO o SUPABASE_*.');
    return send(res, 503, { error: 'not_configured' });
  }

  const user = await getUserFromToken(bearerToken(req)).catch(() => null);
  if (!user) return send(res, 401, { error: 'unauthorized' });
  if (!(await rateLimit('stripe_user', user.id))) return send(res, 429, { error: 'rate_limited' });

  // Aceptación obligatoria de los Términos (versión vigente) antes de abrir Stripe Checkout
  let b;
  try { b = await readJsonBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
  if (b.termsAccepted !== true || b.termsVersion !== TERMS_VERSION) return send(res, 400, { error: 'terms_not_accepted' });
  const aceptacion = { terms_version: TERMS_VERSION, terms_accepted_at: new Date().toISOString() };

  try {
    const profile = await getMembership(user.id);
    if (!profile) return send(res, 503, { error: 'not_configured' });
    const tier = tierForRole(profile.role);
    if (!tier) return send(res, 403, { error: 'no_plan_for_role' });
    // Cualquier suscripción no terminada (activa, en prueba, en mora…) se gestiona en el portal:
    // así nadie termina pagando dos. syncSubscription() borra stripe_subscription_id al cancelarse.
    if (profile.stripe_subscription_id) {
      return send(res, 409, { error: ACTIVE_STATUSES.has(profile.membership_status) ? 'already_member' : 'subscription_needs_attention' });
    }

    const stripe = getStripe();

    // Cliente de Stripe (uno por usuario; se guarda solo si sigue vacío)
    let customerId = profile.stripe_customer_id;
    if (!customerId) {
      const c = await stripe.customers.create({
        email: user.email || undefined,
        name: profile.full_name || undefined,
        metadata: { supabase_user_id: String(user.id) },
      }, { idempotencyKey: `bw-customer-${user.id}` });
      const rows = await sbOrThrow(`/rest/v1/profiles?id=eq.${enc(user.id)}&stripe_customer_id=is.null`, {
        method: 'PATCH', body: { stripe_customer_id: c.id }, prefer: 'return=representation' });
      customerId = rows.length ? c.id : (await getMembership(user.id)).stripe_customer_id;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: String(user.id),
      line_items: [{ price: p[tier], quantity: 1 }],
      success_url: `${siteUrl()}/?membership=success`,
      cancel_url: `${siteUrl()}/?membership=cancel`,
      allow_promotion_codes: true,
      // Constancia de aceptación de los Términos (queda en Stripe junto a la suscripción)
      metadata: { supabase_user_id: String(user.id), tier, ...aceptacion },
      subscription_data: { metadata: { supabase_user_id: String(user.id), tier, ...aceptacion } },
    });
    return send(res, 200, { url: session.url, tier });
  } catch (e) {
    if (e && e.type && String(e.type).startsWith('Stripe')) {
      console.error('Stripe (suscripción):', e.type, e.message);
      return send(res, 402, { error: 'stripe_rejected', message: e.type === 'StripeCardError' ? e.message : undefined }); // solo rechazos de tarjeta: sin detalles de configuración
    }
    console.error('create-subscription:', e.message);
    return send(res, 500, { error: 'internal_error' });
  }
}

module.exports = handler;
