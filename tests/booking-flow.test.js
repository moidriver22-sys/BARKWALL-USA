// Pruebas del flujo de reserva por pasos (booking-flow.js + #bookingModal en index.html). Ejecuta: npm test
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const F = require(path.join(ROOT, 'booking-flow.js'));
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const NOW = Date.parse('2026-11-24T15:00:00Z');
const COMPLETO = { petsCount: 1, serviceId: 'walk_std', variantLabel: '15 min', days: 1, time: '10:00', firstStartMs: NOW + 3600e3, now: NOW, address: '1800 Oxmoor Rd, Homewood, AL', liability: true };
const con = (cambios) => ({ ...COMPLETO, ...cambios });

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('✓', name); };

(async () => {
  // ---------- Validación por paso ----------
  await t('4 pasos en orden: Mascotas → Servicio → Cuándo → Revisar', async () => {
    assert.deepEqual(F.STEPS.map((s) => s.id), ['pets', 'service', 'when', 'review']);
    for (const s of F.STEPS) assert.ok(s.es && s.en && s.icon);
  });
  await t('cada paso valida lo suyo (mascota, servicio, día/hora/dirección, exención)', async () => {
    assert.deepEqual(F.validateStep(0, con({ petsCount: 0 })), { ok: false, code: 'no_pets' });
    assert.deepEqual(F.validateStep(1, con({ variantLabel: '' })), { ok: false, code: 'no_service' });
    assert.deepEqual(F.validateStep(2, con({ days: 0 })), { ok: false, code: 'no_days' });
    assert.deepEqual(F.validateStep(2, con({ time: '' })), { ok: false, code: 'no_time' });
    assert.deepEqual(F.validateStep(2, con({ firstStartMs: NOW - 60e3 })), { ok: false, code: 'past_time' });
    assert.deepEqual(F.validateStep(2, con({ address: '   ' })), { ok: false, code: 'no_address' });
    assert.deepEqual(F.validateStep(3, con({ liability: false })), { ok: false, code: 'liability' });
    for (let i = 0; i < 4; i++) assert.equal(F.validateStep(i, COMPLETO).ok, true);
  });
  await t('mensajes claros y bilingües para cada error', async () => {
    for (const code of Object.keys(F.MSG)) {
      assert.ok(F.message(code, 'es').length > 10 && F.message(code, 'en').length > 10, code);
      assert.notEqual(F.message(code, 'es'), F.message(code, 'en'));
    }
    assert.match(F.message('past_time', 'es'), /ya pasó/); assert.match(F.message('no_address', 'en'), /pickup address/);
  });

  // ---------- Navegación ----------
  await t('Continuar avanza solo si el paso está completo; si no, se queda y muestra el error', async () => {
    let datos = con({ petsCount: 0 });
    const cambios = [];
    const flow = F.createFlow(() => datos, (st) => cambios.push(st));
    assert.equal(flow.next().step, 0); assert.equal(flow.state.error, 'no_pets');
    datos = COMPLETO;
    const st = flow.next();
    assert.equal(st.step, 1); assert.equal(st.error, null); assert.equal(st.dir, 'forward');
    assert.ok(cambios.length >= 2, 'avisa a la pantalla en cada cambio');
  });
  await t('Atrás conserva todo lo elegido y marca la dirección de la animación', async () => {
    const datos = { ...COMPLETO };
    const flow = F.createFlow(() => datos);
    flow.next(); flow.next();
    const st = flow.back();
    assert.equal(st.step, 1); assert.equal(st.dir, 'back');
    assert.deepEqual(datos, COMPLETO, 'no se modifica ninguna elección');
    flow.back(); assert.equal(flow.back().step, 0, 'no baja de 0');
  });
  await t('indicador: se puede volver a un paso anterior; saltar adelante lleva al primer paso incompleto', async () => {
    let datos = con({ address: '' });
    const flow = F.createFlow(() => datos);
    const st = flow.goTo(3);
    assert.equal(st.step, 2, 'falta la dirección (paso 3)'); assert.equal(st.error, 'no_address');
    assert.equal(flow.goTo(0).step, 0);
    datos = COMPLETO;
    assert.equal(flow.goTo(3).step, 3); assert.equal(flow.state.error, null);
  });
  await t('estados del indicador: hecho ✓ / activo / pendiente / con error', async () => {
    assert.deepEqual([0, 1, 2, 3].map((i) => F.stepStatus(i, 2, COMPLETO)), ['done', 'done', 'active', 'pending']);
    assert.equal(F.stepStatus(0, 2, con({ petsCount: 0 })), 'error');
  });
  await t('pagar: si algo falta (p. ej. la exención), no cobra y lleva a ese paso sin alert()', async () => {
    let datos = con({ liability: false });
    const flow = F.createFlow(() => datos);
    flow.goTo(3);
    assert.equal(flow.checkout(), false); assert.equal(flow.state.error, 'liability'); assert.equal(flow.state.step, 3);
    datos = con({ days: 0 });
    assert.equal(flow.checkout(), false); assert.equal(flow.state.step, 2, 'vuelve al paso de los días');
    datos = COMPLETO;
    assert.equal(flow.checkout(), true);
  });

  // ---------- Cancelar amable ----------
  await t('Cancelar: abre la confirmación sin perder nada; "Seguir con mi reserva" vuelve al mismo paso', async () => {
    const datos = { ...COMPLETO };
    const flow = F.createFlow(() => datos);
    flow.next(); flow.next(); flow.next();
    assert.equal(flow.requestCancel().cancelOpen, true);
    const st = flow.keepBooking();
    assert.equal(st.cancelOpen, false); assert.equal(st.step, 3, 'mismo paso'); assert.equal(st.cancelled, false);
    assert.deepEqual(datos, COMPLETO, 'lo elegido sigue intacto');
  });
  await t('Cancelar: solo al confirmar se cancela y el flujo vuelve al inicio', async () => {
    const flow = F.createFlow(() => COMPLETO);
    flow.next(); flow.requestCancel();
    const st = flow.confirmCancel();
    assert.equal(st.cancelled, true); assert.equal(st.cancelOpen, false); assert.equal(st.step, 0);
    assert.equal(flow.reset().cancelled, false);
  });
  await t('cerrar con la X pregunta antes solo si ya hay algo elegido', async () => {
    assert.equal(F.hasProgress({}), false);
    assert.equal(F.hasProgress({ days: 1 }), true);
    assert.equal(F.hasProgress({ address: 'x' }), true);
    assert.equal(F.hasProgress({ touched: true }), true);
  });

  // ---------- Resumen en vivo ----------
  await t('resumen en vivo: fichas de mascotas, servicio, días, hora y total', async () => {
    const chips = F.summaryChips({ petNames: ['Luna', 'Toby'], serviceName: 'Paseo Estándar', serviceIcon: '🚶', duration: '15 min', days: 2, time: '10:00', total: 48 }, 'es');
    assert.deepEqual(chips.map((c) => [c.k, c.text]), [['pets', 'Luna + Toby'], ['service', 'Paseo Estándar · 15 min'], ['days', '2 días'], ['time', '10:00'], ['total', '$48.00']]);
    assert.equal(F.summaryChips({ days: 1 }, 'en')[0].text, '1 day');
  });

  // ---------- Pantalla (index.html) ----------
  await t('el modal tiene los 4 pasos y cada bloque está en su paso (mismos ids de siempre)', async () => {
    const ini = HTML.indexOf('<div id="bookingModal"'); const fin = HTML.indexOf('<!-- MODAL 1:', ini);
    const modal = HTML.slice(ini, fin);
    const pasoDe = (id) => { const at = modal.indexOf(`id="${id}"`); assert.ok(at > 0, id); const sec = modal.lastIndexOf('data-step="', at); return Number(modal.slice(sec + 11, sec + 12)); };
    assert.equal(pasoDe('bookingPetsList'), 0);
    assert.equal(pasoDe('serviceCatalog'), 1); assert.equal(pasoDe('groomingAddons'), 1); assert.equal(pasoDe('chkLargeDog'), 1);
    assert.equal(pasoDe('bookingDayStrip'), 2); assert.equal(pasoDe('inputBookingTime'), 2); assert.equal(pasoDe('inputPickupAddress'), 2); assert.equal(pasoDe('hpBooking'), 2);
    assert.equal(pasoDe('bkReview'), 3); assert.equal(pasoDe('lblTotalPrice'), 3); assert.equal(pasoDe('liabilityBox'), 3);
    assert.equal(pasoDe('stripeCardElement'), 3); assert.equal(pasoDe('expressCheckoutElement'), 3); assert.equal(pasoDe('btnConfirmBooking'), 3);
    for (const id of ['bkStepper', 'bkLive', 'bkNavBar', 'bkNext', 'bkBack', 'bkStepError', 'bkCancelLink', 'bkCancel', 'bkKeep', 'bkConfirmCancel']) assert.ok(modal.includes(`id="${id}"`), id);
    assert.equal((modal.match(/data-goto="/g) || []).length, 4);
  });
  await t('protecciones intactas: aviso antifuga junto a la exención, honeypot, Turnstile y pago por el flujo', async () => {
    const safety = fs.readFileSync(path.join(ROOT, 'bw-safety.js'), 'utf8');
    assert.match(safety, /ensureNote\(document\.getElementById\('liabilityBox'\), 'beforebegin', 'bwLeakBooking'/);
    assert.match(HTML, /id="hpBooking" name="website"/); assert.match(HTML, /BWSafety\.getHumanToken\('booking'\)/);
    assert.match(HTML, /onclick="window\.BWBookingFlow \? BWBookingFlow\.confirm\(\) : confirmBooking\(\)"/);
    assert.match(HTML, /onclick="window\.BWBookingFlow \? BWBookingFlow\.requestClose\(\) : closeBookingModal\(\)"/);
    assert.match(HTML, /if \(window\.BWBookingFlow\) BWBookingFlow\.open\(\);/); assert.match(HTML, /if \(window\.BWBookingFlow\) BWBookingFlow\.refresh\(\);/);
    assert.match(HTML, /<script src="\/booking-flow\.js\?v=\d+" defer><\/script>/);
  });
  await t('sin el script, el formulario se ve completo como antes (pasos y navegación ocultos por defecto)', async () => {
    assert.match(HTML, /<nav id="bkStepper" class="bk-stepper"[^>]* hidden>/);
    assert.match(HTML, /<div id="bkNavBar" class="bk-navbar" hidden>/);
    assert.ok(!/<section class="bk-step"[^>]*hidden/.test(HTML), 'las secciones no están ocultas en el HTML');
  });
  await t('animaciones suaves y respeto a prefers-reduced-motion', async () => {
    for (const k of ['bkInR', 'bkInL', 'bkUp', 'bkPopIn', 'bkWave']) assert.match(F.CSS, new RegExp(`@keyframes ${k}`));
    const rm = F.CSS.slice(F.CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    assert.ok(rm.length > 100, 'hay bloque de movimiento reducido');
    for (const cls of ['.bk-in-forward', '.bk-in-back', '.bk-rv-item', '.bk-cancel-in', '.bk-chip-pop']) assert.ok(rm.includes(cls), cls);
    assert.match(rm, /animation:none!important/); assert.match(rm, /transition:none!important/);
  });
  await t('booking-flow.js funciona igual cargado en el navegador (window.BWBookingFlow)', async () => {
    const ctx = { self: {} };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'booking-flow.js'), 'utf8'), ctx);
    const B = ctx.self.BWBookingFlow;
    assert.equal(typeof B.open, 'function'); assert.equal(typeof B.confirm, 'function'); assert.equal(typeof B.requestClose, 'function');
    assert.equal(B.validateStep(0, { petsCount: 1 }).ok, true);
  });

  console.log(`\n${passed} pruebas OK`);
})().catch((e) => { console.error('✗ FALLO:', e.stack); process.exit(1); });
