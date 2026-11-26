// Pruebas del selector Mes / Día / Año (date-select.js): al cambiar el año se conservan mes y día; si la fecha
// no existe (29-feb en año no bisiesto, 31 en mes de 30 días) se ajusta al último día válido. Ejecuta: npm test
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const DS = require(path.join(ROOT, 'date-select.js'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('✓', name); };

t('días por mes y bisiestos (incluye 1900 y 2000)', () => {
  assert.equal(DS.daysInMonth(2024, 2), 29); assert.equal(DS.daysInMonth(2023, 2), 28);
  assert.equal(DS.daysInMonth(2000, 2), 29); assert.equal(DS.daysInMonth(1900, 2), 28);
  assert.equal(DS.daysInMonth(2023, 4), 30); assert.equal(DS.daysInMonth(2023, 12), 31);
  assert.equal(DS.daysInMonth(0, 2), 29, 'sin año, febrero admite el 29');
});

t('cambiar el año conserva mes y día', () => {
  assert.deepEqual(DS.withYear({ y: 1990, m: 7, d: 14 }, 1985), { y: 1985, m: 7, d: 14 });
  assert.deepEqual(DS.withYear({ y: 0, m: 3, d: 31 }, 2001), { y: 2001, m: 3, d: 31 });
  assert.deepEqual(DS.withYear({ y: 1990, m: 0, d: 0 }, 1991), { y: 1991, m: 0, d: 0 }, 'sin mes/día no inventa valores');
});

t('29-feb en año no bisiesto → 28-feb (mes y día no se reinician)', () => {
  assert.deepEqual(DS.withYear({ y: 2000, m: 2, d: 29 }, 2001), { y: 2001, m: 2, d: 28 });
  assert.deepEqual(DS.withYear({ y: 0, m: 2, d: 29 }, 1999), { y: 1999, m: 2, d: 28 });
  assert.deepEqual(DS.withYear({ y: 1999, m: 2, d: 28 }, 2004), { y: 2004, m: 2, d: 28 }, 'no "sube" a 29 al volver a bisiesto');
  assert.deepEqual(DS.withYear({ y: 2001, m: 2, d: 29 }, 2004), { y: 2004, m: 2, d: 29 });
  assert.deepEqual(DS.withMonth({ y: 2023, m: 1, d: 31 }, 4), { y: 2023, m: 4, d: 30 }, '31 → 30 al pasar a abril');
  assert.deepEqual(DS.withMonth({ y: 2023, m: 3, d: 31 }, 2), { y: 2023, m: 2, d: 28 });
});

t('toIso / fromIso: solo una fecha completa produce valor', () => {
  assert.equal(DS.toIso({ y: 1990, m: 5, d: 1 }), '1990-05-01');
  assert.equal(DS.toIso({ y: 2023, m: 2, d: 29 }), '2023-02-28');
  assert.equal(DS.toIso({ y: 1990, m: 5, d: 0 }), ''); assert.equal(DS.toIso({ y: 0, m: 5, d: 1 }), '');
  assert.deepEqual(DS.fromIso('1990-05-01'), { y: 1990, m: 5, d: 1 }); assert.deepEqual(DS.fromIso(''), { y: 0, m: 0, d: 0 });
});

t('rango exacto (puro): meses/días permitidos y ajuste al límite más cercano sin vaciar nada', () => {
  const min = DS.bound('2026-12-24'), max = DS.bound('2027-11-27');
  assert.equal(DS.bound(''), null); assert.equal(DS.bound(null), null);
  assert.deepEqual(DS.monthRange(2026, min, max), [12, 12]); assert.deepEqual(DS.monthRange(2027, min, max), [1, 11]);
  assert.deepEqual(DS.monthRange(0, min, max), [1, 12], 'sin año: todos los meses');
  assert.deepEqual(DS.dayRange(2026, 12, min, max), [24, 31]); assert.deepEqual(DS.dayRange(2027, 11, min, max), [1, 27]);
  assert.deepEqual(DS.dayRange(2027, 2, min, max), [1, 28]); assert.deepEqual(DS.dayRange(2027, 0, min, max), [1, 31]);
  assert.deepEqual(DS.clampToRange({ y: 2026, m: 3, d: 10 }, min, max), { y: 2026, m: 12, d: 24 }, 'antes del mínimo → mínimo');
  assert.deepEqual(DS.clampToRange({ y: 2026, m: 12, d: 30 }, min, max), { y: 2026, m: 12, d: 30 }, 'dentro: no cambia');
  assert.deepEqual(DS.clampToRange({ y: 2027, m: 12, d: 15 }, min, max), { y: 2027, m: 11, d: 15 }, 'mes después del máximo → mes máximo, día se conserva');
  assert.deepEqual(DS.clampToRange({ y: 2027, m: 12, d: 31 }, min, max), { y: 2027, m: 11, d: 27 }, 'y el día al máximo');
  assert.deepEqual(DS.clampToRange({ y: 2027, m: 3, d: 0 }, min, max), { y: 2027, m: 3, d: 0 }, 'sin día no inventa uno');
  assert.deepEqual(DS.clampToRange({ y: 2030, m: 5, d: 5 }, min, max), { y: 2030, m: 5, d: 5 }, 'año guardado fuera de la lista: no se toca');
  assert.deepEqual(DS.clampToRange({ y: 2027, m: 2, d: 29 }, null, null), { y: 2027, m: 2, d: 28 }, 'sin rango: solo el ajuste de febrero');
  // Nacimiento (registro): max = cumpleaños 19 → el día exacto del límite sí, el siguiente no
  const dmax = DS.bound('2007-11-26');
  assert.deepEqual(DS.dayRange(2007, 11, null, dmax), [1, 26]); assert.deepEqual(DS.monthRange(2007, null, dmax), [1, 11]);
  assert.deepEqual(DS.clampToRange({ y: 2007, m: 12, d: 3 }, null, dmax), { y: 2007, m: 11, d: 3 });
});

// ---------- Control montado sobre un DOM mínimo simulado ----------
function fakeDom() {
  const byId = {};
  const mkEl = (tag) => {
    const el = { tagName: tag.toUpperCase(), attrs: {}, listeners: {}, children: [], value: '', className: '', innerHTML: '', id: '',
      setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'for') this.htmlFor = String(v); },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
      dispatchEvent(e) { (this.listeners[e.type] || []).forEach((fn) => fn(e)); return true; },
      appendChild(c) { this.children.push(c); if (c.id) byId[c.id] = c; return c; },
      insertAdjacentElement(_, c) { this.after = c; c.children.forEach((k) => { if (k.id) byId[k.id] = k; }); return c; },
      focus() { doc.focused = this; } };
    return el;
  };
  const doc = { head: mkEl('head'), focused: null, createElement: mkEl, getElementById: (id) => byId[id] || null,
    querySelector: (sel) => { const m = /label\[for="([^"]+)"\]/.exec(sel); return m && byId['__label_' + m[1]] || null; } };
  return { doc, mkEl, byId };
}

t('control: cambiar el año en pantalla conserva mes/día y ajusta 29-feb; escribe el mismo input y avisa con eventos', () => {
  const { doc, mkEl, byId } = fakeDom();
  global.document = doc; global.Event = class { constructor(type) { this.type = type; } };
  const input = mkEl('input'); input.id = 'regBirth'; input.type = 'date'; input.ownerDocument = doc; input.setAttribute('max', '2007-11-26'); input.setAttribute('min', '1900-01-01');
  const label = mkEl('label'); label.setAttribute('for', 'regBirth'); byId.__label_regBirth = label;
  let changes = 0; input.addEventListener('change', () => changes++);
  const ui = DS.attach(input, { lang: 'es' });
  assert.equal(input.type, 'hidden', 'el valor sigue en el mismo #regBirth');
  assert.equal(label.htmlFor, 'regBirth_m', 'la etiqueta apunta al selector de mes');
  assert.match(ui.y.innerHTML, /<option value="2007">2007<\/option>/); assert.doesNotMatch(ui.y.innerHTML, /value="2008"/, 'respeta el máximo (19+ años)');
  assert.match(ui.y.innerHTML, /value="1900"/);
  assert.match(ui.m.innerHTML, /Febrero/);
  const pick = (sel, v) => { sel.value = String(v); sel.dispatchEvent(new Event('change')); };
  pick(ui.m, 2); pick(ui.d, 29);
  assert.match(ui.d.innerHTML, /value="29" selected/, 'sin año, el 29 de febrero se puede elegir');
  assert.equal(input.value, '', 'aún falta el año');
  pick(ui.y, 2000);
  assert.equal(input.value, '2000-02-29');
  pick(ui.y, 2001);
  assert.equal(input.value, '2001-02-28', '29-feb → 28-feb al pasar a un año no bisiesto');
  assert.deepEqual(ui.state, { y: 2001, m: 2, d: 28 }, 'mes y día no se reinician');
  assert.match(ui.m.innerHTML, /value="2" selected/); assert.match(ui.d.innerHTML, /value="28" selected/);
  assert.doesNotMatch(ui.d.innerHTML, /value="29"/, 'el día 29 ya no aparece en ese año');
  pick(ui.y, 1995);
  assert.equal(input.value, '1995-02-28', 'cambiar de año otra vez conserva el 28 de febrero');
  assert.ok(changes >= 3, 'dispara change en el input original');
  input.focus(); assert.equal(doc.focused, ui.m, 'el foco de los avisos de error va al selector de mes');
  assert.equal(DS.attach(input, { lang: 'en' }), ui, 'montarlo otra vez no duplica (cambio de idioma)');
  assert.match(ui.m.innerHTML, /February/); assert.match(ui.y.innerHTML, />Year</); assert.equal(input.value, '1995-02-28');
  delete global.document; delete global.Event;
});

t('vencimiento del ID (future): años de hoy hacia adelante, conserva mes/día, 29-feb → 28-feb, sin autocompletar', () => {
  const { doc, mkEl } = fakeDom();
  global.document = doc; global.Event = class { constructor(type) { this.type = type; } };
  const hoy = new Date().getFullYear();
  const input = mkEl('input'); input.id = 'waExpiry'; input.type = 'date'; input.ownerDocument = doc;
  input.setAttribute('min', `${hoy}-01-15`); input.setAttribute('max', `${hoy + 12}-01-10`);
  let changes = 0; input.addEventListener('change', () => changes++);
  const ui = DS.attach(input, { lang: 'en', future: true });
  const years = [...ui.y.innerHTML.matchAll(/value="(\d{4})"/g)].map((m) => +m[1]);
  assert.equal(years[0], hoy, 'empieza en el año actual'); assert.equal(years[years.length - 1], hoy + 12, 'llega al máximo (+12)');
  assert.deepEqual(years, [...years].sort((a, b) => a - b), 'orden ascendente');
  assert.equal(ui.y.getAttribute('autocomplete'), 'off', 'no ofrece la fecha de nacimiento');
  const pick = (sel, v) => { sel.value = String(v); sel.dispatchEvent(new Event('change')); };
  const bisiesto = [...Array(8)].map((_, i) => hoy + 1 + i).find((y) => DS.isLeap(y));
  pick(ui.m, 2); pick(ui.d, 29); pick(ui.y, bisiesto);
  assert.equal(input.value, `${bisiesto}-02-29`);
  pick(ui.y, bisiesto + 1);
  assert.equal(input.value, `${bisiesto + 1}-02-28`, '29-feb → 28-feb'); assert.deepEqual(ui.state, { y: bisiesto + 1, m: 2, d: 28 });
  assert.ok(changes >= 2, 'dispara change: el aviso "tu ID vence en N días" se actualiza');
  // Re-montar (p. ej. cambio de idioma) usa las opciones nuevas también al elegir
  DS.attach(input, { lang: 'es', future: true }); pick(ui.y, bisiesto + 2);
  assert.match(ui.m.innerHTML, /Febrero/, 'los selectores usan el idioma del último montaje'); assert.equal(input.value, `${bisiesto + 2}-02-28`);
  // Nacimiento no cambia: nunca ofrece años futuros
  const dob = mkEl('input'); dob.id = 'dob'; dob.type = 'date'; dob.ownerDocument = doc;
  const u2 = DS.attach(dob, { lang: 'es' });
  assert.doesNotMatch(u2.y.innerHTML, new RegExp(`value="${hoy + 1}"`)); assert.equal(u2.y.getAttribute('autocomplete'), 'bday-year');
  delete global.document; delete global.Event;
});

t('integración: el vencimiento del ID usa el selector (future) sobre el mismo #waExpiry con el máximo del servidor', () => {
  const src = read('walker-application.js');
  assert.match(src, /<input id="waExpiry" type="date" min="\$\{today\(\)\}" max="\$\{maxExpiry\(\)\}" required>/, 'respaldo nativo si no carga el script');
  assert.match(src, /const maxExpiry = \(\) => new Date\(Date\.parse\(`\$\{today\(\)\}T00:00:00Z`\) \+ 365 \* 12 \* 864e5\)/, 'mismo tope que checkIdExpiry (365 × 12 días)');
  const wire = src.slice(src.indexOf('function wireForm'), src.indexOf('async function submit'));
  assert.match(wire, /if \(win\.BWDateSelect\) win\.BWDateSelect\.attach\(\$\('waExpiry'\), \{ win, future: true \}\);/);
  assert.ok(wire.indexOf('BWDateSelect.attach') < wire.indexOf("$('waExpiry').addEventListener('change'"), 'el aviso de vencimiento sigue escuchando el mismo input');
  const html = read('index.html');
  assert.ok(html.indexOf('/date-select.js?v=') < html.indexOf('/walker-application.js?v='), 'se carga antes que walker-application.js');
  // El tope de la app coincide con el del servidor: el último día permitido pasa, el siguiente no
  const ID = require(path.join(ROOT, 'api/_lib/walker-identity.js'));
  const d0 = '2026-11-26', max = new Date(Date.parse(`${d0}T00:00:00Z`) + 365 * 12 * 864e5).toISOString().slice(0, 10);
  const next = new Date(Date.parse(`${max}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
  assert.equal(ID.checkIdExpiry(max, d0).ok, true); assert.equal(ID.checkIdExpiry(next, d0).error, 'invalid_id_expiry');
});

t('fecha de reserva: años solo del rango (hoy+28 … hoy+366), foco y desplazamiento van a los selectores visibles', () => {
  const { doc, mkEl } = fakeDom();
  global.document = doc; global.Event = class { constructor(type) { this.type = type; } };
  const input = mkEl('input'); input.id = 'inputBookingDate'; input.type = 'date'; input.ownerDocument = doc;
  input.setAttribute('aria-describedby', 'bookingDatesHelp');
  input.setAttribute('min', '2026-12-24'); input.setAttribute('max', '2027-11-27'); // lo que fija renderBookingDates()
  const ui = DS.attach(input, { lang: 'es', future: true });
  assert.deepEqual([...ui.y.innerHTML.matchAll(/value="(\d{4})"/g)].map((m) => +m[1]), [2026, 2027], 'solo los años de la reserva');
  assert.equal(ui.wrap.getAttribute('aria-describedby'), 'bookingDatesHelp', 'conserva la ayuda "cada día es un servicio"');
  let scrolled = null; ui.wrap.scrollIntoView = (o) => { scrolled = o; };
  input.scrollIntoView({ block: 'center' }); assert.deepEqual(scrolled, { block: 'center' }, 'el aviso de error desplaza a los selectores');
  input.focus({ preventScroll: true }); assert.equal(doc.focused, ui.m);
  const pick = (sel, v) => { sel.value = String(v); sel.dispatchEvent(new Event('change')); };
  pick(ui.m, 3); pick(ui.d, 31); pick(ui.y, 2027); assert.equal(input.value, '2027-03-31');
  pick(ui.m, 4); assert.equal(input.value, '2027-04-30', '31 → 30 al pasar a abril'); assert.deepEqual(ui.state, { y: 2027, m: 4, d: 30 });
  // renderBookingDates() vuelve a montar en cada cambio (agregar/quitar día, idioma): no duplica ni pierde la fecha
  input.setAttribute('min', '2026-12-25'); assert.equal(DS.attach(input, { lang: 'en', future: true }), ui); assert.equal(input.value, '2027-04-30');
  assert.match(ui.m.innerHTML, /April/);
  delete global.document; delete global.Event;
});

t('control con rango exacto: la reserva solo ofrece meses/días entre hoy+28 y hoy+366; al cambiar año ajusta al límite', () => {
  const { doc, mkEl } = fakeDom();
  global.document = doc; global.Event = class { constructor(type) { this.type = type; } };
  const input = mkEl('input'); input.id = 'inputBookingDate'; input.type = 'date'; input.ownerDocument = doc;
  input.setAttribute('min', '2026-12-24'); input.setAttribute('max', '2027-11-27');
  let changes = 0; input.addEventListener('change', () => changes++);
  const ui = DS.attach(input, { lang: 'es', future: true });
  const vals = (sel) => [...sel.innerHTML.matchAll(/value="(\d+)"/g)].map((m) => +m[1]);
  assert.deepEqual(vals(ui.m), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'sin año: todos los meses');
  const pick = (sel, v) => { sel.value = String(v); sel.dispatchEvent(new Event('change')); };
  pick(ui.y, 2026);
  assert.deepEqual(vals(ui.m), [12], '2026: solo diciembre');
  pick(ui.m, 12);
  assert.deepEqual(vals(ui.d), [24, 25, 26, 27, 28, 29, 30, 31], 'diciembre 2026: desde el 24');
  pick(ui.d, 28); assert.equal(input.value, '2026-12-28');
  pick(ui.y, 2027);
  assert.equal(input.value, '2027-11-27', 'diciembre 2027 no existe en el rango → 27-nov-2027 (el máximo)');
  assert.deepEqual(ui.state, { y: 2027, m: 11, d: 27 });
  assert.deepEqual(vals(ui.m), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]); assert.equal(Math.max(...vals(ui.d)), 27);
  pick(ui.m, 3); assert.equal(input.value, '2027-03-27', 'dentro del rango conserva el día');
  pick(ui.y, 2026); assert.equal(input.value, '2026-12-27', 'volver a 2026 → diciembre, día 27 sigue válido');
  // renderBookingDates mueve el mínimo al día siguiente: la fecha elegida se ajusta y se avisa
  const n0 = changes; input.setAttribute('min', '2026-12-28'); DS.attach(input, { future: true });
  assert.equal(input.value, '2026-12-28'); assert.ok(changes > n0, 'el input avisa del ajuste');
  // Nacimiento sin max: nunca deja elegir un día futuro
  const dob = mkEl('input'); dob.id = 'tgBirth'; dob.type = 'date'; dob.ownerDocument = doc;
  const u2 = DS.attach(dob, { lang: 'es' });
  const t0 = new Date(); pick(u2.y, t0.getFullYear());
  assert.equal(Math.max(...vals(u2.m)), t0.getMonth() + 1, 'este año: solo hasta el mes actual');
  pick(u2.m, t0.getMonth() + 1); assert.equal(Math.max(...vals(u2.d)), t0.getDate(), 'y hasta hoy');
  delete global.document; delete global.Event;
});

t('integración: la reserva monta el selector tras fijar min/max y addBookingDate sigue leyendo el mismo input', () => {
  const html = read('index.html');
  assert.match(html, /<div class="flex flex-wrap items-end gap-2 mt-2">\s*<input type="date" id="inputBookingDate"/, 'respaldo nativo; el botón baja de línea en pantallas angostas');
  const r = html.slice(html.indexOf('function renderBookingDates'), html.indexOf('function initBookingSchedule'));
  assert.ok(r.indexOf('input.max = shiftYmd(hoy, 366)') < r.indexOf('window.BWDateSelect.attach(input, { future: true })'), 'monta después de fijar el rango');
  const add = html.slice(html.indexOf('function addBookingDate'), html.indexOf('function removeBookingDate'));
  assert.match(add, /const d = ymd \|\| \(input && input\.value\)/); assert.match(add, /d < hoy \|\| d > shiftYmd\(hoy, 366\)/, 'el rango lo sigue validando la reserva');
  assert.match(read('date-select.js'), /flex:1 1 230px;min-width:0/, 'ocupa el espacio del input en la fila flex');
});

t('integración: registro y pantalla de Términos usan el selector sobre el mismo input; sin script queda el nativo', () => {
  const html = read('index.html'), tg = read('terms-gate.js');
  assert.match(html, /<input type="date" id="regBirth"/, 'respaldo nativo si no carga el script');
  assert.match(html, /if \(window\.BWDateSelect\) window\.BWDateSelect\.attach\(birth\);/);
  assert.ok(html.indexOf('/date-select.js?v=') < html.indexOf('/terms-gate.js?v='), 'se carga antes de terms-gate.js');
  assert.match(tg, /<input type="date" id="tgBirth" required/);
  assert.match(tg, /if \(state\.needsBirth && win\.BWDateSelect\) win\.BWDateSelect\.attach\(doc\.getElementById\('tgBirth'\), \{ win \}\)/);
  assert.match(tg, /birthDate: state\.needsBirth \? \(\$\('tgBirth'\) \|\| \{\}\)\.value : undefined/, 'el envío lee el mismo valor que antes');
});

console.log(`\n${n} pruebas OK`);
