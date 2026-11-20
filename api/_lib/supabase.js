// Acceso a Supabase desde el servidor (REST + Auth) con la clave de servicio.
// La clave de servicio ignora RLS: solo se usa aquí, nunca en index.html.

function supabaseConfig() {
  return {
    url: (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  };
}

function isConfigured() {
  const { url, key } = supabaseConfig();
  return !!(url && key);
}

async function sb(path, { method = 'GET', body, bearer, prefer } = {}) {
  const { url, key } = supabaseConfig();
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  else if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`; // clave service_role clásica (JWT)
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${url}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: r.ok, status: r.status, data };
}

// Igual que sb() pero lanza un error si la respuesta no es 2xx
async function sbOrThrow(path, opts) {
  const r = await sb(path, opts);
  if (!r.ok) {
    const msg = (r.data && (r.data.message || r.data.msg || r.data.error_description)) || JSON.stringify(r.data);
    const err = new Error(`Supabase ${opts && opts.method ? opts.method : 'GET'} ${path.split('?')[0]} → ${r.status}: ${msg}`);
    err.status = r.status;
    err.code = r.data && r.data.code;
    throw err;
  }
  return r.data;
}

// Usuario dueño del token de sesión (Supabase valida el JWT)
async function getUserFromToken(token) {
  if (!token) return null;
  const r = await sb('/auth/v1/user', { bearer: token });
  return r.ok && r.data && r.data.id ? r.data : null;
}

async function getAuthUserEmail(userId) {
  if (!userId || !/^[0-9a-f-]{36}$/i.test(String(userId))) return null;
  const r = await sb(`/auth/v1/admin/users/${encodeURIComponent(userId)}`);
  if (!r.ok) return null;
  return (r.data && (r.data.email || (r.data.user && r.data.user.email))) || null;
}

const enc = encodeURIComponent;

module.exports = { supabaseConfig, isConfigured, sb, sbOrThrow, getUserFromToken, getAuthUserEmail, enc };
