// Puerta del paseador: un paseador SIN postulación, PENDIENTE, rechazado, suspendido o con el ID vencido NUNCA
// desbloquea #appDashboard — ni al entrar, ni al navegar, ni al volver "atrás" (popstate / pageshow desde la
// caché bfcache), ni con "Volver a la app", bwUnlockApp() o código que quite la clase "hidden".
// Ejecuta el bloque REAL de index.html (BW_WALKER_GATE) + el walker-application.js REAL (gate(), isApproved,
// closeApplication) sobre una pantalla y un Supabase simulados. También: cierre de sesión a la portada limpia
// (BW_SIGNOUT), documentos legales dentro de la app (BW_LEGAL_MODAL) y el Service Worker. Ejecuta: npm test
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const HTML = read('index.html');
const WA_SRC = read('walker-application.js');
const block = (name) => {
  const a = HTML.indexOf(`// ===== ${name}:START =====`), b = HTML.indexOf(`// ===== ${name}:END =====`);
  assert.ok(a > 0 && b > a, `bloque ${name} en index.html`);
  return HTML.slice(a, b);
};
const GATE = block('BW_WALKER_GATE');

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (k) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + k * 864e5).toISOString().slice(0, 10);
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('✓', name); };

// ---------- Pantalla simulada: elementos con clases que avisan a los MutationObserver ----------
function makeDom() {
  const els = {}, observers = [], listeners = { window: {}, document: {} };
  const mk = (id) => {
    const l = {};
    const e = {
      id, dataset: {}, style: {}, value: '', hidden: false, isConnected: true, _html: '',
      get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
      classList: {
        _s: new Set(),
        add(...c) { const antes = [...this._s].join(' '); c.forEach((x) => this._s.add(x)); if (antes !== [...this._s].join(' ')) notify(e); },
        remove(...c) { const antes = [...this._s].join(' '); c.forEach((x) => this._s.delete(x)); if (antes !== [...this._s].join(' ')) notify(e); },
        contains(c) { return this._s.has(c); }, toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this.add(c); else this.remove(c); },
      },
      addEventListener(tp, f) { (l[tp] = l[tp] || []).push(f); }, removeEventListener() {},
      setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k] ?? null; }, removeAttribute(k) { delete this[k]; },
      querySelector() { return mk(`${id}::q${Math.random()}`); }, querySelectorAll() { return []; },
      focus() {}, remove() {}, closest() { return null; }, appendChild(c) { return c; },
    };
    return e;
  };
  const el = (id) => els[id] || (els[id] = mk(id));
  function notify(target) { observers.forEach((o) => { if (o.target === target) o.cb([{ target, attributeName: 'class' }]); }); }
  class FakeMO { constructor(cb) { this.cb = cb; } observe(target) { this.target = target; observers.push(this); } disconnect() {} }
  const on = (where) => (tp, f) => { (listeners[where][tp] = listeners[where][tp] || []).push(f); };
  const fire = (where, tp, ev = {}) => Promise.all((listeners[where][tp] || []).map((f) => f({ type: tp, ...ev })));
  const doc = { hidden: false, head: { appendChild() {} }, body: { appendChild() {} }, getElementById: el, createElement: (tg) => mk(`new-${tg}-${Math.random()}`),
    addEventListener: on('document'), removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  ['appDashboard', 'walkerOnboardingView'].forEach((id) => el(id).classList._s.add('hidden'));
  return { el, doc, FakeMO, on, fire };
}

// Supabase simulado: el estado del paseador y sus postulaciones (lo que devolvería la base con RLS)
function makeDb(fx) {
  return {
    from(table) {
      const q = { select() { return q; }, eq() { return q; }, order() { return q; },
        limit() { if (fx.fail) return Promise.reject(new Error('sin red')); return Promise.resolve({ data: table === 'walker_applications' ? fx.apps : [] }); },
        maybeSingle() { if (fx.fail) return Promise.reject(new Error('sin red')); return Promise.resolve({ data: { walker_status: fx.status } }); } };
      return q;
    },
    auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
  };
}

// Arranca el bloque real de index.html + walker-application.js real en un mismo contexto
function boot(fx, { role = 'shopper', admin = false, withModule = true } = {}) {
  const dom = makeDom();
  const calls = { dashboard: 0, onboardingRender: 0, switchTab: [] };
  const win = {
    currentLang: 'es', supabaseClient: makeDb(fx),
    currentUser: { id: fx.uid || 'u1', role: 'walker', full_name: 'Camila Rojas', walker_status: fx.status, is_admin: admin },
    setInterval: () => 1, clearInterval() {}, localStorage: { getItem: () => null, setItem() {} }, URL: {}, File: function () {},
    addEventListener: dom.on('window'), document: dom.doc,
  };
  win.window = win;
  const ctx = {
    window: win, self: undefined, document: dom.doc, MutationObserver: dom.FakeMO, console: { ...console, warn() {} }, Intl, Date, Promise,
    setTimeout: (f) => { f(); return 0; }, currentUserRole: role, tr: (es) => es,
    showDashboardWithSkeleton: () => { calls.dashboard++; }, switchTab: (x) => calls.switchTab.push(x), BWTermsGate: { check() {} }, lucide: null,
  };
  vm.createContext(ctx);
  if (withModule) {
    vm.runInContext(WA_SRC, ctx);
    win.BWWalkerApp = ctx.BWWalkerApp;
    const realRender = ctx.BWWalkerApp.renderOnboarding;
    ctx.BWWalkerApp.renderOnboarding = (id) => { calls.onboardingRender++; return realRender(id); };
  }
  vm.runInContext(GATE + '\nthis.G = { walkerMustOnboard, showWalkerOnboarding, enforceWalkerLock, recheckWalkerGate, walkerLocked, WALKER_GATE };', ctx);
  const app = dom.el('appDashboard'), view = dom.el('walkerOnboardingView');
  // Lo mismo que hace enterDashboardForUser() tras leer el perfil
  const enter = async () => { if (await ctx.G.walkerMustOnboard()) ctx.G.showWalkerOnboarding(); else { view.classList.add('hidden'); app.classList.remove('hidden'); } };
  const appVisible = () => !app.classList.contains('hidden');
  const flush = () => new Promise((r) => setImmediate(r));
  return { ctx, win, dom, app, view, calls, enter, appVisible, flush, G: ctx.G, fx };
}

// Todo lo que podría volver a mostrar la app: cada intento debe terminar con la app OCULTA
async function attackAll(e, label) {
  const { app, dom, win, appVisible, flush } = e;
  const intentos = [
    ['código quita "hidden" (pestañas, navCloseEntry, consola)', async () => { app.classList.remove('hidden'); }],
    ['toggle("hidden", false)', async () => { app.classList.toggle('hidden', false); }],
    ['popstate (botón Atrás)', async () => { await dom.fire('window', 'popstate'); }],
    ['pageshow desde bfcache (volver de /terminos-paseadores)', async () => { await dom.fire('window', 'pageshow', { persisted: true }); }],
    ['pageshow normal', async () => { await dom.fire('window', 'pageshow', { persisted: false }); }],
    ['volver a la pestaña', async () => { await dom.fire('document', 'visibilitychange'); }],
    ['bwUnlockApp() (bienvenida / consola)', async () => { await win.bwUnlockApp(); }],
    ['"Volver a la app" (closeApplication)', async () => { if (win.BWWalkerApp) { await win.BWWalkerApp.openApplication(); win.BWWalkerApp.closeApplication(); } }],
    ['Atrás + quitar "hidden" a la vez', async () => { const p = dom.fire('window', 'popstate'); app.classList.remove('hidden'); await p; }],
  ];
  for (const [nombre, intento] of intentos) {
    await intento(); await flush();
    assert.equal(appVisible(), false, `${label}: ${nombre} NO debe mostrar appDashboard`);
  }
  assert.equal(e.calls.dashboard, 0, `${label}: nunca se dibujó el panel (showDashboardWithSkeleton)`);
}

(async () => {
  await t('sin postulación (pending): bloqueado al entrar y ante TODO intento de mostrar la app', async () => {
    const e = boot({ status: 'pending', apps: [] });
    await e.enter();
    assert.equal(e.appVisible(), false); assert.equal(e.view.classList.contains('hidden'), false, 've el onboarding');
    assert.equal(e.G.walkerLocked(), true);
    await attackAll(e, 'sin postulación');
  });

  await t('walker_status = pending con postulación enviada: bloqueado aunque navegue o vuelva atrás', async () => {
    const e = boot({ status: 'pending', apps: [{ status: 'submitted', id_expiry: addDays(400), submitted_at: TODAY }] });
    await e.enter();
    assert.equal(e.appVisible(), false);
    await attackAll(e, 'pendiente');
  });

  await t('postulación aprobada pero walker_status pending (admin a medias): sigue bloqueado', async () => {
    const e = boot({ status: 'pending', apps: [{ status: 'approved', id_expiry: addDays(400), submitted_at: TODAY }] });
    await e.enter(); await attackAll(e, 'aprobada sin verified');
  });

  await t('rechazado, suspendido, verified sin postulación o con el ID vencido: bloqueado', async () => {
    for (const fx of [
      { status: 'rejected', apps: [{ status: 'rejected', id_expiry: addDays(300), submitted_at: TODAY }] },
      { status: 'suspended', apps: [{ status: 'approved', id_expiry: addDays(300), submitted_at: TODAY }] },
      { status: 'verified', apps: [] },
      { status: 'verified', apps: [{ status: 'approved', id_expiry: addDays(-1), submitted_at: TODAY }] },
      { status: null, apps: [] },
    ]) {
      const e = boot(fx); await e.enter(); await attackAll(e, JSON.stringify(fx.status));
    }
  });

  await t('sin red o sin el módulo de postulación: se bloquea (nunca se abre la app por error)', async () => {
    const e1 = boot({ status: 'verified', apps: [{ status: 'approved', id_expiry: addDays(300) }], fail: true });
    await e1.enter(); assert.equal(e1.appVisible(), false); await attackAll(e1, 'sin red');
    const e2 = boot({ status: 'verified', apps: [{ status: 'approved', id_expiry: addDays(300) }] }, { withModule: false });
    assert.equal(await e2.G.walkerMustOnboard(), true); e2.app.classList.remove('hidden'); assert.equal(e2.appVisible(), false);
  });

  await t('control: verified + postulación aprobada con ID vigente SÍ entra, y bwUnlockApp abre la app', async () => {
    const e = boot({ status: 'verified', apps: [{ status: 'approved', id_expiry: addDays(300), submitted_at: TODAY }] });
    await e.enter();
    assert.equal(e.appVisible(), true); assert.equal(e.G.walkerLocked(), false);
    await e.dom.fire('window', 'popstate'); await e.dom.fire('window', 'pageshow', { persisted: true }); await e.flush();
    assert.equal(e.appVisible(), true, 'navegar no lo saca de la app');
    e.app.classList.add('hidden'); e.view.classList.remove('hidden');
    await e.win.bwUnlockApp();
    assert.equal(e.appVisible(), true); assert.equal(e.calls.dashboard, 1); assert.deepEqual(e.calls.switchTab, ['pro']);
  });

  await t('aprobado y luego suspendido: al volver atrás / a la pestaña se re-verifica en el servidor y se bloquea', async () => {
    const e = boot({ status: 'verified', apps: [{ status: 'approved', id_expiry: addDays(300), submitted_at: TODAY }] });
    await e.enter(); assert.equal(e.appVisible(), true);
    e.fx.status = 'suspended';
    await e.dom.fire('window', 'pageshow', { persisted: true }); await e.flush();
    assert.equal(e.appVisible(), false, 'suspendido: fuera de la app'); assert.equal(e.view.classList.contains('hidden'), false);
    await attackAll(e, 'suspendido después');
  });

  await t('la aprobación es de UNA cuenta: otro usuario en la misma pestaña empieza bloqueado', async () => {
    const e = boot({ status: 'verified', apps: [{ status: 'approved', id_expiry: addDays(300) }] });
    await e.enter(); assert.equal(e.appVisible(), true);
    e.fx.status = 'pending'; e.fx.apps = [];
    e.win.currentUser = { id: 'otro', role: 'walker', walker_status: 'pending', is_admin: false };
    assert.equal(e.G.walkerLocked(), true, 'la aprobación guardada era de u1, no de "otro"');
    // Con el panel aún en pantalla, el siguiente evento de navegación lo cierra
    await e.dom.fire('window', 'popstate'); await e.flush();
    assert.equal(e.appVisible(), false);
    await attackAll(e, 'otra cuenta');
  });

  await t('clientes y admins no pasan por la puerta del paseador', async () => {
    const c = boot({ status: null, apps: [] }, { role: 'client' });
    assert.equal(await c.G.walkerMustOnboard(), false); c.app.classList.remove('hidden'); assert.equal(c.appVisible(), true);
    const a = boot({ status: 'pending', apps: [] }, { admin: true });
    assert.equal(await a.G.walkerMustOnboard(), false); a.app.classList.remove('hidden'); assert.equal(a.appVisible(), true);
  });

  await t('sin aprobación no se cargan datos de paseos ni alertas en vivo (además de la RLS de la base)', async () => {
    const shown = HTML.slice(HTML.indexOf('function onWalkerDashboardShown'), HTML.indexOf('function onWalkerDashboardShown') + 400);
    assert.match(shown, /if \(window\.walkerLocked && window\.walkerLocked\(\)\) \{[^}]*enforceWalkerLock\(\); return; \}\s*restoreWalkerWalks\(\);/, 'el panel del paseador no carga nada');
    const restore = HTML.slice(HTML.indexOf('async function restoreWalkerWalks'), HTML.indexOf('function onWalkerDashboardShown'));
    assert.ok(restore.indexOf('window.walkerLocked()') < restore.indexOf(".from('walk_requests')"), 'no pide sus paseos');
    assert.match(HTML, /paseadorAprobado: !\(window\.walkerLocked && window\.walkerLocked\(\)\)/, 'sin alertas de paseos nuevos');
    assert.match(HTML, /WALKER_GATE\.approvedFor = null; WALKER_GATE\.lastCheck = 0;/, 'cerrar sesión borra la aprobación');
    assert.match(WA_SRC, /function closeApplication\(\) \{\s*APP\.open = false;[\s\S]{0,200}if \(typeof win\.walkerLocked === 'function' && win\.walkerLocked\(\)\) return renderOnboarding\('onbRoot'\);/);
  });

  // ---------- Documentos legales dentro de la app (sin salir de la página) ----------
  await t('enlaces a /terminos-paseadores, /terminos-clientes y /privacidad se abren en un modal, no fuera de la app', async () => {
    const L = block('BW_LEGAL_MODAL');
    const ctx = { location: { href: 'https://www.barkwalkusa.com/', origin: 'https://www.barkwalkusa.com' }, URL, decodeURIComponent,
      document: { addEventListener() {}, getElementById: () => null }, window: {}, currentLang: 'es' };
    vm.createContext(ctx); vm.runInContext(L + '\nthis.F = { legalTarget };', ctx);
    const a = (href, ext) => ({ getAttribute: () => href, dataset: ext ? { legalExternal: '1' } : {} });
    assert.deepEqual({ ...ctx.F.legalTarget(a('/terminos-paseadores#es-2')) }, { path: '/terminos-paseadores', anchor: 'es-2' });
    assert.deepEqual({ ...ctx.F.legalTarget(a('/terminos-clientes?lang=en')) }, { path: '/terminos-clientes', anchor: '' });
    assert.deepEqual({ ...ctx.F.legalTarget(a('/privacidad.html')) }, { path: '/privacidad', anchor: '' });
    assert.equal(ctx.F.legalTarget(a('https://evil.example/terminos-paseadores')), null, 'otro sitio: no');
    assert.equal(ctx.F.legalTarget(a('/terminos-paseadores', true)), null, '"Abrir en pestaña nueva" sigue funcionando');
    assert.equal(ctx.F.legalTarget(a('/api/signup')), null);
    assert.match(L, /document\.addEventListener\('click', \(e\) => \{[\s\S]*e\.preventDefault\(\);\s*openLegalModal\(dest\.path, dest\.anchor\);[\s\S]*\}, true\);/, 'fase de captura');
    assert.match(L, /querySelectorAll\('script,style,iframe,object,embed,link,meta,form'\)\.forEach\(n => n\.remove\(\)\)/, 'copia sin scripts');
    assert.match(L, /\/\^on\/i\.test\(at\.name\)/, 'sin manejadores on*');
    assert.match(WA_SRC, /<a href="\$\{CONTRACTOR_URL\}#\$\{lang\}-2" target="_blank" rel="noopener"/, 'y si no hay modal, pestaña nueva');
  });

  // ---------- Cerrar sesión: siempre a la portada actual y limpia ----------
  await t('cerrar sesión recarga "/" con location.replace (sin volver con Atrás), vacía sessionStorage y cachés', async () => {
    const S = block('BW_SIGNOUT');
    const store = { borrador: 'x' }, deleted = [];
    const ctx = {
      window: {}, setTimeout: () => 0,
      sessionStorage: { clear() { Object.keys(store).forEach((k) => delete store[k]); }, setItem(k, v) { store[k] = v; }, getItem: (k) => store[k] ?? null, removeItem(k) { delete store[k]; } },
      location: { replaced: [], replace(u) { this.replaced.push(u); } },
      document: { getElementById: (id) => ({ classList: { contains: () => id !== 'appDashboard' } }) },
      resetAccountState() { ctx.resets = (ctx.resets || 0) + 1; }, showToast() {},
    };
    ctx.window.caches = { keys: async () => ['old-app-v1'], delete: async (k) => deleted.push(k) };
    ctx.caches = ctx.window.caches;
    const pageshow = [];
    ctx.window.addEventListener = (tp, f) => { if (tp === 'pageshow') pageshow.push(f); };
    ctx.addEventListener = ctx.window.addEventListener;
    vm.createContext(ctx); vm.runInContext(S.replace(/window\.addEventListener/g, 'addEventListener') + '\nthis.F = { bwHardHome };', ctx);
    ctx.F.bwHardHome('✅ Tu cuenta fue eliminada.');
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(ctx.location.replaced, ['/']); assert.equal(store.borrador, undefined, 'sessionStorage vacío');
    assert.equal(store.bw_signout_notice, '✅ Tu cuenta fue eliminada.', 'el aviso viaja a la portada nueva');
    assert.deepEqual(deleted, ['old-app-v1'], 'cachés del Service Worker borradas');
    // Volver "atrás" a la app vieja (bfcache) sin sesión → portada limpia
    ctx.window.supabaseClient = { auth: { getSession: async () => ({ data: { session: null } }) } };
    ctx.window.currentUser = { id: 'u1' }; ctx.location.replaced = [];
    for (const f of pageshow) await f({ persisted: true });
    assert.deepEqual(ctx.location.replaced, ['/']); assert.ok(ctx.resets >= 1);
    // Con sesión válida no se toca nada
    ctx.window.supabaseClient = { auth: { getSession: async () => ({ data: { session: { user: {} } } }) } }; ctx.location.replaced = [];
    for (const f of pageshow) await f({ persisted: true });
    assert.deepEqual(ctx.location.replaced, []);
  });

  await t('logoutUser y el cierre desde otra pestaña terminan en bwHardHome(); el aviso de cuenta eliminada se conserva', async () => {
    const lo = HTML.slice(HTML.indexOf('async function logoutUser(opts = {})'), HTML.indexOf('// ===== BW_SIGNOUT:START'));
    assert.ok(lo.indexOf('resetAccountState();') < lo.indexOf('bwHardHome('), 'limpia y luego recarga');
    assert.match(HTML, /if \(event === 'SIGNED_OUT' && window\.currentUser\) \{ resetAccountState\(\); goHome\(\); bwHardHome\(\); \}/);
    assert.match(read('account-close.js'), /await win\.logoutUser\(\{ notice: aviso \}\)/);
  });

  await t('Service Worker: sin "fetch" (nunca sirve una portada vieja), toma el control al instante y borra cachés antiguas', async () => {
    const sw = read('sw.js');
    assert.doesNotMatch(sw, /addEventListener\('fetch'/);
    assert.match(sw, /self\.skipWaiting\(\)/); assert.match(sw, /self\.clients\.claim\(\)/);
    assert.match(sw, /caches\.keys\(\)[\s\S]*caches\.delete\(k\)/);
    const cfg = JSON.parse(read('vercel.json'));
    for (const src of ['/', '/index.html', '/sw.js']) {
      const h = cfg.headers.find((x) => x.source === src);
      assert.ok(h && /no-cache/.test(h.headers.find((x) => x.key === 'Cache-Control').value), `${src} se revalida siempre`);
    }
  });

  console.log(`\n${n} pruebas OK`);
})().catch((e) => { console.error('✗ FALLO:', e); process.exit(1); });
