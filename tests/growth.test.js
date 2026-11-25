// Pruebas del Agente de Fidelización y Crecimiento (api/_lib/growth-agent.js + /api/dispatch?action=growth)
// Supabase REST, Resend y Web Push simulados; reloj fijo. Ejecuta: npm test
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
process.env.SUPABASE_URL = 'http://fake.supabase';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
process.env.CRON_SECRET = 'cron-secret-for-tests-1234';
process.env.RESEND_API_KEY = 're_test';
process.env.STRIPE_SECRET_KEY = '';

const H = 3600 * 1000, D = 24 * H;
const NOW = Date.parse('2026-11-21T18:00:00Z'); // 12:00 PM Birmingham (dentro del horario de envío)
const iso = (ms) => new Date(NOW + ms).toISOString();

let DB, RESEND, PUSHES;
function reset() {
  DB = {
    dispatch_alerts: [],
    push_subscriptions: [{ id: 1, user_id: 'c-ana', endpoint: 'https://push.example/ana-phone', p256dh: 'k', auth: 'a', fail_count: 0 }],
    profiles: [
      { id: 'c-ana', email: 'ana@example.com', full_name: 'Ana López', growth_opt_out_at: null },
      { id: 'c-beto', email: 'beto@example.com', full_name: 'Beto', growth_opt_out_at: null },
      { id: 'c-caro', email: 'caro@example.com', full_name: 'Caro', growth_opt_out_at: null },
      { id: 'c-dani', email: 'dani@example.com', full_name: 'Dani', growth_opt_out_at: null },
      { id: 'c-eva', email: 'eva@example.com', full_name: 'Eva', growth_opt_out_at: null },
      { id: 'c-fer', email: 'fer@example.com', full_name: 'Fer', growth_opt_out_at: '2026-11-01T00:00:00Z' },
      { id: 'c-gil', email: 'gil@example.com', full_name: 'Gil', growth_opt_out_at: null },
    ],
    walk_requests: [
      // Ana: reserva de 2 días, ambos completados (el último hace 3 h) → UN agradecimiento
      { id: 'w-ana-1', client_id: 'c-ana', booking_id: 'b-ana', status: 'completed', payment_status: 'paid', pet_name: 'Luna', completed_at: iso(-27 * H) },
      { id: 'w-ana-2', client_id: 'c-ana', booking_id: 'b-ana', status: 'completed', payment_status: 'paid', pet_name: 'Luna', completed_at: iso(-3 * H) },
      // Beto: reserva de 3 días con uno aún pendiente → todavía no
      { id: 'w-beto-1', client_id: 'c-beto', booking_id: 'b-beto', status: 'completed', payment_status: 'paid', pet_name: 'Rocky', completed_at: iso(-5 * H) },
      { id: 'w-beto-2', client_id: 'c-beto', booking_id: 'b-beto', status: 'accepted', payment_status: 'paid', pet_name: 'Rocky', scheduled_at: iso(20 * H) },
      // Caro: completado hace 20 min → aún no (espera 60 min a que llegue el reporte)
      { id: 'w-caro', client_id: 'c-caro', booking_id: null, status: 'completed', payment_status: 'paid', pet_name: 'Max', completed_at: iso(-20 * 60 * 1000) },
      // Dani: último paseo hace 16 días, nada reservado → reactivación
      { id: 'w-dani-old', client_id: 'c-dani', booking_id: 'b-dani0', status: 'completed', payment_status: 'paid', pet_name: 'Toby', completed_at: iso(-40 * D) },
      { id: 'w-dani', client_id: 'c-dani', booking_id: 'b-dani', status: 'completed', payment_status: 'paid', pet_name: 'Toby', completed_at: iso(-16 * D) },
      // Eva: hace 20 días pero ya tiene otro paseo reservado → no se le molesta
      { id: 'w-eva', client_id: 'c-eva', booking_id: 'b-eva', status: 'completed', payment_status: 'paid', pet_name: 'Kira', completed_at: iso(-20 * D) },
      { id: 'w-eva-next', client_id: 'c-eva', booking_id: 'b-eva2', status: 'pending', payment_status: 'paid', pet_name: 'Kira', scheduled_at: iso(2 * D) },
      // Fer: se dio de baja de estos avisos
      { id: 'w-fer', client_id: 'c-fer', booking_id: null, status: 'completed', payment_status: 'paid', pet_name: 'Coco', completed_at: iso(-2 * H) },
      // Gil: reportó un problema en su paseo → ni agradecimiento ni reactivación
      { id: 'w-gil', client_id: 'c-gil', booking_id: null, status: 'completed', payment_status: 'paid', pet_name: 'Bruno', completed_at: iso(-4 * H), client_issue_at: iso(-3 * H) },
      // Paseos de prueba sin pagar y clientes perdidos hace mucho → nunca
      { id: 'w-unpaid', client_id: 'c-ana', booking_id: null, status: 'completed', payment_status: 'pending', pet_name: 'Luna', completed_at: iso(-2 * H) },
      { id: 'w-viejo', client_id: 'c-caro', booking_id: 'b-viejo', status: 'completed', payment_status: 'paid', pet_name: 'Max', completed_at: iso(-90 * D) },
    ],
  };
  RESEND = { calls: [], status: 200 };
  PUSHES = [];
}

const resp = (status, data) => { const t = data == null ? '' : JSON.stringify(data); return { ok: status < 300, status, text: async () => t, json: async () => data }; };
function cmp(row, key, expr) {
  const v = row[key];
  if (expr === 'not.is.null') return v != null;
  const m = expr.match(/^in\.\((.*)\)$/);
  if (m) return m[1].split(',').map((s) => s.replace(/^"|"$/g, '')).includes(String(v));
  const [op, ...rest] = expr.split('.'); const val = rest.join('.');
  if (op === 'eq') return String(v) === val;
  if (op === 'gte') return v != null && Date.parse(v) >= Date.parse(val);
  throw new Error('filtro no soportado ' + key + '=' + expr);
}
global.fetch = async (url, opts = {}) => {
  if (String(url).startsWith('https://api.resend.com/')) {
    RESEND.calls.push({ headers: opts.headers, body: JSON.parse(opts.body) });
    return resp(RESEND.status, RESEND.status < 300 ? { id: 'e' + RESEND.calls.length } : { message: 'fail' });
  }
  const u = new URL(url); const table = u.pathname.replace('/rest/v1/', ''); const rows = DB[table];
  if (!rows) throw new Error('tabla inesperada ' + u.pathname);
  const method = opts.method || 'GET';
  if (method === 'POST') {
    const n = JSON.parse(opts.body);
    if (rows.some((r) => r.walk_id === n.walk_id && r.kind === n.kind)) return resp(201, []);
    rows.push(n); return resp(201, [n]);
  }
  const filters = [...u.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'on_conflict'].includes(k));
  const hit = rows.filter((r) => filters.every(([k, e]) => cmp(r, k, e)));
  if (method === 'GET') return resp(200, hit);
  if (method === 'DELETE') { DB[table] = rows.filter((r) => !hit.includes(r)); return resp(204, null); }
  if (method === 'PATCH') { hit.forEach((r) => Object.assign(r, JSON.parse(opts.body))); return resp(204, null); }
  throw new Error('método ' + method);
};

const G = require(path.join(ROOT, 'api/_lib/growth-agent.js'));
const { setPushSender } = require(path.join(ROOT, 'api/_lib/push.js'));
const handler = require(path.join(ROOT, 'api/dispatch.js'));
const fakePush = async (sub, payload) => { PUSHES.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) }); };
let passed = 0;
const t = async (name, fn) => { reset(); setPushSender(fakePush); try { await fn(); } finally { setPushSender(null); } passed++; console.log('✓', name); };
const claves = () => DB.dispatch_alerts.map((a) => a.walk_id).sort();

(async () => {
  await t('decide bien: 1 agradecimiento por reserva y 1 reactivación (sin falsos positivos)', async () => {
    const r = await G.runGrowth({ now: NOW, dryRun: true });
    assert.deepEqual(r.byKind, { growth_thanks: 1, growth_reactivate: 1 });
    assert.deepEqual(r.items.map((i) => `${i.kind}:${i.client}`).sort(), ['growth_reactivate:c-dani', 'growth_thanks:c-ana']);
    assert.equal(r.optedOut, 1, 'Fer se dio de baja'); assert.equal(RESEND.calls.length, 0); assert.equal(DB.dispatch_alerts.length, 0, 'dry run no reclama');
  });

  await t('envía push + correo con el diseño oficial; la 2.ª ejecución no repite nada', async () => {
    const r1 = await G.runGrowth({ now: NOW });
    assert.equal(r1.failed, 0, JSON.stringify(r1)); assert.equal(r1.sent, 2);
    assert.deepEqual(claves(), ['grow:reactivate:c-dani:w-dani', 'grow:thanks:b-ana']);
    const anaCall = RESEND.calls.find((c) => c.body.to[0] === 'ana@example.com'); const ana = anaCall.body;
    assert.match(ana.subject, /Gracias por pasear con Barkwalk/); assert.match(ana.html, /email-logo\.png/);
    assert.match(ana.html, /Hola Ana/); assert.match(ana.html, /los 2 paseos de tu reserva/); assert.match(ana.html, /califica a tu paseador/);
    assert.match(ana.html, /BAJA/); assert.equal(anaCall.headers['Idempotency-Key'], 'grow:thanks:b-ana');
    const dani = RESEND.calls.find((c) => c.body.to[0] === 'dani@example.com').body;
    assert.match(dani.subject, /^Toby te extraña/); assert.match(dani.html, /16 días/);
    assert.ok(dani.headers['List-Unsubscribe'].startsWith('<mailto:barkwalkusallc@gmail.com'));
    assert.equal(PUSHES.length, 1); assert.equal(PUSHES[0].endpoint, 'https://push.example/ana-phone'); assert.match(PUSHES[0].payload.title, /Gracias/);
    const r2 = await G.runGrowth({ now: NOW + H });
    // Ana y Dani no se repiten; Caro (completado hace 20 min) ya pasó la espera de 60 min → recibe el suyo ahora
    assert.equal(r2.skipped, 2); assert.equal(r2.sent, 1); assert.equal(RESEND.calls.length, 3, 'sin duplicados');
    assert.deepEqual(RESEND.calls.map((c) => c.body.to[0]).filter((e) => e === 'ana@example.com' || e === 'dani@example.com').length, 2);
    assert.equal(RESEND.calls[2].body.to[0], 'caro@example.com');
  });

  await t('reserva de varios días: el agradecimiento sale cuando termina el último día', async () => {
    await G.runGrowth({ now: NOW });
    const beto = DB.walk_requests.find((w) => w.id === 'w-beto-2');
    beto.status = 'completed'; beto.completed_at = iso(22 * H);
    const r = await G.runGrowth({ now: NOW + 24 * H });
    assert.equal(r.byKind.growth_thanks, 2, 'Beto + Caro'); assert.ok(claves().includes('grow:thanks:b-beto'));
    assert.equal(RESEND.calls.filter((c) => c.body.to[0] === 'beto@example.com').length, 1);
  });

  await t('reactivación: una por ausencia; si vuelve y se ausenta otra vez, recibe otra', async () => {
    await G.runGrowth({ now: NOW });
    await G.runGrowth({ now: NOW + 5 * D });
    assert.equal(RESEND.calls.filter((c) => c.body.to[0] === 'dani@example.com').length, 1, 'no insiste durante la misma ausencia');
    DB.walk_requests.push({ id: 'w-dani-2', client_id: 'c-dani', booking_id: 'b-dani2', status: 'completed', payment_status: 'paid', pet_name: 'Toby', completed_at: iso(6 * D) });
    const r = await G.runGrowth({ now: NOW + 21 * D });
    assert.ok(claves().includes('grow:reactivate:c-dani:w-dani-2'));
    // Para entonces Ana y Caro también llevan ≥ 14 días sin paseo; Eva sigue con uno reservado, Fer (baja) y Gil (queja) nunca
    assert.deepEqual(r.items.filter((i) => i.kind === 'growth_reactivate').map((i) => i.client).sort(), ['c-ana', 'c-caro', 'c-dani']);
  });

  await t('fuera del horario (de noche en Birmingham) no envía ni reclama nada', async () => {
    const noche = Date.parse('2026-11-22T08:00:00Z'); // 2:00 AM Birmingham
    assert.equal(G.chicagoHour(noche), 2);
    const r = await G.runGrowth({ now: noche });
    assert.equal(r.quietHours, true); assert.equal(RESEND.calls.length, 0); assert.equal(DB.dispatch_alerts.length, 0);
  });

  await t('si Resend falla, libera el reclamo y lo reintenta en la siguiente ejecución', async () => {
    RESEND.status = 500;
    const r1 = await G.runGrowth({ now: NOW });
    assert.equal(r1.failed, 2); assert.equal(DB.dispatch_alerts.length, 0);
    RESEND.status = 200;
    const r2 = await G.runGrowth({ now: NOW + 10 * 60 * 1000 });
    assert.equal(r2.sent, 2);
  });

  await t('tope por ejecución: lo que sobra queda para la siguiente', async () => {
    process.env.GROWTH_MAX_PER_RUN = '1';
    try {
      const r1 = await G.runGrowth({ now: NOW });
      assert.equal(r1.sent, 1); assert.equal(r1.deferred, 1); assert.equal(DB.dispatch_alerts.length, 1);
      const r2 = await G.runGrowth({ now: NOW + 10 * 60 * 1000 });
      assert.equal(r2.sent, 1); assert.equal(DB.dispatch_alerts.length, 2);
    } finally { delete process.env.GROWTH_MAX_PER_RUN; }
  });

  const call = async (headers, url) => {
    const res = { statusCode: 0, setHeader() {}, end(b) { this.body = b; } };
    await handler({ method: 'GET', url, headers }, res);
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
  await t('endpoint action=growth: exige CRON_SECRET y no expone correos', async () => {
    assert.equal((await call({}, '/api/dispatch?action=growth')).status, 401);
    const r = await call({ authorization: `Bearer ${process.env.CRON_SECRET}` }, '/api/dispatch?action=growth&dry=1');
    assert.equal(r.status, 200); assert.equal(r.body.dryRun, true); assert.ok(!/@/.test(JSON.stringify(r.body)));
    assert.equal(RESEND.calls.length, 0);
  });

  await t('acción test_growth: los 2 mensajes [TEST] a un perfil registrado, sin tocar dispatch_alerts', async () => {
    const auth = { authorization: `Bearer ${process.env.CRON_SECRET}` };
    assert.equal((await call({}, '/api/dispatch?action=test_growth&to=ana@example.com')).status, 401);
    const no = await call(auth, '/api/dispatch?action=test_growth&to=desconocido@otro.com');
    assert.equal(no.status, 400); assert.equal(no.body.error, 'recipient_not_allowed');
    DB.pets = [{ owner_id: 'c-ana', name: 'Luna' }];
    const ok = await call(auth, '/api/dispatch?action=test_growth&to=Ana@Example.com');
    assert.equal(ok.status, 200); assert.equal(ok.body.to, 'an***@example.com');
    assert.deepEqual(ok.body.results.map((x) => [x.kind, x.push, x.email]), [['growth_thanks', 'sent', 'sent'], ['growth_reactivate', 'sent', 'sent']]);
    assert.deepEqual(RESEND.calls.map((c) => c.body.subject.slice(0, 7)), ['[TEST] ', '[TEST] ']);
    assert.match(RESEND.calls[1].body.subject, /Luna te extraña/);
    assert.equal(PUSHES.length, 2); assert.ok(PUSHES.every((x) => x.payload.title.startsWith('[TEST]')));
    assert.notEqual(PUSHES[0].payload.tag, PUSHES[1].payload.tag, 'las dos notificaciones se ven, no se reemplazan');
    assert.equal(DB.dispatch_alerts.length, 0);
  });

  console.log(`\n${passed} pruebas OK`);
})().catch((e) => { console.error('✗ FALLO:', e.stack); process.exit(1); });
