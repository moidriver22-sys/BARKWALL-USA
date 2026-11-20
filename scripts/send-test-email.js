// Envía el correo REAL de "Reserva confirmada" (el mismo buildEmail del webhook) a tu correo, con datos de ejemplo.
// No crea reservas, no cobra nada y no toca Supabase ni Stripe: solo llama a la API de Resend.
//
// Uso (PowerShell):
//   $env:RESEND_API_KEY = 're_...'                                  # Resend → API Keys
//   $env:EMAIL_FROM     = 'Barkwalk USA <no-reply@barkwalkusa.com>'
//   node scripts/send-test-email.js tu-correo@gmail.com en          # o "es"
//   node scripts/send-test-email.js --dry                           # solo genera test-email.html, sin enviar
//   node scripts/send-test-email.js tu-correo@gmail.com es --refund # correo de reembolso (remitente soporte@)
const fs = require('fs');
const path = require('path');
const { buildEmail } = require('../api/stripe-webhook');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const to = args.find((a) => a.includes('@'));
const lang = args.includes('es') ? 'es' : 'en';

const booking = {
  id: 'test0000-demo', lang,
  service_label: lang === 'es' ? '🚶 Paseo Estándar · 30 min' : '🚶 Standard Walk · 30 min',
  address: '1800 Oxmoor Rd, Homewood, AL',
  pets: [
    { name: 'Luna', breed: 'Golden Retriever', photo: 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&w=200&h=200&q=80' },
    { name: 'Max', breed: 'Beagle', photo: null }, // sin foto → emoji
  ],
  pets_count: 2, per_day_cents: 3000, currency: 'usd', scheduled_time: '09:30',
  dates: ['2026-12-01', '2026-12-02', '2026-12-04'],
};
// --refund: correo de "Reembolso confirmado" con los datos REALES del reembolso de prueba del 20/11
// (reserva 8e81294f…, $16.00, 1 día cancelado). La reserva ya se borró de Supabase, así que el webhook
// no puede reenviarlo; esto genera el mismo correo con la misma función de producción (buildRefundEmail).
const refund = args.includes('--refund');
let msg;
if (refund) {
  const { buildRefundEmail, testRefundSample } = require('../api/_lib/refund-email');
  msg = buildRefundEmail(testRefundSample(lang), args.find((a) => a.startsWith('--name='))?.slice(7) || '');
} else {
  msg = buildEmail(booking, { amount_received: 9000, currency: 'usd' }, 'Ana');
}
const subject = `[TEST] ${msg.subject}`;

(async () => {
  if (dry) {
    const out = path.join(process.cwd(), 'test-email.html');
    fs.writeFileSync(out, msg.html);
    console.log(`Vista previa: ${out}\nAsunto: ${subject}`);
    return;
  }
  if (!to) throw new Error('Indica el destinatario: node scripts/send-test-email.js tu-correo@gmail.com [en|es]');
  const key = (process.env.RESEND_API_KEY || '').trim();
  const from = refund ? (process.env.REFUND_EMAIL_FROM || 'Barkwalk USA <soporte@barkwalkusa.com>').trim() : (process.env.EMAIL_FROM || '').trim();
  if (!/^re_/.test(key) || !from) throw new Error('Define RESEND_API_KEY (re_...) y EMAIL_FROM antes de ejecutar.');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html: msg.html, text: msg.text }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Resend ${r.status}: ${JSON.stringify(j)}`);
  console.log(`✓ Enviado a ${to} (id ${j.id}). Asunto: ${subject}`);
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
