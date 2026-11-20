// Correo de PRUEBA enviado desde producción (con la clave de Resend de Vercel, que no se puede descargar).
// Lo expone /api/dispatch?action=test_refund_email&to=<correo> (protegido con CRON_SECRET).
// Seguridad: el destinatario solo puede ser OPS_ALERT_EMAIL o el correo de un perfil registrado en Barkwalk,
// así que ni con el secreto se puede usar para escribir a terceros desconocidos.
const { sb, enc } = require('./supabase');
const L = require('./email-layout');
const { buildRefundEmail, testRefundSample, DEFAULT_FROM } = require('./refund-email');

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function allowedRecipient(to) {
  const email = String(to || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'invalid_email' };
  const ops = (process.env.OPS_ALERT_EMAIL || L.SUPPORT).trim().toLowerCase();
  if (email === ops) return { ok: true, email, name: '' };
  const r = await sb(`/rest/v1/profiles?email=eq.${enc(email)}&select=full_name&limit=1`);
  const p = r.ok && Array.isArray(r.data) && r.data[0];
  return p ? { ok: true, email, name: p.full_name || '' } : { ok: false, error: 'recipient_not_allowed' };
}

async function sendTestRefundEmail(to, lang = 'es') {
  const key = (process.env.RESEND_API_KEY || '').trim();
  if (!key) return { status: 503, body: { error: 'resend_not_configured' } };
  const dest = await allowedRecipient(to);
  if (!dest.ok) return { status: 400, body: { error: dest.error } };
  const msg = buildRefundEmail(testRefundSample(lang === 'en' ? 'en' : 'es'), dest.name);
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
      'Idempotency-Key': `test-refund-${dest.email}-${Math.floor(Date.now() / 60000)}` }, // como mucho 1 por minuto
    body: JSON.stringify({ from: (process.env.REFUND_EMAIL_FROM || DEFAULT_FROM).trim(), to: [dest.email], reply_to: L.SUPPORT,
      subject: `[TEST] ${msg.subject}`, html: msg.html, text: msg.text }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { status: 502, body: { error: 'resend_error', resendStatus: r.status, message: String(j.message || '').slice(0, 200) } };
  const masked = dest.email.replace(/^(.{2}).*(@.*)$/, '$1***$2');
  return { status: 200, body: { sent: true, id: j.id, to: masked, subject: `[TEST] ${msg.subject}` } };
}

module.exports = { sendTestRefundEmail, allowedRecipient };
