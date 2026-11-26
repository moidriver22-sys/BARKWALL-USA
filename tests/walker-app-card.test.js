// Pruebas: la postulación de identidad del paseador (formulario: nombre legal, teléfono, ZIP, ciudad, tipo de ID,
// vencimiento, fotos y "Enviar postulación") NUNCA se incrusta en la app con sesión (pestaña Walker Pro).
// Solo aparece en el registro/onboarding o en la pantalla de postulación abierta a propósito. Ejecuta: npm test
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'walker-application.js'), 'utf8').replace(/\r\n/g, '\n');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const body = (name) => { const i = JS.indexOf(name); assert.ok(i > 0, name); return JS.slice(i, JS.indexOf('\n    }\n', i) + 6); };
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('✓', name); };

t('Walker Pro (render): nunca dibuja el formulario; solo un aviso breve o nada', () => {
  const r = body('async function render(containerId)');
  assert.ok(!/formHtml\(|wireForm\(/.test(r), 'render() no debe incrustar el formulario');
  assert.match(r, /box\.hidden = true; box\.innerHTML = '';/, 'empieza oculto y vacío');
  assert.match(r, /u\.is_admin/, 'los admins no ven la tarjeta');
  assert.match(r, /if \(!html\) return; \/\/ aprobada y vigente/, 'aprobado y vigente: no se muestra nada');
  assert.match(r, /onclick = \(\) => openApplication\(\)/, 'renovar abre la pantalla de postulación a propósito');
});
t('pantalla de postulación explícita: fuera de las pestañas, con "Volver a la app"', () => {
  const o = body('async function openApplication()');
  assert.match(o, /app\.classList\.add\('hidden'\)/); assert.match(o, /view\.classList\.remove\('hidden'\)/);
  const s = body('async function renderApplicationScreen()');
  assert.match(s, /formHtml\(/); assert.match(s, /data-wa-back/); assert.match(s, /wireForm\(root, async \(\) => closeApplication\(\)\)/);
  const c = body('function closeApplication()');
  assert.match(c, /view\.classList\.add\('hidden'\)/); assert.match(c, /app\.classList\.remove\('hidden'\)/);
  assert.match(JS, /if \(APP\.open\) return renderApplicationScreen\(\);/, 'cambiar idioma no muestra la bienvenida de aprobado');
  assert.match(JS, /function stop\(\) \{ APP\.open = false;/, 'al cerrar sesión se olvida la pantalla abierta');
});
t('el onboarding del registro (antes de la aprobación) sigue mostrando el formulario', () => {
  const r = body('async function renderOnboarding(rootId)');
  assert.match(r, /st\.mode === 'form'/); assert.match(r, /formHtml\(st, g\.reviews\)/);
});
t('módulo carga en el navegador y expone openApplication; index.html usa la versión nueva', () => {
  const ctx = { self: {} }; vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'walker-application.js'), 'utf8'), ctx);
  assert.equal(typeof ctx.self.BWWalkerApp.openApplication, 'function');
  assert.match(HTML, /<script src="\/walker-application\.js\?v=20261212" defer><\/script>/);
  assert.match(HTML, /<section id="walkerApplicationCard" class="w-card" hidden><\/section>/);
});
console.log(`\n${n} pruebas OK`);
