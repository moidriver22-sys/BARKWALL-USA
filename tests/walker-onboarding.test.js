// Pruebas del onboarding del paseador FUERA de la app interna (walker-application.js + index.html):
// sin aprobación del admin no hay pestañas ni menú; Etapa 1 (documentos) → Etapa 2 (en revisión) → bienvenida.
// Pantalla y Supabase simulados en memoria (sin navegador). Ejecuta: npm test
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'walker-application.js'), 'utf8');
const W = require(path.join(ROOT, 'walker-application.js'));

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('✓', name); };

// ---------- Pantalla simulada mínima ----------
function makeEnv(fixture) {
  const els = {};
  const el = (id) => {
    if (els[id]) return els[id];
    const listeners = {};
    const e = els[id] = {
      id, hidden: false, value: '', checked: false, disabled: false, textContent: '', _html: '', dataset: {}, style: {}, isConnected: true,
      classList: { _s: new Set(), add(...c) { c.forEach((x) => this._s.add(x)); }, remove(...c) { c.forEach((x) => this._s.delete(x)); }, contains(c) { return this._s.has(c); }, toggle() {} },
      get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
      addEventListener(t2, f) { (listeners[t2] = listeners[t2] || []).push(f); }, setAttribute(k, v) { this[k] = v; },
      querySelector(sel) { const m = /data-onb="([a-z]+)"/.exec(sel); return m && this._html.includes(`data-onb="${m[1]}"`) ? el(`${id}::${m[1]}`) : (sel === 'button' ? el(`${id}::btn`) : null); },
      querySelectorAll() { return []; }, remove() { delete els[id]; body.children = body.children.filter((c) => c !== e); }, focus() {}, closest() { return null; },
    };
    return e;
  };
  const body = { children: [], appendChild(c) { this.children.push(c); els[c.id] = c; } };
  const doc = { hidden: false, head: { appendChild() {} }, body, getElementById: (id) => (id === 'missing' ? null : el(id)), createElement: (tag) => el(`new-${tag}-${Math.random()}`), addEventListener() {} };
  // Supabase: profiles / walker_applications / walker_reviews del propio paseador
  const db = {
    from(table) {
      const q = { _t: table, select() { return q; }, eq() { return q; }, order() { return q; },
        limit() { return Promise.resolve({ data: table === 'walker_applications' ? fixture.apps : fixture.reviews || [] }); },
        maybeSingle() { return Promise.resolve({ data: { walker_status: fixture.status } }); } };
      return q;
    },
    auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
  };
  const timers = [];
  const calls = { unlock: 0, logout: 0 };
  const store = {};
  const win = {
    document: doc, supabaseClient: db, currentLang: 'es', currentUser: { id: 'u1', role: 'walker', full_name: 'Camila Rojas', walker_status: fixture.status },
    setInterval: (f) => { timers.push(f); return timers.length; }, clearInterval: (id) => { timers[id - 1] = null; },
    localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } },
    bwUnlockApp: () => { calls.unlock++; }, logoutUser: () => { calls.logout++; }, URL: {}, File: function () {},
  };
  win.window = win;
  const ctx = { window: win, self: undefined, document: doc, setTimeout: (f) => f(), Intl, Date, console };
  vm.runInNewContext(SRC, ctx);
  return { B: ctx.BWWalkerApp, els, body, timers, calls, fixture, win };
}
// El módulo se registra en window (self) del contexto
function boot(fixture) {
  const env = makeEnv(fixture);
  assert.ok(env.B, 'módulo cargado');
  return env;
}

(async () => {
  // ---------- Regla de aprobación ----------
  await t('solo entra a la app quien el admin aprobó y tiene postulación aprobada con ID vigente (misma regla que la base)', async () => {
    assert.equal(W.isApproved('pending', [], TODAY), false);
    assert.equal(W.isApproved('verified', [], TODAY), false, 'verificado antiguo sin ID: al onboarding');
    assert.equal(W.isApproved('verified', [{ status: 'approved', id_expiry: addDays(-1) }], TODAY), false, 'ID vencido: al onboarding');
    assert.equal(W.isApproved('rejected', [{ status: 'approved', id_expiry: addDays(200) }], TODAY), false);
    assert.equal(W.isApproved('verified', [{ status: 'approved', id_expiry: addDays(200) }], TODAY), true);
    assert.equal(W.isApproved('verified', [{ status: 'submitted', id_expiry: addDays(400) }, { status: 'approved', id_expiry: addDays(10) }], TODAY), true, 'renovación en revisión: conserva el acceso');
  });

  // ---------- index.html: separación de la app interna ----------
  await t('la vista de onboarding está FUERA de la app interna y no tiene pestañas, menú, campana ni barra de navegación', async () => {
    const a = HTML.indexOf('<div id="walkerOnboardingView"'), d = HTML.indexOf('<div id="appDashboard"');
    assert.ok(a > 0 && a < d, 'es hermana anterior de appDashboard, no está dentro');
    const vista = HTML.slice(a, d);
    for (const x of ['data-tab', 'bwTabBar', 'bwDrawer', 'bwBellBtn', 'tabPro', 'tabHome', 'openBookingModal']) assert.ok(!vista.includes(x), x);
    assert.match(vista, /id="onbRoot"/);
    const dash = HTML.slice(d, HTML.indexOf('<!-- PANEL DE ADMINISTRACIÓN', d) > 0 ? HTML.length : HTML.length);
    for (const id of ['bwTabBar', 'bwDrawer', 'bwBellBtn', 'tabPro']) assert.ok(dash.includes(`id="${id}"`), `${id} vive dentro de la app interna`);
  });
  await t('al iniciar sesión, el paseador no aprobado va al onboarding ANTES de mostrar la app (y si algo falla, se bloquea)', async () => {
    const fn = HTML.slice(HTML.indexOf('async function enterDashboardForUser'), HTML.indexOf('function walkerMustOnboard'));
    const gate = fn.indexOf('if (await walkerMustOnboard())'), show = fn.indexOf("document.getElementById('appDashboard').classList.remove('hidden')");
    assert.ok(gate > 0 && show > gate, 'primero decide, después muestra la app');
    assert.match(fn.slice(gate, show), /showWalkerOnboarding\(\);[\s\S]*return;/);
    const must = HTML.slice(HTML.indexOf('async function walkerMustOnboard'), HTML.indexOf('function showWalkerOnboarding'));
    assert.match(HTML, /function walkerGateApplies\(u = window\.currentUser\) \{ return !!u && currentUserRole === 'shopper' && !u\.is_admin; \}/, 'clientes y admin no pasan por el onboarding');
    assert.match(must, /if \(!walkerGateApplies\(u\)\) return false;/);
    assert.match(must, /let approved = false;\s*if \(window\.BWWalkerApp\) \{/, 'sin módulo: bloqueado');
    assert.match(must, /catch \(e\) \{[^}]*approved = false; \}/, 'error: bloqueado');
    assert.match(must, /return !approved;/);
    assert.match(HTML, /function showWalkerOnboarding\(\) \{\s*document\.getElementById\('appDashboard'\)\.classList\.add\('hidden'\);/);
    assert.ok(!/Completa tu postulación: sube tu ID vigente y una selfie en Walker Pro/.test(HTML), 'ya no se envía al paseador a Walker Pro para postular');
  });
  await t('al aprobarse: bwUnlockApp desbloquea toda la app y lleva a Walker Pro (cobros con Stripe); cerrar sesión limpia todo', async () => {
    const un = HTML.slice(HTML.indexOf('window.bwUnlockApp = async function'), HTML.indexOf('// 1) Nadie puede dejar #appDashboard visible'));
    assert.ok(un.length > 50, 'bwUnlockApp encontrado');
    assert.ok(un.indexOf('if (await walkerMustOnboard()) { enforceWalkerLock(); return; }') < un.indexOf("appDashboard').classList.remove('hidden')"), 'solo abre la app si el servidor lo confirma');
    assert.match(un, /walkerOnboardingView'\)\.classList\.add\('hidden'\)/); assert.match(un, /appDashboard'\)\.classList\.remove\('hidden'\)/);
    assert.match(un, /switchTab\('pro'\)/);
    assert.match(HTML, /BWWalkerApp\.stop\(\); document\.getElementById\('walkerOnboardingView'\)\.classList\.add\('hidden'\)/);
    assert.match(HTML, /<script src="\/walker-application\.js\?v=\d+" defer><\/script>/);
  });

  // ---------- Flujo en la pantalla simulada ----------
  await t('Etapa 1: sin postulación → formulario dedicado de documentos (ID vigente + selfie) con cerrar sesión', async () => {
    const env = boot({ status: 'pending', apps: [] });
    await env.B.renderOnboarding('onbRoot');
    const h = env.els.onbRoot.innerHTML;
    assert.match(h, /Etapa 1 de 2/); assert.match(h, /completa tu postulación/); assert.match(h, /data-onb="logout"/);
    assert.match(env.els.onbForm.innerHTML, /id="waIdFile"/); assert.match(env.els.onbForm.innerHTML, /id="waSelfieFile"/); assert.match(env.els.onbForm.innerHTML, /id="waExpiry"/);
    assert.equal(env.timers.filter(Boolean).length, 0, 'en la etapa 1 no consulta el estado');
    env.els['onbRoot::logout'].onclick(); assert.equal(env.calls.logout, 1);
  });
  await t('Etapa 2: postulación enviada → "Postulación en revisión", actualizar estado, reenviar documentos y cerrar sesión', async () => {
    const env = boot({ status: 'pending', apps: [{ status: 'submitted', submitted_at: `${TODAY}T10:00:00Z`, id_expiry: addDays(300) }] });
    await env.B.renderOnboarding('onbRoot');
    const h = env.els.onbRoot.innerHTML;
    assert.match(h, /Etapa 2 de 2/); assert.match(h, /Postulación en revisión/); assert.match(h, /data-onb="refresh"/);
    assert.match(h, /Envía tus documentos corregidos/); assert.match(h, /data-onb="logout"/);
    assert.equal(env.timers.filter(Boolean).length, 1, 'consulta el estado periódicamente');
  });
  await t('rechazada → vuelve a la Etapa 1 mostrando el motivo y permite reenviar', async () => {
    const env = boot({ status: 'rejected', apps: [{ status: 'rejected', submitted_at: '2026-11-01', id_expiry: addDays(300) }], reviews: [{ status: 'rejected', reason: 'La foto del ID está borrosa' }] });
    await env.B.renderOnboarding('onbRoot');
    assert.match(env.els.onbForm.innerHTML, /no fue aprobada/); assert.match(env.els.onbForm.innerHTML, /La foto del ID está borrosa/);
    assert.match(env.els.onbForm.innerHTML, /id="waSubmit"/);
  });
  await t('suspendido → pantalla de cuenta suspendida, sin formulario y sin acceso a la app', async () => {
    const env = boot({ status: 'suspended', apps: [{ status: 'rejected', submitted_at: '2026-11-01' }] });
    await env.B.renderOnboarding('onbRoot');
    assert.match(env.els.onbRoot.innerHTML, /Cuenta suspendida/); assert.ok(!/waSubmit/.test(env.els.onbRoot.innerHTML)); assert.equal(env.calls.unlock, 0);
  });
  await t('aprobación detectada mientras espera → mensaje de bienvenida y, al aceptar, se desbloquea la app', async () => {
    const fx = { status: 'pending', apps: [{ status: 'submitted', submitted_at: `${TODAY}T10:00:00Z`, id_expiry: addDays(300) }] };
    const env = boot(fx);
    await env.B.renderOnboarding('onbRoot');
    // El admin aprueba
    fx.status = 'verified'; fx.apps = [{ status: 'approved', submitted_at: `${TODAY}T10:00:00Z`, id_expiry: addDays(300) }];
    await env.timers.filter(Boolean)[0]();
    const welcome = env.body.children.find((c) => c.id === 'bwWelcomeApproved');
    assert.ok(welcome, 'aparece la bienvenida');
    assert.match(welcome.innerHTML, /¡Bienvenido a Barkwalk USA!/); assert.match(welcome.innerHTML, /Tu perfil ha sido aprobado/); assert.match(welcome.innerHTML, /Walker Pro/);
    assert.equal(env.timers.filter(Boolean).length, 0, 'deja de consultar');
    assert.equal(env.calls.unlock, 0, 'no desbloquea hasta que acepta');
    welcome.querySelector('[data-onb="enter"]').onclick();
    assert.equal(env.calls.unlock, 1, 'desbloquea toda la app');
  });
  await t('ya aprobado al entrar → la bienvenida se muestra una sola vez', async () => {
    const env = boot({ status: 'verified', apps: [{ status: 'approved', id_expiry: addDays(300) }] });
    env.B.maybeWelcome();
    assert.equal(env.body.children.filter((c) => c.id === 'bwWelcomeApproved').length, 1);
    env.body.children.find((c) => c.id === 'bwWelcomeApproved').remove();
    env.B.maybeWelcome();
    assert.equal(env.body.children.filter((c) => c.id === 'bwWelcomeApproved').length, 0, 'no se repite');
  });

  console.log(`\n${n} pruebas OK`);
})().catch((e) => { console.error('✗ FALLO:', e.stack); process.exit(1); });
