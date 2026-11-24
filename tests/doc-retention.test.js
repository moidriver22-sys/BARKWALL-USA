// Pruebas de la retención de fotos de identidad (api/_lib/doc-retention.js): rechazada sin operar → borrar a los 90 días.
// Supabase REST y Storage simulados en memoria. Ejecuta: npm test
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
process.env.SUPABASE_URL = 'http://fake.supabase';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
const R = require(path.join(ROOT, 'api/_lib/doc-retention.js'));

const NOW = Date.parse('2026-11-24T12:00:00Z');
const hace = (d) => new Date(NOW - d * 864e5).toISOString();
const app = (walker_id, status, decidedDaysAgo, o = {}) => ({ walker_id, status, submitted_at: hace((decidedDaysAgo || 0) + 1), decided_at: decidedDaysAgo == null ? null : hace(decidedDaysAgo), docs_deleted_at: null, ...o });

let DB, FILES, DELETED;
function reset() { DB = { walker_applications: [], walk_requests: [] }; FILES = {}; DELETED = []; }
const resp = (status, data) => { const s = data == null ? '' : JSON.stringify(data); return { ok: status < 300, status, text: async () => s, json: async () => data }; };
function match(row, k, e) {
  const [op, ...r] = e.split('.'); const v = r.join('.');
  if (op === 'eq') return String(row[k]) === v;
  if (op === 'is') return v === 'null' ? row[k] == null : String(row[k]) === v;
  if (op === 'in') return v.slice(1, -1).split(',').includes(String(row[k]));
  throw new Error('filtro ' + k + '=' + e);
}
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('/storage/v1/object/list/walker-docs')) { const uid = JSON.parse(opts.body).prefix.replace(/\/$/, ''); return resp(200, (FILES[uid] || []).map((n) => ({ name: n, metadata: { size: 1, mimetype: 'image/jpeg' } }))); }
  if (u.endsWith('/storage/v1/object/walker-docs') && opts.method === 'DELETE') { DELETED.push(...JSON.parse(opts.body).prefixes); return resp(200, []); }
  const p = new URL(u); const rows = DB[p.pathname.replace('/rest/v1/', '')]; if (!rows) return resp(404, {});
  const f = [...p.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit'].includes(k));
  const hit = rows.filter((r) => f.every(([k, e]) => match(r, k, e)));
  if ((opts.method || 'GET') === 'GET') return resp(200, hit);
  if (opts.method === 'PATCH') { const b = JSON.parse(opts.body); hit.forEach((r) => Object.assign(r, b)); return resp(200, hit); }
  return resp(405, {});
};

let n = 0;
const t = async (name, fn) => { reset(); await fn(); n++; console.log('✓', name); };

(async () => {
  await t('regla: solo rechazada hace ≥ 90 días, sin operar, sin aprobación previa y sin envío nuevo en revisión', async () => {
    const apps = [
      app('A', 'rejected', 91),                                   // ✔ borrar
      app('B', 'rejected', 30),                                   // aún no pasan 90 días
      app('C', 'rejected', 120),                                  // operó (tiene paseos)
      app('D', 'rejected', 200), app('D', 'approved', 400, { submitted_at: hace(500) }), // fue aprobado alguna vez
      app('E', 'rejected', 150), app('E', 'submitted', null, { submitted_at: hace(5) }), // reenvió: en revisión
      app('F', 'rejected', 100, { docs_deleted_at: hace(5) }),    // ya borradas
      app('G', 'rejected', 90),                                   // justo 90 días
    ];
    assert.deepEqual(R.retentionCandidates(apps, new Set(['C']), NOW).sort(), ['A', 'G']);
    assert.equal(R.RETENTION_DAYS, 90);
  });
  await t('ejecución: borra TODOS los archivos del paseador elegible y marca la fecha; la fila e historial se conservan', async () => {
    DB.walker_applications.push(app('A', 'rejected', 95), app('A', 'superseded', 120, { submitted_at: hace(130) }), app('B', 'rejected', 10));
    FILES.A = ['1-id.jpg', '1-selfie.jpg', '2-id.jpg', '2-selfie.jpg']; FILES.B = ['x.jpg'];
    const r = await R.runDocRetention({ now: NOW });
    assert.deepEqual([r.walkersCleaned, r.filesDeleted, r.failed], [1, 4, 0]);
    assert.deepEqual(DELETED.sort(), ['A/1-id.jpg', 'A/1-selfie.jpg', 'A/2-id.jpg', 'A/2-selfie.jpg']);
    assert.ok(DB.walker_applications.filter((a) => a.walker_id === 'A').every((a) => a.docs_deleted_at), 'todas sus filas marcadas');
    assert.equal(DB.walker_applications.length, 3, 'no se borra ninguna fila');
    assert.ok(DB.walker_applications.filter((a) => a.walker_id === 'B').every((a) => !a.docs_deleted_at), 'B no se toca');
    const r2 = await R.runDocRetention({ now: NOW });
    assert.equal(r2.eligible, 0, 'no repite');
  });
  await t('nunca borra a quien operó como paseador (conservación de 3 años tras cerrar la cuenta)', async () => {
    DB.walker_applications.push(app('C', 'rejected', 300)); DB.walk_requests.push({ id: 'w1', walker_id: 'C' }); FILES.C = ['id.jpg'];
    const r = await R.runDocRetention({ now: NOW });
    assert.equal(r.eligible, 0); assert.equal(DELETED.length, 0);
  });
  await t('modo prueba (dry): informa sin borrar nada', async () => {
    DB.walker_applications.push(app('A', 'rejected', 95)); FILES.A = ['id.jpg'];
    const r = await R.runDocRetention({ now: NOW, dryRun: true });
    assert.equal(r.eligible, 1); assert.equal(DELETED.length, 0); assert.equal(DB.walker_applications[0].docs_deleted_at, null);
  });
  await t('integración: corre en el cron de /api/dispatch, la política lo promete y el panel muestra el borrado', async () => {
    const d = fs.readFileSync(path.join(ROOT, 'api/dispatch.js'), 'utf8');
    assert.match(d, /action'\) === 'doc_retention'/); assert.match(d, /r\.docRetention = await runDocRetention\(\{ dryRun \}\)/);
    assert.match(fs.readFileSync(path.join(ROOT, 'privacidad.html'), 'utf8'), /borramos a los 90 días/);
    assert.match(fs.readFileSync(path.join(ROOT, 'walker-application.js'), 'utf8'), /a\.docs_deleted_at/);
    assert.match(fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261203_doc_retention.sql'), 'utf8'), /add column if not exists docs_deleted_at timestamptz/);
    assert.equal(fs.readdirSync(path.join(ROOT, 'api')).filter((f) => f.endsWith('.js')).length, 12);
  });
  console.log(`\n${n} pruebas OK`);
})().catch((e) => { console.error('✗ FALLO:', e.stack); process.exit(1); });
