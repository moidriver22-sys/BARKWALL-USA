// Membresías recurrentes (Stripe Billing): utilidades compartidas
// ---------------------------------------------------------------------------
//   · Barkwalk Club  (role client)          → tier 'club'        → precio STRIPE_PRICE_CLUB
//   · Socio Pro      (role walker/shopper)  → tier 'walker_pro'  → precio STRIPE_PRICE_WALKER_PRO
// El TIER se deduce del PRECIO de la suscripción en Stripe (no de metadata ni del navegador).
// Beneficios activos solo con status 'active' o 'trialing'.
// Variables: STRIPE_PRICE_CLUB, STRIPE_PRICE_WALKER_PRO, WALKER_PRO_PAYOUT_PERCENT (80)
// ---------------------------------------------------------------------------
const { sb, sbOrThrow, enc } = require('./supabase');

const ACTIVE_STATUSES = new Set(['active', 'trialing']);
const KNOWN_STATUSES = new Set(['incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused']);
const WALKER_ROLES = new Set(['walker', 'shopper']);

function priceIdValid(p) { return /^price_[A-Za-z0-9]{8,}$/.test(p || ''); }

function prices() {
  return { club: process.env.STRIPE_PRICE_CLUB || '', walker_pro: process.env.STRIPE_PRICE_WALKER_PRO || '' };
}

function tierForRole(role) {
  if (role === 'client') return 'club';
  if (WALKER_ROLES.has(role)) return 'walker_pro';
  return null;
}

function tierForPrice(priceId) {
  const p = prices();
  if (priceId && priceId === p.club) return 'club';
  if (priceId && priceId === p.walker_pro) return 'walker_pro';
  return null;
}

function isActiveMember(profile, tier) {
  return !!profile && profile.membership_tier === tier && ACTIVE_STATUSES.has(profile.membership_status);
}

// Porcentaje del paseador Pro (por defecto 80). Sin valor válido, el Pro cobra el porcentaje base.
function proPayoutPercent() {
  const p = Number(process.env.WALKER_PRO_PAYOUT_PERCENT || 80);
  return Number.isFinite(p) && p > 0 && p <= 100 ? p : null;
}

// Membresía del usuario; si las columnas aún no existen (migración sin aplicar) → sin membresía
async function getMembership(userId) {
  const r = await sb(`/rest/v1/profiles?id=eq.${enc(userId)}&select=id,role,email,full_name,membership_tier,membership_status,stripe_customer_id,stripe_subscription_id,membership_current_period_end&limit=1`);
  if (!r.ok) { console.warn('membership: no se pudo leer (¿falta la migración 20261115?)', r.status); return null; }
  return (r.data && r.data[0]) || null;
}

// Guarda en profiles el estado REAL de una suscripción de Stripe (fuente de verdad: Stripe)
async function syncSubscription(stripe, subOrId) {
  const sub = typeof subOrId === 'string' ? await stripe.subscriptions.retrieve(subOrId) : subOrId;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer && sub.customer.id;
  const item = sub.items && sub.items.data && sub.items.data[0];
  const tier = tierForPrice(item && item.price && item.price.id);

  // Perfil: primero por customer (lo creó nuestro servidor); si no, por metadata de la suscripción
  let rows = customerId ? await sbOrThrow(`/rest/v1/profiles?stripe_customer_id=eq.${enc(customerId)}&select=id,role,stripe_subscription_id&limit=1`) : [];
  if (!rows.length && sub.metadata && sub.metadata.supabase_user_id) {
    rows = await sbOrThrow(`/rest/v1/profiles?id=eq.${enc(sub.metadata.supabase_user_id)}&stripe_customer_id=eq.${enc(customerId)}&select=id,role,stripe_subscription_id&limit=1`);
  }
  const profile = rows[0];
  if (!profile) { console.error(`Suscripción ${sub.id}: sin perfil con customer ${customerId}.`); return { status: 'profile_not_found' }; }
  if (!tier) { console.error(`Suscripción ${sub.id}: precio desconocido (${item && item.price && item.price.id}).`); return { status: 'unknown_price' }; }
  if (tier !== tierForRole(profile.role)) { console.error(`Suscripción ${sub.id}: tier ${tier} no corresponde al rol ${profile.role}.`); return { status: 'tier_role_mismatch' }; }

  // Una suscripción vieja (p. ej. cancelada) no pisa a la vigente
  if (profile.stripe_subscription_id && profile.stripe_subscription_id !== sub.id && !ACTIVE_STATUSES.has(sub.status)) {
    return { status: 'ignored_old_subscription' };
  }

  const status = KNOWN_STATUSES.has(sub.status) ? sub.status : 'inactive';
  const terminada = status === 'canceled' || status === 'incomplete_expired';
  const periodEnd = (item && item.current_period_end) || sub.current_period_end; // según versión de la API
  const body = {
    membership_tier: terminada ? 'free' : tier,
    membership_status: status,
    stripe_subscription_id: terminada ? null : sub.id,
    membership_current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
  };
  await sbOrThrow(`/rest/v1/profiles?id=eq.${enc(profile.id)}`, { method: 'PATCH', body, prefer: 'return=minimal' });
  return { status: 'ok', userId: profile.id, tier: body.membership_tier, membership: status };
}

module.exports = { ACTIVE_STATUSES, WALKER_ROLES, priceIdValid, prices, tierForRole, tierForPrice, isActiveMember, proPayoutPercent, getMembership, syncSubscription };
