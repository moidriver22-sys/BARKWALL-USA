// Pruebas de los errores de Stripe Connect (onboarding del paseador). Ejecuta: npm test
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
process.env.SUPABASE_URL = 'http://fake.supabase';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
process.env.STRIPE_SECRET_KEY = 'sk_test_' + 'x'.repeat(30);
const { classifyConnectError } = require(path.join(ROOT, 'api/_lib/connect.js'));
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('✓', name); };

// Error REAL de producción (logs de Vercel, 2026-11-24, stripe.accounts.create)
const REAL = { type: 'StripeInvalidRequestError', message: 'You must complete your platform profile to use Connect and create live connected accounts. Visit your dashboard at https://dashboard.stripe.com/connect/accounts/overview to answer the questionnaire.' };

t('el error real de producción se reconoce: falta el "platform profile" de Connect (configuración, no reintento)', () => {
  assert.deepEqual(classifyConnectError(REAL), { error: 'connect_platform_incomplete', status: 503, setup: true });
});
t('otros errores de configuración de Connect y de cuenta conectada', () => {
  assert.equal(classifyConnectError({ message: "You can only create new accounts if you've signed up for Connect" }).error, 'connect_not_enabled');
  assert.equal(classifyConnectError({ message: 'The transfers capability is not available for accounts in this country' }).error, 'connect_capability_unavailable');
  assert.deepEqual(classifyConnectError({ code: 'account_invalid', message: 'The provided key does not have access to account' }), { error: 'connect_account_invalid', status: 409, setup: false });
  assert.equal(classifyConnectError({ code: 'resource_missing', message: 'No such account: acct_123' }).error, 'connect_account_invalid');
  assert.deepEqual(classifyConnectError({ message: 'Something else' }), { error: 'stripe_rejected', status: 402, setup: false });
});
t('la respuesta no expone el mensaje interno de Stripe al navegador', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/create-connect-account.js'), 'utf8');
  assert.match(src, /send\(res, c\.status, \{ error: c\.error, setup: c\.setup \}\)/);
  assert.match(src, /\[ACCIÓN REQUERIDA en Stripe\]/, 'log fácil de encontrar en Vercel');
});
t('la app muestra un mensaje claro por cada código (y la pista técnica solo a administradores)', () => {
  for (const code of ['connect_platform_incomplete', 'connect_not_enabled', 'connect_capability_unavailable', 'connect_account_invalid', 'rate_limited']) {
    assert.match(HTML, new RegExp(`${code}: \\[`), code);
  }
  assert.match(HTML, /const hint = isAdmin\(\) && CONNECT_ADMIN_HINT\[j\.error\]/);
  assert.match(HTML, /if \(j\.setup && m\) \{ showToast\('⏳ '/, 'configuración pendiente = aviso, no banner rojo');
});
t('sigue el límite de 12 funciones en api/', () => {
  assert.equal(fs.readdirSync(path.join(ROOT, 'api')).filter((f) => f.endsWith('.js')).length, 12);
});
console.log(`\n${n} pruebas OK`);
