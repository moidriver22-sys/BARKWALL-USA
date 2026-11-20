// Vercel Cron: GET /api/cron-payouts  (programado en vercel.json, una vez al día)
// ---------------------------------------------------------------------------
// Paga a los paseadores los días cuya retención de 48 h ya terminó (ver 20261114_walk_completion_hold.sql).
// Los días retenidos para revisión (sin GPS o con reporte del cliente) NO se pagan hasta que el admin
// los libere con admin_release_walk_payout(). Cada día se paga una sola vez (ver _lib/connect.js).
//
// Seguridad: Vercel envía "Authorization: Bearer <CRON_SECRET>". Sin CRON_SECRET configurado → 503.
// Variables: CRON_SECRET, STRIPE_SECRET_KEY, WALKER_PAYOUT_PERCENT, SUPABASE_*
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const { send, bearerToken } = require('./_lib/http');
const { isConfigured } = require('./_lib/supabase');
const { stripeKeyValid, getStripe, payoutPercent, walkersWithDuePayouts, payoutCompletedWalks } = require('./_lib/connect');

function secretOk(given) {
  const expected = process.env.CRON_SECRET || '';
  if (expected.length < 16 || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { error: 'method_not_allowed' }); }
  if (!process.env.CRON_SECRET || !stripeKeyValid(process.env.STRIPE_SECRET_KEY) || !isConfigured() || !payoutPercent()) {
    console.error('cron-payouts: faltan CRON_SECRET, STRIPE_SECRET_KEY, WALKER_PAYOUT_PERCENT o SUPABASE_*.');
    return send(res, 503, { error: 'not_configured' });
  }
  if (!secretOk(bearerToken(req))) return send(res, 401, { error: 'unauthorized' });

  const stripe = getStripe();
  const resumen = { walkers: 0, paid: 0, cents: 0, failed: 0, skipped: {} };
  try {
    const walkers = await walkersWithDuePayouts();
    for (const walkerId of walkers) {
      resumen.walkers++;
      const r = await payoutCompletedWalks(stripe, walkerId).catch((e) => ({ status: 'error', error: e.message, paid: [], failed: [] }));
      if (r.status !== 'ok') resumen.skipped[r.status] = (resumen.skipped[r.status] || 0) + 1; // p. ej. no_account
      resumen.paid += r.paid.length;
      resumen.cents += r.paid.reduce((s, p) => s + p.amount, 0);
      resumen.failed += r.failed.length;
    }
    console.log('cron-payouts:', JSON.stringify(resumen));
    return send(res, 200, resumen);
  } catch (e) {
    console.error('cron-payouts:', e.message);
    return send(res, 500, { error: 'internal_error', ...resumen });
  }
}

module.exports = handler;
