// Pruebas: foto obligatoria de entrega segura (delivery-photo.js + index.html + migración 20261205) y
// rastreo GPS continuo sin modo ahorro. Ejecuta: npm test
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const HTML = read('index.html');
const SQL = read('supabase/migrations/20261205_delivery_photo.sql');
const D = require(path.join(ROOT, 'delivery-photo.js'));
const W = 'a1b2c3d4-0000-4000-8000-000000000001';
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('✓', name); };
const fnBody = (name) => { const i = HTML.indexOf(name); assert.ok(i > 0, name); return HTML.slice(i, HTML.indexOf('\n  }\n', i) + 4); };

// ---------- 1. Foto de entrega segura ----------
t('módulo: ruta única dentro de la carpeta del paseo; instrucciones del cliente; qué perros no tienen foto', () => {
  const p1 = D.buildPath(W, 1), p2 = D.buildPath(W, 1);
  assert.ok(p1.startsWith(`${W}/`) && p1.endsWith('.jpg') && p1 !== p2, 'nunca sobrescribe');
  assert.deepEqual(D.instructions({ method: 'lockbox', homeNotes: 'Déjalo en el patio cerrado', bookingNotes: 'Tiene miedo a la puerta' }, 'es'),
    ['Acceso: Caja de llaves', 'Indicaciones del hogar: Déjalo en el patio cerrado', 'Notas de la reserva: Tiene miedo a la puerta']);
  assert.match(D.instructions({}, 'es')[0], /no dejó indicaciones/);
  assert.match(D.instructions({ locked: true }, 'en')[0], /1 hour before/);
  assert.deepEqual(D.missingPhotos([{ id: 'a', deliveryPhoto: 'x' }, { id: 'b' }]), ['b']);
  assert.match(D.friendlyError('ERROR: Falta la foto de entrega segura…', 'es'), /Toma la foto de entrega segura/);
  assert.equal(D.friendlyError('otro error'), 'otro error');
  const ctx = { self: {} }; vm.runInNewContext(read('delivery-photo.js'), ctx); assert.equal(typeof ctx.self.BWDeliveryPhoto.upload, 'function');
});
t('pantalla del paseo: instrucciones de entrega del cliente + paso "Tomar foto de entrega segura" antes de "Completar paseo"', () => {
  const sheet = fnBody('function openFinishSheet(ids)');
  assert.match(sheet, /data-delivery-instr=/); assert.match(sheet, /Tomar foto de entrega segura/); assert.match(sheet, /capture="environment"/);
  assert.match(sheet, /obligatoria/); assert.match(sheet, /Completar paseo/);
  assert.match(sheet, /updateFinishButton\(\);\s*dogs\.forEach\(d => fillDeliveryInstructions\(d\)\)/);
  const upd = fnBody('function updateFinishButton()');
  assert.match(upd, /btn\.disabled = faltan\.length > 0/, 'el botón se habilita solo con todas las fotos');
  assert.match(fnBody('async function fillDeliveryInstructions(d)'), /get_home_access_for_walk/);
  assert.match(fnBody('async function takeDeliveryPhoto(id, input)'), /d\.deliveryPhoto = r\.path;[\s\S]*updateFinishButton\(\)/);
  assert.match(HTML, /<script src="\/delivery-photo\.js\?v=\d+" defer><\/script>/);
  assert.match(HTML, /Notas especiales y lugar de entrega segura/, 'el cliente sabe dónde indicar el lugar de entrega');
});
t('completar: sin foto no se intenta; el error de la base se traduce; el cliente recibe aviso y ve la foto en el reporte', () => {
  const fin = fnBody('async function finishDogs(reports)');
  const chk = fin.indexOf('if (!d.deliveryPhoto)'), set = fin.indexOf("setWalkStatus(d.row.id, 'completed')");
  assert.ok(chk > 0 && chk < set, 'se comprueba la foto antes de pedir el cambio de estado');
  assert.match(fin, /BWDeliveryPhoto\.friendlyError\(r2\.error\.message/);
  assert.match(fin, /📸 \$\{tr\('Entrega segura/);
  assert.match(HTML, /<div id="reportDeliveryPhoto"[^>]*hidden><\/div>/);
  assert.match(HTML, /if \(fresh\) \{ renderReportView\(fresh, false\); showReportDeliveryPhoto\(fresh\.walkId\); \}/);
  assert.match(read('delivery-photo.js'), /createSignedUrl\(`\$\{walkId\}\/\$\{data\[0\]\.name\}`, SIGNED_URL_SECONDS\)/);
  assert.ok(!/getPublicUrl/.test(read('delivery-photo.js')), 'nunca URL pública');
});
t('base: bucket PRIVADO; sube solo el paseador asignado con el paseo en curso; ven cliente, paseador y admin; sin borrar', () => {
  assert.match(SQL, /values \('delivery-photos', 'delivery-photos', false, 5242880/);
  const ins = SQL.slice(SQL.indexOf('"delivery-photos: assigned walker uploads during walk"'), SQL.indexOf('"delivery-photos: participants or admin read"'));
  assert.match(ins, /public\.bw_is_assigned_walker\(\(storage\.foldername\(name\)\)\[1\]\)/); assert.match(ins, /r\.status = 'in_progress'/);
  assert.match(SQL, /public\.bw_is_walk_participant\(\(storage\.foldername\(name\)\)\[1\]\) or public\.bw_is_admin\(\)/);
  assert.ok(!/on storage\.objects for (update|delete)/i.test(SQL));
});
t('base: trigger NUEVO rechaza completar sin foto subida después de iniciar (sin tocar triggers ni políticas existentes)', () => {
  assert.match(SQL, /create trigger bw_walk_requests_delivery_photo\s+before update of status on public\.walk_requests/);
  assert.match(SQL, /new\.status = 'completed' and coalesce\(old\.status, 'pending'\) <> 'completed'/);
  assert.match(SQL, /not private\.bw_has_delivery_photo\(new\.id, old\.started_at\)/);
  assert.match(SQL, /o\.created_at >= coalesce\(p_since, '-infinity'::timestamptz\)/);
  assert.match(SQL, /raise exception 'Falta la foto de entrega segura/);
  for (const prev of ['bw_walk_requests_guard', 'bw_walk_requests_cancel_log', 'bw_walk_requests_no_client_price', 'bw_walk_requests_sync_duration']) assert.ok(!SQL.includes(prev), prev);
  assert.ok(!/create policy[^;]*on public\./i.test(SQL), 'ninguna política de tablas');
});

// ---------- 2. GPS continuo ----------
t('GPS: no queda ningún modo de ahorro de energía ni interruptor de frecuencia', () => {
  for (const x of ['trackInterval', 'trackContinuous', 'setTrackingMode', 'getTrackingMode', 'applyTrackingUI', 'TRACK_INTERVAL_MS', 'gpsIntervalId', 'Saver · 60 s', 'Ahorro · 60 s', "'interval'"]) {
    assert.ok(!HTML.includes(x), x);
  }
  assert.match(HTML, /localStorage\.removeItem\('barkwalk_tracking_mode'\)/, 'se borra la preferencia antigua');
});
t('GPS: alta precisión sin caché, envío continuo y latido aunque el paseador esté quieto', () => {
  assert.match(HTML, /const GPS_OPTIONS = \{ enableHighAccuracy: true, maximumAge: 0, timeout: 15000 \};/);
  const start = fnBody('function startLocationSharing()');
  assert.match(start, /navigator\.geolocation\.watchPosition\(handleWalkerPosition, onGeoError, GPS_OPTIONS\)/);
  assert.match(start, /queueLocation\(lastWalkerPos\.lat, lastWalkerPos\.lng\)/, 'latido');
  assert.match(start, /getCurrentPosition\(handleWalkerPosition, onGeoError, GPS_OPTIONS\)/, 'reintento si se detiene');
  assert.match(HTML, /const GPS_SEND_INTERVAL_MS = 3000;/); assert.match(HTML, /const GPS_HEARTBEAT_MS = 10000;/);
  assert.match(fnBody('function stopLocationSharing()'), /clearInterval\(gpsHeartbeatId\)/);
});
t('GPS: alerta visible si se pierde la señal o el permiso durante un paseo activo, y desaparece al recuperarla', () => {
  assert.match(fnBody('function onGeoError(err)'), /if \(walkIsActive\(\) && \(err\.code === 1 \|\| err\.code === 2\)\) showGpsAlert/);
  assert.match(fnBody('function startLocationSharing()'), /if \(Date\.now\(\) - lastFixAt > GPS_STALL_MS\) \{\s*showGpsAlert\('lost'\)/);
  assert.match(fnBody('function startLocationSharing()'), /p\.state === 'denied' && walkIsActive\(\)\) showGpsAlert\('denied'\)/);
  const alerta = fnBody('function showGpsAlert(kind)');
  assert.match(alerta, /role', 'alert'/); assert.match(alerta, /Permiso de ubicación desactivado/); assert.match(alerta, /Se perdió la señal GPS/); assert.match(alerta, /retryGps\(\)/);
  assert.match(fnBody('function handleWalkerPosition(pos)'), /lastFixAt = Date\.now\(\);\s*hideGpsAlert\(\);/);
});
t('sigue el límite de 12 funciones en api/', () => {
  assert.equal(fs.readdirSync(path.join(ROOT, 'api')).filter((f) => f.endsWith('.js')).length, 12);
});
console.log(`\n${n} pruebas OK`);
