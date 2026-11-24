// Pruebas de la PANTALLA del flujo de reserva (booking-flow.js) con un DOM simulado mínimo, sin navegador.
// Recorre el flujo completo como un usuario y comprueba que no hay bucles de redibujado. Ejecuta: npm test
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'booking-flow.js'), 'utf8');

function el(id, tag = 'div', extra = {}) {
  const listeners = {};
  const classes = new Set(extra.classes || []);
  const e = {
    id, tagName: tag.toUpperCase(), hidden: !!extra.hidden, dataset: { ...(extra.dataset || {}) }, value: extra.value || '', checked: !!extra.checked,
    textContent: '', _html: '', offsetWidth: 1, style: {}, attrs: {},
    classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), toggle: (c, on) => { (on === undefined ? !classes.has(c) : on) ? classes.add(c) : classes.delete(c); }, contains: (c) => classes.has(c) },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
    setAttribute(k, v) { this.attrs[k] = v; }, querySelector: () => null, closest: () => null, focus() {}, scrollTo() {},
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); }, _fire(t, ev = {}) { (listeners[t] || []).forEach((f) => f({ target: e, preventDefault() {}, ...ev })); },
    _classes: classes,
  };
  return e;
}
const E = {};
const add = (e) => (E[e.id] = e);
add(el('bookingModal')); add(el('bkStepper', 'nav', { hidden: true })); add(el('bkNavBar', 'div', { hidden: true }));
add(el('bkLive')); add(el('bkReview')); add(el('bkStepError', 'p')); add(el('bkBack', 'button', { hidden: true })); add(el('bkNext', 'button'));
add(el('bkCancelLink', 'button')); add(el('bkCancel', 'div', { hidden: true })); add(el('bkKeep', 'button')); add(el('bkConfirmCancel', 'button'));
add(el('bkCancelTitle', 'h4')); add(el('bkCancelSummary')); add(el('bkCancelText', 'p')); add(el('bkProgressBar', 'span'));
add(el('inputBookingTime', 'input', { value: '10:00' })); add(el('inputPickupAddress', 'input', { value: '' })); add(el('chkLiability', 'input'));
add(el('chkLargeDog', 'input'));
const steps = [0, 1, 2, 3].map((i) => el('step' + i, 'section', { dataset: { step: String(i) }, classes: ['bk-step'] }));
const titles = [0, 1, 2, 3].map((i) => el('t' + i, 'h4', { dataset: { title: String(i) } }));
const dots = [0, 1, 2, 3].map((i) => { const b = el('d' + i, 'button', { dataset: { goto: String(i) } }); b.querySelector = () => null; return b; });
E.bookingModal.querySelector = () => ({ scrollTo() {} });

const doc = {
  getElementById: (id) => E[id] || null,
  querySelectorAll: (sel) => sel.includes('.bk-step-title') ? titles : sel.includes('.bk-step') ? steps : sel.includes('data-goto') ? dots : [],
  addEventListener() {}, createElement: () => el('x'), head: { appendChild() {} },
};
let renders = 0, toasts = [], resets = 0;
const win = {
  document: doc, matchMedia: () => ({ matches: false }),
  getBookingSummary: () => { renders++; if (renders > 5000) throw new Error('BUCLE: demasiados renders'); return { pets: [{ name: 'Luna' }], serviceName: 'Paseo Estándar', serviceLabel: '🚶 Paseo Estándar', duration: '15 min', days: 1, dates: ['2099-01-01'], perDay: 16, grandTotal: 16, lines: [] }; },
  birminghamToUtcIso: () => '2099-01-01T16:00:00Z', fmtBookingDate: (d) => d,
  resetBookingAfterSuccess: () => { resets++; }, renderCatalog: () => {}, confirmBooking: () => 'PAGO', showToast: (m) => toasts.push(m),
};
win.window = win;
const ctx = { window: win, document: doc, self: undefined, setTimeout: (f) => f(), console };
ctx.self = win;
vm.runInNewContext(src, ctx);
const B = win.BWBookingFlow;

const visible = () => steps.map((s) => (s.hidden ? '·' : 'X')).join('');
let n = 0; const ok = (name) => { n++; console.log('✓', name); };
B.open();
assert.equal(visible(), 'X···'); assert.equal(E.bkStepper.hidden, false); assert.equal(E.bkNavBar.hidden, false);
assert.match(E.bkLive.innerHTML, /Luna/); assert.match(E.bkLive.innerHTML, /15 min/); assert.match(E.bkLive.innerHTML, /\$16\.00/);
assert.match(titles[0].innerHTML, /Paso 1 de 4/); assert.match(titles[0].innerHTML, /bk-st-name">Mascotas/); assert.match(titles[0].innerHTML, /Quién sale a pasear/);
assert.ok(E.bkLive.attrs['data-empty'], 'texto para el resumen vacío');
ok('encabezado de cada paso: "Paso X de 4", nombre y subtítulo');
ok('al abrir: solo el paso 1, indicador y navegación visibles, resumen en vivo con mascota, duración y total');
E.bkNext._fire('click');
assert.equal(visible(), '·X··'); assert.deepEqual(dots.map((d) => d.dataset.status), ['done', 'active', 'pending', 'pending']);
assert.ok(steps[1]._classes.has('bk-in-forward'), 'animación hacia adelante');
ok('Continuar: pasa al paso 2 con animación y marca el 1 como hecho');
E.bkNext._fire('click'); E.bkNext._fire('click');
assert.equal(visible(), '··X·'); assert.match(E.bkStepError.textContent, /dirección de recogida/);
E.inputPickupAddress.value = '1800 Oxmoor Rd'; E.bookingModal._fire('input', { target: E.inputPickupAddress });
assert.equal(E.bkStepError.textContent, '');
ok('sin dirección no avanza y lo explica; al escribirla el aviso desaparece');
E.bkBack._fire('click'); assert.equal(visible(), '·X··'); assert.ok(steps[1]._classes.has('bk-in-back'), 'animación hacia atrás');
E.bkNext._fire('click'); E.bkNext._fire('click');
assert.equal(visible(), '···X'); assert.equal(E.bkNext.hidden, true); assert.match(E.bkReview.innerHTML, /Revisa tu reserva/); assert.match(E.bkReview.innerHTML, /Total a pagar/);
assert.match(E.bkReview.innerHTML, /data-edit="2"/);
ok('Atrás anima hacia atrás; el paso 4 muestra la revisión final con "Cambiar" en cada dato');
assert.equal(B.confirm(), false); assert.match(E.bkStepError.textContent, /Exención/);
E.chkLiability.checked = true; assert.equal(B.confirm(), 'PAGO');
ok('pagar: sin la exención no cobra (aviso en pantalla, sin alert); con todo listo llama al cobro de siempre');
E.bkCancelLink._fire('click'); assert.equal(E.bkCancel.hidden, false);
assert.match(E.bkCancelSummary.innerHTML, /Lo que tienes elegido/); assert.match(E.bkCancelSummary.innerHTML, /Luna · Paseo Estándar · 15 min · 1 día/);
assert.match(E.bkReview.innerHTML, /Pago seguro con Stripe/); assert.match(E.bkReview.innerHTML, /<b>\$16\.00<\/b>/, 'el total lleva el símbolo $'); assert.match(E.bkCancelTitle.textContent, /cancelar tu reserva/);
E.bkKeep._fire('click'); assert.equal(E.bkCancel.hidden, true); assert.equal(visible(), '···X'); assert.equal(resets, 0);
ok('Cancelar abre la confirmación; "Seguir con mi reserva" vuelve al mismo paso sin borrar nada');
E.bkCancelLink._fire('click'); E.bkConfirmCancel._fire('click');
assert.ok(E.bookingModal._classes.has('hidden')); assert.equal(resets, 1); assert.equal(visible(), 'X···'); assert.match(toasts[0], /No se hizo ningún cargo/);
ok('confirmar cancelación: despedida amable, se borra la selección, se cierra y la próxima vez empieza en el paso 1');
assert.ok(renders < 100, 'sin bucles de redibujado (' + renders + ')');
ok('sin bucles de redibujado (' + renders + ' lecturas en todo el recorrido)');
console.log(`\n${n} pruebas OK`);
