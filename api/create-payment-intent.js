// Vercel Serverless Function: POST /api/create-payment-intent
// ---------------------------------------------------------------------------
// Crea la reserva (public.bookings, estado 'awaiting_payment') y su PaymentIntent de Stripe.
// Los días de paseo (public.walk_requests, una fila por día) los crea /api/stripe-webhook
// SOLO cuando Stripe confirma el cobro: así los paseadores nunca ven reservas sin pagar.
//
// Petición (cliente con sesión de Supabase):
//   POST /api/create-payment-intent
//   Authorization: Bearer <access_token>
//   {
//     "checkoutId": "<uuid generado al abrir el checkout>",   // reintentos = misma reserva
//     "serviceId": "walk_std", "variantIdx": 1, "grooming": ["bath"], "largeDog": false,
//     "petIds": ["<id pets>", "<id pets>"],                    // número de mascotas = petIds.length
//     "selectedDates": ["2026-11-20", "2026-11-21"],           // cada día = un servicio
//     "time": "09:30",                                          // hora local de Birmingham
//     "address": "1800 Oxmoor Rd, Homewood, AL", "notes": "…",
//     "liabilityAccepted": true, "lang": "es"
//   }
// Respuesta: { clientSecret, paymentIntentId, bookingId, amount, currency, quote }
//
// El MONTO se calcula aquí (api/_lib/pricing.js): precio_por_día × días, con tarifa por mascota extra.
// Variables: STRIPE_SECRET_KEY, SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
// ---------------------------------------------------------------------------
const Stripe = require('stripe');
const { send, readJsonBody, bearerToken } = require('./_lib/http');
const { isConfigured, sb, sbOrThrow, getUserFromToken, enc } = require('./_lib/supabase');
const { computeQuote, QuoteError, MAX_PETS, MEMBER_DISCOUNT_PCT } = require('./_lib/pricing');
const { getMembership, isActiveMember } = require('./_lib/membership');
const { isValidTime, localToUtcIso } = require('./_lib/time');
const { clientIp } = require('./_lib/http');
const { verifyHuman } = require('./_lib/bot-guard');
const { rateLimit } = require('./_lib/rate-limit');
const contentFilter = require('./_lib/content-filter');
const { sanitizePickupCoords } = require('./_lib/location-privacy');

const MAX_TOTAL_CENTS = 500000; // tope de seguridad: $5,000 por reserva
const LIABILITY_VERSION = '2026-11-11';
const REUSABLE = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PET_ID = /^[A-Za-z0-9-]{1,64}$/;

function stripeKeyValid(k) { return /^(sk|rk)_(live|test)_[A-Za-z0-9]{20,}$/.test(k || ''); }

// Mascotas del usuario (con foto si la columna dog_photo_url ya existe)
async function loadOwnPets(userId, petIds) {
  const ids = petIds.map((id) => `"${String(id).replace(/"/g, '')}"`).join(',');
  const base = `/rest/v1/pets?owner_id=eq.${enc(userId)}&id=in.(${enc(ids)})`;
  let r = await sb(`${base}&select=id,name,breed,notes,dog_photo_url`);
  if (!r.ok && r.data && r.data.code === '42703') r = await sb(`${base}&select=id,name,breed,notes`); // aún sin la columna
  if (!r.ok) throw new Error(`Supabase pets ${r.status}: ${JSON.stringify(r.data)}`);
  const porId = new Map((r.data || []).map((p) => [String(p.id), p]));
  return petIds.map((id) => porId.get(String(id))).filter(Boolean);
}

async function findBooking(userId, checkoutId) {
  const rows = await sbOrThrow(`/rest/v1/bookings?client_id=eq.${enc(userId)}&checkout_id=eq.${enc(checkoutId)}&select=*&limit=1`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'method_not_allowed' }); }

  if (!stripeKeyValid(process.env.STRIPE_SECRET_KEY) || !isConfigured()) {
    console.error('Configuración incompleta: STRIPE_SECRET_KEY (sk_live_…), SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.');
    return send(res, 503, { error: 'not_configured' });
  }

  // 1) Sesión
  const user = await getUserFromToken(bearerToken(req)).catch(() => null);
  if (!user) return send(res, 401, { error: 'unauthorized' });
  if (!(await rateLimit('payment_user', user.id))) return send(res, 429, { error: 'rate_limited' });

  // 2) Datos de la reserva
  let b;
  try { b = await readJsonBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
  // Anti-bots (honeypot siempre; Turnstile cuando estén las claves en Vercel)
  const human = await verifyHuman(b, clientIp(req), 'booking');
  if (!human.ok) return send(res, human.error === 'bot_detected' ? 400 : 403, { error: human.error });
  const checkoutId = String(b.checkoutId || '');
  if (!UUID.test(checkoutId)) return send(res, 400, { error: 'invalid_checkout_id' });
  if (b.liabilityAccepted !== true) return send(res, 400, { error: 'liability_not_accepted' });
  const address = String(b.address || '').trim();
  if (address.length < 5 || address.length > 300) return send(res, 400, { error: 'invalid_address' });
  const time = String(b.time || '');
  if (!isValidTime(time)) return send(res, 400, { error: 'invalid_time' });
  const notes = String(b.notes || '').trim().slice(0, 500) || null;
  if (!contentFilter.check(notes).ok) return send(res, 400, { error: 'content_blocked', field: 'notes' });
  const lang = b.lang === 'en' ? 'en' : 'es';
  const petIds = Array.isArray(b.petIds) ? [...new Set(b.petIds.map(String))] : [];
  if (!petIds.length || petIds.length > MAX_PETS || !petIds.every((id) => PET_ID.test(id))) return send(res, 400, { error: 'invalid_pets' });

  try {
    const pets = await loadOwnPets(user.id, petIds);
    if (pets.length !== petIds.length) return send(res, 403, { error: 'pets_not_owned' });

    // 3) Monto calculado en el servidor: precio por día × días (+ mascotas extra) − descuento Barkwalk Club
    //    La membresía se lee de la base (la escribe solo el webhook de Stripe), nunca del navegador.
    const socio = isActiveMember(await getMembership(user.id).catch(() => null), 'club');
    let quote;
    try {
      quote = computeQuote({ serviceId: b.serviceId, variantIdx: b.variantIdx, grooming: b.grooming, largeDog: !!b.largeDog, petsCount: pets.length, dates: b.selectedDates },
                           { memberDiscountPct: socio ? MEMBER_DISCOUNT_PCT : 0 });
    } catch (e) {
      if (e instanceof QuoteError) return send(res, 400, { error: e.code });
      throw e;
    }
    if (quote.totalCents < 50 || quote.totalCents > MAX_TOTAL_CENTS) return send(res, 422, { error: 'invalid_amount' });
    // La primera cita no puede quedar en el pasado (p. ej. hoy a una hora que ya pasó)
    const primera = localToUtcIso(quote.dates[0], time);
    if (!primera || Date.parse(primera) < Date.now() - 5 * 60000) return send(res, 400, { error: 'past_time' });

    const snapshotPets = pets.map((p) => ({ id: p.id, name: p.name, breed: p.breed || null, notes: p.notes || null, photo: p.dog_photo_url || null }));
    const values = {
      client_id: user.id, checkout_id: checkoutId, status: 'awaiting_payment', payment_status: 'pending',
      service_id: quote.serviceId, variant_idx: quote.variantIdx,
      service_label: `${quote.serviceIcon} ${quote.serviceName[lang]} · ${quote.variantLabel}`,
      // Duración CONTRATADA (catálogo del servidor). Los días de paseo la copian de aquí: la pantalla del paseo,
      // el mínimo para completar y las alertas usan siempre lo que se pagó.
      duration_label: quote.durationLabel, duration_minutes: quote.durationMinutes,
      grooming: quote.grooming, large_dog: quote.largeDog, pets: snapshotPets, pets_count: quote.petsCount,
      dates: quote.dates, scheduled_time: time, address, notes, lang,
      per_day_cents: quote.perDayCents, total_cents: quote.totalCents, currency: 'usd', quote: { lines: quote.lines },
      // Solo con descuento: así las reservas siguen funcionando si la migración de membresías aún no está aplicada
      ...(quote.memberDiscountPct ? { per_day_list_cents: quote.perDayListCents, member_discount_pct: quote.memberDiscountPct } : {}),
      liability_accepted_at: new Date().toISOString(), liability_version: LIABILITY_VERSION,
    };
    // Coordenadas opcionales de la DIRECCIÓN de recogida (distancia/ETA del paseador), redondeadas a ~11 m.
    // Nunca la ubicación en vivo del dueño (ver api/_lib/location-privacy.js).
    const pickup = sanitizePickupCoords(b.pickupLat, b.pickupLng);
    if (pickup) { values.pickup_lat = pickup.lat; values.pickup_lng = pickup.lng; }

    // 4) Reserva: la misma checkoutId reutiliza la fila (doble clic, reintento, cambio de días)
    let booking = await findBooking(user.id, checkoutId);
    if (booking && (booking.payment_status === 'paid' || booking.status === 'paid')) return send(res, 409, { error: 'already_paid', bookingId: booking.id });
    if (booking) {
      const rows = await sbOrThrow(`/rest/v1/bookings?id=eq.${enc(booking.id)}`, { method: 'PATCH', body: values, prefer: 'return=representation' });
      booking = rows[0] || { ...booking, ...values };
    } else {
      const rows = await sbOrThrow('/rest/v1/bookings', { method: 'POST', body: values, prefer: 'return=representation' });
      booking = rows[0];
    }

    // 5) PaymentIntent (reutiliza el pendiente si el monto no cambió)
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2 });
    let previo = null;
    if (booking.stripe_payment_intent_id) {
      previo = await stripe.paymentIntents.retrieve(booking.stripe_payment_intent_id).catch(() => null);
      if (previo && previo.status === 'succeeded') return send(res, 409, { error: 'already_paid', bookingId: booking.id });
      // Cobro en curso (p. ej. verificación del banco): crear otro PaymentIntent podría cobrar dos veces
      if (previo && previo.status === 'processing') return send(res, 409, { error: 'payment_processing', bookingId: booking.id });
      if (previo && REUSABLE.has(previo.status) && previo.amount === quote.totalCents && previo.metadata.booking_id === String(booking.id)) {
        return send(res, 200, view(previo, booking, quote));
      }
      if (previo && REUSABLE.has(previo.status)) await stripe.paymentIntents.cancel(previo.id).catch(() => {});
    }

    const pi = await stripe.paymentIntents.create({
      amount: quote.totalCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true }, // tarjeta, Apple Pay, Google Pay, Cash App Pay… (según el Dashboard)
      description: `Barkwalk · ${quote.serviceName.en} (${quote.variantLabel}) × ${quote.days} day(s) · ${quote.petsCount} pet(s)`.slice(0, 200),
      receipt_email: user.email || undefined,
      // Stripe Connect: agrupa este cobro con las transferencias a los paseadores (/api/walker-payout)
      transfer_group: `booking_${booking.id}`,
      metadata: {
        booking_id: String(booking.id), client_id: String(user.id), checkout_id: checkoutId,
        days: String(quote.days), pets: String(quote.petsCount), customer_email: user.email || '',
      },
    }, { idempotencyKey: `bw-${booking.id}-${quote.totalCents}-${previo ? previo.id : 'first'}` });

    await sbOrThrow(`/rest/v1/bookings?id=eq.${enc(booking.id)}`, { method: 'PATCH', body: { stripe_payment_intent_id: pi.id }, prefer: 'return=minimal' });
    // Aparte y sin bloquear el pago: la columna existe solo tras la migración de Connect
    await sb(`/rest/v1/bookings?id=eq.${enc(booking.id)}`, { method: 'PATCH', body: { transfer_group: `booking_${booking.id}` }, prefer: 'return=minimal' }).catch(() => {});
    return send(res, 200, view(pi, booking, quote));
  } catch (e) {
    if (e && e.type && String(e.type).startsWith('Stripe')) {
      console.error('Stripe:', e.type, e.message);
      return send(res, 402, { error: 'stripe_rejected', message: e.type === 'StripeCardError' ? e.message : undefined }); // solo rechazos de tarjeta: sin detalles de configuración
    }
    console.error('create-payment-intent:', e.message);
    return send(res, 500, { error: 'internal_error' });
  }
}

function view(pi, booking, quote) {
  return {
    clientSecret: pi.client_secret, paymentIntentId: pi.id, bookingId: booking.id,
    amount: pi.amount, currency: pi.currency, status: pi.status,
    quote: { perDayCents: quote.perDayCents, perDayListCents: quote.perDayListCents, memberDiscountPct: quote.memberDiscountPct, days: quote.days, petsCount: quote.petsCount, totalCents: quote.totalCents, dates: quote.dates, lines: quote.lines },
  };
}

module.exports = handler;
