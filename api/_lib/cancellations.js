// Reembolsos por cancelación de días de paseo (Términos para Clientes, sección 6)
// ---------------------------------------------------------------------------
// La base anota cada cancelación de un día PAGADO en public.walk_cancellations (trigger de walk_requests,
// migración 20261130_walk_cancellation_refunds.sql): quién canceló, si ya había paseador y cuántas horas faltaban.
// Aquí se decide y se ejecuta (lo llama /api/dispatch: al instante vía pg_net y cada 10 min como respaldo):
//   · 100 % AUTOMÁTICO  → canceló el Paseador o Barkwalk; o el cliente antes de que alguien aceptara; o con ≥ 24 h
//   · 50 %  → AVISO al equipo (correo + push) con el monto exacto: el cliente canceló con < 24 h y ya había paseador
//   · casos especiales → AVISO (disputa abierta, reserva ya reembolsada, sin hora, saldo insuficiente…)
//   · 'system' (cancelaciones del propio servidor por reembolso total o disputa) → se ignoran: ya están cubiertas
// Montos: SIEMPRE el precio de UN día que pagó el cliente (bookings.per_day_cents). Nunca viajan a walk_requests
// (que leen los paseadores): viven en walk_cancellations (solo el cliente dueño y admin).
// Idempotente: reclamo atómico (status pending → refunding) + idempotencyKey por día en Stripe.
// ---------------------------------------------------------------------------
const { sb, sbOrThrow, enc } = require('./supabase');
const { sendPushToUsers, adminUserIds } = require('./push');
const L = require('./email-layout');

const HALF_PCT = 50;
const FULL_HOURS = 24;
const MAX_PER_RUN = 25;

// Decisión pura (probada en tests/cancellations.test.js)
//   c: fila de walk_cancellations · b: reserva (per_day_cents, total_cents, refunded_cents, payment_status, dispute_status)
function decideRefund(c, b) {
  if (!c || c.cancelled_by === 'system') return { action: 'skip', reason: 'server_cancellation' };
  const perDay = Math.max(0, Number(b && b.per_day_cents) || 0);
  const restante = Math.max(0, (Number(b && b.total_cents) || 0) - (Number(b && b.refunded_cents) || 0));
  if (!b || b.payment_status !== 'paid') return { action: 'review', reason: 'booking_not_paid', suggestedCents: 0 };
  if (b.dispute_status && !['won', 'warning_closed'].includes(b.dispute_status)) return { action: 'review', reason: 'dispute_open', suggestedCents: 0 };
  if (!perDay) return { action: 'review', reason: 'no_price', suggestedCents: 0 };

  let pct = null, why = '';
  if (c.cancelled_by === 'walker') { pct = 100; why = 'walker_cancelled'; }
  else if (c.cancelled_by === 'admin') { pct = 100; why = 'barkwalk_cancelled'; }
  else if (c.cancelled_by === 'client') {
    const h = c.hours_before == null ? null : Number(c.hours_before);
    if (!c.walker_assigned) { pct = 100; why = 'before_acceptance'; }
    else if (h != null && h >= FULL_HOURS) { pct = 100; why = 'at_least_24h'; }
    else if (h != null && ['pending', 'accepted', null, undefined].includes(c.prev_status)) {
      return { action: 'review', reason: 'late_cancellation_50', suggestedCents: Math.min(restante, Math.round(perDay * HALF_PCT / 100)) };
    } else return { action: 'review', reason: 'special_case', suggestedCents: 0 };
  } else return { action: 'review', reason: 'unknown_actor', suggestedCents: 0 };

  const cents = Math.round(perDay * pct / 100);
  if (cents > restante) return { action: 'review', reason: 'exceeds_remaining', suggestedCents: restante };
  return { action: 'refund', reason: why, cents };
}

// ¿Un reembolso PARCIAL de Stripe se explica por cancelaciones de días? (para no retener los demás días)
//   refundedCents: total reembolsado del cargo · cancels: filas de walk_cancellations de esa reserva
// Devuelve { explained, manualIds }: manualIds = avisos del 50 % que el admin acaba de reembolsar a mano.
function explainPartialRefund(refundedCents, cancels) {
  const auto = (cancels || []).filter((c) => ['refunding', 'refunded'].includes(c.status)).reduce((s, c) => s + (Number(c.refund_cents) || 0), 0);
  const manualHechos = (cancels || []).filter((c) => c.status === 'refunded_manual').reduce((s, c) => s + (Number(c.refund_cents) || 0), 0);
  const base = auto + manualHechos;
  const refunded = Number(refundedCents) || 0;
  if (refunded <= base) return { explained: true, manualIds: [] };
  // Lo que falta debe coincidir EXACTAMENTE con la suma de avisos pendientes (los del 50 %, p. ej.)
  const pendientes = (cancels || []).filter((c) => c.status === 'needs_review' && Number(c.suggested_cents) > 0);
  const falta = refunded - base;
  // Busca el subconjunto (en orden) cuya suma sea exactamente lo que falta: casi siempre 1 o 2 días
  let acc = 0; const ids = [];
  for (const c of pendientes) { if (acc + Number(c.suggested_cents) <= falta) { acc += Number(c.suggested_cents); ids.push(c.walk_id); } if (acc === falta) break; }
  return acc === falta ? { explained: true, manualIds: ids } : { explained: false, manualIds: [] };
}

// ---------- Aviso al equipo (correo de Resend + push a administradores) ----------
const money = (c) => `$${(Math.max(0, Number(c) || 0) / 100).toFixed(2)}`;
const REASON_TEXT = {
  late_cancellation_50: 'El cliente canceló con menos de 24 h y el paseo ya tenía paseador: según los Términos corresponde un reembolso del 50 %.',
  dispute_open: 'La reserva tiene una disputa abierta: no se reembolsa automáticamente.',
  booking_not_paid: 'La reserva ya no figura como pagada (¿reembolso total previo?).',
  exceeds_remaining: 'El reembolso de este día supera lo que queda por reembolsar del cargo.',
  no_price: 'La reserva no tiene precio por día registrado.',
  special_case: 'Caso especial: revisa el historial del paseo.',
  unknown_actor: 'No se pudo determinar quién canceló.',
  refund_failed: 'Stripe rechazó el reembolso automático.',
};
function buildOpsEmail(c, b, d, walk) {
  const sugerido = d.suggestedCents > 0 ? money(d.suggestedCents) : 'a criterio del equipo';
  const fecha = walk && walk.scheduled_date ? `${walk.scheduled_date} ${String(walk.scheduled_time || '').slice(0, 5)}` : '—';
  const filas = [
    ['Reserva', String(b && b.id || c.booking_id)], ['Día cancelado', fecha], ['Canceló', c.cancelled_by],
    ['Horas de anticipación', c.hours_before == null ? '—' : String(c.hours_before)], ['Ya tenía paseador', c.walker_assigned ? 'sí' : 'no'],
    ['Precio del día', money(b && b.per_day_cents)], ['Reembolso sugerido', sugerido],
  ];
  const html = L.emailShell({
    title: 'Cancelación a revisar', lang: 'es',
    preheader: `Cancelación a revisar · ${sugerido}`,
    bodyHtml: `<h1 style="margin:0 0 8px;font-family:${L.FONT};font-size:20px;color:${L.C.ink}">↩️ Cancelación a revisar</h1>
      <p style="margin:0 0 14px">${L.esc(REASON_TEXT[d.reason] || d.reason)}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${L.C.line}">${filas.map(([k, v]) =>
        `<tr><td style="padding:7px 0;border-bottom:1px solid ${L.C.line};color:${L.C.muted};font-size:13px">${L.esc(k)}</td><td align="right" style="padding:7px 0;border-bottom:1px solid ${L.C.line};font-weight:700;font-size:13px">${L.esc(v)}</td></tr>`).join('')}</table>
      <p style="margin:16px 0 0;font-size:13px">Para reembolsar: Stripe → Payments → el cobro de esta reserva → <strong>Refund</strong> por <strong>${L.esc(sugerido)}</strong>.
      Si el monto coincide exactamente, la app lo reconoce y los demás días de la reserva siguen su curso normal.</p>`,
  });
  const text = `Cancelación a revisar. ${REASON_TEXT[d.reason] || d.reason}\n${filas.map(([k, v]) => `${k}: ${v}`).join('\n')}`;
  return { subject: `[Ops] Cancelación a revisar · reembolso sugerido ${sugerido}`, html, text };
}

async function alertOps(c, b, d, walk) {
  const out = { push: 0, email: false };
  const push = await sendPushToUsers(await adminUserIds().catch(() => []), {
    title: '[Ops] Cancelación a revisar', body: `${d.suggestedCents > 0 ? 'Reembolso sugerido ' + money(d.suggestedCents) : 'Revisión manual'} · ${walk && walk.scheduled_date || ''}`,
    url: '/', tag: `cancel-${String(c.walk_id).slice(0, 12)}`, urgent: true,
  }).catch(() => ({ sent: 0 }));
  out.push = push.sent || 0;
  const key = (process.env.RESEND_API_KEY || '').trim();
  if (key) {
    const msg = buildOpsEmail(c, b, d, walk);
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `cancel-${c.walk_id}-${d.reason}` },
      body: JSON.stringify({ from: (process.env.DISPATCH_EMAIL_FROM || process.env.EMAIL_FROM || 'Barkwalk USA <no-reply@barkwalkusa.com>').trim(),
        to: [(process.env.OPS_ALERT_EMAIL || L.SUPPORT).trim()], reply_to: L.SUPPORT, subject: msg.subject, html: msg.html, text: msg.text }),
    });
    out.email = r.ok;
  }
  return out;
}

const patch = (walkId, body, extra = '') => sbOrThrow(`/rest/v1/walk_cancellations?walk_id=eq.${enc(walkId)}${extra}`,
  { method: 'PATCH', body, prefer: 'return=representation' });

// ---------- Ejecución ----------
async function processCancellations({ stripe, dryRun = false } = {}) {
  const rows = await sbOrThrow(`/rest/v1/walk_cancellations?status=eq.pending&select=*&order=cancelled_at.asc&limit=${MAX_PER_RUN}`);
  const out = { checked: rows.length, refunded: 0, review: 0, skipped: 0, failed: 0, dryRun, items: [] };
  for (const c of rows) {
    const [b] = await sbOrThrow(`/rest/v1/bookings?id=eq.${enc(c.booking_id)}&select=id,per_day_cents,total_cents,refunded_cents,payment_status,dispute_status,stripe_payment_intent_id,currency&limit=1`);
    const [walk] = await sbOrThrow(`/rest/v1/walk_requests?id=eq.${enc(c.walk_id)}&select=id,scheduled_date,scheduled_time&limit=1`);
    const d = decideRefund(c, b);
    out.items.push({ walk: String(c.walk_id).slice(0, 8), by: c.cancelled_by, action: d.action, reason: d.reason });
    if (dryRun) continue;
    const now = new Date().toISOString();

    if (d.action === 'skip') { await patch(c.walk_id, { status: 'skipped', decision: d.reason, processed_at: now }, '&status=eq.pending'); out.skipped++; continue; }

    if (d.action === 'review') {
      const claimed = await patch(c.walk_id, { status: 'needs_review', decision: d.reason, suggested_cents: d.suggestedCents, processed_at: now }, '&status=eq.pending');
      if (!claimed.length) continue; // otra ejecución ya lo tomó
      const a = await alertOps(c, b, d, walk).catch((e) => ({ error: e.message }));
      await sb(`/rest/v1/walk_cancellations?walk_id=eq.${enc(c.walk_id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { notified_at: a.error ? null : now, error: a.error || null } });
      out.review++; continue;
    }

    // Reembolso automático: primero se anota "refunding" con el monto (el webhook charge.refunded lo reconoce aunque llegue antes)
    const claimed = await patch(c.walk_id, { status: 'refunding', decision: d.reason, refund_cents: d.cents }, '&status=eq.pending');
    if (!claimed.length) continue;
    try {
      const refund = await stripe.refunds.create({
        payment_intent: b.stripe_payment_intent_id, amount: d.cents, reason: 'requested_by_customer',
        metadata: { kind: 'walk_cancellation', booking_id: String(b.id), walk_id: String(c.walk_id), rule: d.reason },
      }, { idempotencyKey: `bw-cancel-refund-${c.walk_id}` });
      await patch(c.walk_id, { status: 'refunded', stripe_refund_id: refund.id, processed_at: new Date().toISOString(), error: null });
      out.refunded++;
    } catch (e) {
      console.error(`Reembolso automático (walk ${c.walk_id}):`, e.message);
      await patch(c.walk_id, { status: 'needs_review', decision: 'refund_failed', refund_cents: null, suggested_cents: d.cents, error: String(e.message || e).slice(0, 300), processed_at: new Date().toISOString() });
      await alertOps(c, b, { reason: 'refund_failed', suggestedCents: d.cents }, walk).catch(() => {});
      out.failed++;
    }
  }
  return out;
}

module.exports = { decideRefund, explainPartialRefund, processCancellations, buildOpsEmail, HALF_PCT, FULL_HOURS };
