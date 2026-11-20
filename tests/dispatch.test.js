// Pruebas del Agente de Operaciones y Despacho (api/_lib/dispatch.js + /api/dispatch)
// Supabase REST y Resend simulados en memoria; reloj fijo. Ejecuta: npm test
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
process.env.SUPABASE_URL = 'http://fake.supabase';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
process.env.CRON_SECRET = 'cron-secret-for-tests-1234';
process.env.RESEND_API_KEY = 're_test';
process.env.OPS_ALERT_EMAIL = 'ops@barkwalkusa.com';

const MIN = 60000;
const NOW = Date.parse('2026-11-20T16:00:00Z'); // 10:00 AM Birmingham
const iso = (offsetMin) => new Date(NOW + offsetMin * MIN).toISOString();

// ---------- PostgREST simulado (filtros usados por dispatch.js) ----------
let DB, RESEND;
function reset() {
  DB = {
    profiles: [
      { id: 'cli', email: 'cliente@example.com', full_name: 'Ana' },
      { id: 'wk', email: 'paseador@example.com', full_name: 'Camila' },
    ],
    dispatch_alerts: [],
    walk_requests: [],
  };
  RESEND = { calls: [], status: 200 };
}
const walk = (id, o) => DB.walk_requests.push({ id, payment_status: 'paid', client_id: 'cli', pet_name: 'Luna', duration: '30 min',
  service_type: '🚶 Standard Walk · 30 min', pickup_address: '1 Main St', created_at: iso(-120), ...o });
function cmp(row, key, expr) {
  const v = row[key];
  const [op, ...rest] = expr.split('.'); const val = rest.join('.');
  if (op === 'eq') return String(v) === val;
  if (op === 'gte') return v != null && Date.parse(v) >= Date.parse(val);
  if (op === 'in') return val.slice(1, -1).split(',').map((s) => s.replace(/"/g, '')).includes(String(v));
  throw new Error('filtro no soportado ' + key + '=' + expr);
}
function matchOr(row, expr) { // (a.gte.X,b.gte.Y)
  return expr.slice(1, -1).split(/,(?=[a-z_]+\.)/).some((part) => { const i = part.indexOf('.'); return cmp(row, part.slice(0, i), part.slice(i + 1)); });
}
const resp = (status, data) => { const t = data == null ? '' : JSON.stringify(data); return { ok: status < 300, status, text: async () => t, json: async () => data }; };
global.fetch = async (url, opts = {}) => {
  if (String(url).startsWith('https://api.resend.com/')) {
    RESEND.calls.push({ headers: opts.headers, body: JSON.parse(opts.body) });
    return resp(RESEND.status, RESEND.status < 300 ? { id: 'e' + RESEND.calls.length } : { message: 'fail' });
  }
  const u = new URL(url);
  const table = u.pathname.replace('/rest/v1/', '');
  const rows = DB[table];
  if (!rows) return resp(404, { code: 'PGRST205' });
  const method = opts.method || 'GET';
  if (method === 'POST') { // dispatch_alerts con on_conflict=walk_id,kind + ignore-duplicates
    const n = JSON.parse(opts.body);
    if (rows.some((r) => r.walk_id === n.walk_id && r.kind === n.kind)) return resp(201, []);
    rows.push(n); return resp(201, [n]);
  }
  const filters = [...u.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'on_conflict'].includes(k));
  const hit = rows.filter((r) => filters.every(([k, e]) => (k === 'or' ? matchOr(r, e) : cmp(r, k, e))));
  if (method === 'GET') return resp(200, hit);
  if (method === 'DELETE') { DB[table] = rows.filter((r) => !hit.includes(r)); return resp(204, null); }
  throw new Error('método no soportado ' + method);
};

const { runDispatch, planAlerts, durationMinutes, config } = require(path.join(ROOT, 'api/_lib/dispatch.js'));
const handler = require(path.join(ROOT, 'api/dispatch.js'));
let passed = 0;
const t = async (name, fn) => { reset(); await fn(); passed++; console.log('✓', name); };
const kinds = (r) => r.alerts.map((a) => `${a.kind}:${a.walk}`).sort();

(async () => {
  await t('duración contratada → minutos', async () => {
    assert.equal(durationMinutes('15 min'), 15); assert.equal(durationMinutes('1 h'), 60);
    assert.equal(durationMinutes('1 day'), 600); assert.equal(durationMinutes('1 night'), 720); assert.equal(durationMinutes(''), 60);
  });

  await t('detecta las 6 situaciones con los umbrales por defecto', async () => {
    walk('w-assigned', { status: 'pending', walker_id: 'wk', created_at: iso(-31), scheduled_at: iso(600) });   // recordatorio al paseador
    walk('w-open', { status: 'pending', walker_id: null, created_at: iso(-40), scheduled_at: iso(300) });       // sin paseador (hoy)
    walk('w-open-far', { status: 'pending', walker_id: null, created_at: iso(-40), scheduled_at: iso(5 * 24 * 60) }); // la semana que viene: no molesta
    walk('w-near', { status: 'pending', walker_id: null, created_at: iso(-5), scheduled_at: iso(45) });          // urgente: empieza en 45 min
    walk('w-soon', { status: 'accepted', walker_id: 'wk', scheduled_at: iso(50) });                              // empieza pronto
    walk('w-late', { status: 'en_camino', walker_id: 'wk', scheduled_at: iso(-25) });                            // no iniciado tras 25 min
    walk('w-overdue', { status: 'in_progress', walker_id: 'wk', duration: '30 min', started_at: iso(-80), scheduled_at: iso(-80) }); // 30+45 < 80
    walk('w-ok', { status: 'in_progress', walker_id: 'wk', duration: '60 min', started_at: iso(-50), scheduled_at: iso(-50) });     // dentro de tiempo
    walk('w-unpaid', { status: 'pending', walker_id: null, payment_status: 'pending', created_at: iso(-90), scheduled_at: iso(30) }); // no pagado: ignorado
    walk('w-done', { status: 'completed', walker_id: 'wk', scheduled_at: iso(-200) });
    const r = await runDispatch({ now: NOW, dryRun: true });
    assert.deepEqual(kinds(r), [
      'late_start_ops:w-late', 'late_start_walker:w-late',
      'overdue_ops:w-overdu', 'overdue_walker:w-overdu',
      'pending_near_start_ops:w-near',
      'pending_open_ops:w-open',
      'pending_walker_reminder:w-assign',
      'upcoming_client:w-soon', 'upcoming_walker:w-soon',
    ]);
    assert.equal(RESEND.calls.length, 0, 'dry run no envía'); assert.equal(DB.dispatch_alerts.length, 0, 'dry run no reclama');
  });

  await t('envía a quien corresponde y NO repite en la siguiente ejecución (idempotente)', async () => {
    walk('w-soon', { status: 'accepted', walker_id: 'wk', scheduled_at: iso(50) });
    walk('w-overdue', { status: 'in_progress', walker_id: 'wk', duration: '30 min', started_at: iso(-80) });
    const r1 = await runDispatch({ now: NOW });
    assert.equal(r1.sent, 4);
    const to = RESEND.calls.map((c) => `${c.body.to[0]}|${c.body.subject.split(' · #')[0]}`).sort();
    assert.deepEqual(to, [
      'cliente@example.com|🐾 Tu paseo de hoy empieza pronto · Your walk starts soon',
      'ops@barkwalkusa.com|[Ops] Paseo abierto demasiado tiempo',
      'paseador@example.com|⏱️ ¿Ya terminaste el paseo? · Did you finish the walk?',
      'paseador@example.com|🐾 Tu paseo empieza pronto · Your walk starts soon',
    ]);
    assert.ok(RESEND.calls.every((c) => /email-logo\.png/.test(c.body.html)), 'diseño oficial con logo');
    assert.ok(RESEND.calls.every((c) => /^dispatch-w-/.test(c.headers['Idempotency-Key'])));
    const r2 = await runDispatch({ now: NOW + 10 * MIN }); // 10 min después: mismo estado
    assert.equal(r2.sent, 0); assert.equal(r2.skipped, 4); assert.equal(RESEND.calls.length, 4, 'sin correos duplicados');
  });

  await t('si Resend falla, libera el reclamo y lo reintenta en la siguiente ejecución', async () => {
    walk('w-late', { status: 'accepted', walker_id: null, scheduled_at: iso(-30) });
    RESEND.status = 500;
    const r1 = await runDispatch({ now: NOW });
    assert.equal(r1.failed, 1); assert.equal(DB.dispatch_alerts.length, 0, 'reclamo liberado');
    RESEND.status = 200;
    const r2 = await runDispatch({ now: NOW + 10 * MIN });
    assert.equal(r2.sent, 1); assert.equal(DB.dispatch_alerts.length, 1);
  });

  await t('sin RESEND_API_KEY: no reclama nada (se enviará cuando se configure)', async () => {
    walk('w-late', { status: 'accepted', walker_id: null, scheduled_at: iso(-30) });
    process.env.RESEND_API_KEY = '';
    try {
      const r = await runDispatch({ now: NOW });
      assert.equal(r.error, 'resend_not_configured'); assert.equal(DB.dispatch_alerts.length, 0);
    } finally { process.env.RESEND_API_KEY = 're_test'; }
  });

  await t('tope por ejecución: lo que sobra queda para la siguiente', async () => {
    process.env.DISPATCH_MAX_ALERTS_PER_RUN = '2';
    try {
      for (let i = 0; i < 4; i++) walk(`w-late-${i}`, { status: 'accepted', walker_id: null, scheduled_at: iso(-30) });
      const r = await runDispatch({ now: NOW });
      assert.equal(r.sent, 2); assert.equal(r.alerts.filter((a) => a.status === 'deferred').length, 2);
      const r2 = await runDispatch({ now: NOW + 10 * MIN });
      assert.equal(r2.sent, 2); assert.equal(RESEND.calls.length, 4);
    } finally { delete process.env.DISPATCH_MAX_ALERTS_PER_RUN; }
  });

  await t('umbrales configurables por variables de entorno', async () => {
    process.env.DISPATCH_PENDING_MINUTES = '90';
    try {
      walk('w-assigned', { status: 'pending', walker_id: 'wk', created_at: iso(-60), scheduled_at: iso(600) });
      assert.equal(planAlerts(DB.walk_requests, NOW, config()).length, 0, '60 min < 90 min');
    } finally { delete process.env.DISPATCH_PENDING_MINUTES; }
  });

  const call = async (headers, url = '/api/dispatch') => {
    const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
    await handler({ method: 'GET', url, headers }, res);
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
  await t('endpoint: exige CRON_SECRET (401) y no expone correos en la respuesta', async () => {
    assert.equal((await call({})).status, 401);
    assert.equal((await call({ authorization: 'Bearer wrong-secret-0000000000' })).status, 401);
    walk('w-soon', { status: 'accepted', walker_id: 'wk', scheduled_at: new Date(Date.now() + 30 * MIN).toISOString() });
    const r = await call({ authorization: `Bearer ${process.env.CRON_SECRET}` }, '/api/dispatch?dry=1');
    assert.equal(r.status, 200); assert.equal(r.body.dryRun, true); assert.equal(r.body.planned, 2);
    assert.ok(!/@/.test(JSON.stringify(r.body)), 'sin direcciones de correo en la respuesta');
  });

  console.log(`\n${passed} pruebas OK`);
})().catch((e) => { console.error('✗ FALLO:', e.message); process.exit(1); });
