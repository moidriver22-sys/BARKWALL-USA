// Agente de Fidelización y Crecimiento ("empleado virtual" #3)
// ---------------------------------------------------------------------------
// Se invoca con /api/dispatch?action=growth[&dry=1] (CRON_SECRET). pg_cron: job 'barkwalk-growth' cada hora (:40).
// Envía al CLIENTE (push al teléfono + correo de respaldo), solo por paseos PAGADOS:
//   · growth_thanks      agradecimiento post-paseo + invitación a calificar y reservar de nuevo.
//                        Uno por RESERVA (no uno por cada día de una reserva de varios días): sale cuando ya no queda
//                        ningún día pendiente, entre GROWTH_THANKS_DELAY_MINUTES (60) y GROWTH_THANKS_MAX_HOURS (72)
//                        después del último paseo completado. No sale si el cliente reportó un problema.
//   · growth_reactivate  recordatorio amigable a clientes cuyo último paseo completado fue hace
//                        GROWTH_REACTIVATION_DAYS (14) – GROWTH_REACTIVATION_MAX_DAYS (60) días y que no tienen
//                        nada reservado. Uno por "ausencia": si vuelve a reservar y luego se ausenta otra vez, recibe otro.
// Respeta profiles.growth_opt_out_at (baja de estos avisos) y un horario de envío en hora de Birmingham
// (GROWTH_SEND_FROM_HOUR 9 – GROWTH_SEND_TO_HOUR 20): fuera de ese horario no envía nada (lo hará en la siguiente hora).
// Idempotencia: reutiliza public.dispatch_alerts con claves 'grow:thanks:<reserva>' y 'grow:reactivate:<cliente>:<último paseo>'.
// Se reclama ANTES de enviar y se libera si el envío falla (se reintenta en la siguiente ejecución).
// Tope por ejecución: GROWTH_MAX_PER_RUN (25).
// ---------------------------------------------------------------------------
const { sb, sbOrThrow, enc, getAuthUserEmail } = require('./supabase');
const L = require('./email-layout');
const { sendPushToUsers } = require('./push');

const MIN = 60 * 1000, H = 60 * MIN, D = 24 * H;
const ACTIVE = ['pending', 'accepted', 'en_camino', 'in_progress'];
const COLS = 'id,client_id,booking_id,status,payment_status,pet_name,completed_at,scheduled_at,client_issue_at';

function num(name, def) { const n = Number(process.env[name]); return Number.isFinite(n) && n >= 0 && process.env[name] !== '' ? n : def; }
function config() {
  return {
    thanksDelayMin: num('GROWTH_THANKS_DELAY_MINUTES', 60),
    thanksMaxH: num('GROWTH_THANKS_MAX_HOURS', 72),
    reactivateDays: num('GROWTH_REACTIVATION_DAYS', 14),
    reactivateMaxDays: num('GROWTH_REACTIVATION_MAX_DAYS', 60),
    fromHour: num('GROWTH_SEND_FROM_HOUR', 9),
    toHour: num('GROWTH_SEND_TO_HOUR', 20),
    maxPerRun: num('GROWTH_MAX_PER_RUN', 25) || 25,
    from: (process.env.GROWTH_EMAIL_FROM || process.env.DISPATCH_EMAIL_FROM || process.env.EMAIL_FROM || 'Barkwalk USA <no-reply@barkwalkusa.com>').trim(),
  };
}
const ts = (v) => (v ? Date.parse(v) : NaN);
function chicagoHour(t) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', hour: '2-digit' }).format(new Date(t)));
}

// ---------- Datos ----------
async function loadData(now, cfg) {
  const desde = new Date(now - (cfg.reactivateMaxDays + 1) * D).toISOString();
  const completed = await sbOrThrow(`/rest/v1/walk_requests?status=eq.completed&payment_status=eq.paid&client_id=not.is.null`
    + `&completed_at=gte.${enc(desde)}&select=${COLS}&order=completed_at.desc&limit=5000`);
  const active = await sbOrThrow(`/rest/v1/walk_requests?status=in.(${ACTIVE.join(',')})&payment_status=eq.paid&client_id=not.is.null`
    + `&select=${COLS}&limit=5000`);
  return { completed, active };
}
async function loadProfiles(ids) {
  if (!ids.length) return new Map();
  const lista = ids.map((id) => `"${String(id).replace(/"/g, '')}"`).join(',');
  const r = await sbOrThrow(`/rest/v1/profiles?id=in.(${enc(lista)})&select=id,email,full_name,growth_opt_out_at&limit=${ids.length}`);
  return new Map(r.map((p) => [String(p.id), p]));
}

// ---------- Decisión (función pura: fácil de probar) ----------
function planGrowth({ completed, active }, now, cfg) {
  const out = [];
  const pendientes = new Set(active.map((w) => String(w.booking_id || `w:${w.id}`))); // reservas con días sin terminar
  const clientesActivos = new Set(active.map((w) => String(w.client_id)));             // clientes con algo reservado

  // 1) Agradecimiento: uno por reserva (o por paseo suelto sin reserva)
  const grupos = new Map();
  for (const w of completed) {
    const g = String(w.booking_id || `w:${w.id}`);
    if (!grupos.has(g)) grupos.set(g, []);
    grupos.get(g).push(w);
  }
  for (const [g, ws] of grupos) {
    if (pendientes.has(g)) continue;                 // aún quedan días de esta reserva
    if (ws.some((w) => w.client_issue_at)) continue; // el cliente reportó un problema: lo atiende operaciones, no marketing
    const ultimo = ws.reduce((a, b) => (ts(b.completed_at) > ts(a.completed_at) ? b : a));
    const edad = now - ts(ultimo.completed_at);
    if (edad >= cfg.thanksDelayMin * MIN && edad <= cfg.thanksMaxH * H) {
      out.push({ kind: 'growth_thanks', key: `grow:thanks:${g}`, clientId: String(ultimo.client_id), walk: ultimo, walks: ws.length });
    }
  }

  // 2) Reactivación: último paseo completado de cada cliente (completed viene ordenado por fecha, pero no dependemos de ello)
  const ultimoPorCliente = new Map();
  for (const w of completed) {
    const c = String(w.client_id);
    const prev = ultimoPorCliente.get(c);
    if (!prev || ts(w.completed_at) > ts(prev.completed_at)) ultimoPorCliente.set(c, w);
  }
  for (const [c, w] of ultimoPorCliente) {
    if (clientesActivos.has(c) || w.client_issue_at) continue;
    const dias = (now - ts(w.completed_at)) / D;
    if (dias >= cfg.reactivateDays && dias <= cfg.reactivateMaxDays) {
      out.push({ kind: 'growth_reactivate', key: `grow:reactivate:${c}:${w.id}`, clientId: c, walk: w, days: Math.floor(dias) });
    }
  }
  return out;
}

// ---------- Mensajes (bilingües, como el resto de avisos) ----------
function pushText(a) {
  const pet = a.walk.pet_name || 'tu mascota';
  if (a.kind === 'growth_thanks') {
    return { title: '🐾 ¡Gracias por confiar en Barkwalk!', body: `¿Cómo le fue a ${pet}? Califica a tu paseador y reserva el próximo paseo. · Rate your walker & book again.`,
      url: '/', tag: `growth-thanks-${String(a.walk.id).slice(0, 12)}`, urgent: false };
  }
  return { title: `🐶 ${a.walk.pet_name || 'Tu perro'} te extraña`, body: `Han pasado ${a.days} días desde su último paseo. Reserva uno nuevo en un minuto. · Time for another walk?`,
    url: '/', tag: `growth-react-${String(a.clientId).slice(0, 12)}`, urgent: false };
}

function buildGrowthEmail(a, name = '') {
  const esc = L.esc;
  const pet = esc(a.walk.pet_name || '');
  const petEs = pet || 'tu mascota', petEn = pet || 'your pet';
  const hola = name ? ` ${esc(String(name).split(' ')[0])}` : '';
  const h1 = (t) => `<h1 style="margin:0 0 8px;font-family:${L.FONT};font-size:22px;line-height:28px;font-weight:800;color:${L.C.ink}">${t}</h1>`;
  const p = (t) => `<p style="margin:0 0 12px">${t}</p>`;
  const baja = `¿No quieres recibir estos recordatorios? Responde a este correo con la palabra BAJA. · Reply STOP to opt out of these reminders.`;
  let subject, cuerpo, boton, pre;
  if (a.kind === 'growth_thanks') {
    subject = '¡Gracias por pasear con Barkwalk! 🐾 · Thanks for walking with us';
    pre = `¿Cómo le fue a ${a.walk.pet_name || 'tu mascota'}? Califica a tu paseador.`;
    cuerpo = h1('¡Gracias por confiar en nosotros! 🐾')
      + p(`Hola${hola}, ${a.walks > 1 ? `terminamos los ${a.walks} paseos de tu reserva` : 'terminamos el paseo'} de <strong>${petEs}</strong>. Esperamos que haya vuelto feliz y cansado.`)
      + p('Tu opinión nos ayuda muchísimo: <strong>califica a tu paseador</strong> (y déjale propina si quieres) desde la app. Y cuando quieras, reserva el próximo paseo en un minuto.')
      + p(`<em>Thanks for walking with Barkwalk! We hope ${petEn} came home happy. Please rate your walker in the app, and book the next walk whenever you're ready.</em>`);
    boton = L.button(`${L.SITE}/`, '⭐ Calificar y reservar · Rate &amp; book');
  } else {
    subject = `${a.walk.pet_name || 'Tu perro'} te extraña 🐶 · Time for another walk?`;
    pre = `Han pasado ${a.days} días desde el último paseo.`;
    cuerpo = h1(`${petEs.charAt(0).toUpperCase() + petEs.slice(1)} te extraña 🐶`)
      + p(`Hola${hola}, han pasado <strong>${a.days} días</strong> desde el último paseo de <strong>${petEs}</strong> con Barkwalk.`)
      + p('Un buen paseo ayuda a que esté más tranquilo, sano y feliz. Reserva el siguiente cuando te venga bien: tus datos y los de tu mascota ya están guardados.')
      + p(`<em>It's been ${a.days} days since ${petEn}'s last Barkwalk. Book the next walk in a minute — your details are already saved.</em>`);
    boton = L.button(`${L.SITE}/`, '🐾 Reservar un paseo · Book a walk');
  }
  const html = L.emailShell({ title: subject, preheader: pre, lang: 'es', bodyHtml: cuerpo + boton, footerNote: esc(baja) });
  const text = [subject, '', pre, `${L.SITE}/`, '', baja].join('\n');
  return { subject, html, text };
}

// ---------- Envío e idempotencia (misma tabla que los otros agentes) ----------
async function claim(key, kind) {
  const r = await sbOrThrow('/rest/v1/dispatch_alerts?on_conflict=walk_id,kind', {
    method: 'POST', body: { walk_id: key, kind, recipient_role: 'client' }, prefer: 'return=representation,resolution=ignore-duplicates' });
  return Array.isArray(r) && r.length > 0;
}
async function release(key, kind) {
  await sb(`/rest/v1/dispatch_alerts?walk_id=eq.${enc(key)}&kind=eq.${enc(kind)}`, { method: 'DELETE', prefer: 'return=minimal' });
}
async function sendEmail(cfg, to, msg, idem) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${(process.env.RESEND_API_KEY || '').trim()}`, 'Content-Type': 'application/json', 'Idempotency-Key': idem.slice(0, 256) },
    body: JSON.stringify({ from: cfg.from, to: [to], reply_to: L.SUPPORT, subject: msg.subject, html: msg.html, text: msg.text,
      headers: { 'List-Unsubscribe': `<mailto:${L.SUPPORT}?subject=BAJA%20recordatorios>` } }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
}
const validEmail = (e) => !!e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

// ---------- Ejecución ----------
async function runGrowth({ now = Date.now(), dryRun = false } = {}) {
  const cfg = config();
  const data = await loadData(now, cfg);
  const plan = planGrowth(data, now, cfg);
  const perfiles = await loadProfiles([...new Set(plan.map((a) => a.clientId))]);
  const out = { checked: data.completed.length, planned: 0, sent: 0, skipped: 0, failed: 0, optedOut: 0, deferred: 0,
    byKind: {}, push: {}, dryRun, quietHours: false, items: [] };
  const anota = (a, status) => {
    out.items.push({ kind: a.kind, client: a.clientId.slice(0, 8), status });
    if (status === 'sent' || status === 'push_only' || status === 'would_send') out.byKind[a.kind] = (out.byKind[a.kind] || 0) + 1;
  };
  const elegibles = [];
  for (const a of plan) {
    const p = perfiles.get(a.clientId);
    if (p && p.growth_opt_out_at) { out.optedOut++; continue; }
    elegibles.push({ ...a, profile: p || null });
  }
  out.planned = elegibles.length;
  if (dryRun) { elegibles.forEach((a) => anota(a, 'would_send')); return out; }
  const hora = chicagoHour(now);
  if (hora < cfg.fromHour || hora >= cfg.toHour) { out.quietHours = true; return out; } // nada reclamado: sale en horario
  if (!(process.env.RESEND_API_KEY || '').trim()) { out.error = 'resend_not_configured'; return out; }

  for (const a of elegibles) {
    if (out.sent >= cfg.maxPerRun) { out.deferred++; anota(a, 'deferred'); continue; }
    if (!(await claim(a.key, a.kind))) { out.skipped++; continue; } // ya enviado antes
    try {
      const push = await sendPushToUsers([a.clientId], pushText(a)).catch((e) => ({ status: 'error', sent: 0, reason: e.message }));
      out.push[push.status] = (out.push[push.status] || 0) + 1;
      const email = (a.profile && a.profile.email) || (await getAuthUserEmail(a.clientId));
      if (!validEmail(email)) { if (push.sent) { out.sent++; anota(a, 'push_only'); } else anota(a, 'no_recipient'); continue; }
      await sendEmail(cfg, email, buildGrowthEmail(a, a.profile && a.profile.full_name), a.key);
      out.sent++; anota(a, 'sent');
    } catch (e) {
      out.failed++; anota(a, 'failed');
      await release(a.key, a.kind);
      console.warn(`growth: ${a.kind} no enviado, se reintenta: ${e.message}`);
    }
  }
  return out;
}

module.exports = { runGrowth, planGrowth, buildGrowthEmail, pushText, chicagoHour, config };
