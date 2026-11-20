// Correo al cliente cuando Stripe confirma un reembolso (charge.refunded) · Resend
// ---------------------------------------------------------------------------
// · Remitente: REFUND_EMAIL_FROM o "Barkwalk USA <soporte@barkwalkusa.com>" (dominio verificado en Resend).
//   Reply-To: soporte@ para que el cliente pueda responder.
// · Destinatario: billing_details.email del cargo → receipt_email → profiles.email → Auth (por si vienen nulos).
// · Sin duplicados: Idempotency-Key = refund-<cargo>-<monto reembolsado>. Un segundo reembolso parcial
//   (otro monto acumulado) sí genera su propio correo.
// · Errores: sin Resend configurado o rechazo 4xx → se registra y el webhook responde 200 (reintentar no
//   ayudaría y Stripe acabaría deshabilitando el endpoint). Fallo 5xx o de red → 'retry' para que Stripe reintente.
// ---------------------------------------------------------------------------
const { sb, enc, getAuthUserEmail } = require('./supabase');
const L = require('./email-layout');

const DEFAULT_FROM = 'Barkwalk USA <soporte@barkwalkusa.com>';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function money(cents, currency = 'usd') {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: String(currency).toUpperCase() }).format((Number(cents) || 0) / 100); }
  catch { return `$${((Number(cents) || 0) / 100).toFixed(2)}`; }
}
function fmtDate(ymd, lang) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return null;
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${ymd}T12:00:00Z`));
}
function fmtTime(hm) {
  const [h, m] = String(hm || '').split(':').map(Number);
  return Number.isFinite(h) ? `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` : '';
}

// Correo del cliente: primero lo que trae Stripe; si viene vacío, Supabase
async function resolveRecipient(charge, booking) {
  const candidatos = [charge && charge.billing_details && charge.billing_details.email, charge && charge.receipt_email];
  for (const c of candidatos) if (c && EMAIL_RE.test(String(c).trim())) return String(c).trim();
  if (booking && booking.client_id) {
    const r = await sb(`/rest/v1/profiles?id=eq.${enc(booking.client_id)}&select=email,full_name&limit=1`);
    const e = r.ok && Array.isArray(r.data) && r.data[0] && r.data[0].email;
    if (e && EMAIL_RE.test(e)) return e;
    const auth = await getAuthUserEmail(booking.client_id);
    if (auth && EMAIL_RE.test(auth)) return auth;
  }
  return null;
}

// HTML + texto del correo (también lo usa scripts/send-test-email.js --refund)
function buildRefundEmail({ booking, full, refundedCents, currency, cancelledDays = [], activeDays = [] }, clientName) {
  const lang = booking && booking.lang === 'en' ? 'en' : 'es';
  const t = (es, en) => (lang === 'es' ? es : en);
  const esc = L.esc;
  const monto = money(refundedCents, currency);
  const total = booking && booking.total_cents ? money(booking.total_cents, currency) : null;
  const ref = String((booking && booking.id) || '').slice(0, 8);
  const fila = (k, v, fuerte) => (v ? `
      <tr><td style="padding:9px 0;border-bottom:1px solid ${L.C.line};font-size:14px;line-height:20px;color:${L.C.muted}">${k}</td>
          <td align="right" style="padding:9px 0 9px 12px;border-bottom:1px solid ${L.C.line};font-size:${fuerte ? 17 : 14}px;line-height:20px;font-weight:700;color:${fuerte ? L.C.ink : L.C.text}">${esc(v)}</td></tr>` : '');
  const diaHtml = (d, tag, color) => `
      <tr><td style="padding:7px 12px;border-bottom:1px solid ${L.C.line};font-size:14px;line-height:20px;color:${L.C.text}">📅 <strong>${esc(fmtDate(d.date, lang) || t('Día del servicio', 'Service day'))}</strong>${d.time ? ` <span style="color:${L.C.muted}">· ${esc(fmtTime(String(d.time).slice(0, 5)))}</span>` : ''}</td>
          <td align="right" style="padding:7px 12px;border-bottom:1px solid ${L.C.line};font-size:12px;font-weight:800;color:${color};white-space:nowrap">${tag}</td></tr>`;
  const diasCancelados = cancelledDays.map((d) => diaHtml(d, t('Cancelado', 'Cancelled'), '#B3412E')).join('');
  // Días no cancelados: etiqueta según su estado real (en un reembolso total pueden estar ya hechos o en curso)
  const etiqueta = (s) => (s === 'completed' ? [t('Completado', 'Completed'), L.C.muted]
    : s === 'in_progress' ? [t('En curso', 'In progress'), '#B45309']
    : [t('Sigue activo', 'Still active'), L.C.ink]);
  const diasActivos = activeDays.map((d) => { const [tag, color] = etiqueta(d.status); return diaHtml(d, tag, color); }).join('');

  const titulo = full ? t('Reembolso confirmado', 'Refund confirmed') : t('Reembolso parcial confirmado', 'Partial refund confirmed');
  const intro = full
    ? t(`Te devolvimos <strong>${esc(monto)}</strong> por tu reserva. Los días de paseo asociados quedaron <strong>cancelados</strong> y ningún paseador acudirá.`,
        `We refunded <strong>${esc(monto)}</strong> for your booking. The walk days on it have been <strong>cancelled</strong> and no walker will come.`)
    : t(`Te devolvimos <strong>${esc(monto)}</strong> de tu reserva. Es un reembolso parcial: tu reserva sigue activa.`,
        `We refunded <strong>${esc(monto)}</strong> from your booking. This is a partial refund: your booking is still active.`);

  const body = `
      <h1 style="margin:0 0 6px;font-family:${L.FONT};font-size:24px;line-height:30px;font-weight:800;color:${L.C.ink}">${titulo} 💸</h1>
      <p style="margin:0 0 18px">${t('Hola', 'Hi')}${clientName ? ' ' + esc(clientName) : ''}, ${intro}</p>
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border-top:1px solid ${L.C.line}">
        ${fila(t('Reserva', 'Booking'), ref ? `#${ref}` : null)}
        ${fila(t('Servicio', 'Service'), booking && booking.service_label)}
        ${fila(t('Total pagado', 'Total paid'), total)}
        ${fila(t('Monto reembolsado', 'Amount refunded'), monto, true)}
      </table>
      ${diasCancelados || diasActivos ? `
      <p style="margin:22px 0 8px;font-size:13px;line-height:18px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${L.C.ink}">${t('Tus días de servicio', 'Your service days')}</p>
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="${L.C.soft}" style="background:${L.C.soft};border:1px solid ${L.C.line};border-radius:12px">${diasCancelados}${diasActivos}</table>` : ''}
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top:18px"><tr>
        <td bgcolor="#EEF6F1" style="background:#EEF6F1;border-left:4px solid ${L.C.green};border-radius:8px;padding:12px 14px;font-size:13px;line-height:19px;color:${L.C.text}">
          ${t('El dinero vuelve al mismo método de pago. Según tu banco, puede tardar de 5 a 10 días hábiles en aparecer en tu estado de cuenta.',
              'The money goes back to the same payment method. Depending on your bank, it can take 5–10 business days to appear on your statement.')}
        </td></tr></table>
      ${L.button(`${L.SITE}/`, t('Reservar de nuevo', 'Book again'))}
      <p style="margin:6px 0 0;font-size:13px;line-height:19px;color:${L.C.muted};text-align:center">${t('¿Dudas? Responde a este correo o escríbenos a', 'Questions? Reply to this email or write to')} <a href="mailto:${L.SUPPORT}" style="color:${L.C.ink}">${L.SUPPORT}</a>.</p>`;

  const html = L.emailShell({
    title: titulo,
    preheader: t(`Te devolvimos ${monto} · Reserva #${ref}`, `We refunded ${monto} · Booking #${ref}`),
    lang, bodyHtml: body,
    footerNote: `${t('Reserva', 'Booking')} #${esc(ref)}`,
  });
  const text = [
    titulo,
    `${t('Reserva', 'Booking')}: #${ref}`,
    booking && booking.service_label ? `${t('Servicio', 'Service')}: ${booking.service_label}` : null,
    `${t('Monto reembolsado', 'Amount refunded')}: ${monto}`,
    cancelledDays.length ? `${t('Días cancelados', 'Cancelled days')}: ${cancelledDays.map((d) => fmtDate(d.date, lang) || '—').join(', ')}` : null,
    full ? t('Los días de paseo asociados quedaron cancelados.', 'The walk days on this booking have been cancelled.') : t('Tu reserva sigue activa.', 'Your booking is still active.'),
    t('El dinero puede tardar de 5 a 10 días hábiles en aparecer en tu estado de cuenta.', 'It can take 5–10 business days to appear on your statement.'),
  ].filter(Boolean).join('\n');
  const subject = `Barkwalk · ${titulo} (${monto}) · #${ref}`;
  return { subject, html, text };
}

// Envía el correo. Devuelve { status: 'sent' | 'skipped' | 'failed' | 'retry', ... }
async function sendRefundEmail(notify) {
  const key = (process.env.RESEND_API_KEY || '').trim();
  if (!key) return { status: 'skipped', reason: 'resend_not_configured' };
  const to = await resolveRecipient(notify.charge, notify.booking);
  if (!to) return { status: 'skipped', reason: 'no_recipient' };

  let clientName = '';
  if (notify.booking && notify.booking.client_id) {
    const p = await sb(`/rest/v1/profiles?id=eq.${enc(notify.booking.client_id)}&select=full_name&limit=1`);
    clientName = (p.ok && Array.isArray(p.data) && p.data[0] && p.data[0].full_name) || '';
  }
  const msg = buildRefundEmail(notify, clientName);
  const from = (process.env.REFUND_EMAIL_FROM || DEFAULT_FROM).trim();
  const idem = `refund-${notify.charge && notify.charge.id}-${notify.refundedCents}`.slice(0, 256);
  let r;
  try {
    r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': idem },
      body: JSON.stringify({ from, to: [to], reply_to: L.SUPPORT, subject: msg.subject, html: msg.html, text: msg.text }),
    });
  } catch (e) {
    return { status: 'retry', reason: `network: ${e.message}` };
  }
  if (r.ok) return { status: 'sent', idempotencyKey: idem };
  const detalle = (await r.text().catch(() => '')).slice(0, 300);
  return { status: r.status >= 500 || r.status === 429 ? 'retry' : 'failed', reason: `resend ${r.status}: ${detalle}` };
}

// Muestra para pruebas: datos REALES del reembolso de prueba del 20/11 (reserva 8e81294f…, $16.00, 1 día
// cancelado; la fecha exacta se borró con la reserva). La usan scripts/send-test-email.js --refund y
// /api/dispatch?action=test_refund_email.
function testRefundSample(lang = 'es') {
  return {
    booking: { id: '8e81294f-c62f-4c8c-9e53-037cbb02454a', lang, total_cents: 1600,
      service_label: lang === 'es' ? '🚶 Paseo Estándar · 15 min' : '🚶 Standard Walk · 15 min' },
    full: true, refundedCents: 1600, currency: 'usd',
    cancelledDays: [{ date: null, time: null, status: 'cancelled' }], activeDays: [],
  };
}

module.exports = { buildRefundEmail, sendRefundEmail, resolveRecipient, testRefundSample, DEFAULT_FROM };
