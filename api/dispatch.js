// Agente de Operaciones y Despacho: GET/POST /api/dispatch
// ---------------------------------------------------------------------------
// Lo dispara pg_cron (Supabase) cada 10 min: el plan Hobby de Vercel solo permite crons diarios
// (ver supabase/migrations/20261122_dispatch_agent.sql). Lógica y reglas en api/_lib/dispatch.js.
// Seguridad: "Authorization: Bearer <CRON_SECRET>" (el mismo secreto que /api/cron-payouts).
// ?dry=1 → informa qué alertas enviaría, sin reclamarlas ni enviarlas.
// Respuesta: { checked, planned, sent, skipped, failed, byKind, alerts: [{ kind, walk, role, status }] }
//   (sin correos ni nombres: solo tipo de alerta, referencia corta del paseo y rol del destinatario)
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const { send, bearerToken } = require('./_lib/http');
const { isConfigured } = require('./_lib/supabase');
const { runDispatch } = require('./_lib/dispatch');
const { sendTestRefundEmail, sendTestPush, sendTestGrowth } = require('./_lib/test-email');
// ?action=test_growth&to=<correo> → prueba de los 2 mensajes del Agente de Fidelización (push + correo [TEST])
// ?action=test_push&to=<correo> → notificación push de prueba a ese perfil (ver _lib/test-email.js)
const { runFinanceAudit } = require('./_lib/finance-agent');
// ?action=finance_audit[&dry=1] → Agente de Cobros y Finanzas (ver _lib/finance-agent.js)
const { runGrowth } = require('./_lib/growth-agent');
const { backfillEarnings } = require('./_lib/earnings');
const { stripeHealth } = require('./_lib/stripe-health');
const { processCancellations } = require('./_lib/cancellations');
const { processWalkerReviews } = require('./_lib/walker-reviews');
// ?action=walker_reviews[&dry=1] → avisa al paseador (push + correo) la decisión sobre su postulación
// ?action=cancellations[&dry=1] → reembolso automático (100 %) o aviso al equipo (50 % / casos especiales) por días cancelados
const { getStripe, siteUrl } = require('./_lib/connect');
// ?action=stripe_health → diagnóstico de SOLO LECTURA de Stripe: cuenta, webhook, Apple/Google Pay, Connect (ver _lib/stripe-health.js)
// ?action=backfill_earnings → rellena la ganancia neta del paseador en días ya creados (ver _lib/earnings.js)
// ?action=growth[&dry=1] → Agente de Fidelización y Crecimiento (ver _lib/growth-agent.js)
// ?action=test_refund_email&to=<correo>[&lang=en] → correo de reembolso [TEST] (ver _lib/test-email.js)

function secretOk(given) {
  const expected = process.env.CRON_SECRET || '';
  if (expected.length < 16 || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { error: 'method_not_allowed' }); }
  if (!process.env.CRON_SECRET || !isConfigured()) {
    console.error('dispatch: faltan CRON_SECRET o SUPABASE_*.');
    return send(res, 503, { error: 'not_configured' });
  }
  if (!secretOk(bearerToken(req))) return send(res, 401, { error: 'unauthorized' });

  const url = new URL(req.url || '/', 'http://localhost');
  if (url.searchParams.get('action') === 'stripe_health') {
    try { return send(res, 200, await stripeHealth(getStripe(), { siteUrl: siteUrl() })); }
    catch (e) { console.error('dispatch stripe_health:', e.type || '', e.message); return send(res, 500, { error: 'stripe_health_failed', type: e.type || null }); }
  }
  // Acción de soporte: correo de reembolso de PRUEBA con la configuración real de Resend (solo a OPS o a perfiles registrados)
  if (url.searchParams.get('action') === 'test_refund_email') {
    try {
      const r = await sendTestRefundEmail(url.searchParams.get('to'), url.searchParams.get('lang'));
      console.log('dispatch test_refund_email:', r.status, r.body.error || 'sent');
      return send(res, r.status, r.body);
    } catch (e) {
      console.error('dispatch test_refund_email:', e.message);
      return send(res, 500, { error: 'internal_error' });
    }
  }
  // Push de PRUEBA a los dispositivos de un perfil registrado (verifica VAPID + suscripción real)
  if (url.searchParams.get('action') === 'test_push') {
    try {
      const r = await sendTestPush(url.searchParams.get('to'));
      console.log('dispatch test_push:', r.status, JSON.stringify(r.body));
      return send(res, r.status, r.body);
    } catch (e) {
      console.error('dispatch test_push:', e.message);
      return send(res, 500, { error: 'internal_error' });
    }
  }
  if (url.searchParams.get('action') === 'backfill_earnings') {
    try {
      const r = await backfillEarnings();
      console.log('backfill_earnings:', JSON.stringify(r));
      return send(res, 200, r);
    } catch (e) {
      console.error('backfill_earnings:', e.message);
      return send(res, 500, { error: 'internal_error' });
    }
  }
  if (url.searchParams.get('action') === 'test_growth') {
    try {
      const r = await sendTestGrowth(url.searchParams.get('to'));
      console.log('dispatch test_growth:', r.status, JSON.stringify(r.body));
      return send(res, r.status, r.body);
    } catch (e) {
      console.error('dispatch test_growth:', e.message);
      return send(res, 500, { error: 'internal_error' });
    }
  }
  const dryRun = url.searchParams.get('dry') === '1';
  // Empleado virtual #3: Agente de Fidelización y Crecimiento (job 'barkwalk-growth' de pg_cron)
  if (url.searchParams.get('action') === 'growth') {
    try {
      const r = await runGrowth({ dryRun });
      console.log('growth:', JSON.stringify({ ...r, items: undefined }));
      return send(res, 200, r);
    } catch (e) {
      console.error('growth:', e.message);
      return send(res, 500, { error: 'internal_error' });
    }
  }
  // Empleado virtual #2: Agente de Cobros y Finanzas (job 'barkwalk-finance' de pg_cron)
  if (url.searchParams.get('action') === 'finance_audit') {
    try {
      const r = await runFinanceAudit({ dryRun });
      console.log('finance_audit:', JSON.stringify(r));
      return send(res, 200, r);
    } catch (e) {
      console.error('finance_audit:', e.message);
      return send(res, 500, { error: 'internal_error' });
    }
  }
  // Reembolsos por cancelación (al instante vía pg_net desde el trigger, y en cada ronda de 10 min como respaldo)
  if (url.searchParams.get('action') === 'walker_reviews') {
    try {
      const r = await processWalkerReviews({ dryRun });
      console.log('walker_reviews:', JSON.stringify(r));
      return send(res, 200, r);
    } catch (e) {
      console.error('walker_reviews:', e.message);
      return send(res, 500, { error: 'internal_error' });
    }
  }
  if (url.searchParams.get('action') === 'cancellations') {
    try {
      const r = await processCancellations({ stripe: getStripe(), dryRun });
      console.log('cancellations:', JSON.stringify({ ...r, items: undefined }));
      return send(res, 200, r);
    } catch (e) {
      console.error('cancellations:', e.message);
      return send(res, 500, { error: 'internal_error' });
    }
  }
  try {
    // Un fallo en los reembolsos nunca detiene las alertas de despacho (y viceversa)
    const cancelaciones = await (async () => processCancellations({ stripe: getStripe(), dryRun }))().catch((e) => ({ error: e.message }));
    const r = await runDispatch({ dryRun });
    r.cancellations = { ...cancelaciones, items: undefined };
    r.walkerReviews = await processWalkerReviews({ dryRun }).catch((e) => ({ error: e.message }));
    console.log('dispatch:', JSON.stringify({ ...r, alerts: undefined }));
    return send(res, 200, r);
  } catch (e) {
    console.error('dispatch:', e.message);
    return send(res, 500, { error: 'internal_error' });
  }
}

module.exports = handler;
