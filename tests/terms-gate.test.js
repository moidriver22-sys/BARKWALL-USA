// Pruebas: aceptación obligatoria de Términos (servidor, base y app) + postulación de paseadores y textos honestos.
// Supabase REST, Auth y Resend simulados en memoria. Ejecuta: npm test
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
process.env.SUPABASE_URL = 'http://fake.supabase';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
process.env.STRIPE_SECRET_KEY = 'sk_test_' + 'x'.repeat(30);
process.env.RESEND_API_KEY = 're_test';

const T = require(path.join(ROOT, 'api/_lib/terms.js'));
const G = require(path.join(ROOT, 'terms-gate.js'));
const W = require(path.join(ROOT, 'api/_lib/walker-reviews.js'));
require(path.join(ROOT, 'api/_lib/push.js')).setPushSender(async () => ({ statusCode: 201 }));
const RL = require(path.join(ROOT, 'api/_lib/rate-limit.js'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const HTML = read('index.html');
const SQL = read('supabase/migrations/20261201_terms_gate_walker_review.sql');
const SQL_LAST = read('supabase/migrations/20261202_walker_identity.sql'); // la migración más reciente fija las versiones vigentes

const UID = '11111111-2222-3333-4444-555555555555';
let DB, RESEND, FETCH;
function reset(role = 'client', birth = null) {
  DB = { profiles: [{ id: UID, role, email: 'a@example.com', birth_date: birth, full_name: 'Ana' }], legal_consents: [], walker_reviews: [], push_subscriptions: [] };
  RESEND = []; FETCH = [];
}
const resp = (status, data) => { const s = data == null ? '' : JSON.stringify(data); return { ok: status < 300, status, text: async () => s, json: async () => data }; };
function match(row, k, e) {
  const [op, ...r] = e.split('.'); const v = r.join('.');
  if (op === 'eq') return String(row[k]) === v;
  if (op === 'is') return v === 'null' ? row[k] == null : String(row[k]) === v;
  if (op === 'in') return v.slice(1, -1).split(',').includes(String(row[k]));
  throw new Error('filtro ' + k + '=' + e);
}
global.fetch = async (url, opts = {}) => {
  const u = String(url); FETCH.push({ url: u, opts });
  if (u.startsWith('https://api.resend.com/')) { RESEND.push(JSON.parse(opts.body)); return resp(200, { id: 'e' }); }
  if (u.includes('/auth/v1/user')) return (opts.headers && /token-ok/.test(opts.headers.Authorization || '')) ? resp(200, { id: UID, email: 'a@example.com' }) : resp(401, {});
  const p = new URL(u); const table = p.pathname.replace('/rest/v1/', '');
  if (table.startsWith('rpc/')) return resp(200, true);
  const rows = DB[table]; if (!rows) return resp(404, { code: 'PGRST205' });
  const f = [...p.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'on_conflict'].includes(k));
  const hit = rows.filter((r) => f.every(([k, e]) => match(r, k, e)));
  const m = opts.method || 'GET';
  if (m === 'GET') return resp(200, [...hit].reverse());
  if (m === 'POST') { const b = JSON.parse(opts.body); rows.push({ ...b, created_at: new Date().toISOString() }); return resp(201, [b]); }
  if (m === 'PATCH') { const b = JSON.parse(opts.body); hit.forEach((r) => Object.assign(r, b)); return resp(200, hit); }
  return resp(405, {});
};
const call = async (handler, { method = 'POST', headers = {}, body } = {}) => {
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await handler({ method, url: '/', headers: { 'x-real-ip': '203.0.113.9', 'user-agent': 'test-agent', ...headers }, body }, res);
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
const OK_BODY = { action: 'accept_terms', termsAccepted: true, termsVersion: T.CURRENT.terms, privacyAccepted: true, privacyVersion: T.CURRENT.privacy };

let n = 0;
const t = async (name, fn) => { RL.setRateLimitBackend(() => true); await fn(); n++; console.log('✓', name); };

(async () => {
  // ---------- Versiones sincronizadas ----------
  await t('versiones vigentes idénticas en servidor, app, index.html y base (la última de cada lista)', async () => {
    assert.deepEqual({ ...G.CURRENT }, { ...T.CURRENT });
    assert.match(HTML, new RegExp(`const TERMS_VERSION = '${T.CURRENT.terms}'`));
    assert.match(HTML, new RegExp(`const CONTRACTOR_VERSION = '${T.CURRENT.contractor}'`));
    assert.match(HTML, new RegExp(`const PRIVACY_VERSION = '${T.CURRENT.privacy}'`));
    const last = (k) => { const m = SQL_LAST.match(new RegExp(`'${k}', jsonb_build_array\\(([^)]*)\\)`)); return m[1].split(',').map((x) => x.trim().replace(/'/g, '')).pop(); };
    assert.equal(last('terms'), T.CURRENT.terms); assert.equal(last('contractor'), T.CURRENT.contractor); assert.equal(last('privacy'), T.CURRENT.privacy);
    for (const f of ['terminos-clientes.html', 'terminos-paseadores.html']) assert.match(read(f), new RegExp(`Versión ${T.CURRENT.terms}`), f);
  });

  // ---------- Reglas ----------
  const fila = (o) => ({ terms_version: T.CURRENT.terms, terms_accepted_at: 'x', privacy_version: T.CURRENT.privacy, privacy_accepted_at: 'x', contractor_version: null, contractor_accepted_at: null, ...o });
  await t('regla: cliente necesita Términos + Privacidad vigentes; paseador además el Acuerdo para Paseadores', async () => {
    assert.deepEqual(T.missingDocs(null, 'client'), ['terms', 'privacy']);
    assert.deepEqual(T.missingDocs(fila(), 'client'), []);
    assert.deepEqual(T.missingDocs(fila(), 'walker'), ['contractor']);
    assert.deepEqual(T.missingDocs(fila({ contractor_version: T.CURRENT.contractor, contractor_accepted_at: 'x' }), 'walker'), []);
    assert.deepEqual(T.missingDocs(fila({ terms_version: '2026-11-14' }), 'client'), ['terms'], 'versión vieja = hay que volver a aceptar');
    for (const [row, role] of [[null, 'client'], [fila(), 'walker'], [fila({ terms_version: 'x' }), 'shopper']]) {
      assert.deepEqual(G.missingDocs(row, role), T.missingDocs(row, role), 'misma regla en la app y en el servidor');
    }
  });
  await t('validación de la aceptación: versiones exactas, casillas, Acuerdo del paseador y edad mínima de 19', async () => {
    assert.equal(T.validateAcceptance({ ...OK_BODY, termsVersion: '2026-11-14' }, 'client', '1990-01-01').error, 'terms_not_accepted');
    assert.equal(T.validateAcceptance({ ...OK_BODY, privacyAccepted: false }, 'client', '1990-01-01').error, 'privacy_not_accepted');
    assert.equal(T.validateAcceptance(OK_BODY, 'walker', '1990-01-01').error, 'contractor_not_accepted');
    assert.equal(T.validateAcceptance(OK_BODY, 'client', null).error, 'invalid_birth_date', 'sin fecha guardada hay que pedirla');
    const menor = `${Number(T.todayInAlabama().slice(0, 4)) - 18}-01-01`;
    assert.equal(T.validateAcceptance({ ...OK_BODY, birthDate: menor }, 'client', null).error, 'underage');
    assert.deepEqual(T.validateAcceptance(OK_BODY, 'client', '1990-01-01'), { ok: true, birthDate: '1990-01-01' });
    const body = G.acceptanceBody({ role: 'walker', terms: true, privacy: true, contractor: true, birthDate: '1990-01-01' });
    assert.equal(T.validateAcceptance(body, 'walker', null).ok, true, 'lo que manda la app pasa la validación del servidor');
  });

  // ---------- Endpoint de aceptación (POST /api/signup action=accept_terms) ----------
  const signup = require(path.join(ROOT, 'api/signup.js'));
  await t('aceptar Términos exige sesión; el rol sale de la base (no del navegador)', async () => {
    reset('client', '1990-01-01');
    assert.equal((await call(signup, { body: OK_BODY })).status, 401);
    reset('walker', '1990-01-01');
    const r = await call(signup, { headers: { authorization: 'Bearer token-ok' }, body: { ...OK_BODY, role: 'client' } });
    assert.equal(r.status, 400); assert.equal(r.body.error, 'contractor_not_accepted', 'es paseador según la base');
    assert.equal(DB.legal_consents.length, 0);
  });
  await t('aceptación de un paseador: constancia con versiones, fecha, IP y navegador + perfil actualizado', async () => {
    reset('walker', null);
    const body = G.acceptanceBody({ role: 'walker', terms: true, privacy: true, contractor: true, birthDate: '1991-04-02' });
    const r = await call(signup, { headers: { authorization: 'Bearer token-ok' }, body });
    assert.equal(r.status, 200); assert.equal(r.body.status, 'accepted');
    const c = DB.legal_consents[0];
    assert.equal(c.user_id, UID); assert.equal(c.role, 'walker'); assert.equal(c.terms_doc, 'terminos-paseadores');
    assert.equal(c.terms_version, T.CURRENT.terms); assert.equal(c.privacy_version, T.CURRENT.privacy); assert.equal(c.contractor_version, T.CURRENT.contractor);
    assert.ok(c.terms_accepted_at && c.contractor_accepted_at); assert.equal(c.ip_address, '203.0.113.9'); assert.equal(c.user_agent, 'test-agent');
    assert.equal(c.birth_date, '1991-04-02');
    const p = DB.profiles[0];
    assert.equal(p.terms_version, T.CURRENT.terms); assert.ok(p.contractor_agreement_accepted_at); assert.equal(p.birth_date, '1991-04-02');
    assert.equal((await T.consentStatus(UID)).ok, true);
  });

  // ---------- Validación en los endpoints ----------
  const payment = require(path.join(ROOT, 'api/create-payment-intent.js'));
  const connect = require(path.join(ROOT, 'api/create-connect-account.js'));
  const RESERVA = { checkoutId: '11111111-2222-4333-8444-555555555555', liabilityAccepted: true, address: '1800 Oxmoor Rd, Homewood, AL', time: '09:00', petIds: ['p1'] };
  await t('reservar sin Términos vigentes → 403 terms_required y NO se crea ninguna reserva', async () => {
    reset('client', '1990-01-01');
    const r = await call(payment, { headers: { authorization: 'Bearer token-ok' }, body: RESERVA });
    assert.equal(r.status, 403); assert.equal(r.body.error, 'terms_required'); assert.deepEqual(r.body.missing, ['terms', 'privacy']);
    assert.ok(!FETCH.some((f) => f.url.includes('/rest/v1/bookings')), 'sin reserva');
  });
  await t('vincular cobros con Stripe sin Términos + Acuerdo vigentes → 403 terms_required', async () => {
    reset('walker', '1990-01-01');
    DB.legal_consents.push({ user_id: UID, ...fila() }); // acepta Términos, pero no el Acuerdo vigente
    const r = await call(connect, { headers: { authorization: 'Bearer token-ok' } });
    assert.equal(r.status, 403); assert.deepEqual(r.body.missing, ['contractor']);
  });
  await t('membresía: el endpoint también exige la aceptación guardada en la base', async () => {
    const src = read('api/create-subscription.js');
    assert.match(src, /requireCurrentConsent\(user\.id\)/); assert.match(src, /TERMS_VERSION = CURRENT\.terms/);
  });

  // ---------- Base de datos ----------
  await t('base: el paseador sin aceptación vigente no ve ni acepta paseos (sin tocar políticas ni triggers)', async () => {
    assert.match(SQL, /create or replace function public\.bw_is_verified_walker\(\)[\s\S]*and private\.bw_has_current_consent\(auth\.uid\(\)\)/);
    assert.match(SQL, /lc\.terms_version\s+= \(r\.j -> 'terms'\)\s+->> -1/);
    assert.ok(!/create policy[^;]*on public\.(walk_requests|profiles|bookings)/i.test(SQL), 'no cambia políticas existentes');
    assert.ok(!/(create|drop) trigger/i.test(SQL), 'no cambia triggers');
  });

  // ---------- App ----------
  await t('app: bloqueo al entrar, en reservar, ponerse en línea, aceptar paseos y ante terms_required del servidor', async () => {
    assert.match(HTML, /<script src="\/terms-gate\.js\?v=\d+" defer><\/script>/);
    assert.match(HTML, /if \(window\.BWTermsGate\) BWTermsGate\.check\(\);/);
    assert.match(HTML, /function openBookingModal\(\) \{\s*if \(termsBlocked\(\)\) return;/);
    assert.match(HTML, /function toggleAvailability\(\) \{\s*if \(!walkerOnline && typeof termsBlocked === 'function' && termsBlocked\(\)\) return;/);
    assert.match(HTML, /async function acceptWalk\(paseo, box\) \{\s*if \(typeof termsBlocked === 'function' && termsBlocked\(\)\) return;/);
    assert.ok((HTML.match(/j\.error === 'terms_required' && window\.BWTermsGate/g) || []).length >= 3, 'reservas, cobros y membresía');
    const ctx = { self: {} }; vm.runInNewContext(read('terms-gate.js'), ctx);
    assert.equal(typeof ctx.self.BWTermsGate.check, 'function');
    assert.match(G.CSS, /safe-area-inset-top/, 'el bloqueo respeta la barra de estado del iPhone');
  });

  // ---------- Postulación de paseadores ----------
  await t('postulación: estado "no aprobado" con motivo obligatorio, historial y aviso al paseador', async () => {
    assert.match(SQL, /'pending', 'verified', 'suspended', 'rejected'/);
    assert.match(SQL, /if new_status = 'rejected' and v_reason is null then raise exception 'reason required'/);
    assert.match(SQL, /insert into public\.walker_reviews/);
    assert.match(HTML, /rejected:\s*\{ es: 'No aprobado'/); assert.match(HTML, /new_status: status, reason: motivo/);
    assert.match(HTML, /function walkerApplicationSteps\(u, st\)/);
    const m = W.reviewMessage('rejected', 'Faltan referencias', 'es');
    assert.match(m.lines.join(' '), /Motivo: Faltan referencias/);
    assert.match(W.reviewMessage('verified', null, 'en').lines.join(' '), /Stripe payouts/);
  });
  await t('aviso de la decisión: correo + push una sola vez (aunque el cron pase varias veces)', async () => {
    reset('walker', '1990-01-01');
    DB.walker_reviews.push({ id: 1, walker_id: UID, status: 'verified', reason: null, notified_at: null, created_at: 'x' },
      { id: 2, walker_id: UID, status: 'pending', reason: null, notified_at: null, created_at: 'y' });
    const r1 = await W.processWalkerReviews();
    assert.equal(r1.sent, 1); assert.equal(RESEND.length, 1); assert.match(RESEND[0].subject, /aprobada/); assert.deepEqual(RESEND[0].to, ['a@example.com']);
    const r2 = await W.processWalkerReviews();
    assert.equal(r2.checked, 0); assert.equal(RESEND.length, 1, 'sin duplicados');
  });

  // ---------- Textos honestos ----------
  await t('textos: nadie afirma verificación de antecedentes ni "certificados" (web, asistente local, IA y términos)', async () => {
    const chatRaw = read('api/chat.js');
    // La única mención permitida es la PROHIBICIÓN explícita dentro del prompt del sistema
    const chat = chatRaw.replace(/never say or imply that walkers are background-checked, certified, licensed, insured or bonded/, '');
    assert.notEqual(chat, chatRaw, 'el prompt prohíbe afirmarlo');
    for (const [src, name] of [[HTML, 'index.html'], [chat, 'api/chat.js']]) {
      for (const re of [/background-checked/i, /Background check is required/i, /Paseadores con verificación de antecedentes/, /examinados con verificación/i,
        /certified walkers/i, /paseadores certificados/i, /Certified dog walkers/i, /vetted (independent|walker)/i, /Debes aprobar la verificación de antecedentes/]) {
        assert.ok(!re.test(src), `${name}: ${re}`);
      }
    }
    assert.match(chat, /does NOT currently run background checks/);
    assert.match(read('terminos-paseadores.html'), /no realiza actualmente verificaciones de antecedentes con proveedores externos/);
    assert.match(read('terminos-clientes.html'), /no realiza actualmente verificaciones de antecedentes penales con proveedores externos/);
    assert.ok(fs.existsSync(path.join(ROOT, 'docs/verificacion-paseadores.md')), 'documentado dónde conectar un proveedor');
  });
  await t('sigue el límite de 12 funciones en api/', async () => {
    assert.equal(fs.readdirSync(path.join(ROOT, 'api')).filter((f) => f.endsWith('.js')).length, 12);
  });

  console.log(`\n${n} pruebas OK`);
})().catch((e) => { console.error('✗ FALLO:', e.stack); process.exit(1); });
