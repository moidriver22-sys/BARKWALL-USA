// Vercel Serverless Function: POST /api/create-connect-account
// ---------------------------------------------------------------------------
// Onboarding del paseador con Stripe Connect (Express).
//   Authorization: Bearer <access_token de Supabase>   (solo perfiles con role walker/shopper)
// 1. Si el paseador no tiene cuenta conectada, crea una de tipo 'express' y guarda
//    profiles.stripe_account_id (con la clave de servicio; el navegador nunca puede escribirla).
// 2. Lee el estado de la cuenta en Stripe y lo guarda en profiles.
// 3. Respuesta:
//    · { status: 'onboarding', url }          → redirigir al formulario de Stripe (datos bancarios, identidad)
//    · { status: 'complete', dashboardUrl }   → ya puede recibir pagos; enlace a su panel Express
//    Al quedar completa, también paga los paseos completados que tenía pendientes.
// Variables: STRIPE_SECRET_KEY, SUPABASE_*, PUBLIC_SITE_URL (opcional), WALKER_PAYOUT_PERCENT
// ---------------------------------------------------------------------------
const { send, bearerToken } = require('./_lib/http');
const { rateLimit } = require('./_lib/rate-limit');
const { isConfigured, sbOrThrow, getUserFromToken, enc } = require('./_lib/supabase');
const { WALKER_ROLES, stripeKeyValid, getStripe, siteUrl, getProfile, syncAccountStatus, payoutCompletedWalks } = require('./_lib/connect');

async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'method_not_allowed' }); }
  if (!stripeKeyValid(process.env.STRIPE_SECRET_KEY) || !isConfigured()) return send(res, 503, { error: 'not_configured' });

  const user = await getUserFromToken(bearerToken(req)).catch(() => null);
  if (!user) return send(res, 401, { error: 'unauthorized' });
  if (!(await rateLimit('stripe_user', user.id))) return send(res, 429, { error: 'rate_limited' });

  try {
    let profile = await getProfile(user.id);
    if (!profile || !WALKER_ROLES.has(profile.role)) return send(res, 403, { error: 'not_walker' });
    if (profile.walker_status === 'suspended') return send(res, 403, { error: 'walker_suspended' });

    const stripe = getStripe();

    // 1) Crear la cuenta conectada (una sola por paseador)
    if (!profile.stripe_account_id) {
      const acct = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        email: user.email || undefined,
        business_type: 'individual',
        capabilities: { transfers: { requested: true } }, // solo recibe transferencias de Barkwalk
        business_profile: {
          mcc: '7299', // servicios personales varios (paseo / cuidado de mascotas)
          product_description: 'Independent pet walking and pet care services booked through Barkwalk USA',
          url: siteUrl(),
        },
        metadata: { supabase_user_id: String(user.id) },
      }, { idempotencyKey: `bw-connect-${user.id}` });

      // Guardar solo si sigue vacío (dos clics simultáneos no crean dos cuentas enlazadas)
      const rows = await sbOrThrow(`/rest/v1/profiles?id=eq.${enc(user.id)}&stripe_account_id=is.null`, {
        method: 'PATCH', body: { stripe_account_id: acct.id }, prefer: 'return=representation' });
      if (!rows.length) {
        if ((await getProfile(user.id)).stripe_account_id !== acct.id) await stripe.accounts.del(acct.id).catch(() => {});
      }
      profile = await getProfile(user.id);
    }

    // 2) Estado real en Stripe
    profile = await syncAccountStatus(stripe, profile);

    // 3a) Completa: panel Express + pagar lo pendiente
    if (profile.stripe_details_submitted && profile.stripe_transfers_active) {
      const login = await stripe.accounts.createLoginLink(profile.stripe_account_id).catch(() => null);
      const pagos = await payoutCompletedWalks(stripe, user.id).catch((e) => ({ status: 'error', error: e.message }));
      return send(res, 200, {
        status: 'complete', dashboardUrl: login ? login.url : null, payoutsEnabled: profile.stripe_payouts_enabled,
        paidWalks: (pagos.paid || []).length,
      });
    }

    // 3b) Falta información: enlace de onboarding (caduca en minutos; se genera uno nuevo cada vez)
    const link = await stripe.accountLinks.create({
      account: profile.stripe_account_id,
      refresh_url: `${siteUrl()}/?connect=refresh`,
      return_url: `${siteUrl()}/?connect=return`,
      type: 'account_onboarding',
      collection_options: { fields: 'eventually_due' },
    });
    return send(res, 200, { status: 'onboarding', url: link.url });
  } catch (e) {
    if (e && e.type && String(e.type).startsWith('Stripe')) {
      console.error('Stripe Connect:', e.type, e.message);
      return send(res, 402, { error: 'stripe_rejected', message: e.type === 'StripeCardError' ? e.message : undefined }); // solo rechazos de tarjeta: sin detalles de configuración
    }
    console.error('create-connect-account:', e.message);
    return send(res, 500, { error: 'internal_error' });
  }
}

module.exports = handler;
