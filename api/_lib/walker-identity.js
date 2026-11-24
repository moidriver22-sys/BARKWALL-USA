// Postulación de identidad del paseador: ID oficial VIGENTE + selfie (bucket privado 'walker-docs')
// ---------------------------------------------------------------------------
// Flujo: la app sube las dos fotos a walker-docs/<uid>/… (RLS: solo a su carpeta) y luego llama a
// POST /api/signup { action: 'walker_application', … }. Aquí, con la clave de servicio:
//   · se valida TODO de nuevo (rol, Términos vigentes, edad ≥ 19, datos, ID no vencido, archivos reales en el
//     bucket con formato y tamaño permitidos y dentro de la carpeta del propio paseador);
//   · se guarda un ENVÍO nuevo en public.walker_applications (los anteriores quedan como 'superseded': nada se
//     sobrescribe) y, si venía de un rechazo, el estado vuelve a 'pending' con su entrada en walker_reviews;
//   · se ejecuta el agente auditor (api/_lib/application-agent.js), que NUNCA aprueba.
// ---------------------------------------------------------------------------
const { sb, sbOrThrow, enc, supabaseConfig } = require('./supabase');
const TERMS = require('./terms');

const BUCKET = 'walker-docs';
const MAX_BYTES = 5 * 1024 * 1024;
const MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EXT = /\.(jpe?g|png|webp)$/i;
const ID_TYPES = new Set(['drivers_license', 'state_id']);
const EXPIRY_WARN_DAYS = 30;

const dayMs = 864e5;
function daysUntil(dateStr, today) {
  return Math.round((Date.parse(`${dateStr}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / dayMs);
}

// Vencimiento del ID (función pura, la misma regla que la app): nunca vencido; aviso si faltan ≤ 30 días
function checkIdExpiry(expiry, today) {
  if (!TERMS.validDate(expiry)) return { ok: false, error: 'invalid_id_expiry' };
  const d = daysUntil(expiry, today);
  if (d < 0) return { ok: false, error: 'id_expired', days: d };
  if (d > 365 * 12) return { ok: false, error: 'invalid_id_expiry' }; // ningún ID de EE. UU. dura tanto
  return { ok: true, days: d, warning: d <= EXPIRY_WARN_DAYS ? 'id_expiring_soon' : null };
}

const normPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? d.slice(1) : d; };

// Datos enviados por la app (función pura). uid: el paseador con sesión
function validateApplicationInput(b, uid, today) {
  const x = b || {};
  const legalName = String(x.legalName || '').trim().replace(/\s+/g, ' ');
  const phone = normPhone(x.phone);
  const city = String(x.city || '').trim();
  const zip = String(x.zip || '').trim();
  const idType = String(x.idType || '');
  const idPhotoPath = String(x.idPhotoPath || '');
  const selfiePath = String(x.selfiePath || '');
  if (legalName.length < 3 || legalName.length > 120 || !/\s/.test(legalName)) return { error: 'invalid_legal_name' };
  if (!/^\d{10}$/.test(phone)) return { error: 'invalid_phone' };
  if (city.length < 2 || city.length > 80) return { error: 'invalid_city' };
  if (!/^\d{5}$/.test(zip)) return { error: 'invalid_zip' };
  if (!ID_TYPES.has(idType)) return { error: 'invalid_id_type' };
  const exp = checkIdExpiry(String(x.idExpiry || ''), today);
  if (!exp.ok) return { error: exp.error };
  // Las rutas deben estar en la carpeta del propio paseador, ser distintas y con extensión de imagen
  const propia = (p) => p.startsWith(`${uid}/`) && !p.includes('..') && EXT.test(p) && p.length <= 200;
  if (!propia(idPhotoPath)) return { error: 'invalid_id_photo' };
  if (!propia(selfiePath)) return { error: 'invalid_selfie' };
  if (idPhotoPath === selfiePath) return { error: 'same_file' };
  return { ok: true, value: { legalName, phone, city, zip, idType, idExpiry: x.idExpiry, idPhotoPath, selfiePath }, warning: exp.warning };
}

// Metadatos REALES de los archivos en el bucket privado (Storage API con la clave de servicio)
async function listOwnFiles(uid) {
  const { url, key: serviceKey } = supabaseConfig();
  const r = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: `${uid}/`, limit: 200, sortBy: { column: 'created_at', order: 'desc' } }),
  });
  if (!r.ok) throw new Error(`storage list ${r.status}`);
  const rows = await r.json();
  return (Array.isArray(rows) ? rows : []).map((o) => ({
    path: `${uid}/${o.name}`, size: Number(o.metadata && o.metadata.size) || 0,
    mimetype: (o.metadata && o.metadata.mimetype) || '', createdAt: o.created_at || null,
  }));
}

// ¿El archivo existe con formato y tamaño permitidos? (función pura)
function checkFile(files, path) {
  const f = (files || []).find((x) => x.path === path);
  if (!f) return { ok: false, error: 'file_missing' };
  if (!MIME.has(f.mimetype)) return { ok: false, error: 'file_type' };
  if (!(f.size > 0) || f.size > MAX_BYTES) return { ok: false, error: 'file_size' };
  return { ok: true, file: f };
}

// ¿Puede enviar una postulación nueva? (función pura) — apps: envíos del paseador, el más reciente primero
function canSubmit(profile, apps, today) {
  if (!profile || !['walker', 'shopper'].includes(profile.role)) return { ok: false, error: 'not_walker' };
  if (profile.walker_status === 'suspended') return { ok: false, error: 'walker_suspended' };
  const aprobada = (apps || []).find((a) => a.status === 'approved' && a.id_expiry >= today);
  // Ya aprobado con ID vigente: solo se permite RENOVAR cuando faltan ≤ 30 días para que venza
  if (profile.walker_status === 'verified' && aprobada && daysUntil(aprobada.id_expiry, today) > EXPIRY_WARN_DAYS) {
    return { ok: false, error: 'already_approved' };
  }
  return { ok: true };
}

async function submitApplication({ user, body, ip, userAgent, runAgent }) {
  const today = TERMS.todayInAlabama();
  const [profile] = await sbOrThrow(`/rest/v1/profiles?id=eq.${enc(user.id)}&select=id,role,email,full_name,walker_status,birth_date&limit=1`);
  const apps = await sbOrThrow(`/rest/v1/walker_applications?walker_id=eq.${enc(user.id)}&select=id,status,id_expiry,submitted_at&order=submitted_at.desc&limit=50`);
  const puede = canSubmit(profile, apps, today);
  if (!puede.ok) return { status: puede.error === 'not_walker' ? 403 : 409, body: { error: puede.error } };

  // Términos + Acuerdo vigentes (constancia en legal_consents) y edad mínima
  const consent = await TERMS.consentStatus(user.id);
  if (!consent.ok) return { status: 403, body: { error: 'terms_required', missing: consent.missing } };
  const birth = profile.birth_date;
  if (!TERMS.validDate(birth || '') || TERMS.ageOn(birth, today) < TERMS.MIN_AGE) return { status: 400, body: { error: 'underage', minAge: TERMS.MIN_AGE } };

  const v = validateApplicationInput(body, user.id, today);
  if (!v.ok) return { status: 400, body: { error: v.error } };

  const files = await listOwnFiles(user.id);
  for (const [key, path] of [['id_photo', v.value.idPhotoPath], ['selfie', v.value.selfiePath]]) {
    const c = checkFile(files, path);
    if (!c.ok) return { status: 400, body: { error: `${key}_${c.error}` } };
  }

  // Historial: el envío abierto anterior queda 'superseded' (no se borra ni se modifica su evidencia)
  await sbOrThrow(`/rest/v1/walker_applications?walker_id=eq.${enc(user.id)}&status=eq.submitted`, {
    method: 'PATCH', body: { status: 'superseded' }, prefer: 'return=minimal' });
  const [app] = await sbOrThrow('/rest/v1/walker_applications', {
    method: 'POST', prefer: 'return=representation',
    body: {
      walker_id: user.id, legal_name: v.value.legalName, phone: v.value.phone, city: v.value.city, zip: v.value.zip,
      id_type: v.value.idType, id_expiry: v.value.idExpiry, id_photo_path: v.value.idPhotoPath, selfie_path: v.value.selfiePath,
      ip_address: ip || null, user_agent: String(userAgent || '').slice(0, 500),
    },
  });

  // Reenvío tras un rechazo: vuelve a revisión (la decisión anterior sigue en walker_reviews)
  if (profile.walker_status === 'rejected') {
    await sbOrThrow(`/rest/v1/profiles?id=eq.${enc(user.id)}`, { method: 'PATCH', body: { walker_status: 'pending' }, prefer: 'return=minimal' });
    await sb('/rest/v1/walker_reviews', { method: 'POST', prefer: 'return=minimal',
      body: { walker_id: user.id, status: 'pending', reason: 'Reenvío de documentos por el paseador', notified_at: new Date().toISOString() } });
  }

  // Agente auditor: analiza y deja su reporte. No aprueba ni cambia el estado del paseador.
  let agent = null;
  if (typeof runAgent === 'function') agent = await runAgent(app.id).catch((e) => ({ error: e.message }));
  return { status: 200, body: { status: 'submitted', applicationId: app.id, warning: v.warning || null, agent: agent && agent.risk ? { risk: agent.risk } : null } };
}

module.exports = {
  BUCKET, MAX_BYTES, MIME, ID_TYPES, EXPIRY_WARN_DAYS, daysUntil, checkIdExpiry, normPhone, validateApplicationInput,
  listOwnFiles, checkFile, canSubmit, submitApplication,
};
