// Vercel Serverless Function: POST /api/stripe-webhook
// ---------------------------------------------------------------------------
// Evento: payment_intent.succeeded
//   1. Verifica la firma con stripe.webhooks.constructEvent(cuerpo_crudo, stripe-signature, STRIPE_WEBHOOK_SECRET).
//   2. Confirma que el dinero está cobrado: status 'succeeded', moneda y amount_received == total de la reserva
//      (si hay STRIPE_SECRET_KEY válida, vuelve a leer el PaymentIntent directamente de Stripe).
//   3. Marca public.bookings como 'paid' y crea una fila de public.walk_requests POR CADA DÍA.
//   4. Envía UN correo de confirmación (Resend) con los días, las mascotas y sus fotos.
// Todo es idempotente: Stripe puede reenviar el mismo evento sin duplicar días ni correos.
//
// Variables: STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY (recomendada), SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL),
//            SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, EMAIL_FROM
// ---------------------------------------------------------------------------
const Stripe = require('stripe');
const { send, readRawBody, escapeHtml } = require('./_lib/http');
const { isConfigured, sb, sbOrThrow, getAuthUserEmail, enc } = require('./_lib/supabase');
const { localToUtcIso } = require('./_lib/time');
const { syncSubscription } = require('./_lib/membership');
const { handleChargeRefunded, handleDispute } = require('./_lib/refunds');
const EMAIL = require('./_lib/email-layout'); // diseño común (logo, colores, pie) para los correos

// Reembolsos y disputas: añade estos eventos al endpoint en Stripe (ver _lib/refunds.js)
const REFUND_EVENTS = new Set(['charge.refunded', 'charge.dispute.created', 'charge.dispute.closed']);

const SUBSCRIPTION_EVENTS = new Set(['checkout.session.completed', 'customer.subscription.created',
  'customer.subscription.updated', 'customer.subscription.deleted']);

function stripeClient() {
  const k = process.env.STRIPE_SECRET_KEY || '';
  // constructEvent no usa la clave; con una inválida solo se omite la relectura del PaymentIntent
  return {
    stripe: Stripe(k || 'sk_unset', { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2 }),
    canCallApi: /^(sk|rk)_(live|test)_[A-Za-z0-9]{20,}$/.test(k),
  };
}

function money(cents, currency = 'usd') {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format((Number(cents) || 0) / 100); }
  catch { return `$${((Number(cents) || 0) / 100).toFixed(2)}`; }
}

function fmtDate(ymd, lang) {
  const d = new Date(ymd + 'T12:00:00Z');
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
}

function fmtTime(hm) {
  const [h, m] = String(hm || '').split(':').map(Number);
  if (!Number.isFinite(h)) return '';
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// ---------- Días de paseo (una fila de walk_requests por fecha) ----------
const OPTIONAL_WALK_COLUMNS = ['pet_photo_url', 'pet_ids', 'pets_count', 'scheduled_date', 'scheduled_time', 'scheduled_at', 'booking_id',
  'payment_status', 'paid_at', 'payment_method', 'pickup_address', 'pickup_latitude', 'pickup_longitude', 'liability_accepted_at', 'special_notes'];

async function insertWalkDays(booking, clientName) {
  const pets = Array.isArray(booking.pets) ? booking.pets : [];
  const nombres = pets.map((p) => p.name).filter(Boolean).join(' + ') || 'Pet';
  const primera = pets[0] || {};
  const duracion = String(booking.service_label || '').split(' · ').pop() || null;
  let filas = (booking.dates || []).map((fecha) => ({
    booking_id: booking.id,
    client_id: booking.client_id,
    client_name: clientName || 'Cliente',
    pet_name: nombres,
    pet_id: primera.id != null ? primera.id : undefined,
    pet_ids: pets.map((p) => p.id),
    pets_count: booking.pets_count || pets.length || 1,
    pet_photo_url: primera.photo || undefined,
    status: 'pending',
    service_type: booking.service_label,
    duration: duracion,
    total_price: (Number(booking.per_day_cents) || 0) / 100, // cada día es un servicio independiente
    address: booking.address,
    pickup_address: booking.address,
    pickup_latitude: booking.pickup_lat != null ? booking.pickup_lat : undefined,
    pickup_longitude: booking.pickup_lng != null ? booking.pickup_lng : undefined,
    scheduled_date: fecha,
    scheduled_time: booking.scheduled_time,
    scheduled_at: localToUtcIso(fecha, String(booking.scheduled_time || '').slice(0, 5)),
    payment_status: 'paid',
    paid_at: booking.paid_at || new Date().toISOString(),
    payment_method: 'card',
    liability_accepted_at: booking.liability_accepted_at,
    special_notes: booking.notes || undefined,
  }));
  filas = filas.map((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)));

  // Columnas que la tabla aún no tenga: se reintenta sin ellas (mismo patrón que index.html)
  let usarConflicto = true; // índice único (booking_id, scheduled_date): evita días duplicados si Stripe reintenta
  for (let intento = 0; intento <= OPTIONAL_WALK_COLUMNS.length + 1; intento++) {
    const conflicto = usarConflicto && filas[0] && 'scheduled_date' in filas[0] && 'booking_id' in filas[0] ? '?on_conflict=booking_id,scheduled_date' : '';
    const r = await sb(`/rest/v1/walk_requests${conflicto}`, {
      method: 'POST', body: filas, prefer: `return=representation${conflicto ? ',resolution=ignore-duplicates' : ''}`,
    });
    if (r.ok) return Array.isArray(r.data) ? r.data : [];
    const code = r.data && r.data.code;
    if (code === '42P10' && conflicto) { // aún no existe el índice único: se inserta sin on_conflict
      console.warn('walk_requests sin índice único (booking_id, scheduled_date); ejecuta la migración SQL.');
      usarConflicto = false;
      continue;
    }
    const msg = (r.data && r.data.message) || '';
    const col = code === 'PGRST204' && OPTIONAL_WALK_COLUMNS.find((c) => filas[0] && c in filas[0] && msg.includes(`'${c}'`));
    if (!col) throw new Error(`Supabase walk_requests ${r.status}: ${JSON.stringify(r.data)}`);
    console.warn(`walk_requests no tiene la columna ${col}; se guarda sin ella.`);
    filas = filas.map((f) => { const copia = { ...f }; delete copia[col]; return copia; });
  }
  throw new Error('walk_requests: no se pudieron insertar los días');
}

// ---------- Correo ----------
function buildEmail(booking, pi, clientName) {
  const es = booking.lang !== 'en';
  const t = (a, b) => (es ? a : b);
  const pets = Array.isArray(booking.pets) ? booking.pets : [];
  const total = money(pi.amount_received, pi.currency);
  const porDia = money(booking.per_day_cents, booking.currency || 'usd');
  const hora = fmtTime(String(booking.scheduled_time || '').slice(0, 5));
  const L = EMAIL;
  // Días: una fila por fecha (las listas <ul> se descuadran en Gmail para Android)
  const dias = (booking.dates || []).map((d) => `
      <tr><td style="padding:7px 12px;border-bottom:1px solid ${L.C.line};font-size:14px;line-height:20px;color:${L.C.text}">📅 <strong>${escapeHtml(fmtDate(d, booking.lang))}</strong>${hora ? ` <span style="color:${L.C.muted}">· ${escapeHtml(hora)}</span>` : ''}</td></tr>`).join('');
  // Mascotas: hasta 4 por fila; foto redonda (sin object-fit, que Gmail ignora) o un emoji si no hay foto
  const ancho = Math.floor(100 / Math.min(4, Math.max(1, pets.length)));
  const fotos = pets.slice(0, 4).map((p) => `
      <td align="center" valign="top" width="${ancho}%" style="padding:6px 4px;font-family:${L.FONT}">
        ${p.photo && /^https:\/\//.test(p.photo)
          ? `<img src="${escapeHtml(p.photo)}" alt="${escapeHtml(p.name)}" width="84" height="84" style="display:block;margin:0 auto;width:84px;height:84px;border-radius:42px;border:3px solid ${L.C.page}">`
          : `<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center"><tr><td width="84" height="84" align="center" valign="middle" bgcolor="${L.C.page}" style="width:84px;height:84px;border-radius:42px;background:${L.C.page};font-size:38px;line-height:84px">🐶</td></tr></table>`}
        <div style="margin-top:8px;font-size:14px;font-weight:700;color:${L.C.text}">${escapeHtml(p.name)}</div>
        ${p.breed ? `<div style="font-size:12px;line-height:16px;color:${L.C.muted}">${escapeHtml(p.breed)}</div>` : ''}
      </td>`).join('');
  const fila = (k, v, fuerte) => (v ? `
      <tr><td style="padding:9px 0;border-bottom:1px solid ${L.C.line};font-size:14px;line-height:20px;color:${L.C.muted}">${k}</td>
          <td align="right" style="padding:9px 0 9px 12px;border-bottom:1px solid ${L.C.line};font-size:${fuerte ? 17 : 14}px;line-height:20px;font-weight:700;color:${fuerte ? L.C.ink : L.C.text}">${escapeHtml(v)}</td></tr>` : '');

  const body = `
      <h1 style="margin:0 0 6px;font-family:${L.FONT};font-size:24px;line-height:30px;font-weight:800;color:${L.C.ink}">${t('¡Pago confirmado! 🐾', 'Payment confirmed! 🐾')}</h1>
      <p style="margin:0 0 18px">${t('Hola', 'Hi')}${clientName ? ' ' + escapeHtml(clientName) : ''}, ${t('recibimos tu pago y tu reserva está confirmada.', 'we received your payment and your booking is confirmed.')}</p>
      ${fotos ? `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 14px"><tr>${fotos}</tr></table>` : ''}
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border-top:1px solid ${L.C.line}">
        ${fila(t('Servicio', 'Service'), booking.service_label)}
        ${fila(t('Dirección', 'Address'), booking.address)}
        ${fila(t('Mascotas', 'Pets'), String(booking.pets_count || pets.length))}
        ${fila(t('Precio por día', 'Price per day'), porDia)}
        ${fila(t('Días', 'Days'), String((booking.dates || []).length))}
        ${fila(t('Total pagado', 'Total paid'), total, true)}
      </table>
      <p style="margin:22px 0 8px;font-size:13px;line-height:18px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${L.C.ink}">${t('Tus días de servicio', 'Your service days')}</p>
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="${L.C.soft}" style="background:${L.C.soft};border:1px solid ${L.C.line};border-radius:12px">${dias}</table>
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top:18px"><tr>
        <td bgcolor="#EEF6F1" style="background:#EEF6F1;border-left:4px solid ${L.C.green};border-radius:8px;padding:12px 14px;font-size:13px;line-height:19px;color:${L.C.text}">
          ${t('Te avisaremos en la app cuando tu paseador acepte y vaya en camino. Los códigos de acceso solo se muestran al paseador asignado 1 hora antes de cada cita.',
              'We will notify you in the app when your walker accepts and is on the way. Access codes are only shown to your assigned walker 1 hour before each visit.')}
        </td></tr></table>
      ${L.button(`${L.SITE}/`, t('Abrir Barkwalk', 'Open Barkwalk'))}`;
  const html = L.emailShell({
    title: t('Reserva confirmada', 'Booking confirmed'),
    preheader: t(`Tu reserva de ${(booking.dates || []).length} día(s) está confirmada · ${total}`, `Your ${(booking.dates || []).length}-day booking is confirmed · ${total}`),
    lang: es ? 'es' : 'en',
    bodyHtml: body,
    footerNote: `${t('Reserva', 'Booking')} #${escapeHtml(String(booking.id).slice(0, 8))} · ${t('Aceptaste la Exención de Responsabilidad de Acceso al Hogar y Custodia de Llaves', 'You accepted the Key Handling &amp; House Access Release of Liability')}.`,
  });

  const text = [
    t('¡Pago confirmado!', 'Payment confirmed!'),
    `${t('Servicio', 'Service')}: ${booking.service_label}`,
    `${t('Mascotas', 'Pets')}: ${pets.map((p) => p.name).join(', ')}`,
    `${t('Días', 'Days')}: ${(booking.dates || []).map((d) => fmtDate(d, booking.lang)).join(', ')}${hora ? ' · ' + hora : ''}`,
    `${t('Dirección', 'Address')}: ${booking.address}`,
    `${t('Total pagado', 'Total paid')}: ${total}`,
  ].join('\n');

  return { subject: `Barkwalk · ${t('Reserva confirmada', 'Booking confirmed')} (${(booking.dates || []).length} ${t('día(s)', 'day(s)')})`, html, text };
}

async function sendEmail(to, msg, idempotencyKey) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) throw new Error('RESEND_API_KEY / EMAIL_FROM no configurados');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey.slice(0, 256) },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject: msg.subject, html: msg.html, text: msg.text }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

// ---------- payment_intent.succeeded ----------
async function handlePaymentSucceeded(eventPi, stripe, canCallApi) {
  // Fuente de verdad: el PaymentIntent leído de Stripe (si hay clave); si no, el del evento firmado
  const pi = canCallApi ? await stripe.paymentIntents.retrieve(eventPi.id) : eventPi;
  const bookingId = pi.metadata && pi.metadata.booking_id;
  if (!bookingId) return { status: 200, body: { received: true, ignored: 'missing metadata.booking_id' } };

  const rows = await sbOrThrow(`/rest/v1/bookings?id=eq.${enc(bookingId)}&select=*&limit=1`).catch((e) => {
    if (e.code === '22P02') return []; // id con formato antiguo (walk_requests)
    throw e;
  });
  const booking = rows[0];
  if (!booking) {
    console.error(`Reserva ${bookingId} no encontrada en bookings (PaymentIntent ${pi.id}).`);
    return { status: 200, body: { received: true, ignored: 'booking not found' } };
  }

  // Dinero confirmado: estado, moneda y monto exactos
  const cobrado = pi.amount_received || 0;
  if (pi.status !== 'succeeded' || String(pi.currency) !== String(booking.currency || 'usd') || cobrado !== Number(booking.total_cents)) {
    console.error(`Reserva ${booking.id}: pago NO coincide (status ${pi.status}, ${cobrado} ${pi.currency} vs ${booking.total_cents} ${booking.currency}). No se marca como pagada.`);
    await sb(`/rest/v1/bookings?id=eq.${enc(booking.id)}&payment_status=neq.paid`, { method: 'PATCH', body: { status: 'amount_mismatch' }, prefer: 'return=minimal' });
    return { status: 200, body: { received: true, booking: booking.id, paid: false, reason: 'amount_mismatch' } };
  }

  // 1) paid (solo si aún no lo está)
  const paidAt = new Date((pi.created || Math.floor(Date.now() / 1000)) * 1000).toISOString();
  // Cargo (ch_…): origen de las transferencias a los paseadores (Stripe Connect). Aparte y sin bloquear:
  // si la migración de Connect aún no se aplicó, la columna no existe y el resto del webhook sigue igual.
  const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : (pi.latest_charge && pi.latest_charge.id) || null;
  if (chargeId && !booking.stripe_charge_id) {
    const rc = await sb(`/rest/v1/bookings?id=eq.${enc(booking.id)}`, { method: 'PATCH', body: { stripe_charge_id: chargeId }, prefer: 'return=minimal' });
    if (!rc.ok) console.warn(`Reserva ${booking.id}: no se guardó stripe_charge_id (¿falta la migración de Connect?).`);
  }
  if (booking.payment_status !== 'paid') {
    await sbOrThrow(`/rest/v1/bookings?id=eq.${enc(booking.id)}&payment_status=neq.paid`, {
      method: 'PATCH', body: { payment_status: 'paid', status: 'paid', paid_at: paidAt, stripe_payment_intent_id: pi.id }, prefer: 'return=minimal',
    });
    booking.paid_at = paidAt;
  }

  // Nombre del cliente para los paseadores y el correo
  const perfil = await sb(`/rest/v1/profiles?id=eq.${enc(booking.client_id)}&select=full_name&limit=1`);
  const clientName = (perfil.ok && perfil.data && perfil.data[0] && perfil.data[0].full_name) || '';

  // 2) Un registro de walk_requests por día (ignora los que ya existan)
  if (!booking.walks_created_at) {
    const creadas = await insertWalkDays(booking, clientName);
    await sbOrThrow(`/rest/v1/bookings?id=eq.${enc(booking.id)}`, { method: 'PATCH', body: { walks_created_at: new Date().toISOString() }, prefer: 'return=minimal' });
    console.log(`Reserva ${booking.id}: ${creadas.length} día(s) creados en walk_requests.`);
  }

  // 3) Correo una sola vez (se reserva el envío antes de mandarlo)
  if (booking.confirmation_email_sent_at) return { status: 200, body: { received: true, booking: booking.id, paid: true, email: 'already sent' } };
  // Sin Resend configurado no se responde 500: Stripe reintentaría durante días y acabaría DESHABILITANDO
  // el endpoint (también dejarían de llegar los eventos de membresías). El pago y los días ya quedaron guardados.
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    console.error(`Reserva ${booking.id}: pagada, pero no se envió el correo (faltan RESEND_API_KEY / EMAIL_FROM en Vercel).`);
    return { status: 200, body: { received: true, booking: booking.id, paid: true, email: 'not_configured' } };
  }
  const reclamo = await sbOrThrow(`/rest/v1/bookings?id=eq.${enc(booking.id)}&confirmation_email_sent_at=is.null`, {
    method: 'PATCH', body: { confirmation_email_sent_at: new Date().toISOString() }, prefer: 'return=representation',
  });
  if (!reclamo.length) return { status: 200, body: { received: true, booking: booking.id, paid: true, email: 'handled by another delivery' } };

  const to = String((pi.metadata && pi.metadata.customer_email) || pi.receipt_email || '').trim() || await getAuthUserEmail(booking.client_id);
  if (!to) return { status: 200, body: { received: true, booking: booking.id, paid: true, email: 'no recipient' } };
  try {
    await sendEmail(to, buildEmail(booking, pi, clientName), `booking-paid-${booking.id}-${pi.id}`);
  } catch (e) {
    await sb(`/rest/v1/bookings?id=eq.${enc(booking.id)}`, { method: 'PATCH', body: { confirmation_email_sent_at: null }, prefer: 'return=minimal' });
    console.error(`Reserva ${booking.id}: error enviando el correo:`, e.message);
    return { status: 500, body: { error: 'email_failed', booking: booking.id, paid: true } }; // Stripe reintenta
  }
  return { status: 200, body: { received: true, booking: booking.id, paid: true, email: 'sent' } };
}

// ---------- Handler ----------
async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'method_not_allowed' }); }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !isConfigured()) {
    console.error('Faltan variables: STRIPE_WEBHOOK_SECRET, SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY.');
    return send(res, 503, { error: 'not_configured' });
  }

  let raw;
  try { raw = await readRawBody(req, 1024 * 1024); } catch { return send(res, 400, { error: 'unreadable_body' }); }

  const { stripe, canCallApi } = stripeClient();
  let event;
  try {
    // Verificación oficial de Stripe: HMAC-SHA256 del cuerpo crudo + tolerancia de 5 minutos
    event = stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'], secret);
  } catch (e) {
    console.warn('Webhook rechazado (firma inválida):', e.message);
    return send(res, 400, { error: 'invalid_signature' });
  }

  // Membresías (Stripe Billing): se relee la suscripción en Stripe y se sincroniza profiles
  if (SUBSCRIPTION_EVENTS.has(event.type)) {
    if (!canCallApi) { console.error('Membresías: STRIPE_SECRET_KEY inválida; no se puede leer la suscripción.'); return send(res, 500, { error: 'not_configured' }); }
    try {
      const obj = event.data.object;
      let subId = null;
      if (event.type === 'checkout.session.completed') {
        if (obj.mode !== 'subscription') return send(res, 200, { received: true, ignored: 'checkout_not_subscription' });
        subId = typeof obj.subscription === 'string' ? obj.subscription : obj.subscription && obj.subscription.id;
      } else {
        subId = obj.id;
      }
      if (!subId) return send(res, 200, { received: true, ignored: 'no_subscription' });
      const r = await syncSubscription(stripe, subId);
      console.log(`Membresía ${subId}: ${JSON.stringify(r)}`);
      return send(res, 200, { received: true, membership: r.status });
    } catch (e) {
      console.error(`Error procesando ${event.type}:`, e.message);
      return send(res, 500, { error: 'processing_failed' }); // Stripe reintenta
    }
  }

  // Reembolsos y disputas → reserva, días y pagos al paseador
  if (REFUND_EVENTS.has(event.type)) {
    try {
      const obj = event.data.object;
      const r = event.type === 'charge.refunded'
        ? await handleChargeRefunded(obj, stripe, canCallApi)
        : await handleDispute(event.type, obj, stripe, canCallApi);
      console.log(`${event.type} ${obj.id}: ${JSON.stringify(r)}`);
      // El cron estaba pagando un día de esta reserva en este instante: que Stripe reintente en unos minutos
      // para revertir esa transferencia. Solo durante 1 h (después queda en revisión y se responde 200).
      const recent = Date.now() / 1000 - (event.created || 0) < 3600;
      if (r.processing && r.processing.length && recent) return send(res, 500, { error: 'payout_in_progress', retry: true });
      return send(res, 200, { received: true, ...r });
    } catch (e) {
      console.error(`Error procesando ${event.type}:`, e.message);
      return send(res, 500, { error: 'processing_failed' }); // Stripe reintenta
    }
  }

  if (event.type !== 'payment_intent.succeeded') return send(res, 200, { received: true, ignored: event.type });

  try {
    const r = await handlePaymentSucceeded(event.data.object, stripe, canCallApi);
    return send(res, r.status, r.body);
  } catch (e) {
    console.error('Error procesando payment_intent.succeeded:', e.message);
    return send(res, 500, { error: 'processing_failed' }); // Stripe reintenta hasta 3 días
  }
}

module.exports = handler;
module.exports.buildEmail = buildEmail;
