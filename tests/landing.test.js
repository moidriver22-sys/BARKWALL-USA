// Pruebas de la portada pública (index.html #welcomeView): con sesión desaparece por completo, el modal de
// inicio de sesión se cierra con Escape / clic en el fondo y la burbuja de Barky no tapa los botones en móvil.
// Ejecuta: npm test
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('✓', name); };

t('con sesión la portada se oculta: #welcomeView.hidden gana a display:flex del id', () => {
  assert.match(HTML, /#welcomeView\.hidden \{ display: none !important; \}/);
  assert.match(HTML, /document\.getElementById\('welcomeView'\)\.classList\.add\('hidden'\)/, 'el panel oculta la portada al entrar');
});
t('enlace mágico (#access_token): no se enseña la portada mientras se crea la sesión', () => {
  assert.match(HTML, /hasSession = \/access_token=\/\.test\(lnk\) && !\/type=recovery\/\.test\(lnk\)/);
  assert.match(HTML, /html\.bw-resume #welcomeView \{ visibility: hidden; \}/);
});
t('modal de inicio de sesión / registro: se cierra con Escape y con clic en el fondo (y la ✕ sigue)', () => {
  assert.match(HTML, /e\.key === 'Escape' && canClose\(\)\) \{ e\.preventDefault\(\); closeRegistrationModal\(\); \}/);
  assert.match(HTML, /e\.target === modal && downOnBackdrop && canClose\(\)\) closeRegistrationModal\(\)/);
  assert.match(HTML, /canClose = \(\) => !modal\.classList\.contains\('hidden'\) && !isProcessingAction/, 'no se cierra mientras se envía');
  assert.match(HTML, /onclick="closeRegistrationModal\(\)"/);
});
t('Barky en móvil: se aparta de "Continuar" y de los botones del hero', () => {
  assert.match(HTML, /<div class="lp-total" data-fab-avoid>/);
  assert.match(HTML, /<div class="lp-ctas" data-fab-avoid>/);
  assert.match(HTML, /\.bw-chat-fab\.is-yielding \{ opacity: 0; pointer-events: none;/);
  assert.match(HTML, /fab\.classList\.toggle\('is-yielding', tapa\)/);
});
t('navbar: Iniciar sesión y Registrarse siempre visibles; modo claro/oscuro en la barra', () => {
  assert.match(HTML, /class="lp-btn lp-btn-ghost" onclick="openRegistrationModal\(null, 'login'\)"/);
  assert.match(HTML, /class="lp-btn lp-btn-primary" onclick="openRegistrationModal\('client'\)"/);
  assert.match(HTML, /class="bw-theme-pill bw-theme-btn lp-theme"/);
});
console.log(`\n${n} pruebas OK`);
