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
const { sendTestRefundEmail, sendTestPush } = require('./_lib/test-email');
// ?action=test_push&to=<correo> → notificación push de prueba a ese perfil (ver _lib/test-email.js)
const { runFinanceAudit } = require('./_lib/finance-agent');
// ?action=finance_audit[&dry=1] → Agente de Cobros y Finanzas (ver _lib/finance-agent.js)
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
  const dryRun = url.searchParams.get('dry') === '1';
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
  try {
    const r = await runDispatch({ dryRun });
    console.log('dispatch:', JSON.stringify({ ...r, alerts: undefined }));
    return send(res, 200, r);
  } catch (e) {
    console.error('dispatch:', e.message);
    return send(res, 500, { error: 'internal_error' });
  }
}

module.exports = handler;
