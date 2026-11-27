// Agente de Revisión y Auditoría de Postulaciones (empleado virtual #4, junto a Despacho, Finanzas y Fidelización)
// ---------------------------------------------------------------------------
// REGLA ESTRICTA: este agente NUNCA aprueba, rechaza, activa ni cambia el estado de un paseador. Solo LEE,
// analiza y guarda su reporte en walker_applications.agent_report (+ agent_risk). La decisión final (Aprobar o
// Rechazar con motivo obligatorio en walker_reviews) es exclusiva del administrador: admin_set_walker_status().
//
// Cuándo corre: al enviar o reenviar la postulación (/api/signup action=walker_application) y en cada ronda del
// cron de 10 min de /api/dispatch (postulaciones sin reporte, y aprobadas cuyo ID vence en ≤ 30 días o venció).
// Audita: Términos/Privacidad/Acuerdo vigentes, edad ≥ 19, ID + selfie (formato, tamaño, existencia), vencimiento
// del ID (y aviso si vence pronto), coherencia de datos y señales de alerta, historial (rechazos, suspensiones,
// reenvíos) y el estado de Stripe Connect Express. Avisa por correo al equipo (sin fotos ni datos del ID).
// ---------------------------------------------------------------------------
const { sb, sbOrThrow, enc } = require('./supabase');
const TERMS = require('./terms');
const ID = require('./walker-identity');
const L = require('./email-layout');

const AL_ZIP = /^3[56]\d{3}$/; // Alabama: 35000–36999

// Similitud de nombres por palabras (sin acentos ni mayúsculas)
const words = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
function nameMatch(a, b) {
  const A = new Set(words(a)), B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let n = 0; A.forEach((w) => { if (B.has(w)) n++; });
  return n / Math.min(A.size, B.size);
}

// ---------- Auditoría (función PURA: fácil de probar; no toca la base) ----------
//   d: { app, profile, consent, files, previousApps, reviews, phoneDupes, today }
function audit(d) {
  const { app, profile = {}, consent, files = [], previousApps = [], reviews = [], phoneDupes = 0, today } = d;
  const role = profile.role || 'walker';
  const checklist = [];
  const alerts = [];
  const item = (key, ok, label, detail) => checklist.push({ key, ok: !!ok, label, detail: detail || '' });
  const alert = (level, code, message) => alerts.push({ level, code, message });

  // 1. Consentimientos vigentes
  const faltan = TERMS.missingDocs(consent, role);
  item('consents', !faltan.length, 'Términos, Privacidad y Acuerdo para Paseadores vigentes',
    faltan.length ? `Falta: ${faltan.join(', ')}` : `Versión ${TERMS.CURRENT.terms} aceptada el ${String(consent.terms_accepted_at || '').slice(0, 10)}`);
  if (faltan.length) alert('high', 'consent_missing', 'No tiene aceptados los documentos legales vigentes: no puede operar.');

  // 2. Edad mínima
  const birth = profile.birth_date || (consent && consent.birth_date);
  const edad = TERMS.validDate(birth || '') ? TERMS.ageOn(birth, today) : null;
  item('age', edad != null && edad >= TERMS.MIN_AGE, `Edad mínima ${TERMS.MIN_AGE} años`, edad == null ? 'Sin fecha de nacimiento' : `${edad} años`);
  if (edad == null || edad < TERMS.MIN_AGE) alert('high', 'age', 'No cumple o no acredita la edad mínima.');
  if (consent && consent.birth_date && profile.birth_date && consent.birth_date !== profile.birth_date) {
    alert('medium', 'birth_mismatch', 'La fecha de nacimiento del perfil no coincide con la de la constancia legal.');
  }

  // 3–4. ID (frente y reverso) y selfie (existencia, formato, tamaño). No hay comparación facial automática:
  // la coincidencia entre la selfie y el ID la decide el administrador mirando las fotos.
  const kb = (f) => `${Math.round(f.file.size / 1024)} KB · ${f.file.mimetype}`;
  const idf = ID.checkFile(files, app.id_photo_path);
  const sef = ID.checkFile(files, app.selfie_path);
  item('id_photo', idf.ok, 'Foto del ID oficial, frente (JPEG/PNG/WEBP, ≤ 5 MB)', idf.ok ? kb(idf) : idf.error);
  // Envíos anteriores al reverso (id_back_path vacío): se informa, pero no se marca como archivo inválido
  const bkf = app.id_back_path ? ID.checkFile(files, app.id_back_path) : null;
  item('id_back', !!(bkf && bkf.ok), 'Foto del ID oficial, reverso (JPEG/PNG/WEBP, ≤ 5 MB)', !bkf ? 'No enviado (postulación anterior al reverso)' : bkf.ok ? kb(bkf) : bkf.error);
  if (!bkf) alert('low', 'id_back_missing', 'Esta postulación no incluye el reverso del ID (enviada antes de que se pidiera).');
  item('selfie', sef.ok, 'Selfie del postulante (JPEG/PNG/WEBP, ≤ 5 MB)', sef.ok ? kb(sef) : sef.error);
  if (!idf.ok || !sef.ok || (bkf && !bkf.ok)) alert('high', 'files', 'Falta la foto del ID (frente o reverso) o la selfie, o el archivo no es válido.');
  const iguales = (a, b) => a && b && a.ok && b.ok && a.file.size === b.file.size && a.file.mimetype === b.file.mimetype;
  if (iguales(idf, sef) || iguales(bkf, sef)) {
    alert('medium', 'same_image', 'Una foto del ID y la selfie tienen exactamente el mismo tamaño: podrían ser la misma imagen.');
  }
  if (iguales(idf, bkf)) alert('medium', 'same_id_sides', 'El frente y el reverso del ID tienen exactamente el mismo tamaño: podría ser la misma foto dos veces.');
  if (idf.ok && idf.file.size < 40 * 1024) alert('low', 'id_low_res', 'La foto del ID es muy liviana (< 40 KB): puede ser ilegible.');
  if (bkf && bkf.ok && bkf.file.size < 40 * 1024) alert('low', 'id_back_low_res', 'La foto del reverso del ID es muy liviana (< 40 KB): puede ser ilegible.');

  // 5. Vencimiento del ID
  const exp = ID.checkIdExpiry(app.id_expiry, today);
  item('id_expiry', exp.ok, 'Identificación vigente (fecha de vencimiento futura)',
    exp.ok ? `Vence el ${app.id_expiry} (en ${exp.days} días)` : `Vencida o inválida (${app.id_expiry})`);
  if (!exp.ok) alert('high', 'id_expired', 'La identificación está vencida: debe reenviar una vigente.');
  else if (exp.warning) alert('medium', 'id_expiring_soon', `La identificación vence en ${exp.days} días: pide renovarla pronto.`);

  // 6. Datos completos y coherentes
  item('data', !!(app.legal_name && app.phone && app.city && app.zip && app.id_type), 'Datos personales completos', `${app.legal_name} · ${app.city} ${app.zip}`);
  const sim = nameMatch(app.legal_name, profile.full_name);
  if (profile.full_name && sim < 0.5) alert('medium', 'name_mismatch', `El nombre legal ("${app.legal_name}") no coincide con el del perfil ("${profile.full_name}"). Compáralo con el ID.`);
  if (!AL_ZIP.test(app.zip || '')) alert('low', 'zip_outside_al', `El código postal ${app.zip} está fuera de Alabama (zona de servicio).`);
  if (phoneDupes > 0) alert('high', 'phone_duplicate', `El teléfono ya aparece en ${phoneDupes} postulación(es) de OTRO paseador.`);

  // 7. Historial
  const rechazos = reviews.filter((r) => r.status === 'rejected');
  const suspensiones = reviews.filter((r) => r.status === 'suspended');
  const reenvios = previousApps.filter((a) => a.id !== app.id).length;
  item('history', !rechazos.length && !suspensiones.length, 'Historial sin rechazos ni suspensiones',
    `${rechazos.length} rechazo(s), ${suspensiones.length} suspensión(es), ${reenvios} envío(s) anteriores`);
  rechazos.slice(0, 3).forEach((r) => alert('medium', 'previous_rejection', `Rechazo anterior (${String(r.created_at).slice(0, 10)}): ${r.reason || 'sin motivo'}`));
  suspensiones.slice(0, 3).forEach((r) => alert('high', 'previous_suspension', `Suspensión anterior (${String(r.created_at).slice(0, 10)}): ${r.reason || 'sin motivo'}`));
  if (reenvios >= 3) alert('low', 'many_resubmissions', `Ha enviado ${reenvios + 1} postulaciones en total.`);

  // 8. Stripe Connect Express (informativo: se conecta DESPUÉS de aprobar)
  const stripeListo = !!(profile.stripe_details_submitted && profile.stripe_transfers_active);
  item('stripe', stripeListo, 'Cobros con Stripe Connect Express',
    stripeListo ? 'Cuenta lista para recibir pagos' : profile.stripe_account_id ? 'Cuenta creada, datos pendientes en Stripe' : 'Aún no conectada (se hace después de aprobar)');

  const risk = alerts.some((a) => a.level === 'high') ? 'high' : alerts.some((a) => a.level === 'medium') ? 'medium' : 'low';
  return {
    version: 1, generatedAt: new Date().toISOString(), applicationId: app.id, risk,
    // El agente solo recomienda REVISAR. Nunca aprueba: lo decide el administrador.
    recommendation: 'manual_review', autoApproval: false,
    checklist, alerts,
    summary: `${checklist.filter((c) => c.ok).length}/${checklist.length} verificaciones OK · ${alerts.length} alerta(s) · riesgo ${risk}`,
  };
}

// ---------- Recolección de datos (solo lectura) ----------
async function gather(appId) {
  const [app] = await sbOrThrow(`/rest/v1/walker_applications?id=eq.${enc(appId)}&select=*&limit=1`);
  if (!app) throw new Error('application_not_found');
  const uid = app.walker_id;
  const [profile] = await sbOrThrow(`/rest/v1/profiles?id=eq.${enc(uid)}&select=id,role,full_name,email,birth_date,walker_status,stripe_account_id,stripe_details_submitted,stripe_transfers_active,stripe_payouts_enabled&limit=1`);
  const [consent] = await sbOrThrow(`/rest/v1/legal_consents?user_id=eq.${enc(uid)}&select=*&order=created_at.desc&limit=1`);
  const previousApps = await sbOrThrow(`/rest/v1/walker_applications?walker_id=eq.${enc(uid)}&select=id,status,submitted_at&order=submitted_at.desc&limit=50`);
  const reviews = await sbOrThrow(`/rest/v1/walker_reviews?walker_id=eq.${enc(uid)}&select=status,reason,created_at&order=created_at.desc&limit=50`);
  const dupes = await sbOrThrow(`/rest/v1/walker_applications?phone=eq.${enc(app.phone)}&walker_id=neq.${enc(uid)}&select=id&limit=20`);
  const files = await ID.listOwnFiles(uid);
  return { app, profile: profile || {}, consent: consent || null, files, previousApps, reviews, phoneDupes: dupes.length, today: TERMS.todayInAlabama() };
}

// Correo al equipo: hay una postulación para revisar (sin fotos ni datos del ID; el detalle está en el panel)
async function notifyOps(report, d) {
  const key = (process.env.RESEND_API_KEY || '').trim();
  if (!key) return false;
  const alertas = report.alerts.map((a) => `<li>${a.level === 'high' ? '🔴' : a.level === 'medium' ? '🟠' : '🟡'} ${L.esc(a.message)}</li>`).join('') || '<li>Sin alertas.</li>';
  const html = L.emailShell({ title: 'Postulación para revisar', lang: 'es', preheader: report.summary,
    bodyHtml: `<h1 style="margin:0 0 8px;font-family:${L.FONT};font-size:20px;color:${L.C.ink}">📋 Postulación de paseador para revisar</h1>
      <p style="margin:0 0 10px">${L.esc(d.profile.full_name || '')} · ${L.esc(report.summary)}</p><ul style="margin:0 0 14px;padding-left:18px">${alertas}</ul>
      <p style="margin:0">El agente <strong>no aprueba</strong>: revisa el ID y la selfie en el panel de administración y decide.</p>${L.button(L.SITE, 'Abrir panel de administración')}` });
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `app-audit-${report.applicationId}-${report.risk}` },
    body: JSON.stringify({ from: (process.env.DISPATCH_EMAIL_FROM || process.env.EMAIL_FROM || 'Barkwalk USA <no-reply@barkwalkusa.com>').trim(),
      to: [(process.env.OPS_ALERT_EMAIL || L.SUPPORT).trim()], subject: `[Ops] Postulación para revisar · riesgo ${report.risk}`, html, text: report.summary }),
  });
  return r.ok;
}

// Analiza UNA postulación y guarda el reporte (única escritura del agente: walker_applications.agent_*)
async function runApplicationAudit(appId, { notify = true } = {}) {
  const d = await gather(appId);
  const report = audit(d);
  await sbOrThrow(`/rest/v1/walker_applications?id=eq.${enc(appId)}`, {
    method: 'PATCH', prefer: 'return=minimal', body: { agent_report: report, agent_risk: report.risk, agent_ran_at: report.generatedAt } });
  if (notify && d.app.status === 'submitted') await notifyOps(report, d).catch(() => false);
  if (notify && d.app.status === 'approved') await remindRenewal(d).catch(() => false);
  return report;
}

// Aprobado con ID por vencer (≤ 30 días) o vencido: aviso al PASEADOR para que suba uno nuevo (1 correo por semana)
async function remindRenewal(d) {
  const exp = ID.checkIdExpiry(d.app.id_expiry, d.today);
  if (exp.ok && !exp.warning) return false;
  const key = (process.env.RESEND_API_KEY || '').trim();
  if (!key || !d.profile.email) return false;
  const vencida = !exp.ok;
  const titulo = vencida ? 'Tu identificación venció' : `Tu identificación vence en ${exp.days} días`;
  const html = L.emailShell({ title: titulo, lang: 'es', preheader: titulo,
    bodyHtml: `<h1 style="margin:0 0 8px;font-family:${L.FONT};font-size:20px;color:${L.C.ink}">🪪 ${L.esc(titulo)}</h1>
      <p style="margin:0 0 12px">${vencida
        ? 'No puedes recibir paseos hasta que subas una identificación vigente y el equipo la revise.'
        : 'Para seguir recibiendo paseos sin interrupciones, sube tu identificación renovada desde Walker Pro → Tu postulación.'}</p>${L.button(L.SITE, 'Abrir Barkwalk')}` });
  const semana = Math.floor(Date.now() / (7 * 864e5));
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `id-renewal-${d.app.id}-${semana}` },
    body: JSON.stringify({ from: (process.env.DISPATCH_EMAIL_FROM || process.env.EMAIL_FROM || 'Barkwalk USA <no-reply@barkwalkusa.com>').trim(),
      to: [d.profile.email], reply_to: L.SUPPORT, subject: `🪪 ${titulo}`, html, text: titulo }),
  });
  return r.ok;
}

// Ronda del cron: postulaciones enviadas sin reporte + aprobadas con ID por vencer o vencido (re-auditoría diaria)
async function runPendingAudits({ dryRun = false } = {}) {
  const sinReporte = await sbOrThrow('/rest/v1/walker_applications?status=eq.submitted&agent_ran_at=is.null&select=id&limit=20');
  const limite = new Date(Date.now() + ID.EXPIRY_WARN_DAYS * 864e5).toISOString().slice(0, 10);
  const ayer = new Date(Date.now() - 864e5).toISOString();
  const porVencer = await sbOrThrow(`/rest/v1/walker_applications?status=eq.approved&id_expiry=lte.${limite}&agent_ran_at=lt.${enc(ayer)}&select=id&limit=20`);
  const ids = [...sinReporte, ...porVencer].map((r) => r.id);
  const out = { checked: ids.length, audited: 0, failed: 0, dryRun };
  if (dryRun) return out;
  for (const id of ids) {
    try { await runApplicationAudit(id, { notify: true }); out.audited++; } catch (e) { out.failed++; console.error(`application_audit ${id}:`, e.message); }
  }
  return out;
}

module.exports = { audit, gather, nameMatch, runApplicationAudit, runPendingAudits, notifyOps };
