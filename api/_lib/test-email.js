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

// Notificación push de PRUEBA a todos los dispositivos de un perfil registrado (claves VAPID de producción).
// Lo expone /api/dispatch?action=test_push&to=<correo del perfil> (protegido con CRON_SECRET).
async function sendTestPush(to) {
  const { sendPushToUsers, pushConfigured } = require('./push');
  if (!pushConfigured()) return { status: 503, body: { error: 'vapid_not_configured' } };
  const email = String(to || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { status: 400, body: { error: 'invalid_email' } };
  const r = await sb(`/rest/v1/profiles?email=eq.${enc(email)}&select=id&limit=1`);
  const p = r.ok && Array.isArray(r.data) && r.data[0];
  if (!p) return { status: 400, body: { error: 'recipient_not_allowed' } };
  const res = await sendPushToUsers([p.id], {
    title: '🔔 Prueba de Barkwalk USA',
    body: 'Si ves esto, las notificaciones de este teléfono funcionan. · Notifications are working on this device.',
    url: '/', tag: 'barkwalk-test-push', urgent: false,
  });
  return { status: res.status === 'sent' ? 200 : 409, body: { push: res.status, sent: res.sent, failed: res.failed } };
}

// PRUEBA de los dos mensajes del Agente de Fidelización (agradecimiento + reactivación): push + correo [TEST]
// a un perfil registrado. Lo expone /api/dispatch?action=test_growth&to=<correo> (CRON_SECRET).
// No toca dispatch_alerts: no cuenta como envío real ni bloquea los avisos reales de ese cliente.
async function sendTestGrowth(to) {
  const G = require('./growth-agent');
  const { sendPushToUsers } = require('./push');
  if (!(process.env.RESEND_API_KEY || '').trim()) return { status: 503, body: { error: 'resend_not_configured' } };
  const email = String(to || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { status: 400, body: { error: 'invalid_email' } };
  const r = await sb(`/rest/v1/profiles?email=eq.${enc(email)}&select=id,full_name&limit=1`);
  const p = r.ok && Array.isArray(r.data) && r.data[0];
  if (!p) return { status: 400, body: { error: 'recipient_not_allowed' } };
  const pets = await sb(`/rest/v1/pets?owner_id=eq.${enc(p.id)}&select=name&order=created_at.asc&limit=1`);
  const pet = (pets.ok && Array.isArray(pets.data) && pets.data[0] && pets.data[0].name) || 'Toby';
  const cfg = G.config();
  const minuto = Math.floor(Date.now() / 60000);
  const muestras = [
    { kind: 'growth_thanks', clientId: String(p.id), walk: { id: `test-${minuto}`, pet_name: pet }, walks: 1 },
    { kind: 'growth_reactivate', clientId: String(p.id), walk: { id: `test-${minuto}`, pet_name: pet }, days: 16 },
  ];
  const out = { to: email.replace(/^(.{2}).*(@.*)$/, '$1***$2'), results: [] };
  for (const a of muestras) {
    const pt = G.pushText(a);
    const push = await sendPushToUsers([p.id], { ...pt, title: `[TEST] ${pt.title}`, tag: `${pt.tag}-test` })
      .catch((e) => ({ status: 'error', sent: 0, failed: 0, reason: e.message }));
    const msg = G.buildGrowthEmail(a, p.full_name);
    let mail = 'sent';
    try { await G.sendEmail(cfg, email, { ...msg, subject: `[TEST] ${msg.subject}` }, `test-${a.kind}-${email}-${minuto}`); }
    catch (e) { mail = `failed: ${String(e.message).slice(0, 120)}`; }
    out.results.push({ kind: a.kind, push: push.status, pushSent: push.sent, pushFailed: push.failed, email: mail });
  }
  const ok = out.results.every((x) => x.email === 'sent');
  return { status: ok ? 200 : 502, body: out };
}

module.exports = { sendTestRefundEmail, sendTestPush, sendTestGrowth, allowedRecipient };
