// Agente de Operaciones y Despacho ("empleado virtual" #1)
// ---------------------------------------------------------------------------
// Revisa los paseos PAGADOS de los últimos días y avisa por correo (Resend) cuando algo necesita atención:
//   · pending_walker_reminder  solicitud asignada a un paseador sin aceptar tras PENDING min   → paseador
//   · pending_open_ops         solicitud abierta que nadie acepta tras PENDING min              → operaciones
//   · pending_near_start_ops   sigue sin aceptar y empieza en ≤ NEAR_START min (o ya pasó)      → operaciones
//   · upcoming_client/_walker  paseo aceptado que empieza en ≤ LEAD min                         → cliente y paseador
//   · late_start_ops/_walker   aceptado pero sin iniciar LATE min después de la hora            → operaciones y paseador
//   · overdue_ops/_walker      en curso más allá de su duración + GRACE min                     → operaciones y paseador
// Idempotente: cada (walk_id, kind) se "reclama" en public.dispatch_alerts (clave única) ANTES de enviar;
// si el envío falla, se libera el reclamo para reintentarlo en la siguiente ejecución.
// Variables (opcionales): DISPATCH_PENDING_MINUTES (30), DISPATCH_NEAR_START_MINUTES (60),
//   DISPATCH_UPCOMING_LEAD_MINUTES (60), DISPATCH_LATE_START_MINUTES (20), DISPATCH_OVERDUE_GRACE_MINUTES (45),
//   DISPATCH_MAX_ALERTS_PER_RUN (40), OPS_ALERT_EMAIL (soporte@barkwalkusa.com),
//   DISPATCH_EMAIL_FROM (o EMAIL_FROM), RESEND_API_KEY.
// ---------------------------------------------------------------------------
const { sb, sbOrThrow, enc, getAuthUserEmail } = require('./supabase');
const L = require('./email-layout');
const { sendPushToUsers, adminUserIds } = require('./push');

const MIN = 60 * 1000;
const LOOKBACK_MS = 3 * 24 * 60 * MIN; // solo paseos recientes: nunca se despiertan alertas viejas
const WALK_COLS = 'id,status,payment_status,client_id,client_name,walker_id,pet_name,service_type,duration,pickup_address,address,scheduled_at,scheduled_date,scheduled_time,created_at,started_at,booking_id';

function num(name, def) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : def;
}
function config() {
  return {
    pendingMin: num('DISPATCH_PENDING_MINUTES', 30),
    nearStartMin: num('DISPATCH_NEAR_START_MINUTES', 60),
    leadMin: num('DISPATCH_UPCOMING_LEAD_MINUTES', 60),
    lateMin: num('DISPATCH_LATE_START_MINUTES', 20),
    graceMin: num('DISPATCH_OVERDUE_GRACE_MINUTES', 45),
    maxPerRun: num('DISPATCH_MAX_ALERTS_PER_RUN', 40),
    opsEmail: (process.env.OPS_ALERT_EMAIL || L.SUPPORT).trim(),
    from: (process.env.DISPATCH_EMAIL_FROM || process.env.EMAIL_FROM || 'Barkwalk USA <no-reply@barkwalkusa.com>').trim(),
  };
}

// Duración contratada en minutos: misma función que la reserva (api/_lib/pricing.js)
const { durationMinutes } = require('./pricing');
const ts = (v) => (v ? Date.parse(v) : NaN);

// Decide qué alertas tocan ahora (función pura: fácil de probar)
function planAlerts(walks, now, cfg) {
  const out = [];
  const add = (w, kind, role) => out.push({ walk: w, kind, role });
  for (const w of walks) {
    if (w.payment_status !== 'paid') continue; // solo paseos cobrados (nada de pruebas ni checkouts abiertos)
    const st = w.status || 'pending';
    const start = ts(w.scheduled_at);
    const toStart = Number.isFinite(start) ? (start - now) / MIN : null; // min hasta la hora (negativo: ya pasó)
    if (st === 'pending') {
      const waiting = (now - ts(w.created_at)) / MIN;
      if (waiting >= cfg.pendingMin) {
        if (w.walker_id) add(w, 'pending_walker_reminder', 'walker');
        // Sin paseador: solo molesta a operaciones si empieza en las próximas 24 h (no por días de la semana que viene)
        else if (toStart == null || toStart <= 24 * 60) add(w, 'pending_open_ops', 'ops');
      }
      if (toStart != null && toStart <= cfg.nearStartMin && toStart > -6 * 60) add(w, 'pending_near_start_ops', 'ops');
    } else if (st === 'accepted' || st === 'en_camino') {
      if (toStart != null && toStart > 0 && toStart <= cfg.leadMin) {
        add(w, 'upcoming_client', 'client');
        if (w.walker_id) add(w, 'upcoming_walker', 'walker');
      }
      if (toStart != null && toStart <= -cfg.lateMin && toStart > -6 * 60) {
        add(w, 'late_start_ops', 'ops');
        if (w.walker_id) add(w, 'late_start_walker', 'walker');
      }
    } else if (st === 'in_progress') {
      const started = ts(w.started_at);
      if (Number.isFinite(started) && (now - started) / MIN >= durationMinutes(w.duration) + cfg.graceMin) {
        add(w, 'overdue_ops', 'ops');
        if (w.walker_id) add(w, 'overdue_walker', 'walker');
      }
    }
  }
  return out;
}

async function loadWalks(now) {
  const since = new Date(now - LOOKBACK_MS).toISOString();
  // Recientes por creación O por fecha programada (una reserva hecha hace semanas para hoy también cuenta)
  return sbOrThrow(`/rest/v1/walk_requests?payment_status=eq.paid&status=in.(pending,accepted,en_camino,in_progress)`
    + `&or=${enc(`(created_at.gte.${since},scheduled_at.gte.${since})`)}&select=${WALK_COLS}&order=scheduled_at.asc.nullslast&limit=500`);
}

async function emailOf(userId) {
  if (!userId) return null;
  const r = await sb(`/rest/v1/profiles?id=eq.${enc(userId)}&select=email,full_name&limit=1`);
  const p = r.ok && Array.isArray(r.data) && r.data[0];
  const e = (p && p.email) || (await getAuthUserEmail(userId));
  return e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? { email: e, name: (p && p.full_name) || '' } : null;
}

// ---------- Correos ----------
function whenText(w) {
  const t = ts(w.scheduled_at);
  if (!Number.isFinite(t)) return [w.scheduled_date, w.scheduled_time].filter(Boolean).join(' ') || '—';
  const f = (loc) => new Intl.DateTimeFormat(loc, { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(t));
  return { es: f('es-US'), en: f('en-US') };
}
function buildDispatchEmail(kind, w, cfg, recipientName = '') {
  const esc = L.esc;
  const cuando = whenText(w);
  const cuandoEs = typeof cuando === 'string' ? cuando : cuando.es;
  const cuandoEn = typeof cuando === 'string' ? cuando : cuando.en;
  const ref = String(w.id).slice(0, 8);
  const pet = w.pet_name || 'Pet';
  const dir = w.pickup_address || w.address || '';
  const filas = [
    ['Paseo / Walk', `#${ref}`], ['Mascota / Pet', pet], ['Servicio / Service', w.service_type || w.duration],
    ['Hora / Time', cuandoEs === cuandoEn ? cuandoEs : `${cuandoEs} · ${cuandoEn}`], ['Dirección / Address', dir],
  ].filter(([, v]) => v).map(([k, v]) => `
      <tr><td style="padding:8px 0;border-bottom:1px solid ${L.C.line};font-size:13px;color:${L.C.muted}">${k}</td>
          <td align="right" style="padding:8px 0 8px 12px;border-bottom:1px solid ${L.C.line};font-size:14px;font-weight:700;color:${L.C.text}">${esc(v)}</td></tr>`).join('');
  const tabla = `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border-top:1px solid ${L.C.line};margin:6px 0 4px">${filas}</table>`;
  const h1 = (t) => `<h1 style="margin:0 0 8px;font-family:${L.FONT};font-size:22px;line-height:28px;font-weight:800;color:${L.C.ink}">${t}</h1>`;
  const p = (t) => `<p style="margin:0 0 12px">${t}</p>`;
  const hola = recipientName ? ` ${esc(recipientName)}` : '';
  const app = L.button(`${L.SITE}/`, 'Abrir Barkwalk · Open Barkwalk');

  const T = {
    pending_walker_reminder: ['⏳ Tienes una solicitud sin aceptar · Pending request',
      `${h1('Tienes una solicitud de paseo esperando 🐾')}${p(`Hola${hola}, la solicitud de <strong>${esc(pet)}</strong> te está esperando. Ábrela en la app para aceptarla.`)}${p(`<em>You have a walk request waiting for you. Open the app to accept it.</em>`)}`],
    upcoming_walker: ['🐾 Tu paseo empieza pronto · Your walk starts soon',
      `${h1('Tu paseo empieza pronto 🐾')}${p(`Hola${hola}, recuerda que tienes el paseo de <strong>${esc(pet)}</strong> a las <strong>${esc(cuandoEs)}</strong>. Los códigos de acceso aparecen en la app 1 hora antes.`)}${p(`<em>Reminder: your walk with ${esc(pet)} starts at ${esc(cuandoEn)}. Access codes show in the app 1 hour before.</em>`)}`],
    upcoming_client: ['🐾 Tu paseo de hoy empieza pronto · Your walk starts soon',
      `${h1('Tu paseo empieza pronto 🐾')}${p(`Hola${hola}, el paseo de <strong>${esc(pet)}</strong> está confirmado para las <strong>${esc(cuandoEs)}</strong>. Podrás seguirlo en vivo desde la app.`)}${p(`<em>Your walk for ${esc(pet)} is confirmed for ${esc(cuandoEn)}. You can follow it live in the app.</em>`)}`],
    late_start_walker: ['⚠️ Tu paseo ya debía haber empezado · Walk not started',
      `${h1('Tu paseo ya debía haber empezado')}${p(`Hola${hola}, el paseo de <strong>${esc(pet)}</strong> estaba programado para las <strong>${esc(cuandoEs)}</strong> y aún no está en curso. Márcalo en la app al empezar o escríbele al cliente por el chat.`)}${p(`<em>This walk was scheduled for ${esc(cuandoEn)} and hasn't started. Mark it in the app or message the client.</em>`)}`],
    overdue_walker: ['⏱️ ¿Ya terminaste el paseo? · Did you finish the walk?',
      `${h1('¿Ya terminaste el paseo?')}${p(`Hola${hola}, el paseo de <strong>${esc(pet)}</strong> lleva más tiempo abierto del contratado. Si ya terminaste, márcalo como <strong>completado</strong> en la app (envía el reporte al cliente y libera tu pago).`)}${p(`<em>This walk has been open longer than booked. If you're done, mark it as completed in the app.</em>`)}`],
    pending_open_ops: ['[Ops] Solicitud sin paseador', `${h1('Solicitud sin paseador')}${p(`Nadie ha aceptado esta solicitud pagada después de ${cfg.pendingMin} min.`)}`],
    pending_near_start_ops: ['[Ops] URGENTE: paseo sin aceptar a punto de empezar', `${h1('⚠️ Paseo sin aceptar a punto de empezar')}${p(`Esta solicitud pagada empieza en ≤ ${cfg.nearStartMin} min (o ya pasó su hora) y sigue <strong>sin paseador</strong>. Asígnala o contacta al cliente.`)}`],
    late_start_ops: ['[Ops] Paseo aceptado que no ha empezado', `${h1('Paseo aceptado que no ha empezado')}${p(`El paseador aceptó, pero el paseo no está en curso ${cfg.lateMin} min después de su hora. Contacta al paseador.`)}`],
    overdue_ops: ['[Ops] Paseo abierto demasiado tiempo', `${h1('Paseo abierto demasiado tiempo')}${p(`Este paseo lleva más de su duración + ${cfg.graceMin} min en curso sin completarse. Revisa con el paseador (posible olvido o incidente).`)}`],
  }[kind];
  const [asunto, cuerpo] = T;
  const subject = `${asunto} · #${ref}`;
  const html = L.emailShell({ title: asunto, preheader: `${pet} · ${cuandoEs}`, lang: 'es', bodyHtml: cuerpo + tabla + app,
    footerNote: kind.endsWith('_ops') ? 'Alerta automática del Agente de Operaciones y Despacho.' : '' });
  const text = [asunto, `Paseo #${ref} · ${pet}`, `Hora: ${cuandoEs}`, dir ? `Dirección: ${dir}` : null, `${L.SITE}/`].filter(Boolean).join('\n');
  return { subject, html, text };
}

// Texto corto para la notificación del teléfono (bilingüe, como los correos)
function pushText(kind, w) {
  const pet = w.pet_name || 'tu mascota';
  const c = whenText(w);
  const hora = typeof c === 'string' ? c : c.es;
  const T = {
    pending_walker_reminder: ['⏳ Solicitud sin aceptar', `${pet} te está esperando. Ábrela para aceptarla. · A walk request is waiting for you.`],
    upcoming_walker: ['🐾 Tu paseo empieza pronto', `${pet} · ${hora}. Los códigos de acceso ya están en la app.`],
    upcoming_client: ['🐾 Tu paseo empieza pronto', `${pet} · ${hora}. Podrás seguirlo en vivo en la app.`],
    late_start_walker: ['⚠️ Tu paseo ya debía empezar', `${pet} estaba programado para ${hora}. Márcalo en la app o escribe al cliente.`],
    overdue_walker: ['⏱️ ¿Ya terminaste el paseo?', `El paseo de ${pet} lleva más tiempo del contratado. Márcalo como completado.`],
    pending_open_ops: ['[Ops] Solicitud sin paseador', `${pet} · ${hora}: nadie la ha aceptado.`],
    pending_near_start_ops: ['[Ops] URGENTE: paseo sin aceptar', `${pet} empieza ${hora} y sigue sin paseador.`],
    late_start_ops: ['[Ops] Paseo sin iniciar', `${pet} · ${hora}: aceptado pero no ha empezado.`],
    overdue_ops: ['[Ops] Paseo abierto demasiado tiempo', `${pet}: sigue en curso más allá de su duración.`],
  }[kind] || ['Barkwalk USA', pet];
  const urgent = /near_start|late_start|overdue/.test(kind);
  return { title: T[0], body: T[1], url: '/', tag: `${kind}-${String(w.id).slice(0, 12)}`, urgent };
}

async function sendEmail(cfg, to, msg, idem) {
  const key = (process.env.RESEND_API_KEY || '').trim();
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': idem },
    body: JSON.stringify({ from: cfg.from, to: [to], reply_to: L.SUPPORT, subject: msg.subject, html: msg.html, text: msg.text }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
}

// Reclamo atómico (clave única walk_id + kind): solo una ejecución envía cada alerta
async function claim(walkId, kind, role) {
  const r = await sbOrThrow('/rest/v1/dispatch_alerts?on_conflict=walk_id,kind', {
    method: 'POST', body: { walk_id: String(walkId), kind, recipient_role: role },
    prefer: 'return=representation,resolution=ignore-duplicates',
  });
  return Array.isArray(r) && r.length > 0;
}
async function release(walkId, kind, error) {
  await sb(`/rest/v1/dispatch_alerts?walk_id=eq.${enc(String(walkId))}&kind=eq.${enc(kind)}`, { method: 'DELETE', prefer: 'return=minimal' });
  console.warn(`dispatch: ${kind} (walk ${walkId}) no enviado, se reintenta en la próxima ejecución: ${error}`);
}

// Ejecución completa. dryRun: solo informa qué haría (sin reclamar ni enviar).
async function runDispatch({ now = Date.now(), dryRun = false } = {}) {
  const cfg = config();
  const walks = await loadWalks(now);
  const plan = planAlerts(walks, now, cfg);
  const resumen = { checked: walks.length, planned: plan.length, sent: 0, skipped: 0, failed: 0, byKind: {}, push: {}, dryRun, alerts: [] };
  const anota = (a, status) => {
    resumen.alerts.push({ kind: a.kind, walk: String(a.walk.id).slice(0, 8), role: a.role, status });
    resumen.byKind[a.kind] = (resumen.byKind[a.kind] || 0) + (status === 'sent' || status === 'would_send' ? 1 : 0);
  };
  if (dryRun) { plan.forEach((a) => anota(a, 'would_send')); return resumen; }
  if (!(process.env.RESEND_API_KEY || '').trim()) {
    resumen.error = 'resend_not_configured'; // no se reclama nada: cuando se configure, se enviará
    return resumen;
  }
  for (const a of plan) {
    if (resumen.sent >= cfg.maxPerRun) { anota(a, 'deferred'); continue; } // tope por ejecución; sigue en la próxima
    if (!(await claim(a.walk.id, a.kind, a.role))) { resumen.skipped++; continue; } // ya avisado antes
    try {
      // 1) Teléfono (Web Push): destinatario directo, o los administradores en las alertas de operaciones.
      //    Nunca bloquea: si falla o no hay dispositivos, el correo sigue saliendo como respaldo.
      const userIds = a.role === 'ops' ? await adminUserIds() : [a.role === 'walker' ? a.walk.walker_id : a.walk.client_id];
      const push = await sendPushToUsers(userIds, pushText(a.kind, a.walk)).catch((e) => ({ status: 'error', sent: 0, reason: e.message }));
      resumen.push[push.status] = (resumen.push[push.status] || 0) + 1;
      // 2) Correo (respaldo)
      const dest = a.role === 'ops' ? { email: cfg.opsEmail, name: '' } : await emailOf(a.role === 'walker' ? a.walk.walker_id : a.walk.client_id);
      if (!dest) { anota(a, push.sent ? 'push_only' : 'no_recipient'); if (push.sent) resumen.sent++; continue; } // el reclamo se queda
      await sendEmail(cfg, dest.email, buildDispatchEmail(a.kind, a.walk, cfg, dest.name), `dispatch-${a.walk.id}-${a.kind}`);
      resumen.sent++; anota(a, 'sent');
    } catch (e) {
      resumen.failed++; anota(a, 'failed');
      await release(a.walk.id, a.kind, e.message);
    }
  }
  return resumen;
}

module.exports = { runDispatch, planAlerts, buildDispatchEmail, pushText, durationMinutes, config };
