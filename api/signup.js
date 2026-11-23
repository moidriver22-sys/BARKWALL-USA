// Vercel Serverless Function: POST /api/signup
// ---------------------------------------------------------------------------
// Registro con constancia legal (Alabama). index.html ya no llama a supabase.auth.signUp() directamente:
//   1. Valida edad (19+, mayoría de edad en Alabama), Términos + Política de Privacidad + Exención de responsabilidad y, si es paseador,
//      el Acuerdo de Contratista Independiente (versiones vigentes).
//   2. Guarda la constancia con la IP REAL del usuario (cabeceras de Vercel) y su navegador en
//      private.bw_signup_intents mediante public.bw_create_signup_intent (solo service_role) → nonce.
//   3. Crea la cuenta con la API pública de Supabase Auth (envía el correo de confirmación de siempre)
//      con el nonce en los metadatos. El trigger de auth.users exige ese nonce y copia la constancia
//      a public.legal_consents y a public.profiles (migración 20261117_signup_consent.sql).
// Cuerpo: { email, password, fullName, role: 'client'|'walker', birthDate: 'YYYY-MM-DD',
//           termsAccepted, termsVersion, privacyAccepted, privacyVersion, waiverAccepted, waiverVersion,
//           contractorAccepted, contractorVersion }   (contractor* solo para paseadores)
// Respuesta 200: { user, session|null }  · 409 email_taken · 400 validación · 429 · 503
// Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY (opcional; la anon es pública)
// ---------------------------------------------------------------------------
// Anti-bots y abuso: honeypot + Cloudflare Turnstile (api/_lib/bot-guard.js), límite persistente
// (api/_lib/rate-limit.js) y filtro de lenguaje en el nombre (api/_lib/content-filter.js).
// GET /api/signup?config=1 → { turnstileSiteKey } (pública; null mientras falten las claves en Vercel)
const { send, readJsonBody, makeRateLimiter } = require('./_lib/http');
const { supabaseConfig, isConfigured, sb } = require('./_lib/supabase');
const { verifyHuman, publicBotConfig } = require('./_lib/bot-guard');
const { rateLimit } = require('./_lib/rate-limit');
const contentFilter = require('./_lib/content-filter');

// Cambia estas versiones junto con index.html y private.bw_consent_rules() (migración 20261117)
const TERMS_VERSION = '2026-11-14';
const PRIVACY_VERSION = '2026-11-16';
const WAIVER_VERSION = '2026-11-16';
const CONTRACTOR_VERSION = '2026-11-14';
const MIN_AGE = 19; // mayoría de edad en Alabama (Ala. Code § 26-1-1)
// Destino del enlace de confirmación: PUBLIC_SITE_URL (la misma que usan Stripe Checkout / Connect) o el dominio raíz
const SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://barkwalkusa.com').trim().replace(/\/+$/, '');
// Clave pública (anon): la misma que ya está en index.html. Solo se usa para la API pública de registro.
const ANON_KEY = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkdGd0cm5icW95dmphc3Z6aWxyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5ODc5NTYsImV4cCI6MjEwOTU2Mzk1Nn0.vLcOfh7_f1cN10hSanuo-HrE3Ajcmk4QCsk7Oa0LPxQ';

const allow = makeRateLimiter({ windowMs: 10 * 60 * 1000, max: 8 }); // 8 intentos / 10 min por IP

// IP del usuario para la constancia: Vercel fija x-real-ip / x-forwarded-for con la IP pública del cliente
function consentIp(req) {
  const h = req.headers || {};
  const raw = String(h['x-real-ip'] || h['x-vercel-forwarded-for'] || h['x-forwarded-for'] || '').split(',')[0].trim();
  return /^[0-9a-fA-F:.]{3,45}$/.test(raw) ? raw : '';
}

// Edad cumplida en una fecha (YYYY-MM-DD), sin zonas horarias
function ageOn(birth, today) {
  const [by, bm, bd] = birth.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty - by - ((tm < bm || (tm === bm && td < bd)) ? 1 : 0);
}
function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function todayInAlabama() { // America/Chicago (Birmingham, AL)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function handler(req, res) {
  if (req.method === 'GET') return send(res, 200, publicBotConfig()); // configuración pública anti-bots
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { error: 'method_not_allowed' }); }
  if (!isConfigured()) return send(res, 503, { error: 'not_configured' });

  const ip = consentIp(req);
  if (!ip) return send(res, 400, { error: 'ip_unavailable' });
  if (!allow(ip) || !(await rateLimit('signup_ip', ip))) return send(res, 429, { error: 'rate_limited' });

  let b;
  try { b = await readJsonBody(req); } catch (e) { return send(res, 400, { error: e.message }); }

  const human = await verifyHuman(b, ip, 'signup');
  if (!human.ok) return send(res, human.error === 'bot_detected' ? 400 : 403, { error: human.error });

  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  const fullName = String(b.fullName || '').trim();
  const role = b.role === 'walker' ? 'walker' : b.role === 'client' ? 'client' : null;
  const birthDate = String(b.birthDate || '');

  if (!role) return send(res, 400, { error: 'invalid_role' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return send(res, 400, { error: 'invalid_email' });
  if (password.length < 6 || password.length > 72) return send(res, 400, { error: 'invalid_password' });
  if (!fullName || fullName.length > 120) return send(res, 400, { error: 'invalid_name' });
  if (!contentFilter.check(fullName).ok) return send(res, 400, { error: 'content_blocked', field: 'fullName' });
  if (!(await rateLimit('signup_email', email))) return send(res, 429, { error: 'rate_limited' });
  if (!validDate(birthDate) || birthDate < '1900-01-01') return send(res, 400, { error: 'invalid_birth_date' });
  if (ageOn(birthDate, todayInAlabama()) < MIN_AGE) return send(res, 400, { error: 'underage', minAge: MIN_AGE });
  if (b.termsAccepted !== true || b.termsVersion !== TERMS_VERSION) return send(res, 400, { error: 'terms_not_accepted' });
  if (b.privacyAccepted !== true || b.privacyVersion !== PRIVACY_VERSION) return send(res, 400, { error: 'privacy_not_accepted' });
  if (b.waiverAccepted !== true || b.waiverVersion !== WAIVER_VERSION) return send(res, 400, { error: 'waiver_not_accepted' });
  if (role === 'walker' && (b.contractorAccepted !== true || b.contractorVersion !== CONTRACTOR_VERSION)) {
    return send(res, 400, { error: 'contractor_not_accepted' });
  }

  // 1) Constancia (fecha y hora del servidor, IP real, navegador)
  const now = new Date().toISOString();
  const intent = await sb('/rest/v1/rpc/bw_create_signup_intent', {
    method: 'POST',
    body: { p: {
      email, role, birth_date: birthDate, ip_address: ip,
      user_agent: String((req.headers && req.headers['user-agent']) || '').slice(0, 500),
      terms_version: TERMS_VERSION, terms_accepted_at: now,
      privacy_version: PRIVACY_VERSION, privacy_accepted_at: now,
      liability_waiver_version: WAIVER_VERSION,
      contractor_version: role === 'walker' ? CONTRACTOR_VERSION : null,
      contractor_accepted_at: role === 'walker' ? now : null,
    } },
  });
  if (!intent.ok || typeof intent.data !== 'string') {
    const missing = intent.status === 404 || (intent.data && intent.data.code === 'PGRST202');
    console.error('signup: no se pudo guardar la constancia', intent.status, missing ? '(falta la migración 20261117)' : JSON.stringify(intent.data));
    return send(res, missing ? 503 : 400, { error: missing ? 'not_configured' : 'consent_rejected' });
  }
  const nonce = intent.data;

  // 2) Cuenta en Supabase Auth (correo de confirmación normal)
  const { url } = supabaseConfig();
  let r, j;
  try {
    r = await fetch(`${url}/auth/v1/signup?redirect_to=${encodeURIComponent(SITE_URL)}`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email, password,
        data: {
          full_name: fullName, role, // los usa el trigger que crea el perfil
          terms_version: TERMS_VERSION, terms_accepted_at: now,
          terms_doc: role === 'walker' ? 'terminos-paseadores' : 'terminos-clientes',
          privacy_version: PRIVACY_VERSION, bw_signup_nonce: nonce,
        },
      }),
    });
    j = await r.json().catch(() => ({}));
  } catch (e) {
    console.error('signup: Supabase Auth no responde:', e.message);
    return send(res, 502, { error: 'auth_unavailable' });
  }

  if (!r.ok) {
    const code = j.error_code || j.code || '';
    const msg = String(j.msg || j.error_description || j.message || '');
    if (code === 'user_already_exists' || /already registered|already exists/i.test(msg)) return send(res, 409, { error: 'email_taken' });
    if (code === 'weak_password') return send(res, 400, { error: 'weak_password', message: msg });
    if (r.status === 429 || /rate limit/i.test(code + msg)) return send(res, 429, { error: 'rate_limited' });
    if (/database error/i.test(msg)) { // el trigger rechazó la cuenta
      console.error('signup: el trigger rechazó el registro', r.status, code, msg);
      return send(res, 400, { error: 'signup_rejected' });
    }
    console.error('signup: Supabase Auth', r.status, code, msg);
    return send(res, 400, { error: 'auth_error', message: msg.slice(0, 200) || undefined });
  }

  // Con confirmación de correo: devuelve solo el usuario. Si la confirmación estuviera desactivada: también la sesión.
  const user = j.user || (j.id ? j : null);
  if (!user) return send(res, 502, { error: 'auth_unexpected' });
  const session = j.access_token ? { access_token: j.access_token, refresh_token: j.refresh_token } : null;
  return send(res, 200, {
    user: { id: user.id, email: user.email, identities: Array.isArray(user.identities) ? user.identities.map((x) => ({ id: x.id, provider: x.provider })) : user.identities },
    session,
  });
}

module.exports = handler;
