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
t('widget del hero: pestañas Reservar / En vivo, desglose con las tarifas del servidor y Club', () => {
  assert.match(HTML, /role="tab" id="lpTabBook"[^>]*aria-selected="true"/);
  assert.match(HTML, /role="tab" id="lpTabLive"[^>]*aria-selected="false"/);
  assert.match(HTML, /const FEE_LARGE = typeof LARGE_DOG_FEE !== 'undefined' \? LARGE_DOG_FEE : 4;/);
  assert.match(HTML, /const FEE_PET = typeof EXTRA_PET_FEE !== 'undefined' \? EXTRA_PET_FEE : 8;/);
  assert.match(HTML, /const club = Math\.round\(list \* \(100 - CLUB\) \/ 100\);/, 'mismo redondeo en centavos que api\/_lib\/pricing.js');
  assert.match(HTML, /if \(reduced\(\)\) return drawLive\(0\.96\);/, 'respeta prefers-reduced-motion');
});
t('cómo funciona (3 pasos clicables), comparador de servicios y CTA final con postulación de paseador', () => {
  assert.equal((HTML.match(/class="lp-how-tab" data-how="\d"/g) || []).length, 3);
  assert.match(HTML, /<div id="lpCards" class="lp-cards"/);
  assert.match(HTML, /onclick="openRegistrationModal\('shopper'\)" data-es="Quiero ser paseador"/);
  assert.match(HTML, /mailto:barkwalkusallc@gmail\.com/);
});
t('Barky en la portada móvil no flota sobre el contenido; se abre desde "Pregúntale a Barky"', () => {
  assert.match(HTML, /@media \(max-width: 959px\) \{ body:has\(#welcomeView:not\(\.hidden\)\) \.bw-chat-fab:not\(\[aria-expanded="true"\]\) \{ opacity: 0; pointer-events: none; \} \}/);
  assert.match(HTML, /class="lp-ask" onclick="togglePublicAiWidget\(\)"/);
});
console.log(`\n${n} pruebas OK`);
