// Notificaciones push al teléfono (Web Push con VAPID) · usado por el Agente de Despacho
// ---------------------------------------------------------------------------
// Variables: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:soporte@barkwalkusa.com).
// La clave pública también está en index.html (PUSH_VAPID_PUBLIC_KEY): deben ser el mismo par.
// Sin claves → no se envía push (el correo de Resend sigue como respaldo).
// Suscripciones caducadas (404/410) se borran; otros fallos suman fail_count y a las 5 se borran.
// ---------------------------------------------------------------------------
const { sb, enc } = require('./supabase');

let sender = null; // inyectable en pruebas
function setPushSender(fn) { sender = fn; }

function pushConfigured() {
  return !!((process.env.VAPID_PUBLIC_KEY || '').trim() && (process.env.VAPID_PRIVATE_KEY || '').trim());
}
function defaultSender() {
  const webpush = require('web-push');
  webpush.setVapidDetails((process.env.VAPID_SUBJECT || 'mailto:soporte@barkwalkusa.com').trim(),
    process.env.VAPID_PUBLIC_KEY.trim(), process.env.VAPID_PRIVATE_KEY.trim());
  return (sub, payload, opts) => webpush.sendNotification(sub, payload, opts);
}

// Envía la notificación a TODOS los dispositivos de los usuarios indicados. Nunca lanza: devuelve un resumen.
async function sendPushToUsers(userIds, { title, body, url = '/', tag, urgent = false }) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (!ids.length) return { status: 'no_users', sent: 0, failed: 0 };
  if (!sender && !pushConfigured()) return { status: 'not_configured', sent: 0, failed: 0 };
  const send = sender || defaultSender();
  const lista = ids.map((id) => `"${id.replace(/"/g, '')}"`).join(',');
  const r = await sb(`/rest/v1/push_subscriptions?user_id=in.(${enc(lista)})&select=id,endpoint,p256dh,auth,fail_count`);
  if (!r.ok) return { status: r.status === 404 || (r.data && r.data.code === '42P01') ? 'table_missing' : 'db_error', sent: 0, failed: 0 };
  const subs = Array.isArray(r.data) ? r.data : [];
  if (!subs.length) return { status: 'no_devices', sent: 0, failed: 0 };
  const payload = JSON.stringify({ title, body, url, tag, urgent });
  let sent = 0, failed = 0;
  for (const s of subs) {
    try {
      await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload,
        { TTL: 60 * 60, urgency: urgent ? 'high' : 'normal', ...(tag ? { topic: String(tag).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } : {}) });
      sent++;
    } catch (e) {
      failed++;
      const code = e && e.statusCode;
      if (code === 404 || code === 410 || (s.fail_count || 0) >= 4) {
        await sb(`/rest/v1/push_subscriptions?id=eq.${enc(s.id)}`, { method: 'DELETE', prefer: 'return=minimal' });
      } else {
        await sb(`/rest/v1/push_subscriptions?id=eq.${enc(s.id)}`, { method: 'PATCH', body: { fail_count: (s.fail_count || 0) + 1 }, prefer: 'return=minimal' });
      }
    }
  }
  return { status: sent ? 'sent' : 'failed', sent, failed };
}

// Administradores (destino de las alertas de operaciones en el teléfono)
async function adminUserIds() {
  const r = await sb('/rest/v1/profiles?is_admin=eq.true&select=id&limit=20');
  return r.ok && Array.isArray(r.data) ? r.data.map((p) => p.id) : [];
}

module.exports = { sendPushToUsers, adminUserIds, pushConfigured, setPushSender };
