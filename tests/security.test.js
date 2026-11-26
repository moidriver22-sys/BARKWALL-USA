// Pruebas del paquete de seguridad: filtro de lenguaje, privacidad de ubicación, anti-bots, límite de peticiones,
// cabeceras HTTP, aviso de IA y validaciones de /api/signup y /api/create-payment-intent.
// Ejecuta: npm test
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
process.env.SUPABASE_URL = 'http://fake.supabase';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
process.env.STRIPE_SECRET_KEY = 'sk_test_' + 'x'.repeat(24);
delete process.env.TURNSTILE_SITE_KEY; delete process.env.TURNSTILE_SECRET_KEY;

let FETCH = [];       // llamadas registradas
let SITEVERIFY = { success: true, action: 'signup' };
let RPC_RESULT = true; // respuesta de bw_rate_hit
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  FETCH.push({ url: u, opts });
  const json = (status, data) => ({ ok: status < 300, status, text: async () => JSON.stringify(data), json: async () => data });
  if (u.startsWith('https://challenges.cloudflare.com/')) return json(200, SITEVERIFY);
  if (u.includes('/rest/v1/rpc/bw_rate_hit')) { if (RPC_RESULT === 'error') throw new Error('db down'); return json(200, RPC_RESULT); }
  if (u.includes('/auth/v1/user')) return json(200, { id: '11111111-2222-3333-4444-555555555555', email: 'a@example.com' });
  if (u.includes('/rest/v1/rpc/bw_create_signup_intent')) return json(200, 'nonce-123');
  if (u.includes('/auth/v1/signup')) return json(200, { user: { id: 'u1', email: 'x@example.com', identities: [] } });
  return json(404, { message: 'not mocked: ' + u });
};

const CF = require(path.join(ROOT, 'api/_lib/content-filter.js'));
const LP = require(path.join(ROOT, 'api/_lib/location-privacy.js'));
const BG = require(path.join(ROOT, 'api/_lib/bot-guard.js'));
const RL = require(path.join(ROOT, 'api/_lib/rate-limit.js'));
const signup = require(path.join(ROOT, 'api/signup.js'));
const payment = require(path.join(ROOT, 'api/create-payment-intent.js'));
const chat = require(path.join(ROOT, 'api/chat.js'));
const { buildSql } = require(path.join(ROOT, 'scripts/build-content-filter.js'));

let passed = 0;
const t = async (name, fn) => { FETCH = []; SITEVERIFY = { success: true, action: 'signup' }; RPC_RESULT = true; RL.setRateLimitBackend(null); await fn(); passed++; console.log('✓', name); };
const call = async (handler, { method = 'POST', url = '/', headers = {}, body } = {}) => {
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await handler({ method, url, headers: { 'x-real-ip': '203.0.113.7', ...headers }, body }, res);
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
const SIGNUP_OK = {
  email: 'nuevo@example.com', password: 'secreto123', fullName: 'Ana López', role: 'client', birthDate: '1990-05-01',
  termsAccepted: true, termsVersion: '2026-11-24.2', privacyAccepted: true, privacyVersion: '2026-11-24',
  waiverAccepted: true, waiverVersion: '2026-11-16',
};

(async () => {
  // ---------------- Filtro de lenguaje ----------------
  await t('filtro: bloquea insultos en español e inglés (acentos, mayúsculas, leet, letras repetidas, separadores)', async () => {
    for (const s of ['eres un pendejo', 'CABRÓN', 'hijo de puta', 'Hijueputa', 'qué mierda', 'pinche perro', 'gilipollas', 'idiota',
      'ESTÚPIDA', 'fuck you', 'fuuuuck', 'f.u.c.k', 'sh1t', 'bullshit', 'motherfucker', 'son of a bitch', 'asshole', 'you moron', 'p*u*t*a', 'n1gger']) {
      assert.equal(CF.check(s).ok, false, `debería bloquear: ${s}`);
    }
  });
  await t('filtro: NO bloquea palabras normales de una app de perros (sin falsos positivos)', async () => {
    for (const s of ['Luna es una perra muy dulce', 'My female dog (bitch) is spayed', 'usa el cono después de la cirugía', 'Shih Tzu de 3 años',
      'shitzu', 'cockapoo', 'computadora', 'Dick Smith', 'Niger', 'Scunthorpe', 'classic', 'pass the ball', 'assistant', 'shiitake treats',
      'putting on the leash', 'Hola, ¿cómo va JEISON?', '', null, undefined]) {
      assert.equal(CF.check(s).ok, true, `no debería bloquear: ${s}`);
    }
  });
  await t('filtro: checkFields indica el campo y message() es bilingüe', async () => {
    assert.deepEqual(CF.checkFields({ name: 'Toby', notes: 'muy pendejo' }), { ok: false, reason: 'profanity', field: 'notes' });
    assert.deepEqual(CF.checkFields({ name: 'Toby', notes: 'le encanta el parque' }), { ok: true });
    assert.match(CF.message('profanity', 'es'), /no permitidas/); assert.match(CF.message('profanity', 'en'), /not allowed/);
  });
  await t('antifuga: detecta teléfonos, correos y pagos/acuerdos por fuera (solo avisa)', async () => {
    assert.deepEqual(CF.detectContact('llámame al (205) 555-1234'), ['phone']);
    assert.deepEqual(CF.detectContact('my email is ana@gmail.com'), ['email']);
    assert.deepEqual(CF.detectContact('pay me on Venmo'), ['offplatform']);
    assert.deepEqual(CF.detectContact('págame por fuera de la app'), ['offplatform']);
    assert.deepEqual(CF.detectContact('Llego a las 9:30 con 2 perros'), []);
    assert.match(CF.message('contact', 'es'), /cobertura, el soporte/); assert.match(CF.message('contact', 'en'), /coverage, support/);
  });
  await t('filtro: la copia del navegador y la regla SQL están sincronizadas con la fuente', async () => {
    assert.equal(fs.readFileSync(path.join(ROOT, 'content-filter.js'), 'utf8'), fs.readFileSync(path.join(ROOT, 'api/_lib/content-filter.js'), 'utf8'),
      'content-filter.js desactualizado: ejecuta node scripts/build-content-filter.js');
    assert.equal(fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261126_content_filter.sql'), 'utf8'), buildSql(),
      'migración SQL desactualizada: ejecuta node scripts/build-content-filter.js');
    assert.equal([...CF.LEET_FROM].length, CF.LEET_TO.length);
  });
  await t('filtro: funciona igual cargado en el navegador (window.BWContentFilter)', async () => {
    const vm = require('vm');
    const ctx = { self: {} };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'content-filter.js'), 'utf8'), ctx);
    assert.equal(ctx.self.BWContentFilter.check('pendejo').ok, false);
    assert.equal(ctx.self.BWContentFilter.check('Luna').ok, true);
  });

  // ---------------- Privacidad de ubicación ----------------
  await t('ubicación: el paseador solo recibe la dirección de recogida, nunca la ubicación en vivo', async () => {
    const walk = { pickup_address: '1800 Oxmoor Rd, Homewood, AL', pickup_latitude: 33.471812345, pickup_longitude: -86.800812345,
      latitude: 33.5, longitude: -86.9, lat: 33.5, lng: -86.9, location_updated_at: '2026-11-23T10:00:00Z' };
    const v = LP.ownerLocationForWalker(walk);
    assert.deepEqual(v, { address: '1800 Oxmoor Rd, Homewood, AL', coords: { lat: 33.4718, lng: -86.8008 } });
    assert.ok(!JSON.stringify(v).includes('33.5'), 'no incluye ninguna posición en vivo');
    assert.deepEqual(LP.ownerLocationForWalker({ address: 'Homewood, AL' }), { address: 'Homewood, AL', coords: null });
  });
  await t('ubicación: coordenadas de recogida se validan y redondean a ~11 m', async () => {
    assert.deepEqual(LP.sanitizePickupCoords('33.471899', '-86.800849'), { lat: 33.4719, lng: -86.8008 });
    for (const [a, b] of [[0, 0], [91, 0], [0, 181], ['x', 1], [null, null], ['', ''], [undefined, 5], [Infinity, 1]]) assert.equal(LP.sanitizePickupCoords(a, b), null);
  });
  await t('ubicación: solo el paseador asignado (o quien acepta) puede escribir la posición en vivo; el dueño nunca', async () => {
    const w = { walker_id: 'wk', client_id: 'cl', status: 'in_progress' };
    assert.equal(LP.canWriteLiveLocation(w, 'wk'), true);
    assert.equal(LP.canWriteLiveLocation(w, 'cl'), false);
    assert.equal(LP.canWriteLiveLocation(w, 'otro'), false);
    assert.equal(LP.canWriteLiveLocation({ walker_id: null, status: 'pending' }, 'wk2'), true);
    assert.equal(LP.canWriteLiveLocation({ walker_id: null, status: 'completed' }, 'wk2'), false);
    assert.deepEqual(LP.WALKER_LIVE_COLUMNS, ['latitude', 'longitude', 'lat', 'lng', 'location_updated_at']);
  });

  // ---------------- Anti-bots ----------------
  await t('anti-bots sin claves: solo honeypot (la app funciona igual) y no se publica clave', async () => {
    assert.deepEqual(BG.publicBotConfig(), { turnstileSiteKey: null });
    assert.deepEqual(await BG.verifyHuman({}, '1.2.3.4', 'signup'), { ok: true, mode: 'honeypot_only' });
    assert.deepEqual(await BG.verifyHuman({ website: 'http://spam' }, '1.2.3.4', 'signup'), { ok: false, error: 'bot_detected' });
    assert.equal(FETCH.length, 0, 'no llama a Cloudflare');
  });
  await t('anti-bots con claves Turnstile: token obligatorio y validado en el servidor', async () => {
    process.env.TURNSTILE_SITE_KEY = '0x4AAA-site'; process.env.TURNSTILE_SECRET_KEY = '0x4AAA-secret';
    try {
      assert.deepEqual(BG.publicBotConfig(), { turnstileSiteKey: '0x4AAA-site' });
      assert.deepEqual(await BG.verifyHuman({}, '1.2.3.4', 'signup'), { ok: false, error: 'captcha_required' });
      assert.deepEqual(await BG.verifyHuman({ turnstileToken: 'tok' }, '1.2.3.4', 'signup'), { ok: true, mode: 'turnstile' });
      const body = FETCH[0].opts.body;
      assert.equal(body.get('secret'), '0x4AAA-secret'); assert.equal(body.get('response'), 'tok'); assert.equal(body.get('remoteip'), '1.2.3.4');
      SITEVERIFY = { success: false, 'error-codes': ['invalid-input-response'] };
      assert.equal((await BG.verifyHuman({ turnstileToken: 'bad' }, '', 'signup')).error, 'captcha_failed');
      SITEVERIFY = { success: true, action: 'booking' };
      assert.equal((await BG.verifyHuman({ turnstileToken: 'tok' }, '', 'signup')).error, 'captcha_failed', 'token de otra acción');
      // Solo una de las dos claves → desactivado (evita bloquear a todos por una configuración a medias)
      delete process.env.TURNSTILE_SECRET_KEY;
      assert.deepEqual(BG.publicBotConfig(), { turnstileSiteKey: null });
      assert.equal((await BG.verifyHuman({}, '', 'signup')).ok, true);
    } finally { delete process.env.TURNSTILE_SITE_KEY; delete process.env.TURNSTILE_SECRET_KEY; }
  });

  // ---------------- Límite de peticiones ----------------
  await t('límite persistente: usa bw_rate_hit de Supabase, bloquea al superar y no tumba la app si la base falla', async () => {
    assert.equal(await RL.rateLimit('payment_user', 'u1'), true);
    const c = FETCH.find((f) => f.url.includes('bw_rate_hit'));
    assert.deepEqual(JSON.parse(c.opts.body), { p_key: 'payment_user:u1', p_window_seconds: 600, p_max: 30 });
    RPC_RESULT = false; assert.equal(await RL.rateLimit('payment_user', 'u1'), false);
    RPC_RESULT = 'error'; assert.equal(await RL.rateLimit('payment_user', 'u1'), true, 'fail-open');
    assert.equal(await RL.rateLimit('accion_inexistente', 'u1'), true);
  });

  // ---------------- /api/signup ----------------
  await t('/api/signup: GET ?config=1 devuelve la clave pública (null sin claves)', async () => {
    const r = await call(signup, { method: 'GET', url: '/api/signup?config=1' });
    assert.equal(r.status, 200); assert.deepEqual(r.body, { turnstileSiteKey: null });
  });
  await t('/api/signup: honeypot → bot, nombre con insultos → content_blocked, límite → 429', async () => {
    assert.deepEqual((await call(signup, { body: { ...SIGNUP_OK, website: 'x' } })).body, { error: 'bot_detected' });
    const malo = await call(signup, { body: { ...SIGNUP_OK, fullName: 'Pendejo Pérez' } });
    assert.equal(malo.status, 400); assert.equal(malo.body.error, 'content_blocked');
    assert.ok(!FETCH.some((f) => f.url.includes('/auth/v1/signup')), 'no se crea la cuenta');
    RL.setRateLimitBackend(() => false);
    assert.equal((await call(signup, { body: SIGNUP_OK, headers: { 'x-real-ip': '203.0.113.99' } })).status, 429);
  });
  await t('/api/signup: con Turnstile activo exige token; con token válido registra', async () => {
    process.env.TURNSTILE_SITE_KEY = 's'; process.env.TURNSTILE_SECRET_KEY = 'k';
    try {
      const sin = await call(signup, { body: SIGNUP_OK, headers: { 'x-real-ip': '203.0.113.10' } });
      assert.equal(sin.status, 403); assert.equal(sin.body.error, 'captcha_required');
      const con = await call(signup, { body: { ...SIGNUP_OK, turnstileToken: 'ok' }, headers: { 'x-real-ip': '203.0.113.11' } });
      assert.equal(con.status, 200); assert.equal(con.body.user.id, 'u1');
    } finally { delete process.env.TURNSTILE_SITE_KEY; delete process.env.TURNSTILE_SECRET_KEY; }
  });

  // ---------------- /api/create-payment-intent ----------------
  const auth = { authorization: 'Bearer token-ok' };
  const RESERVA = { checkoutId: '11111111-2222-4333-8444-555555555555', liabilityAccepted: true, address: '1800 Oxmoor Rd, Homewood, AL', time: '09:00', petIds: ['p1'] };
  await t('/api/create-payment-intent: límite por usuario, honeypot y notas con insultos se rechazan antes de cobrar', async () => {
    RL.setRateLimitBackend(() => false);
    assert.equal((await call(payment, { headers: auth, body: RESERVA })).status, 429);
    RL.setRateLimitBackend(() => true);
    assert.deepEqual((await call(payment, { headers: auth, body: { ...RESERVA, website: 'spam' } })).body, { error: 'bot_detected' });
    const malo = await call(payment, { headers: auth, body: { ...RESERVA, notes: 'el perro es un hijo de puta' } });
    assert.equal(malo.status, 400); assert.equal(malo.body.error, 'content_blocked');
    assert.ok(!FETCH.some((f) => f.url.includes('/rest/v1/bookings')), 'no se crea ninguna reserva');
  });

  // ---------------- IA ----------------
  await t('IA: el system prompt prohíbe diagnósticos, dosis y consejo legal/médico definitivo', async () => {
    const S = chat.SYSTEM;
    for (const re of [/You are an AI assistant/, /Never diagnose/, /Never recommend, name or dose medications/, /confirmed with their veterinarian/,
      /do not give legal, insurance, tax or contractual advice/, /outside Barkwalk/, /Never ask for or repeat passwords/]) assert.match(S, re);
  });
  await t('IA y avisos en la app: textos bilingües de IA, antifuga y privacidad del mapa', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'bw-safety.js'), 'utf8');
    for (const re of [/Barky es una inteligencia artificial/, /Barky is an artificial intelligence/, /verifícalo con tu veterinario/,
      /no aceptes paseos ni pagos por fuera de Barkwalk USA/, /don't accept walks or payments outside Barkwalk USA/,
      /Tu ubicación nunca se comparte con el paseador/, /floatAiBox/, /publicAiBox/, /liabilityBox/]) assert.match(src, re);
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    for (const re of [/src="\/content-filter\.js/, /src="\/bw-safety\.js/, /id="hpSignup" name="website"/, /id="hpBooking" name="website"/,
      /BWSafety\.guardChat\(mensaje\)/, /BWSafety\.getHumanToken\('signup'\)/, /BWSafety\.getHumanToken\('booking'\)/, /La ubicación en vivo del dueño es privada/]) assert.match(html, re);
  });

  // ---------------- Cabeceras HTTP y arquitectura ----------------
  await t('vercel.json: cabeceras de seguridad en todas las rutas', async () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    const h = Object.fromEntries(cfg.headers.find((x) => x.source === '/(.*)').headers.map((x) => [x.key, x.value]));
    assert.equal(h['X-Content-Type-Options'], 'nosniff'); assert.equal(h['X-Frame-Options'], 'DENY');
    assert.equal(h['Referrer-Policy'], 'strict-origin-when-cross-origin');
    assert.match(h['Permissions-Policy'], /geolocation=\(self\)/); assert.match(h['Permissions-Policy'], /microphone=\(\)/);
    assert.match(h['Permissions-Policy'], /payment=\(self "https:\/\/js\.stripe\.com"\)/);
    assert.match(h['Strict-Transport-Security'], /max-age=\d+/);
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'"]) assert.ok(h['Content-Security-Policy'].includes(d), d);
    // Política completa (por orígenes) en Report-Only hasta comprobarla en producción sin violaciones
    const csp = h['Content-Security-Policy'] + '; ' + (h['Content-Security-Policy-Report-Only'] || '');
    for (const d of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) assert.ok(csp.includes(d), d);
    // Lo que la app necesita de verdad: Stripe, Supabase (REST + realtime), Turnstile, mapas y CDNs fijados
    for (const d of ['https://js.stripe.com', 'https://hooks.stripe.com', 'https://api.stripe.com', 'https://hdtgtrnbqoyvjasvzilr.supabase.co',
      'wss://hdtgtrnbqoyvjasvzilr.supabase.co', 'https://challenges.cloudflare.com', 'https://*.tile.openstreetmap.org', 'https://unpkg.com',
      'https://cdn.jsdelivr.net', 'https://api.open-meteo.com', 'https://nominatim.openstreetmap.org', 'https://api.mymemory.translated.net']) assert.ok(csp.includes(d), d);
    // Cada origen externo que carga index.html está permitido por la CSP
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    for (const [, src] of html.matchAll(/<script[^>]*src="(https:\/\/[^/"]+)/g)) assert.ok(csp.includes(src), 'script sin permiso en CSP: ' + src);
  });
  await t('CORS: solo barkwalkusa.com (+ localhost fuera de producción); sin Origin pasa', async () => {
    const { cors, isAllowedOrigin } = require(path.join(ROOT, 'api/_lib/http.js'));
    const run = (method, headers) => { const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } }; const done = cors({ method, headers }, res, { methods: 'POST' }); return { done, res }; };
    const prev = process.env.VERCEL_ENV;
    try {
      process.env.VERCEL_ENV = 'production';
      for (const o of ['https://barkwalkusa.com', 'https://www.barkwalkusa.com']) {
        const { done, res } = run('POST', { origin: o, host: 'barkwalkusa.com' });
        assert.equal(done, false); assert.equal(res.headers['Access-Control-Allow-Origin'], o);
      }
      const evil = run('POST', { origin: 'https://evil.example', host: 'barkwalkusa.com' });
      assert.equal(evil.done, true); assert.equal(evil.res.statusCode, 403); assert.equal(evil.res.headers['Access-Control-Allow-Origin'], undefined);
      assert.equal(run('POST', { origin: 'http://localhost:3000', host: 'barkwalkusa.com' }).res.statusCode, 403, 'localhost bloqueado en producción');
      assert.equal(run('POST', { origin: 'https://barkwalkusa.com.evil.example', host: 'barkwalkusa.com' }).res.statusCode, 403);
      assert.equal(run('POST', { origin: 'http://barkwalkusa.com', host: 'barkwalkusa.com' }).res.statusCode, 403, 'http:// no');
      assert.equal(run('POST', {}).done, false, 'sin Origin (Stripe, cron, curl) pasa');
      assert.equal(run('POST', { origin: 'https://barkwall-abc.vercel.app', host: 'barkwall-abc.vercel.app' }).done, false, 'mismo origen (preview) pasa');
      const pre = run('OPTIONS', { origin: 'https://www.barkwalkusa.com', host: 'barkwalkusa.com' });
      assert.equal(pre.done, true); assert.equal(pre.res.statusCode, 204); assert.match(pre.res.headers['Access-Control-Allow-Headers'], /Authorization/);
      process.env.VERCEL_ENV = 'development';
      assert.equal(isAllowedOrigin('http://localhost:5173', 'x'), true); assert.equal(isAllowedOrigin('http://127.0.0.1:3000', 'x'), true);
      assert.equal(isAllowedOrigin('http://localhost.evil.example', 'x'), false);
    } finally { if (prev === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = prev; }
    // Un handler real rechaza un origen ajeno antes de hacer nada
    const r = await call(payment, { headers: { origin: 'https://evil.example', host: 'barkwalkusa.com' }, body: {} });
    assert.equal(r.status, 403); assert.deepEqual(r.body, { error: 'origin_not_allowed' }); assert.equal(FETCH.length, 0);
  });
  await t('CORS: los 10 endpoints de navegador usan cors(); webhook y cron no lo necesitan', async () => {
    for (const f of ['chat', 'create-connect-account', 'create-payment-intent', 'create-subscription', 'customer-portal', 'dispatch', 'places', 'signup', 'walker-earnings', 'walker-payout']) {
      assert.match(fs.readFileSync(path.join(ROOT, `api/${f}.js`), 'utf8'), /if \(cors\(req, res/, f);
    }
  });
  await t('arquitectura: siguen siendo 12 funciones en api/ (límite del plan Hobby)', async () => {
    assert.equal(fs.readdirSync(path.join(ROOT, 'api')).filter((f) => f.endsWith('.js')).length, 12);
  });
  await t('migración de seguridad: cierra pet_passports público y la lectura global de pets', async () => {
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261126_security_hardening.sql'), 'utf8');
    assert.match(sql, /drop policy if exists "Acceso publico pet_passports"/); assert.match(sql, /drop policy if exists "Authenticated view pets"/);
    assert.match(sql, /revoke all on public\.pet_passports from anon/); assert.match(sql, /grant execute on function public\.bw_rate_hit\(text, int, int\) to service_role/);
  });

  console.log(`\n${passed} pruebas OK`);
})().catch((e) => { console.error('✗ FALLO:', e.stack); process.exit(1); });
