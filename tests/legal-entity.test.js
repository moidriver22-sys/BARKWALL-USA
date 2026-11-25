// Pruebas: identidad legal Barkwalk USA LLC en textos legales, pies de la web y correos. Ejecuta: npm test
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ADDR = '900 Beacon Crest Circle 917, Birmingham, AL 35209';
const COPY = '© 2026 Barkwalk USA LLC. All rights reserved.';
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('✓', name); };

t('documentos legales: contrato con la LLC de Alabama, Entity ID, domicilio, ley y condado de Jefferson', () => {
  for (const f of ['terminos-clientes.html', 'terminos-paseadores.html', 'privacidad.html']) {
    const s = read(f);
    assert.match(s, /a limited liability company organized under the laws of the State of Alabama/, f);
    assert.match(s, /sociedad de responsabilidad limitada/, f);
    assert.ok((s.match(/001-288-229/g) || []).length >= 4, f + ' Entity ID');
    assert.ok(s.includes(ADDR), f + ' dirección');
    assert.ok(s.includes('barkwalkusallc@gmail.com'), f + ' correo');
    assert.ok(s.includes(COPY), f + ' copyright');
    assert.ok(!/Doucleiver|persona física|sole proprietor|a título personal|personal capacity/.test(s), f + ' sin persona física');
  }
  for (const f of ['terminos-clientes.html', 'terminos-paseadores.html']) {
    assert.match(read(f), /Jefferson County, Alabama/); assert.match(read(f), /condado de Jefferson, Alabama/);
  }
});
t('app: exenciones nombran a la LLC; pie con copyright y dirección; sin nombres personales', () => {
  const s = read('index.html');
  assert.ok(!/Doucleiver/.test(s));
  assert.match(s, /liberas a Barkwalk USA LLC/); assert.match(s, /you release Barkwalk USA LLC/);
  assert.match(s, /libero a Barkwalk USA LLC/); assert.match(s, /I release Barkwalk USA LLC/);
  assert.ok(s.includes(COPY) && s.includes(ADDR));
});
t('correos (Resend y plantillas de Supabase): nombre legal, dirección física (CAN-SPAM) y copyright', () => {
  const L = require(path.join(ROOT, 'api/_lib/email-layout.js'));
  const html = L.emailShell({ title: 'x', preheader: 'x', bodyHtml: '<p>x</p>' });
  assert.ok(html.includes('Barkwalk USA LLC') && html.includes(ADDR) && html.includes(COPY));
  for (const f of ['confirm-signup.html', 'reset-password.html']) {
    const s = read('supabase/email-templates/' + f);
    assert.ok(s.includes(ADDR) && s.includes(COPY), f);
  }
});
console.log(`\n${n} pruebas OK`);
