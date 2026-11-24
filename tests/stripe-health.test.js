// Pruebas del diagnóstico de Stripe (api/_lib/stripe-health.js). Ejecuta: npm test
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const H = require(path.join(ROOT, 'api/_lib/stripe-health.js'));
const WEBHOOK_SRC = fs.readFileSync(path.join(ROOT, 'api/stripe-webhook.js'), 'utf8');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('✓', name); };

t('los eventos exigidos son exactamente los que procesa /api/stripe-webhook', () => {
  for (const ev of H.REQUIRED_EVENTS) assert.ok(WEBHOOK_SRC.includes(`'${ev}'`), ev);
});
t('webhook: detecta URL exacta, eventos que faltan y "todos los eventos"', () => {
  const site = 'https://www.barkwalkusa.com';
  const r = H.webhookReport([
    { id: 'we_123456789', url: `${site}/api/stripe-webhook`, status: 'enabled', livemode: true, enabled_events: ['payment_intent.succeeded', 'charge.refunded'] },
    { id: 'we_987654321', url: 'https://barkwalkusa.com/api/stripe-webhook', status: 'disabled', livemode: true, enabled_events: ['*'] },
    { id: 'we_otro', url: 'https://otro.example/hook', status: 'enabled', enabled_events: ['*'] },
  ], site);
  assert.equal(r.length, 2, 'ignora endpoints de otros servicios');
  assert.equal(r[0].exactUrl, true); assert.ok(r[0].missingEvents.includes('charge.dispute.created')); assert.ok(!r[0].missingEvents.includes('charge.refunded'));
  assert.equal(r[1].exactUrl, false, 'sin www redirige y Stripe no sigue redirecciones'); assert.equal(r[1].allEvents, true); assert.deepEqual(r[1].missingEvents, []);
  assert.ok(!JSON.stringify(r).includes('we_123456789'), 'ids recortados');
});
t('Apple Pay / Google Pay: estado por dominio (con y sin www)', () => {
  const r = H.domainReport([{ domain_name: 'www.barkwalkusa.com', enabled: true, apple_pay: { status: 'active' }, google_pay: { status: 'active' } }]);
  assert.deepEqual(r.map((d) => [d.domain, d.registered, d.applePay]), [['barkwalkusa.com', false, null], ['www.barkwalkusa.com', true, 'active']]);
});
t('/api/dispatch expone stripe_health protegido por CRON_SECRET (sin archivo nuevo en api/)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/dispatch.js'), 'utf8');
  assert.ok(src.indexOf("action') === 'stripe_health'") > src.indexOf('secretOk(bearerToken(req))'), 'después de validar el secreto');
  const fns = fs.readdirSync(path.join(ROOT, 'api')).filter((f) => f.endsWith('.js'));
  assert.equal(fns.length, 12, 'límite de 12 funciones del plan Hobby');
});
console.log(`\n${n} pruebas OK`);
