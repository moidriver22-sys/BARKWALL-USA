// Agente de Cobros y Finanzas ("empleado virtual" #2)
// ---------------------------------------------------------------------------
// Se invoca con /api/dispatch?action=finance_audit (CRON_SECRET). pg_cron: job 'barkwalk-finance' cada 6 h.
// 1) ANOMALÍAS (correo consolidado a OPS_ALERT_EMAIL; cada una se avisa UNA sola vez):
//    · payout_overdue       paseo completado y cobrado, elegible hace > FINANCE_PAYOUT_GRACE_HOURS (24) y sin pagar
//    · payout_failed        walker_payout_status = 'failed' (Stripe rechazó la transferencia)
//    · payout_stuck         'processing' desde hace > 2 h (el cron se cortó a mitad)
//    · review_stale         retenido para revisión del admin desde hace > FINANCE_REVIEW_STALE_HOURS (72)
//    · paid_without_walks   reserva pagada hace > 1 h sin días creados (el webhook no pudo insertarlos)
//    · paid_not_recorded    Stripe cobró, pero la reserva sigue 'awaiting_payment' (webhook perdido)
//    · refund_not_recorded  Stripe reembolsó más de lo que registra la reserva (refunded_cents)
//    · charge_without_booking  cobro de reserva (metadata.booking_id) sin fila en bookings y sin reembolso total
// 2) RESUMEN DIARIO (día anterior en hora de Birmingham): ingresos brutos, reembolsos, pagos a paseadores,
//    reversiones y anomalías abiertas. Solo si hubo actividad o anomalías (FINANCE_SUMMARY_ALWAYS=true → siempre).
// Idempotencia: reutiliza public.dispatch_alerts (clave única walk_id + kind) con claves 'fin:<tipo>:<id>' y
// 'fin-summary:<YYYY-MM-DD>'. Se reclama ANTES de enviar y se libera si el envío falla (se reintenta luego).
// Sin STRIPE_SECRET_KEY válida, las comprobaciones contra Stripe se omiten (se indica en el resumen).
// ---------------------------------------------------------------------------
const { sb, sbOrThrow, enc } = require('./supabase');
const { localToUtcIso } = require('./time');
const L = require('./email-layout');

const H = 3600 * 1000;
const fmt = (cents) => `$${((Number(cents) || 0) / 100).toFixed(2)}`;
function num(name, def) { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : def; }
function config() {
  return {
    payoutGraceH: num('FINANCE_PAYOUT_GRACE_HOURS', 24),
    reviewStaleH: num('FINANCE_REVIEW_STALE_HOURS', 72),
    stuckH: 2, paidNoWalksH: 1, awaitingMinH: 0.5,
    stripeLookbackH: 72,
    summaryAlways: String(process.env.FINANCE_SUMMARY_ALWAYS || '').toLowerCase() === 'true',
    opsEmail: (process.env.OPS_ALERT_EMAIL || L.SUPPORT).trim(),
    from: (process.env.DISPATCH_EMAIL_FROM || process.env.EMAIL_FROM || 'Barkwalk USA <no-reply@barkwalkusa.com>').trim(),
  };
}
const ts = (v) => (v ? Date.parse(v) : NaN);
const older = (v, hours, now) => Number.isFinite(ts(v)) && now - ts(v) > hours * H;

// Día de Birmingham (YYYY-MM-DD) de un instante, y sus límites en UTC
function chicagoYmd(t) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}
function dayBounds(ymd) {
  const start = Date.parse(localToUtcIso(ymd, '00:00'));
  const next = new Date(`${ymd}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  return { start, end: Date.parse(localToUtcIso(next.toISOString().slice(0, 10), '00:00')) };
}

// ---------- Datos ----------
async function loadDb(now) {
  const desde = new Date(now - 30 * 24 * H).toISOString();
  const walks = await sbOrThrow('/rest/v1/walk_requests?status=eq.completed&booking_id=not.is.null'
    + '&select=id,booking_id,walker_id,payment_status,completed_at,payout_eligible_at,payout_review_required,payout_review_reason,walker_payout_status,walker_payout_cents,walker_transfer_id,walker_paid_at,walker_payout_error,walker_reversed_at'
    + `&completed_at=gte.${enc(desde)}&limit=2000`);
  const bookings = await sbOrThrow('/rest/v1/bookings?select=id,status,payment_status,total_cents,refunded_cents,refunded_at,paid_at,created_at,stripe_payment_intent_id,walks_created_at,dispute_status'
    + `&created_at=gte.${enc(desde)}&limit=2000`);
  return { walks, bookings };
}

async function listAll(listFn, params, maxPages = 5) {
  const out = [];
  let starting_after;
  for (let i = 0; i < maxPages; i++) {
    const page = await listFn({ ...params, limit: 100, ...(starting_after ? { starting_after } : {}) });
    out.push(...(page.data || []));
    if (!page.has_more || !page.data || !page.data.length) break;
    starting_after = page.data[page.data.length - 1].id;
  }
  return out;
}

// ---------- Detección (funciones puras: fáciles de probar) ----------
function detectDbAnomalies({ walks, bookings }, now, cfg) {
  const a = [];
  const add = (type, id, detail) => a.push({ type, key: `fin:${type}:${id}`, ref: String(id).slice(0, 8), detail });
  for (const w of walks) {
    if (w.walker_transfer_id || w.payment_status !== 'paid') continue;
    if (w.walker_payout_status === 'failed') add('payout_failed', w.id, w.walker_payout_error || 'Stripe rechazó la transferencia');
    else if (w.walker_payout_status === 'processing' && older(w.walker_paid_at || w.payout_eligible_at, cfg.stuckH, now)) add('payout_stuck', w.id, 'En "processing" sin transferencia');
    else if (w.payout_review_required && older(w.payout_eligible_at || w.completed_at, cfg.reviewStaleH, now)) add('review_stale', w.id, w.payout_review_reason || 'Retenido para revisión');
    else if (!w.payout_review_required && w.walker_payout_status === 'unpaid' && older(w.payout_eligible_at, cfg.payoutGraceH, now)) add('payout_overdue', w.id, '¿El paseador vinculó su cuenta de Stripe?');
  }
  for (const b of bookings) {
    if (b.payment_status === 'paid' && !b.walks_created_at && older(b.paid_at || b.created_at, cfg.paidNoWalksH, now)) add('paid_without_walks', b.id, `Cobrada ${fmt(b.total_cents)} sin días de paseo`);
  }
  return a;
}

function detectStripeAnomalies(charges, bookings, now, cfg) {
  const a = [];
  const add = (type, id, detail) => a.push({ type, key: `fin:${type}:${id}`, ref: String(id).slice(0, 8), detail });
  const byPi = new Map(bookings.filter((b) => b.stripe_payment_intent_id).map((b) => [b.stripe_payment_intent_id, b]));
  const byId = new Map(bookings.map((b) => [String(b.id), b]));
  for (const ch of charges) {
    if (ch.status !== 'succeeded' || !ch.paid) continue;
    const pi = typeof ch.payment_intent === 'string' ? ch.payment_intent : ch.payment_intent && ch.payment_intent.id;
    const bookingId = ch.metadata && ch.metadata.booking_id;
    const b = (pi && byPi.get(pi)) || (bookingId && byId.get(String(bookingId)));
    if (!b) {
      // Solo cobros de reservas (las membresías no llevan booking_id) y que no estén reembolsados del todo
      if (bookingId && !(ch.refunded || (ch.amount_refunded || 0) >= ch.amount)) add('charge_without_booking', ch.id, `Cobro ${fmt(ch.amount)} de la reserva ${String(bookingId).slice(0, 8)} que no existe en Supabase`);
      continue;
    }
    if (b.payment_status !== 'paid' && b.payment_status !== 'refunded' && b.status === 'awaiting_payment' && now - ch.created * 1000 > cfg.awaitingMinH * H) {
      add('paid_not_recorded', b.id, `Stripe cobró ${fmt(ch.amount)} pero la reserva sigue esperando pago`);
    }
    if ((ch.amount_refunded || 0) > (Number(b.refunded_cents) || 0)) {
      add('refund_not_recorded', b.id, `Stripe reembolsó ${fmt(ch.amount_refunded)}; Supabase registra ${fmt(b.refunded_cents)}`);
    }
  }
  return a;
}

function summarize({ walks, bookings }, charges, refunds, ymd, stripeOk) {
  const { start, end } = dayBounds(ymd);
  const inDay = (v) => { const t = typeof v === 'number' ? v * 1000 : ts(v); return t >= start && t < end; };
  const s = { day: ymd, stripe: stripeOk };
  if (stripeOk) {
    const cobros = charges.filter((c) => c.status === 'succeeded' && c.paid && inDay(c.created));
    s.grossCents = cobros.reduce((x, c) => x + c.amount, 0); s.charges = cobros.length;
    const rs = refunds.filter((r) => r.status !== 'failed' && r.status !== 'canceled' && inDay(r.created));
    s.refundCents = rs.reduce((x, r) => x + r.amount, 0); s.refunds = rs.length;
  } else {
    const pagadas = bookings.filter((b) => inDay(b.paid_at));
    s.grossCents = pagadas.reduce((x, b) => x + (Number(b.total_cents) || 0), 0); s.charges = pagadas.length;
    const re = bookings.filter((b) => inDay(b.refunded_at));
    s.refundCents = re.reduce((x, b) => x + (Number(b.refunded_cents) || 0), 0); s.refunds = re.length;
  }
  const pagos = walks.filter((w) => w.walker_transfer_id && inDay(w.walker_paid_at));
  s.payoutCents = pagos.reduce((x, w) => x + (Number(w.walker_payout_cents) || 0), 0); s.payouts = pagos.length;
  s.reversals = walks.filter((w) => inDay(w.walker_reversed_at)).length;
  s.openDisputes = bookings.filter((b) => b.dispute_status && !['won', 'lost', 'warning_closed'].includes(b.dispute_status)).length;
  s.activity = s.charges + s.refunds + s.payouts + s.reversals > 0;
  return s;
}

// ---------- Correos ----------
const LABEL = {
  payout_overdue: 'Liquidación vencida', payout_failed: 'Liquidación fallida', payout_stuck: 'Liquidación atascada',
  review_stale: 'Revisión pendiente', paid_without_walks: 'Reserva pagada sin días', paid_not_recorded: 'Cobro no registrado',
  refund_not_recorded: 'Reembolso no registrado', charge_without_booking: 'Cobro sin reserva',
};
function anomaliesTable(list) {
  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border-top:1px solid ${L.C.line}">${list.map((x) => `
    <tr><td style="padding:9px 0;border-bottom:1px solid ${L.C.line};font-size:13px;font-weight:800;color:#B3412E;white-space:nowrap;vertical-align:top">${L.esc(LABEL[x.type] || x.type)}</td>
        <td style="padding:9px 0 9px 12px;border-bottom:1px solid ${L.C.line};font-size:13px;color:${L.C.text}"><strong>#${L.esc(x.ref)}</strong> · ${L.esc(x.detail)}</td></tr>`).join('')}</table>`;
}
function buildAlertEmail(list) {
  const body = `<h1 style="margin:0 0 8px;font-family:${L.FONT};font-size:22px;line-height:28px;font-weight:800;color:${L.C.ink}">⚠️ ${list.length} alerta(s) financiera(s)</h1>
    <p style="margin:0 0 14px">El Agente de Cobros y Finanzas detectó estas situaciones nuevas. Revísalas en Supabase y en Stripe.</p>${anomaliesTable(list)}`;
  const subject = `[Finanzas] ${list.length} alerta(s): ${[...new Set(list.map((x) => LABEL[x.type]))].join(', ')}`.slice(0, 180);
  return { subject, html: L.emailShell({ title: subject, preheader: subject, lang: 'es', bodyHtml: body, footerNote: 'Alerta automática del Agente de Cobros y Finanzas.' }),
    text: list.map((x) => `${LABEL[x.type]} #${x.ref}: ${x.detail}`).join('\n') };
}
function buildSummaryEmail(s, open) {
  const fila = (k, v, fuerte) => `<tr><td style="padding:9px 0;border-bottom:1px solid ${L.C.line};font-size:14px;color:${L.C.muted}">${k}</td>
    <td align="right" style="padding:9px 0 9px 12px;border-bottom:1px solid ${L.C.line};font-size:${fuerte ? 17 : 14}px;font-weight:700;color:${fuerte ? L.C.ink : L.C.text}">${L.esc(v)}</td></tr>`;
  const neto = s.grossCents - s.refundCents - s.payoutCents;
  const body = `<h1 style="margin:0 0 6px;font-family:${L.FONT};font-size:22px;line-height:28px;font-weight:800;color:${L.C.ink}">Cierre financiero · ${L.esc(s.day)}</h1>
    <p style="margin:0 0 14px;color:${L.C.muted};font-size:13px">Día completo en hora de Birmingham. Fuente de cobros y reembolsos: ${s.stripe ? 'Stripe' : 'Supabase (Stripe no disponible)'}.</p>
    <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border-top:1px solid ${L.C.line}">
      ${fila(`Ingresos brutos (${s.charges} cobro/s)`, fmt(s.grossCents), true)}
      ${fila(`Reembolsos (${s.refunds})`, `−${fmt(s.refundCents)}`)}
      ${fila(`Pagos a paseadores (${s.payouts})`, `−${fmt(s.payoutCents)}`)}
      ${fila('Reversiones a paseadores', String(s.reversals))}
      ${fila('Neto aproximado del día', fmt(neto), true)}
      ${fila('Disputas abiertas', String(s.openDisputes))}
      ${fila('Alertas financieras abiertas', String(open.length))}
    </table>
    ${open.length ? `<p style="margin:20px 0 8px;font-size:13px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${L.C.ink}">Pendientes</p>${anomaliesTable(open)}` : ''}
    <p style="margin:16px 0 0;font-size:12px;color:${L.C.muted}">El neto es orientativo: no descuenta comisiones de Stripe ni impuestos.</p>`;
  const subject = `[Finanzas] Cierre ${s.day}: ${fmt(s.grossCents)} brutos · ${open.length} alerta(s)`;
  return { subject, html: L.emailShell({ title: subject, preheader: subject, lang: 'es', bodyHtml: body, footerNote: 'Resumen automático del Agente de Cobros y Finanzas.' }),
    text: [`Cierre ${s.day}`, `Ingresos brutos: ${fmt(s.grossCents)}`, `Reembolsos: ${fmt(s.refundCents)}`, `Pagos a paseadores: ${fmt(s.payoutCents)}`, `Alertas abiertas: ${open.length}`].join('\n') };
}

// ---------- Idempotencia (misma tabla que el Agente de Despacho) ----------
async function claim(key, kind) {
  const r = await sbOrThrow('/rest/v1/dispatch_alerts?on_conflict=walk_id,kind', {
    method: 'POST', body: { walk_id: key, kind, recipient_role: 'ops' }, prefer: 'return=representation,resolution=ignore-duplicates' });
  return Array.isArray(r) && r.length > 0;
}
async function release(key, kind) {
  await sb(`/rest/v1/dispatch_alerts?walk_id=eq.${enc(key)}&kind=eq.${enc(kind)}`, { method: 'DELETE', prefer: 'return=minimal' });
}
async function sendEmail(cfg, msg, idem) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${(process.env.RESEND_API_KEY || '').trim()}`, 'Content-Type': 'application/json', 'Idempotency-Key': idem.slice(0, 256) },
    body: JSON.stringify({ from: cfg.from, to: [cfg.opsEmail], reply_to: L.SUPPORT, subject: msg.subject, html: msg.html, text: msg.text }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
}

// ---------- Ejecución ----------
// opts.stripe: cliente de Stripe (inyectable en pruebas). Si no se pasa, se crea con STRIPE_SECRET_KEY.
async function runFinanceAudit({ now = Date.now(), dryRun = false, stripe } = {}) {
  const cfg = config();
  if (stripe === undefined) {
    const { stripeKeyValid, getStripe } = require('./connect');
    stripe = stripeKeyValid(process.env.STRIPE_SECRET_KEY) ? getStripe() : null;
  }
  const db = await loadDb(now);
  let charges = [], refunds = [], stripeOk = false, stripeError = null;
  const ayer = chicagoYmd(now - 24 * H);
  if (stripe) {
    try {
      const desde = Math.floor(Math.min(now - cfg.stripeLookbackH * H, dayBounds(ayer).start) / 1000);
      charges = await listAll((p) => stripe.charges.list(p), { created: { gte: desde } });
      refunds = await listAll((p) => stripe.refunds.list(p), { created: { gte: desde } });
      stripeOk = true;
    } catch (e) { stripeError = e.message; }
  }
  const anomalies = [...detectDbAnomalies(db, now, cfg), ...(stripeOk ? detectStripeAnomalies(charges, db.bookings, now, cfg) : [])];
  const summary = summarize(db, charges, refunds, ayer, stripeOk);
  const out = { anomalies: anomalies.length, newAlerts: 0, alertEmail: 'none', summaryDay: ayer, summaryEmail: 'none',
    stripe: stripeOk ? 'ok' : (stripe ? `error: ${String(stripeError).slice(0, 120)}` : 'not_configured'), dryRun,
    byType: anomalies.reduce((m, x) => ({ ...m, [x.type]: (m[x.type] || 0) + 1 }), {}), totals: { grossCents: summary.grossCents, refundCents: summary.refundCents, payoutCents: summary.payoutCents } };
  if (dryRun) return out;
  if (!(process.env.RESEND_API_KEY || '').trim()) { out.error = 'resend_not_configured'; return out; }

  // 1) Alertas nuevas (cada anomalía una sola vez), en UN correo
  const nuevas = [];
  for (const x of anomalies) if (await claim(x.key, 'fin_alert')) nuevas.push(x);
  if (nuevas.length) {
    try {
      await sendEmail(cfg, buildAlertEmail(nuevas), `fin-alert-${nuevas.map((x) => x.key).join('|')}`.slice(0, 250));
      out.alertEmail = 'sent'; out.newAlerts = nuevas.length;
    } catch (e) {
      for (const x of nuevas) await release(x.key, 'fin_alert');
      out.alertEmail = 'failed'; console.warn('finance alert email:', e.message);
    }
  }
  // 2) Cierre del día anterior: una vez por día, solo con actividad o anomalías (o si FINANCE_SUMMARY_ALWAYS)
  if (summary.activity || anomalies.length || cfg.summaryAlways) {
    const key = `fin-summary:${ayer}`;
    if (await claim(key, 'fin_summary')) {
      try { await sendEmail(cfg, buildSummaryEmail(summary, anomalies), key); out.summaryEmail = 'sent'; }
      catch (e) { await release(key, 'fin_summary'); out.summaryEmail = 'failed'; console.warn('finance summary email:', e.message); }
    } else out.summaryEmail = 'already_sent';
  } else out.summaryEmail = 'no_activity';
  return out;
}

module.exports = { runFinanceAudit, detectDbAnomalies, detectStripeAnomalies, summarize, chicagoYmd, dayBounds, config };
