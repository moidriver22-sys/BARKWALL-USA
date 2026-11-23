// Pruebas: la duración del paseo en vivo es SIEMPRE la contratada y pagada en la reserva.
// Caso real investigado: "pagué $16 por 15 minutos y a mitad del paseo la pantalla decía 5 minutos".
// Ejecuta: npm test
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
process.env.SUPABASE_URL = 'http://fake.supabase';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
process.env.STRIPE_SECRET_KEY = 'sk_test_' + 'x'.repeat(24);
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const P = require(path.join(ROOT, 'api/_lib/pricing.js'));
const { durationMinutes: dispatchDuration } = require(path.join(ROOT, 'api/_lib/dispatch.js'));
const { bookingDuration } = require(path.join(ROOT, 'api/stripe-webhook.js'));
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Funciones reales de la app (index.html), evaluadas tal cual
function appFn(name) {
  const start = HTML.indexOf(`function ${name}(`);
  assert.ok(start > 0, `no se encontró ${name} en index.html`);
  let depth = 0, i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) { if (HTML[i] === '{') depth++; else if (HTML[i] === '}' && --depth === 0) break; }
  return HTML.slice(start, i + 1);
}
const ctx = {};
vm.runInNewContext(`${appFn('minWalkMinutes')}\n${appFn('walkMinutesLeft')}\nthis.minWalkMinutes = minWalkMinutes; this.walkMinutesLeft = walkMinutesLeft;`, ctx);

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('✓', name); };

(async () => {
  await t('caso del bug: Paseo Estándar de $16 = 15 minutos contratados (del catálogo del servidor)', async () => {
    const q = P.computeQuote({ serviceId: 'walk_std', variantIdx: 0, petsCount: 1, dates: ['2099-01-01'] }, { today: '2098-12-31' });
    assert.equal(q.perDayCents, 1600);
    assert.equal(q.durationLabel, '15 min');
    assert.equal(q.durationMinutes, 15);
  });

  await t('el día de paseo hereda la duración de la reserva, aunque la etiqueta diga otra cosa', async () => {
    // duration_label (guardada al cobrar) manda sobre cualquier texto
    assert.equal(bookingDuration({ duration_label: '15 min', service_label: '🚶 Paseo Estándar · 5 min', service_id: 'walk_std', variant_idx: 0 }), '15 min');
    // Reserva anterior a la columna: se reconstruye desde el catálogo (servicio + opción), no del texto
    assert.equal(bookingDuration({ service_id: 'walk_std', variant_idx: 0, service_label: 'texto roto' }), '15 min');
    assert.equal(bookingDuration({ service_id: 'walk_vip', variant_idx: 1 }), '60 min');
    // Último recurso: la etiqueta
    assert.equal(bookingDuration({ service_label: '🏃 Running / Atlético · 45 min' }), '45 min');
  });

  await t('pantalla del paseo: con 15 min contratados el mínimo para completar es 12 min (no 5)', async () => {
    assert.equal(ctx.minWalkMinutes('15 min'), 12);
    assert.equal(ctx.minWalkMinutes('5 min'), 5, 'lo que pasaba con el paseo de prueba guardado como "5 min"');
    // A mitad del paseo (7.5 min de 15): faltan 5 min para el mínimo, y la duración contratada sigue siendo 15
    const started = new Date(Date.now() - 7.5 * 60000).toISOString();
    assert.equal(ctx.walkMinutesLeft({ duration: '15 min', started_at: started }), 5);
    assert.equal(ctx.walkMinutesLeft({ duration: '15 min', started_at: new Date(Date.now() - 13 * 60000).toISOString() }), 0);
  });

  await t('la app y la base usan la misma regla del mínimo (80 %, mínimo 5) para todas las opciones', async () => {
    const sqlRule = (label) => { // espejo de private.bw_min_walk_minutes
      const d = label.toLowerCase();
      if (/night|noche/.test(d)) return 480; if (/\bday\b|d[ií]a/.test(d)) return 360;
      const m = d.match(/(\d+(?:\.\d+)?)/); if (!m) return 15;
      let n = Number(m[1]); if (/\b(h|hr|hrs|hour|hours|hora|horas)\b/.test(d)) n *= 60;
      return Math.max(5, Math.floor(n * 0.8));
    };
    for (const svc of Object.values(P.SERVICES)) for (const [label] of svc.variants) assert.equal(ctx.minWalkMinutes(label), sqlRule(label), label);
  });

  await t('una sola fuente de minutos: reserva, webhook y Agente de Despacho usan la misma función', async () => {
    assert.equal(dispatchDuration, P.durationMinutes);
    const casos = { '15 min': 15, '30 min': 30, '45 min': 45, '60 min': 60, '1 h': 60, '1 day': 600, '1 night': 720 };
    for (const [k, v] of Object.entries(casos)) assert.equal(P.durationMinutes(k), v, k);
  });

  await t('el catálogo de la app coincide con el del servidor (misma opción = misma duración y precio)', async () => {
    // Si el orden o las etiquetas difirieran, el cliente elegiría "15 min" y el servidor cobraría/guardaría otra opción
    const ini = HTML.indexOf('const SERVICE_CATALOG = [');
    const fin = HTML.indexOf('];', HTML.indexOf("id: 'overnight'", ini)) + 2;
    const cat = vm.runInNewContext(`${HTML.slice(ini, fin)}; SERVICE_CATALOG`);
    const app = {};
    for (const g of cat) for (const s of g.services) app[s.id] = s.variants.map((v) => [typeof v.label === 'string' ? v.label : v.label.en, v.price]);
    for (const [id, svc] of Object.entries(P.SERVICES)) assert.deepEqual(app[id], svc.variants, `catálogo distinto en ${id}`);
  });

  await t('el cobro guarda la duración contratada en la reserva y la base la impone en los días', async () => {
    const cpi = fs.readFileSync(path.join(ROOT, 'api/create-payment-intent.js'), 'utf8');
    assert.match(cpi, /duration_label: quote\.durationLabel, duration_minutes: quote\.durationMinutes/);
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261128_walk_duration_from_booking.sql'), 'utf8');
    assert.match(sql, /before insert or update of duration, booking_id on public\.walk_requests/);
    assert.match(sql, /if v is not null then new\.duration := v; end if;/);
  });

  console.log(`\n${passed} pruebas OK`);
})().catch((e) => { console.error('✗ FALLO:', e.stack); process.exit(1); });
