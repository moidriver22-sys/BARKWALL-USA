// Pruebas del cierre de cuenta (api/_lib/account-closure.js + account-close.js) y de la retención de fotos
// de paseadores que operaron (3 años desde el cierre). Supabase REST, Auth y Storage simulados. Ejecuta: npm test
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
process.env.SUPABASE_URL = 'http://fake.supabase';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
const AC = require(path.join(ROOT, 'api/_lib/account-closure.js'));
const R = require(path.join(ROOT, 'api/_lib/doc-retention.js'));
const T = require(path.join(ROOT, 'api/_lib/terms.js'));
const C = require(path.join(ROOT, 'account-close.js'));
const RL = require(path.join(ROOT, 'api/_lib/rate-limit.js'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const UID = '11111111-2222-3333-4444-555555555555';
let DB, CALLS, FILES;
function reset(role = 'client', extra = {}) {
  DB = {
    profiles: [{ id: UID, role, membership_status: 'inactive', stripe_subscription_id: null, walker_status: role === 'walker' ? 'verified' : 'pending', growth_opt_out_at: null, ...extra }],
    account_closures: [], walk_requests: [], walk_cancellations: [], bookings: [], walker_applications: [],
    push_subscriptions: [{ user_id: UID }], payment_methods: [{ client_id: UID }], home_access: [{ client_id: UID }], legal_consents: [{ user_id: UID }],
  };
  CALLS = []; FILES = {};
}
const resp = (status, data) => { const s = data == null ? '' : JSON.stringify(data); return { ok: status < 300, status, text: async () => s, json: async () => data }; };
function match(row, k, e) {
  const [op, ...r] = e.split('.'); const v = r.join('.');
  if (op === 'eq') return String(row[k]) === v;
  if (op === 'is') return v === 'null' ? row[k] == null : String(row[k]) === v;
  if (op === 'not' && v === 'is.null') return row[k] != null;
  if (op === 'in') return v.slice(1, -1).split(',').includes(String(row[k]));
  throw new Error('filtro ' + k + '=' + e);
}
global.fetch = async (url, opts = {}) => {
  const u = String(url); const m = opts.method || 'GET'; CALLS.push({ url: u, method: m, body: opts.body });
  if (u.includes('/auth/v1/user')) return /token-ok/.test((opts.headers && opts.headers.Authorization) || '') ? resp(200, { id: UID, email: 'a@example.com' }) : resp(401, {});
  if (u.includes('/auth/v1/admin/users/')) return resp(200, { id: UID });
  if (u.includes('/storage/v1/object/list/walker-docs')) { const uid = JSON.parse(opts.body).prefix.replace(/\/$/, ''); return resp(200, (FILES[uid] || []).map((n) => ({ name: n, metadata: { size: 1, mimetype: 'image/jpeg' } }))); }
  if (u.endsWith('/storage/v1/object/walker-docs') && m === 'DELETE') return resp(200, []);
  const p = new URL(u); const t = p.pathname.replace('/rest/v1/', ''); const rows = DB[t]; if (!rows) return resp(404, {});
  const f = [...p.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit'].includes(k));
  const hit = rows.filter((r) => f.every(([k, e]) => match(r, k, e)));
  if (m === 'GET') return resp(200, hit);
  if (m === 'POST') { const b = JSON.parse(opts.body); if (t === 'account_closures' && rows.some((r) => r.user_id === b.user_id)) return resp(409, {}); rows.push(b); return resp(201, []); }
  if (m === 'PATCH') { const b = JSON.parse(opts.body); hit.forEach((r) => Object.assign(r, b)); return resp(200, hit); }
  if (m === 'DELETE') { DB[t] = rows.filter((r) => !hit.includes(r)); return resp(204, null); }
  return resp(405, {});
};
const signup = require(path.join(ROOT, 'api/signup.js'));
let ipN = 0;
const call = async (body, auth = true) => {
  const res = { statusCode: 0, headers: {}, setHeader() {}, end(b) { this.body = b; } };
  await signup({ method: 'POST', url: '/', headers: { 'x-real-ip': `192.0.2.${++ipN}`, 'user-agent': 'ua', ...(auth ? { authorization: 'Bearer token-ok' } : {}) }, body }, res);
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};

let n = 0;
const t = async (name, fn) => { RL.setRateLimitBackend(() => true); await fn(); n++; console.log('✓', name); };

(async () => {
  // ---------- Bloqueos ----------
  await t('bloquea el cierre con paseos activos, pagos al paseador sin liquidar, reembolsos en curso, disputas o membresía activa', async () => {
    reset('walker', { membership_status: 'active', stripe_subscription_id: 'sub_1' });
    DB.walk_requests.push({ id: 'a', client_id: UID, payment_status: 'paid', status: 'pending' }, { id: 'b', walker_id: UID, status: 'in_progress' },
      { id: 'c', walker_id: UID, status: 'completed', payment_status: 'paid', walker_payout_status: 'unpaid' });
    DB.walk_cancellations.push({ walk_id: 'd', client_id: UID, status: 'needs_review' });
    DB.bookings.push({ id: 'e', client_id: UID, dispute_status: 'needs_response' }, { id: 'f', client_id: UID, dispute_status: 'won' });
    const { blockers } = await AC.closureBlockers(UID);
    assert.deepEqual(blockers.map((b) => b.code), ['active_walks', 'active_walks_as_walker', 'unsettled_payouts', 'pending_refunds', 'open_disputes', 'active_membership']);
    reset('client');
    DB.walk_requests.push({ id: 'g', client_id: UID, payment_status: 'paid', status: 'completed' }, { id: 'h', client_id: UID, payment_status: 'paid', status: 'cancelled' });
    assert.deepEqual((await AC.closureBlockers(UID)).blockers, [], 'paseos terminados o cancelados no bloquean');
  });
  await t('cerrar exige sesión y escribir CERRAR (o CLOSE); con bloqueos responde 409 y no cambia nada', async () => {
    reset('client');
    assert.equal((await call({ action: 'close_account', confirm: 'CERRAR' }, false)).status, 401);
    assert.equal((await call({ action: 'close_account', confirm: 'cerrar ya' })).body.error, 'confirmation_required');
    DB.walk_requests.push({ id: 'a', client_id: UID, payment_status: 'paid', status: 'accepted' });
    const r = await call({ action: 'close_account', confirm: 'cerrar' });
    assert.equal(r.status, 409); assert.equal(r.body.error, 'close_blocked'); assert.equal(r.body.blockers[0].code, 'active_walks');
    assert.equal(DB.account_closures.length, 0); assert.ok(!CALLS.some((c) => c.url.includes('/auth/v1/admin/users/')), 'no se desactiva');
    const chk = await call({ action: 'close_account_check' });
    assert.equal(chk.body.canClose, false);
  });
  await t('cierre de un paseador que operó: constancia, cuenta desactivada, deja de recibir paseos y conserva registros legales/financieros', async () => {
    reset('walker');
    DB.walk_requests.push({ id: 'w1', walker_id: UID, status: 'completed', payment_status: 'paid', walker_payout_status: 'paid' });
    DB.bookings.push({ id: 'b1', client_id: 'otro' });
    const r = await call({ action: 'close_account', confirm: 'CLOSE', reason: 'Me mudo' });
    assert.equal(r.status, 200); assert.equal(r.body.status, 'closed'); assert.equal(r.body.operated, true);
    const c = DB.account_closures[0];
    assert.equal(c.user_id, UID); assert.equal(c.role, 'walker'); assert.equal(c.operated, true); assert.ok(c.closed_at); assert.equal(c.reason, 'Me mudo'); assert.ok(c.ip_address);
    const ban = CALLS.find((x) => x.url.includes(`/auth/v1/admin/users/${UID}`));
    assert.equal(ban.method, 'PUT'); assert.match(ban.body, /"ban_duration":"876000h"/);
    assert.equal(DB.profiles[0].walker_status, 'suspended'); assert.ok(DB.profiles[0].growth_opt_out_at);
    assert.equal(DB.push_subscriptions.length, 0); assert.equal(DB.payment_methods.length, 0); assert.equal(DB.home_access.length, 0);
    assert.equal(DB.legal_consents.length, 1, 'consentimientos conservados'); assert.equal(DB.walk_requests.length, 1); assert.equal(DB.bookings.length, 1);
    assert.ok(!CALLS.some((x) => x.method === 'DELETE' && /legal_consents|bookings|walk_requests|walk_cancellations|walker_applications|walker_reviews/.test(x.url)), 'nada legal/financiero se borra');
    assert.equal((await call({ action: 'close_account', confirm: 'CERRAR' })).body.error, 'already_closed');
  });
  await t('cuenta cerrada: el servidor rechaza reservas, membresías y cobros aunque su sesión siga abierta', async () => {
    reset('client'); DB.account_closures.push({ user_id: UID });
    assert.deepEqual(await T.requireCurrentConsent(UID), { error: 'account_closed' });
  });

  // ---------- Retención de fotos tras el cierre ----------
  const NOW = Date.parse('2030-01-10T12:00:00Z');
  const hace = (d) => new Date(NOW - d * 864e5).toISOString();
  await t('retención: paseador que operó → 3 años desde el cierre; que nunca operó → 90 días; clientes no aplican', async () => {
    const lista = [
      { user_id: 'A', role: 'walker', operated: true, closed_at: hace(365 * 3 + 2) },  // ✔ pasaron 3 años
      { user_id: 'B', role: 'walker', operated: true, closed_at: hace(365 * 2) },      // aún no
      { user_id: 'C', role: 'walker', operated: false, closed_at: hace(95) },          // ✔ nunca operó: 90 días
      { user_id: 'D', role: 'walker', operated: false, closed_at: hace(30) },          // aún no
      { user_id: 'E', role: 'client', operated: false, closed_at: hace(4000) },        // cliente: sin documentos
      { user_id: 'F', role: 'walker', operated: true, closed_at: hace(4000), docs_deleted_at: hace(10) }, // ya borradas
    ];
    assert.deepEqual(R.closedCandidates(lista, NOW).sort(), ['A', 'C']);
    assert.equal(R.OPERATED_RETENTION_YEARS, 3);
  });
  await t('retención: borra del bucket privado y deja constancia (fecha y cantidad) en el cierre y en las postulaciones', async () => {
    reset('walker');
    DB.account_closures.push({ user_id: 'A', role: 'walker', operated: true, closed_at: hace(365 * 3 + 2), docs_deleted_at: null });
    DB.walker_applications.push({ walker_id: 'A', status: 'approved', docs_deleted_at: null });
    FILES.A = ['1-id.jpg', '1-selfie.jpg'];
    const r = await R.runClosedRetention({ now: NOW });
    assert.deepEqual([r.walkersCleaned, r.filesDeleted, r.failed], [1, 2, 0]);
    const del = CALLS.find((x) => x.url.endsWith('/storage/v1/object/walker-docs') && x.method === 'DELETE');
    assert.deepEqual(JSON.parse(del.body).prefixes.sort(), ['A/1-id.jpg', 'A/1-selfie.jpg']);
    assert.ok(DB.account_closures[0].docs_deleted_at); assert.equal(DB.account_closures[0].docs_deleted_count, 2);
    assert.ok(DB.walker_applications[0].docs_deleted_at);
    const dry = await R.runClosedRetention({ now: NOW, dryRun: true }); assert.equal(dry.eligible, 0, 'no repite');
  });

  // ---------- App, base y despliegue ----------
  await t('app: "Cerrar mi cuenta" en Perfil con confirmación CERRAR, motivos claros y aviso si una cuenta cerrada intenta entrar', async () => {
    const H = read('index.html');
    assert.match(H, /tr\('Cerrar mi cuenta', 'Close my account'\)[^\n]*BWAccountClose\.open\(\)/);
    assert.match(H, /<script src="\/account-close\.js\?v=\d+" defer><\/script>/);
    assert.match(H, /if \(\/banned\/i\.test\(err\?\.message \|\| ''\)\) showRegError\(tr\('Esta cuenta fue cerrada/);
    assert.equal(C.isConfirm('cerrar'), true); assert.equal(C.isConfirm('CLOSE '), true); assert.equal(C.isConfirm('sí'), false); assert.equal(C.isConfirm(''), false);
    for (const code of ['active_walks', 'active_walks_as_walker', 'unsettled_payouts', 'pending_refunds', 'open_disputes', 'active_membership']) assert.ok(C.blockerText(code, 'es').length > 20 && C.blockerText(code, 'en') !== C.blockerText(code, 'es'), code);
    const ctx = { self: {} }; vm.runInNewContext(read('account-close.js'), ctx); assert.equal(typeof ctx.self.BWAccountClose.open, 'function');
  });
  await t('base: tabla de cierres solo escribible por el servidor; no toca triggers ni políticas existentes; 12 funciones', async () => {
    const SQL = read('supabase/migrations/20261204_account_closure.sql');
    assert.match(SQL, /revoke insert, update, delete, truncate on public\.account_closures from authenticated/);
    assert.match(SQL, /"account_closures: own read"[^;]*using \(user_id = auth\.uid\(\)\)/);
    assert.ok(!/(create|drop) trigger/i.test(SQL)); assert.ok(!/on public\.(profiles|walk_requests|bookings|legal_consents)\b/i.test(SQL.replace(/references public\.profiles/g, '')));
    assert.match(read('api/_lib/doc-retention.js'), /const closed = await runClosedRetention/);
    assert.equal(fs.readdirSync(path.join(ROOT, 'api')).filter((f) => f.endsWith('.js')).length, 12);
  });

  console.log(`\n${n} pruebas OK`);
})().catch((e) => { console.error('✗ FALLO:', e.stack); process.exit(1); });
