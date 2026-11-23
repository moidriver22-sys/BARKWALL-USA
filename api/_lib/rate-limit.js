// Límite de peticiones PERSISTENTE (compartido por todas las instancias de Vercel)
// ---------------------------------------------------------------------------
// El limitador en memoria de http.js (makeRateLimiter) es por instancia: con varias instancias o tras un
// arranque en frío se reinicia. Este usa la función public.bw_rate_hit() de Supabase (ventana fija, atómica;
// migración 20261126_security_hardening.sql), solo ejecutable con la clave de servicio.
// Si la base no responde, NO bloquea (fail-open) y lo registra: la seguridad real la siguen dando
// la autenticación, RLS y el limitador en memoria.
// ---------------------------------------------------------------------------
const { sb } = require('./supabase');

// Reglas por acción: { windowSec, max }
const RULES = {
  signup_ip:       { windowSec: 3600, max: 20 },  // registros por IP por hora
  signup_email:    { windowSec: 3600, max: 5 },   // intentos por correo por hora
  payment_user:    { windowSec: 600, max: 30 },   // creación/actualización de cobros por usuario
  stripe_user:     { windowSec: 600, max: 15 },   // suscripción, portal, Connect, cobro de pagos
  earnings_user:   { windowSec: 600, max: 60 },
  chat_user_day:   { windowSec: 86400, max: 150 },
  chat_ip_day:     { windowSec: 86400, max: 300 },
};

let override = null; // inyectable en pruebas: (key, rule) => boolean
function setRateLimitBackend(fn) { override = fn; }

async function rateLimit(action, id) {
  const rule = RULES[action];
  if (!rule || !id) return true;
  const key = `${action}:${String(id).slice(0, 200)}`;
  if (override) return override(key, rule);
  try {
    const r = await sb('/rest/v1/rpc/bw_rate_hit', { method: 'POST', body: { p_key: key, p_window_seconds: rule.windowSec, p_max: rule.max } });
    if (!r.ok) { console.warn('rate-limit: bw_rate_hit', r.status, JSON.stringify(r.data).slice(0, 160)); return true; }
    return r.data !== false;
  } catch (e) {
    console.warn('rate-limit:', e.message);
    return true;
  }
}

module.exports = { rateLimit, RULES, setRateLimitBackend };
