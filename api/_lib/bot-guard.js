// Protección anti-bots: honeypot (siempre activo) + Cloudflare Turnstile (en cuanto haya claves)
// ---------------------------------------------------------------------------
// · Honeypot: el formulario lleva un campo oculto "website" que una persona nunca ve ni rellena.
//   Si llega con texto → es un bot → se rechaza (respuesta genérica, sin pistas).
// · Turnstile: se activa SOLO cuando existen las DOS variables en Vercel:
//     TURNSTILE_SITE_KEY   (pública; la app la pide a GET /api/signup?config=1)
//     TURNSTILE_SECRET_KEY (secreta; solo aquí)
//   Con las dos: el token es obligatorio y se valida con Cloudflare (siteverify) en cada registro y reserva.
//   Sin ellas: no se exige token (la app funciona igual que antes) y solo actúa el honeypot.
// ---------------------------------------------------------------------------
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function turnstileKeys() {
  const site = (process.env.TURNSTILE_SITE_KEY || '').trim();
  const secret = (process.env.TURNSTILE_SECRET_KEY || '').trim();
  return { site, secret, enabled: !!(site && secret) };
}

// Configuración pública para el navegador
function publicBotConfig() {
  const k = turnstileKeys();
  return { turnstileSiteKey: k.enabled ? k.site : null };
}

// → { ok: true, mode } | { ok: false, error }
async function verifyHuman(body, ip, action) {
  const b = body || {};
  if (typeof b.website === 'string' && b.website.trim() !== '') return { ok: false, error: 'bot_detected' };
  const k = turnstileKeys();
  if (!k.enabled) return { ok: true, mode: 'honeypot_only' };
  const token = typeof b.turnstileToken === 'string' ? b.turnstileToken.trim() : '';
  if (!token || token.length > 2048) return { ok: false, error: 'captcha_required' };
  try {
    const form = new URLSearchParams({ secret: k.secret, response: token });
    if (ip && ip !== 'unknown') form.set('remoteip', ip);
    const r = await fetch(VERIFY_URL, { method: 'POST', body: form });
    const j = await r.json().catch(() => ({}));
    if (!j.success) return { ok: false, error: 'captcha_failed', codes: (j['error-codes'] || []).slice(0, 3) };
    if (action && j.action && j.action !== action) return { ok: false, error: 'captcha_failed', codes: ['action_mismatch'] };
    return { ok: true, mode: 'turnstile' };
  } catch (e) {
    // Cloudflare caído: no dejamos pasar a ciegas, pero el mensaje invita a reintentar
    console.warn('turnstile siteverify:', e.message);
    return { ok: false, error: 'captcha_unavailable' };
  }
}

module.exports = { verifyHuman, publicBotConfig, turnstileKeys };
