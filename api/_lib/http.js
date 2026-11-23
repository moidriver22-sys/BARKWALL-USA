// Utilidades HTTP comunes de las funciones de /api

// Variables de entorno: al pegarlas en Vercel suelen colarse espacios, saltos de línea o comillas.
// Con "sk_live_…\n" las validaciones /^…$/ fallaban y la función respondía 503 not_configured.
// Todas las funciones de /api importan este módulo, así que se normalizan una vez al cargar.
['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_CLUB', 'STRIPE_PRICE_WALKER_PRO',
 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
 'ANTHROPIC_API_KEY', 'RESEND_API_KEY', 'EMAIL_FROM', 'CRON_SECRET', 'PUBLIC_SITE_URL',
 'WALKER_PAYOUT_PERCENT', 'WALKER_PRO_PAYOUT_PERCENT', 'REFUND_EMAIL_FROM', 'DISPATCH_EMAIL_FROM', 'OPS_ALERT_EMAIL',
 'DISPATCH_PENDING_MINUTES', 'DISPATCH_NEAR_START_MINUTES', 'DISPATCH_UPCOMING_LEAD_MINUTES', 'DISPATCH_LATE_START_MINUTES',
 'DISPATCH_OVERDUE_GRACE_MINUTES', 'DISPATCH_MAX_ALERTS_PER_RUN',
 'FINANCE_PAYOUT_GRACE_HOURS', 'FINANCE_REVIEW_STALE_HOURS', 'FINANCE_SUMMARY_ALWAYS',
 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'].forEach((k) => {
  const v = process.env[k];
  if (typeof v !== 'string') return;
  const limpio = v.trim().replace(/^(['"])(.*)\1$/s, '$2').trim();
  if (limpio !== v) process.env[k] = limpio;
});

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readRawBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      const buf = typeof c === 'string' ? Buffer.from(c) : c;
      size += buf.length;
      if (size > limit) { reject(new Error('body_too_large')); req.destroy(); } else chunks.push(buf);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req, limit = 32 * 1024) {
  // Vercel puede entregar req.body ya parseado
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { throw new Error('invalid_json'); } }
  const raw = await readRawBody(req, limit);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString('utf8')); } catch { throw new Error('invalid_json'); }
}

function bearerToken(req) {
  const auth = String((req.headers && req.headers.authorization) || '');
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

function clientIp(req) {
  const xf = String((req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '');
  return xf.split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Límite de peticiones por IP en memoria (por instancia; protección básica contra abuso)
function makeRateLimiter({ windowMs, max }) {
  const hits = new Map();
  return function allow(key) {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) { hits.set(key, arr); return false; }
    arr.push(now);
    hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
    return true;
  };
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { send, readRawBody, readJsonBody, bearerToken, clientIp, makeRateLimiter, escapeHtml };
