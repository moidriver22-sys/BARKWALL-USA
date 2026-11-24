// Aceptación de Términos y Condiciones (fuente única de versiones para el servidor)
// ---------------------------------------------------------------------------
// · Versiones vigentes de los documentos. Si cambias una: actualiza también index.html (TERMS_VERSION,
//   PRIVACY_VERSION, WAIVER_VERSION, CONTRACTOR_VERSION) y private.bw_consent_rules() (la ÚLTIMA versión de cada
//   lista es la vigente; las anteriores solo se aceptan en registros que ya estaban en curso).
// · Constancia legal: public.legal_consents (una fila por aceptación: versiones, fecha y hora del servidor, IP,
//   navegador). El perfil guarda la última aceptación (terms_version, terms_accepted_at, …) para la app.
// · Validación en el servidor: requireCurrentConsent() en reservas, membresías y cobros de paseadores; en la base,
//   private.bw_has_current_consent() dentro de public.bw_is_verified_walker() (ver migración 20261201).
// ---------------------------------------------------------------------------
const { sb, sbOrThrow, enc } = require('./supabase');

const CURRENT = Object.freeze({
  terms: '2026-11-24',       // terminos-clientes.html / terminos-paseadores.html
  privacy: '2026-11-16',     // privacidad.html
  waiver: '2026-11-16',      // Exención de Acceso al Hogar y Custodia de Llaves
  contractor: '2026-11-24',  // Acuerdo para Paseadores (contratista independiente)
});
const MIN_AGE = 19; // mayoría de edad en Alabama (Ala. Code § 26-1-1)
const WALKER_ROLES = new Set(['walker', 'shopper']);
const isWalker = (role) => WALKER_ROLES.has(String(role || ''));
const termsDoc = (role) => (isWalker(role) ? 'terminos-paseadores' : 'terminos-clientes');

// ¿La fila de constancia cubre las versiones vigentes para este rol? (función pura)
function consentCoversCurrent(row, role) {
  if (!row || row.terms_version !== CURRENT.terms || !row.terms_accepted_at) return false;
  if (row.privacy_version !== CURRENT.privacy || !row.privacy_accepted_at) return false;
  if (isWalker(role) && (row.contractor_version !== CURRENT.contractor || !row.contractor_accepted_at)) return false;
  return true;
}

// Qué le falta aceptar a un perfil, según su última constancia (para la app y el servidor)
function missingDocs(row, role) {
  const m = [];
  if (!row || row.terms_version !== CURRENT.terms || !row.terms_accepted_at) m.push('terms');
  if (!row || row.privacy_version !== CURRENT.privacy || !row.privacy_accepted_at) m.push('privacy');
  if (isWalker(role) && (!row || row.contractor_version !== CURRENT.contractor || !row.contractor_accepted_at)) m.push('contractor');
  return m;
}

async function latestConsent(userId) {
  const rows = await sbOrThrow(`/rest/v1/legal_consents?user_id=eq.${enc(userId)}&select=*&order=created_at.desc&limit=1`);
  return rows[0] || null;
}

// { ok, role, missing } — ok=false si falta aceptar la versión vigente de algún documento
async function consentStatus(userId) {
  const [p] = await sbOrThrow(`/rest/v1/profiles?id=eq.${enc(userId)}&select=id,role,email,birth_date&limit=1`);
  const role = (p && p.role) || 'client';
  const row = await latestConsent(userId);
  return { ok: consentCoversCurrent(row, role), role, missing: missingDocs(row, role), profile: p || null };
}

// Para los endpoints: null si puede continuar; si no, el cuerpo de error 403 para responder
async function requireCurrentConsent(userId) {
  const s = await consentStatus(userId);
  return s.ok ? null : { error: 'terms_required', missing: s.missing, versions: CURRENT };
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
function todayInAlabama() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// Valida lo que manda la app al aceptar (función pura). b: cuerpo de la petición; role; birthOnFile: fecha ya guardada
function validateAcceptance(b, role, birthOnFile) {
  const x = b || {};
  if (x.termsAccepted !== true || x.termsVersion !== CURRENT.terms) return { error: 'terms_not_accepted' };
  if (x.privacyAccepted !== true || x.privacyVersion !== CURRENT.privacy) return { error: 'privacy_not_accepted' };
  if (isWalker(role) && (x.contractorAccepted !== true || x.contractorVersion !== CURRENT.contractor)) return { error: 'contractor_not_accepted' };
  const birth = birthOnFile || String(x.birthDate || '');
  if (!validDate(birth) || birth < '1900-01-01') return { error: 'invalid_birth_date' };
  if (ageOn(birth, todayInAlabama()) < MIN_AGE) return { error: 'underage', minAge: MIN_AGE };
  return { ok: true, birthDate: birth };
}

// Guarda la constancia (servidor, con la clave de servicio: el navegador no puede escribir estas columnas)
async function recordConsent({ userId, email, role, birthDate, ip, userAgent }) {
  const now = new Date().toISOString();
  const walker = isWalker(role);
  const row = {
    user_id: userId, role: walker ? 'walker' : 'client', email: email || '', birth_date: birthDate,
    ip_address: ip, user_agent: String(userAgent || '').slice(0, 500),
    terms_doc: termsDoc(role), terms_version: CURRENT.terms, terms_accepted_at: now,
    privacy_version: CURRENT.privacy, privacy_accepted_at: now,
    liability_waiver_version: CURRENT.waiver,
    contractor_version: walker ? CURRENT.contractor : null, contractor_accepted_at: walker ? now : null,
  };
  await sbOrThrow('/rest/v1/legal_consents', { method: 'POST', body: row, prefer: 'return=minimal' });
  const perfil = {
    terms_version: CURRENT.terms, terms_accepted_at: now, privacy_accepted_at: now,
    ...(walker ? { contractor_agreement_accepted_at: now } : {}),
  };
  // birth_date solo si aún no estaba (los perfiles anteriores al registro con constancia no la tienen)
  await sbOrThrow(`/rest/v1/profiles?id=eq.${enc(userId)}`, { method: 'PATCH', body: perfil, prefer: 'return=minimal' });
  await sb(`/rest/v1/profiles?id=eq.${enc(userId)}&birth_date=is.null`, { method: 'PATCH', body: { birth_date: birthDate }, prefer: 'return=minimal' });
  return { acceptedAt: now, versions: CURRENT };
}

module.exports = {
  CURRENT, MIN_AGE, isWalker, termsDoc, consentCoversCurrent, missingDocs, consentStatus, requireCurrentConsent,
  validateAcceptance, recordConsent, ageOn, validDate, todayInAlabama,
};
