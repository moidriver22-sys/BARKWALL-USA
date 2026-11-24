// Diagnóstico de Stripe (SOLO LECTURA): /api/dispatch?action=stripe_health (con CRON_SECRET)
// ---------------------------------------------------------------------------
// Revisa que todo lo necesario para cobrar reservas reales esté listo, sin cambiar nada y sin devolver
// secretos ni datos personales (ids recortados, sin correos ni nombres):
//   · modo de la clave (live/test) y estado de la cuenta (cobros, pagos, datos completos)
//   · webhook: URL exacta, estado y eventos suscritos frente a los que procesa /api/stripe-webhook
//   · eventos recientes con entregas pendientes (= el webhook está fallando)
//   · dominios para Apple Pay / Google Pay (barkwalkusa.com y www)
//   · precios de membresía configurados en Vercel
//   · cuentas Connect de los paseadores (pueden recibir transferencias)
// ---------------------------------------------------------------------------
const { sbOrThrow } = require('./supabase');
const { prices } = require('./membership');

// Eventos que procesa api/stripe-webhook.js (si falta uno, ese flujo no se entera)
const REQUIRED_EVENTS = [
  'payment_intent.succeeded',
  'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed',
  'checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
];
const DOMAINS = ['barkwalkusa.com', 'www.barkwalkusa.com'];
const short = (id) => (id ? `…${String(id).slice(-6)}` : null);

function webhookReport(endpoints, siteUrl) {
  const esperado = `${siteUrl}/api/stripe-webhook`;
  const nuestros = endpoints.filter((e) => /\/api\/stripe-webhook\/?$/.test(e.url || ''));
  return nuestros.map((e) => {
    const todos = (e.enabled_events || []).includes('*');
    const faltan = todos ? [] : REQUIRED_EVENTS.filter((ev) => !(e.enabled_events || []).includes(ev));
    return {
      id: short(e.id), url: e.url, status: e.status, livemode: e.livemode, exactUrl: e.url === esperado,
      allEvents: todos, missingEvents: faltan, apiVersion: e.api_version || null,
    };
  });
}

function domainReport(list) {
  return DOMAINS.map((d) => {
    const x = list.find((p) => p.domain_name === d);
    return {
      domain: d, registered: !!x, enabled: !!(x && x.enabled),
      applePay: x && x.apple_pay ? x.apple_pay.status : null, googlePay: x && x.google_pay ? x.google_pay.status : null,
    };
  });
}

async function priceReport(stripe) {
  const p = prices();
  const out = {};
  for (const tier of Object.keys(p)) {
    if (!p[tier]) { out[tier] = { configured: false }; continue; }
    const x = await stripe.prices.retrieve(p[tier]).catch((e) => ({ error: e.code || e.type }));
    out[tier] = x.error ? { configured: true, error: x.error }
      : { configured: true, active: x.active, amount: x.unit_amount, interval: x.recurring && x.recurring.interval, livemode: x.livemode };
  }
  return out;
}

async function connectReport(stripe) {
  const rows = await sbOrThrow('/rest/v1/profiles?role=in.(walker,shopper)&select=id,walker_status,stripe_account_id,stripe_payouts_enabled,stripe_transfers_active&limit=200');
  const out = { walkers: rows.length, verified: rows.filter((r) => r.walker_status === 'verified').length, withAccount: 0, accounts: [] };
  for (const r of rows.filter((x) => x.stripe_account_id)) {
    out.withAccount++;
    const a = await stripe.accounts.retrieve(r.stripe_account_id).catch((e) => ({ error: e.code || e.type }));
    out.accounts.push(a.error ? { walker: short(r.id), error: a.error } : {
      walker: short(r.id), verifiedWalker: r.walker_status === 'verified',
      transfers: a.capabilities && a.capabilities.transfers, payoutsEnabled: !!a.payouts_enabled, detailsSubmitted: !!a.details_submitted,
      dueNow: ((a.requirements && a.requirements.currently_due) || []).length, disabledReason: (a.requirements && a.requirements.disabled_reason) || null,
      dbInSync: !!r.stripe_payouts_enabled === !!a.payouts_enabled,
    });
  }
  return out;
}

async function stripeHealth(stripe, { siteUrl }) {
  const key = String(process.env.STRIPE_SECRET_KEY || '');
  const report = { keyMode: /^(sk|rk)_live_/.test(key) ? 'live' : /^(sk|rk)_test_/.test(key) ? 'test' : 'unknown', siteUrl };

  const acct = await stripe.accounts.retrieve();
  report.account = {
    id: short(acct.id), country: acct.country, currency: acct.default_currency,
    chargesEnabled: !!acct.charges_enabled, payoutsEnabled: !!acct.payouts_enabled, detailsSubmitted: !!acct.details_submitted,
    cardPayments: acct.capabilities && acct.capabilities.card_payments, transfers: acct.capabilities && acct.capabilities.transfers,
    dueNow: ((acct.requirements && acct.requirements.currently_due) || []).length,
    statementDescriptor: (acct.settings && acct.settings.payments && acct.settings.payments.statement_descriptor) || null,
  };

  const endpoints = (await stripe.webhookEndpoints.list({ limit: 20 })).data || [];
  report.webhooks = webhookReport(endpoints, siteUrl);
  report.webhookSecretSet = /^whsec_/.test(process.env.STRIPE_WEBHOOK_SECRET || '');

  // Entregas pendientes en los últimos eventos (Stripe reintenta hasta 3 días; > 0 sostenido = webhook caído)
  const ev = (await stripe.events.list({ limit: 50 })).data || [];
  report.recentEvents = {
    checked: ev.length, pendingDeliveries: ev.filter((e) => e.pending_webhooks > 0).map((e) => ({ type: e.type, created: new Date(e.created * 1000).toISOString() })),
    types: ev.reduce((m, e) => ((m[e.type] = (m[e.type] || 0) + 1), m), {}),
  };

  const pmd = await stripe.paymentMethodDomains.list({ limit: 20 }).catch((e) => ({ error: e.code || e.type, data: [] }));
  report.walletDomains = pmd.error ? { error: pmd.error } : domainReport(pmd.data || []);

  const pmc = await stripe.paymentMethodConfigurations.list({ limit: 10 }).catch(() => ({ data: [] }));
  const def = (pmc.data || []).find((c) => c.is_default) || (pmc.data || [])[0];
  report.paymentMethods = def ? {
    card: def.card && def.card.display_preference && def.card.display_preference.value,
    applePay: def.apple_pay && def.apple_pay.display_preference && def.apple_pay.display_preference.value,
    googlePay: def.google_pay && def.google_pay.display_preference && def.google_pay.display_preference.value,
    link: def.link && def.link.display_preference && def.link.display_preference.value,
  } : null;

  report.membershipPrices = await priceReport(stripe);
  report.connect = await connectReport(stripe);
  const bal = await stripe.balance.retrieve().catch(() => null);
  report.balanceCurrencies = bal ? (bal.available || []).map((b) => b.currency) : null;
  return report;
}

module.exports = { stripeHealth, webhookReport, domainReport, REQUIRED_EVENTS };
