// Pruebas: registro por rol, identidad del paseador (ID vigente + selfie en bucket privado) y agente auditor
// que NUNCA aprueba. Supabase REST, Storage y Auth simulados en memoria. Ejecuta: npm test
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
process.env.SUPABASE_URL = 'http://fake.supabase';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
delete process.env.RESEND_API_KEY; // sin correos en estas pruebas

const T = require(path.join(ROOT, 'api/_lib/terms.js'));
const ID = require(path.join(ROOT, 'api/_lib/walker-identity.js'));
const AG = require(path.join(ROOT, 'api/_lib/application-agent.js'));
const WA = require(path.join(ROOT, 'walker-application.js'));
const RL = require(path.join(ROOT, 'api/_lib/rate-limit.js'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const HTML = read('index.html');
const SQL = read('supabase/migrations/20261202_walker_identity.sql');

const UID = '11111111-2222-3333-4444-555555555555';
const OTRO = '99999999-2222-3333-4444-555555555555';
const TODAY = T.todayInAlabama();
const addDays = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const CONSENT_OK = { user_id: UID, terms_version: T.CURRENT.terms, terms_accepted_at: 'x', privacy_version: T.CURRENT.privacy, privacy_accepted_at: 'x',
  contractor_version: T.CURRENT.contractor, contractor_accepted_at: 'x', birth_date: '1990-05-01', created_at: '1' };

// ---------- Supabase simulado (REST + Storage list + Auth) ----------
let DB, FILES, FETCH;
function reset({ status = 'pending', consent = true, role = 'walker' } = {}) {
  DB = {
    profiles: [{ id: UID, role, email: 'w@example.com', full_name: 'Camila Rojas', walker_status: status, birth_date: '1990-05-01' }],
    legal_consents: consent ? [{ ...CONSENT_OK }] : [], walker_applications: [], walker_reviews: [],
  };
  FILES = { [UID]: [] }; FETCH = [];
}
const file = (name, mimetype = 'image/jpeg', size = 300 * 1024) => FILES[UID].push({ name, metadata: { mimetype, size }, created_at: 'x' });
let nextId = 1;
const resp = (status, data) => { const s = data == null ? '' : JSON.stringify(data); return { ok: status < 300, status, text: async () => s, json: async () => data }; };
function match(row, k, e) {
  const [op, ...r] = e.split('.'); const v = r.join('.');
  if (op === 'eq') return String(row[k]) === v;
  if (op === 'neq') return String(row[k]) !== v;
  if (op === 'is') return v === 'null' ? row[k] == null : String(row[k]) === v;
  if (op === 'lte') return String(row[k]) <= v;
  if (op === 'lt') return String(row[k]) < v;
  throw new Error('filtro ' + k + '=' + e);
}
global.fetch = async (url, opts = {}) => {
  const u = String(url); FETCH.push({ url: u, method: opts.method || 'GET', body: opts.body });
  if (u.includes('/auth/v1/user')) return /token-ok/.test((opts.headers && opts.headers.Authorization) || '') ? resp(200, { id: UID, email: 'w@example.com' }) : resp(401, {});
  if (u.includes('/storage/v1/object/list/walker-docs')) {
    const prefix = JSON.parse(opts.body).prefix; const uid = prefix.replace(/\/$/, '');
    return resp(200, (FILES[uid] || []));
  }
  const p = new URL(u); const table = p.pathname.replace('/rest/v1/', '');
  const rows = DB[table]; if (!rows) return resp(404, { code: 'PGRST205' });
  const f = [...p.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'on_conflict'].includes(k));
  const hit = rows.filter((r) => f.every(([k, e]) => match(r, k, e)));
  const m = opts.method || 'GET';
  if (m === 'GET') return resp(200, hit);
  if (m === 'POST') { const b = { id: nextId++, status: 'submitted', submitted_at: new Date().toISOString(), created_at: new Date().toISOString(), ...JSON.parse(opts.body) }; rows.push(b); return resp(201, [b]); }
  if (m === 'PATCH') { const b = JSON.parse(opts.body); hit.forEach((r) => Object.assign(r, b)); return resp(200, hit); }
  return resp(405, {});
};
let ipN = 0; // IP distinta por llamada: el límite real de 8 intentos/IP del registro sigue activo
const call = async (handler, { headers = {}, body } = {}) => {
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await handler({ method: 'POST', url: '/', headers: { 'x-real-ip': `198.51.100.${(ipN = (ipN % 250) + 1)}`, 'user-agent': 'ua', ...headers }, body }, res);
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
const APP = (o) => ({ action: 'walker_application', legalName: 'Camila Rojas', phone: '(205) 555-0123', city: 'Homewood', zip: '35209',
  idType: 'drivers_license', idExpiry: addDays(400), idPhotoPath: `${UID}/1-id-a.jpg`, selfiePath: `${UID}/1-selfie-b.jpg`,
  contractorAccepted: true, contractorVersion: T.CURRENT.contractor, contractorSignature: 'Camila Rojas', ...o });

let n = 0;
const t = async (name, fn) => { RL.setRateLimitBackend(() => true); await fn(); n++; console.log('✓', name); };

(async () => {
  const signup = require(path.join(ROOT, 'api/signup.js'));

  // ---------- 1. Registro por rol ----------
  await t('registro: pestañas Cliente / Paseador visibles al crear cuenta; los pasos y campos cambian según el rol', async () => {
    assert.match(HTML, /id="regRoleTabs" class="reg-tabs" role="tablist"/);
    assert.match(HTML, /onclick="selectRegRole\('client'\)"/); assert.match(HTML, /onclick="selectRegRole\('shopper'\)"/);
    assert.match(HTML, /function renderRegRoleUI\(login\)/);
    const fn = HTML.slice(HTML.indexOf('function renderRegRoleUI'), HTML.indexOf('function closeRegistrationModal'));
    const [walker, client] = fn.split(' : [');
    assert.match(walker, /Identidad/); assert.match(walker, /ID vigente \+ selfie/); assert.match(walker, /Stripe/); assert.match(walker, /Contratista/);
    assert.doesNotMatch(client, /Identidad|selfie|Stripe|Contratista/, 'el cliente no ve requisitos de paseador');
    assert.match(client, /Tu mascota/);
    assert.match(HTML, /document\.getElementById\('regContractorRow'\)\.classList\.toggle\('hidden', login \|\| !esPaseador\)/, 'Acuerdo de contratista solo para paseadores');
  });
  await t('registro: Términos + Privacidad (+ Acuerdo del paseador) y 19+ siguen obligatorios en el servidor', async () => {
    const SIGN = { email: 'nuevo@example.com', password: 'secreto123', fullName: 'Ana López', role: 'walker', birthDate: '1990-05-01',
      termsAccepted: true, termsVersion: T.CURRENT.terms, privacyAccepted: true, privacyVersion: T.CURRENT.privacy, waiverAccepted: true, waiverVersion: T.CURRENT.waiver };
    assert.equal((await call(signup, { body: { ...SIGN } })).body.error, 'contractor_not_accepted');
    assert.equal((await call(signup, { headers: { 'x-real-ip': '203.0.113.6' }, body: { ...SIGN, role: 'client', termsVersion: '2026-11-14' } })).body.error, 'terms_not_accepted');
  });

  // ---------- 2. ID vigente ----------
  await t('vencimiento del ID: vencido → rechazado; ≤ 30 días → aviso; misma regla en la app y en el servidor', async () => {
    for (const [d, esperado] of [[-1, 'id_expired'], [0, 'id_expiring_soon'], [10, 'id_expiring_soon'], [30, 'id_expiring_soon'], [31, null], [400, null]]) {
      const s = ID.checkIdExpiry(addDays(d), TODAY), c = WA.checkIdExpiry(addDays(d), TODAY);
      assert.deepEqual(s, c, `mismo resultado (${d})`);
      if (esperado === 'id_expired') { assert.equal(s.ok, false); assert.equal(s.error, 'id_expired'); } else { assert.equal(s.ok, true); assert.equal(s.warning, esperado); }
    }
    assert.equal(ID.checkIdExpiry('2026-02-30', TODAY).error, 'invalid_id_expiry');
    assert.equal(ID.checkIdExpiry(addDays(365 * 13), TODAY).error, 'invalid_id_expiry');
  });
  await t('API: un ID vencido se rechaza (400 id_expired) y no se guarda ninguna postulación', async () => {
    reset(); file('1-id-a.jpg'); file('1-selfie-b.jpg');
    const r = await call(signup, { headers: { authorization: 'Bearer token-ok' }, body: APP({ idExpiry: addDays(-1) }) });
    assert.equal(r.status, 400); assert.equal(r.body.error, 'id_expired'); assert.equal(DB.walker_applications.length, 0);
  });
  await t('API: exige sesión, ser paseador, Términos vigentes, datos válidos y archivos propios en la carpeta del paseador', async () => {
    reset(); file('1-id-a.jpg'); file('1-selfie-b.jpg');
    assert.equal((await call(signup, { body: APP() })).status, 401);
    reset({ role: 'client' }); assert.equal((await call(signup, { headers: { authorization: 'Bearer token-ok' }, body: APP() })).body.error, 'not_walker');
    reset({ consent: false }); assert.equal((await call(signup, { headers: { authorization: 'Bearer token-ok' }, body: APP() })).body.error, 'terms_required');
    reset(); file('1-id-a.jpg'); file('1-selfie-b.jpg');
    const auth = { authorization: 'Bearer token-ok' };
    assert.equal((await call(signup, { headers: auth, body: APP({ idPhotoPath: `${OTRO}/1-id-a.jpg` }) })).body.error, 'invalid_id_photo', 'carpeta de otro paseador');
    assert.equal((await call(signup, { headers: auth, body: APP({ selfiePath: `${UID}/1-id-a.jpg` }) })).body.error, 'same_file');
    assert.equal((await call(signup, { headers: auth, body: APP({ idPhotoPath: `${UID}/../x.jpg` }) })).body.error, 'invalid_id_photo');
    assert.equal((await call(signup, { headers: auth, body: APP({ phone: '555' }) })).body.error, 'invalid_phone');
    assert.equal((await call(signup, { headers: auth, body: APP({ zip: '3520' }) })).body.error, 'invalid_zip');
    assert.equal((await call(signup, { headers: auth, body: APP({ legalName: 'Camila' }) })).body.error, 'invalid_legal_name');
    assert.equal(DB.walker_applications.length, 0);
  });
  await t('API: los archivos deben existir en el bucket con formato JPEG/PNG/WEBP y máximo 5 MB', async () => {
    const auth = { authorization: 'Bearer token-ok' };
    reset(); file('1-id-a.jpg');
    assert.equal((await call(signup, { headers: auth, body: APP() })).body.error, 'selfie_file_missing');
    reset(); file('1-id-a.jpg', 'image/gif'); file('1-selfie-b.jpg');
    assert.equal((await call(signup, { headers: auth, body: APP() })).body.error, 'id_photo_file_type');
    reset(); file('1-id-a.jpg'); file('1-selfie-b.jpg', 'image/jpeg', 6 * 1024 * 1024);
    assert.equal((await call(signup, { headers: auth, body: APP() })).body.error, 'selfie_file_size');
  });
  await t('API: envío válido → postulación guardada + reporte del agente; el agente NO cambia el estado del paseador', async () => {
    reset(); file('1-id-a.jpg'); file('1-selfie-b.jpg', 'image/png', 280 * 1024);
    const r = await call(signup, { headers: { authorization: 'Bearer token-ok', 'x-real-ip': '203.0.113.5' }, body: APP() });
    assert.equal(r.status, 200); assert.equal(r.body.status, 'submitted');
    const a = DB.walker_applications[0];
    assert.equal(a.walker_id, UID); assert.equal(a.phone, '2055550123'); assert.equal(a.ip_address, '203.0.113.5');
    assert.ok(a.agent_report && a.agent_risk, 'el agente dejó su reporte');
    assert.equal(a.agent_report.autoApproval, false); assert.equal(a.agent_report.recommendation, 'manual_review');
    assert.equal(DB.profiles[0].walker_status, 'pending', 'sigue pendiente: solo el admin decide');
    assert.ok(!FETCH.some((f) => f.url.includes('/rest/v1/profiles') && f.method === 'PATCH'), 'nadie tocó profiles');
    assert.ok(!FETCH.some((f) => f.url.includes('admin_set_walker_status')), 'nunca llama a aprobar');
  });
  await t('reenvío tras rechazo: nuevo envío, el anterior queda como historial y vuelve a "pendiente" con su registro', async () => {
    reset({ status: 'rejected' }); file('1-id-a.jpg'); file('1-selfie-b.jpg'); file('2-id-c.jpg'); file('2-selfie-d.jpg');
    DB.walker_applications.push({ id: 50, walker_id: UID, status: 'rejected', id_expiry: addDays(200), submitted_at: '2026-11-01', id_photo_path: `${UID}/1-id-a.jpg`, selfie_path: `${UID}/1-selfie-b.jpg` });
    DB.walker_reviews.push({ walker_id: UID, status: 'rejected', reason: 'Foto borrosa', created_at: '2026-11-02' });
    const r = await call(signup, { headers: { authorization: 'Bearer token-ok' }, body: APP({ idPhotoPath: `${UID}/2-id-c.jpg`, selfiePath: `${UID}/2-selfie-d.jpg` }) });
    assert.equal(r.status, 200);
    assert.equal(DB.walker_applications.length, 2, 'el envío anterior se conserva');
    assert.equal(DB.walker_applications.find((x) => x.id === 50).status, 'rejected', 'su evidencia no se sobrescribe');
    assert.equal(DB.profiles[0].walker_status, 'pending');
    assert.equal(DB.walker_reviews.length, 2); assert.match(DB.walker_reviews[1].reason, /Reenvío/);
    const nuevo = DB.walker_applications.find((x) => x.id !== 50);
    assert.ok(nuevo.agent_report.alerts.some((x) => x.code === 'previous_rejection' && /Foto borrosa/.test(x.message)), 'el agente ve el rechazo anterior');
  });
  await t('aprobado con ID vigente no puede reenviar; sí puede renovar cuando faltan ≤ 30 días', async () => {
    assert.equal(ID.canSubmit({ role: 'walker', walker_status: 'verified' }, [{ status: 'approved', id_expiry: addDays(200) }], TODAY).error, 'already_approved');
    assert.equal(ID.canSubmit({ role: 'walker', walker_status: 'verified' }, [{ status: 'approved', id_expiry: addDays(20) }], TODAY).ok, true);
    assert.equal(ID.canSubmit({ role: 'walker', walker_status: 'suspended' }, [], TODAY).error, 'walker_suspended');
  });

  // ---------- 2b. Independent Contractor Agreement (1099) en la Etapa 1 ----------
  await t('contractor: sin casilla, versión vieja o firma distinta al nombre legal → 400 y no se guarda nada', async () => {
    const auth = { authorization: 'Bearer token-ok' };
    for (const [o, code] of [
      [{ contractorAccepted: undefined }, 'contractor_required'], [{ contractorAccepted: 'true' }, 'contractor_required'],
      [{ contractorAccepted: false }, 'contractor_required'], [{ contractorVersion: '2026-11-14' }, 'contractor_version_outdated'],
      [{ contractorVersion: undefined }, 'contractor_version_outdated'], [{ contractorSignature: '' }, 'contractor_signature_mismatch'],
      [{ contractorSignature: 'Camila' }, 'contractor_signature_mismatch'], [{ contractorSignature: 'Otra Persona' }, 'contractor_signature_mismatch']]) {
      reset(); file('1-id-a.jpg'); file('1-selfie-b.jpg');
      const r = await call(signup, { headers: auth, body: APP(o) });
      assert.equal(r.status, 400, JSON.stringify(o)); assert.equal(r.body.error, code, JSON.stringify(o));
      assert.equal(DB.walker_applications.length, 0, 'sin firma válida no hay postulación');
    }
  });
  await t('contractor: envío válido guarda aceptado, hora, versión vigente, firma y correo DEL PERFIL (no el que mande la app)', async () => {
    reset(); file('1-id-a.jpg'); file('1-selfie-b.jpg');
    DB.profiles[0].email = 'Camila.Rojas@Example.com';
    const antes = Date.now();
    const r = await call(signup, { headers: { authorization: 'Bearer token-ok' },
      body: APP({ contractorSignature: '  camila   ROJAS ', email: 'falso@evil.example', contractorAcceptedAt: '2000-01-01T00:00:00Z' }) });
    assert.equal(r.status, 200);
    const a = DB.walker_applications[0];
    assert.equal(a.contractor_agreement_accepted, true);
    assert.equal(a.contractor_agreement_version, T.CURRENT.contractor);
    assert.equal(a.contractor_signature_name, 'camila ROJAS');
    assert.equal(a.contractor_signer_email, 'camila.rojas@example.com');
    assert.ok(Date.parse(a.contractor_agreement_accepted_at) >= antes - 1000, 'la hora la pone el servidor, no la app');
    assert.equal(DB.profiles[0].walker_status, 'pending', 'firmar no aprueba: sigue decidiendo el admin');
  });
  await t('contractor: misma regla de firma en la app y el servidor (acentos, mayúsculas, espacios)', async () => {
    for (const [firma, nombre, ok] of [['Camila Rojas', 'Camila Rojas', true], ['camila rojas', 'Camila Rojas', true], ['José Pérez', 'Jose Perez', true],
      ['  Ana   María  López ', 'Ana María López', true], ["Mary O'Neil", "mary o'neil", true], ['Camila', 'Camila Rojas', false],
      ['Camila Rojas Díaz', 'Camila Rojas', false], ['', 'Camila Rojas', false], ['ab', 'ab', false]]) {
      assert.equal(ID.signatureMatches(firma, nombre), ok, `${firma} / ${nombre}`);
      assert.equal(WA.signatureMatches(firma, nombre), ok, `app: ${firma} / ${nombre}`);
    }
  });
  await t('contractor: la versión de la app = la del servidor = la del registro; el formulario muestra resumen, acuerdo completo, casilla y firma', async () => {
    assert.equal(WA.CONTRACTOR_VERSION, T.CURRENT.contractor);
    assert.match(HTML, new RegExp(`const CONTRACTOR_VERSION = '${T.CURRENT.contractor.replace(/\./g, '\\.')}'`));
    assert.match(read('terminos-paseadores.html'), new RegExp(`Versión ${T.CURRENT.contractor.replace(/\./g, '\\.')}`), 'el acuerdo enlazado es esa versión');
    const src = read('walker-application.js');
    const form = src.slice(src.indexOf('function formHtml'), src.indexOf('function wireForm'));
    assert.match(form, /\$\{contractorHtml\(\)\}[\s\S]*id="waSubmit"/, 'el acuerdo va antes del botón de envío');
    const ica = src.slice(src.indexOf('function contractorHtml'), src.indexOf('function wireForm'));
    for (const re of [/Independent Contractor Agreement \(1099\)/, /Barkwalk USA LLC/, /id="waContractorOk"/, /id="waContractorSign"/, /CONTRACTOR_URL\}#\$\{lang\}-2/, /target="_blank" rel="noopener"/, /1099/, /W-9/])
      assert.match(ica, re);
    const sub = src.slice(src.indexOf('async function submit'), src.indexOf('// Tarjeta del paseador'));
    assert.ok(sub.indexOf("err('contractor_required')") < sub.indexOf('storage.from(BUCKET).upload'), 'se valida antes de subir las fotos');
    assert.match(sub, /contractorAccepted: \$\('waContractorOk'\)\.checked === true, contractorVersion: CONTRACTOR_VERSION, contractorSignature:/);
    for (const k of ['contractor_required', 'contractor_signature_mismatch', 'contractor_version_outdated']) assert.ok(WA.ERR[k], k);
  });
  await t('contractor: la base exige la firma en cada INSERT, fija la hora con now() y no deja modificarla', async () => {
    const M = read('supabase/migrations/20261207_walker_contractor_signature.sql');
    assert.match(M, /before insert on public\.walker_applications/); assert.match(M, /before update on public\.walker_applications/);
    assert.match(M, /new\.contractor_agreement_accepted is not true/); assert.match(M, /new\.contractor_agreement_accepted_at := now\(\)/);
    assert.match(M, /no se puede modificar/);
    assert.doesNotMatch(M, /create policy|admin_set_walker_status\(|bw_is_verified_walker\(\)\s*returns/, 'no toca RLS ni la aprobación');
  });
  await t('contractor: terms-gate.js y el flujo de clientes no cambian', async () => {
    assert.doesNotMatch(read('terms-gate.js'), /contractorSignature|waContractor/);
    const reg = HTML.slice(HTML.indexOf('contractorAccepted: role ==='), HTML.indexOf('contractorAccepted: role ===') + 200);
    assert.match(reg, /contractorAccepted: role === 'walker', contractorVersion: role === 'walker' \? CONTRACTOR_VERSION : undefined/);
  });

  // ---------- 3. Bucket privado y base de datos ----------
  await t('bucket walker-docs: PRIVADO, solo JPEG/PNG/WEBP, máx. 5 MB; subida solo a la carpeta propia; lectura solo dueño o admin', async () => {
    assert.match(SQL, /values \('walker-docs', 'walker-docs', false, 5242880, array\['image\/jpeg', 'image\/png', 'image\/webp'\]\)/);
    assert.match(SQL, /on conflict \(id\) do update set public = false/);
    const ins = SQL.slice(SQL.indexOf('"walker-docs: walker uploads own"'), SQL.indexOf('"walker-docs: owner or admin reads"'));
    assert.match(ins, /for insert to authenticated/); assert.match(ins, /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/);
    assert.match(ins, /p\.role in \('walker', 'shopper'\)/);
    assert.match(SQL, /for select to authenticated\s+using \(bucket_id = 'walker-docs' and \(\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text or public\.bw_is_admin\(\)\)\)/);
    assert.ok(!/on storage\.objects for (update|delete)/i.test(SQL), 'sin UPDATE ni DELETE: la evidencia no se sobrescribe ni se borra');
    assert.ok(!/\bto (anon|public)\b/i.test(SQL.replace(/from public, anon/g, '')), 'nada para usuarios sin sesión');
    assert.equal(WA.SIGNED_URL_SECONDS, 120, 'URLs firmadas de corta duración');
  });
  await t('base: postulaciones de solo lectura para el paseador (las escribe el servidor) y sin tocar triggers ni políticas existentes', async () => {
    assert.match(SQL, /revoke insert, update, delete, truncate on public\.walker_applications from authenticated/);
    assert.match(SQL, /"walker_applications: walker reads own"[^;]*using \(walker_id = auth\.uid\(\)\)/);
    assert.match(SQL, /check \(id_photo_path like walker_id::text \|\| '\/%' and selfie_path like walker_id::text \|\| '\/%'\)/);
    assert.ok(!/(create|drop) trigger/i.test(SQL));
    assert.ok(!/create policy[^;]*on public\.(walk_requests|profiles|bookings|pets|legal_consents)/i.test(SQL));
    assert.ok(!/policy[^;]*"(Public Access|pet-photos|walk-photos)/i.test(SQL), 'no toca las políticas de los otros buckets');
  });
  await t('base: aprobar exige postulación con ID vigente + Términos; operar exige postulación aprobada y ID no vencido', async () => {
    assert.match(SQL, /if v_app\.id is null then raise exception 'application required'/);
    assert.match(SQL, /if v_app\.id_expiry < current_date then raise exception 'id expired'/);
    assert.match(SQL, /if not private\.bw_has_current_consent\(target_id::uuid\) then raise exception 'terms required'/);
    assert.match(SQL, /a\.status = 'approved' and a\.id_expiry >= current_date/);
  });

  // ---------- 4. Agente auditor ----------
  const base = () => ({
    app: { id: 7, walker_id: UID, legal_name: 'Camila Rojas', phone: '2055550123', city: 'Homewood', zip: '35209', id_type: 'drivers_license',
      id_expiry: addDays(300), id_photo_path: `${UID}/a.jpg`, selfie_path: `${UID}/b.jpg`, status: 'submitted' },
    profile: { role: 'walker', full_name: 'Camila Rojas', birth_date: '1990-05-01' }, consent: { ...CONSENT_OK },
    files: [{ path: `${UID}/a.jpg`, size: 300000, mimetype: 'image/jpeg' }, { path: `${UID}/b.jpg`, size: 200000, mimetype: 'image/jpeg' }],
    previousApps: [], reviews: [], phoneDupes: 0, today: TODAY,
  });
  await t('agente: postulación limpia → checklist completo, riesgo bajo, recomendación SIEMPRE "revisión manual"', async () => {
    const r = AG.audit(base());
    assert.deepEqual(r.checklist.map((c) => c.key), ['consents', 'age', 'id_photo', 'selfie', 'id_expiry', 'data', 'history', 'stripe']);
    assert.ok(r.checklist.filter((c) => c.key !== 'stripe').every((c) => c.ok));
    assert.equal(r.risk, 'low'); assert.equal(r.recommendation, 'manual_review'); assert.equal(r.autoApproval, false);
  });
  await t('agente: detecta ID vencido o por vencer, nombre distinto, teléfono duplicado, misma imagen, fuera de AL e historial', async () => {
    const d = base();
    d.app.id_expiry = addDays(12); d.app.legal_name = 'Laura Pérez'; d.app.zip = '30301'; d.phoneDupes = 1;
    d.files[1].size = 300000; d.reviews = [{ status: 'suspended', reason: 'Queja grave', created_at: '2026-10-01' }];
    d.consent = { ...CONSENT_OK, contractor_version: '2026-11-14' };
    const codes = AG.audit(d).alerts.map((a) => a.code);
    for (const c of ['id_expiring_soon', 'name_mismatch', 'zip_outside_al', 'phone_duplicate', 'same_image', 'previous_suspension', 'consent_missing']) assert.ok(codes.includes(c), c);
    const v = base(); v.app.id_expiry = addDays(-3);
    const rv = AG.audit(v);
    assert.equal(rv.risk, 'high'); assert.ok(rv.alerts.some((a) => a.code === 'id_expired')); assert.equal(rv.checklist.find((c) => c.key === 'id_expiry').ok, false);
    assert.equal(rv.autoApproval, false, 'ni con todo mal ni con todo bien aprueba');
  });
  await t('agente: su código nunca aprueba ni modifica perfiles; solo escribe su reporte en walker_applications', async () => {
    const src = read('api/_lib/application-agent.js');
    assert.ok(!/admin_set_walker_status\s*\(|rpc\/admin_set_walker_status/.test(src.replace(/\/\/[^\n]*/g, '')), 'no llama a aprobar');
    assert.ok(!/profiles\?[^`]*method: 'PATCH'|walker_status:\s*'verified'/.test(src), 'no cambia el estado');
    const writes = [...src.matchAll(/sbOrThrow\(`\/rest\/v1\/([a-z_]+)[^`]*`,\s*\{\s*method: 'PATCH'/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(writes)], ['walker_applications']);
    assert.match(read('api/dispatch.js'), /action'\) === 'application_audit'/);
  });

  // ---------- 5. App (paseador y admin) ----------
  await t('app: estados de la postulación, rutas únicas por envío y documentos solo por URL firmada en el panel', async () => {
    assert.equal(WA.viewState('pending', [], TODAY).mode, 'form');
    assert.equal(WA.viewState('pending', [{ status: 'submitted' }], TODAY).mode, 'submitted');
    assert.equal(WA.viewState('rejected', [{ status: 'rejected' }], TODAY).reason, 'rejected');
    assert.equal(WA.viewState('verified', [{ status: 'approved', id_expiry: addDays(-1) }], TODAY).reason, 'expired');
    assert.equal(WA.viewState('verified', [{ status: 'approved', id_expiry: addDays(10) }], TODAY).renew, true);
    const p1 = WA.buildPath(UID, 'id', 'image/png', 1), p2 = WA.buildPath(UID, 'id', 'image/png', 1);
    assert.ok(p1.startsWith(`${UID}/`) && p1.endsWith('.png') && p1 !== p2);
    assert.equal(WA.checkFile({ type: 'image/heic', size: 10 }).error, 'file_type');
    const src = read('walker-application.js');
    assert.match(src, /createSignedUrl\(b\.dataset\.doc, SIGNED_URL_SECONDS\)/); assert.ok(!/getPublicUrl/.test(src), 'nunca URLs públicas');
    assert.match(src, /upsert: false/);
    assert.match(HTML, /<section id="walkerApplicationCard" class="w-card" hidden><\/section>/);
    assert.match(HTML, /onclick="toggleAppReview\('\$\{id\}', this\)"/);
    const ctx = { self: {} }; vm.runInNewContext(src, ctx); assert.equal(typeof ctx.self.BWWalkerApp.render, 'function');
  });
  await t('sigue el límite de 12 funciones en api/', async () => {
    assert.equal(fs.readdirSync(path.join(ROOT, 'api')).filter((f) => f.endsWith('.js')).length, 12);
  });

  console.log(`\n${n} pruebas OK`);
})().catch((e) => { console.error('✗ FALLO:', e.stack); process.exit(1); });
