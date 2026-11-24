// Avisos al paseador cuando el equipo decide sobre su postulación (aprobada / no aprobada / suspendida)
// ---------------------------------------------------------------------------
// El admin decide en la app con public.admin_set_walker_status(target_id, new_status, reason), que guarda la
// decisión en public.walker_reviews (historial con motivo y quién decidió) y avisa al instante a
// /api/dispatch?action=walker_reviews (pg_net). El cron de 10 min de /api/dispatch hace de respaldo.
// Aquí: push al teléfono + correo (Resend) al paseador, una sola vez por decisión (notified_at).
//
// VERIFICACIÓN DE ANTECEDENTES (futuro): hoy Barkwalk NO usa un proveedor externo. Ver
// docs/verificacion-paseadores.md: el proveedor (p. ej. Checkr) se conectaría como un paso más antes de
// 'verified' y su resultado se guardaría junto a esta decisión, sin cambiar este flujo de avisos.
// ---------------------------------------------------------------------------
const { sb, sbOrThrow, enc } = require('./supabase');
const { sendPushToUsers } = require('./push');
const L = require('./email-layout');

const MAX_PER_RUN = 25;

// Texto de cada decisión (función pura, bilingüe)
function reviewMessage(status, reason, lang) {
  const es = lang !== 'en';
  const t = (a, b) => (es ? a : b);
  const motivo = String(reason || '').trim();
  const M = {
    verified: {
      subject: t('✅ Tu postulación en Barkwalk fue aprobada', '✅ Your Barkwalk application was approved'),
      title: t('¡Bienvenido al equipo!', 'Welcome to the team!'),
      lines: [
        t('El equipo de Barkwalk revisó y aprobó tu postulación de paseador.', 'The Barkwalk team reviewed and approved your walker application.'),
        t('Siguientes pasos en la app: 1) acepta los Términos y el Acuerdo para Paseadores vigentes si te los pide, 2) en Walker Pro pulsa "Cobros con Stripe" para vincular tu banco (Stripe te pedirá tus datos de identidad y bancarios para pagarte), 3) ponte "En línea" para recibir solicitudes.',
          'Next steps in the app: 1) accept the current Terms and Walker Agreement if prompted, 2) in Walker Pro tap "Stripe payouts" to link your bank (Stripe will ask for your identity and bank details to pay you), 3) go "Online" to receive requests.'),
      ],
      push: [t('✅ Postulación aprobada', '✅ Application approved'), t('Ya puedes ponerte en línea y recibir paseos.', 'You can go online and receive walks.')],
    },
    rejected: {
      subject: t('Tu postulación en Barkwalk', 'Your Barkwalk application'),
      title: t('Postulación no aprobada', 'Application not approved'),
      lines: [
        t('Gracias por tu interés. Después de revisarla, por ahora no podemos aprobar tu postulación de paseador.', 'Thank you for your interest. After reviewing it, we cannot approve your walker application at this time.'),
        motivo ? t(`Motivo: ${motivo}`, `Reason: ${motivo}`) : t('Si quieres más detalles, responde a este correo.', 'If you would like more details, reply to this email.'),
        t('Puedes escribirnos a soporte@barkwalkusa.com si crees que hubo un error o tu situación cambia.', 'You can write to soporte@barkwalkusa.com if you believe there was a mistake or your situation changes.'),
      ],
      push: [t('Postulación revisada', 'Application reviewed'), t('Revisa el estado de tu cuenta en Walker Pro.', 'Check your account status in Walker Pro.')],
    },
    suspended: {
      subject: t('⛔ Tu cuenta de paseador en Barkwalk fue suspendida', '⛔ Your Barkwalk walker account was suspended'),
      title: t('Cuenta suspendida', 'Account suspended'),
      lines: [
        t('Tu cuenta de paseador está suspendida: no recibirás solicitudes nuevas mientras se revisa.', 'Your walker account is suspended: you will not receive new requests while it is reviewed.'),
        motivo ? t(`Motivo: ${motivo}`, `Reason: ${motivo}`) : '',
        t('Escríbenos a soporte@barkwalkusa.com para revisarla.', 'Write to soporte@barkwalkusa.com so we can review it.'),
      ].filter(Boolean),
      push: [t('⛔ Cuenta suspendida', '⛔ Account suspended'), t('Revisa tu correo o escribe a soporte.', 'Check your email or contact support.')],
    },
  };
  return M[status] || null;
}

function buildEmail(status, reason, lang, name) {
  const m = reviewMessage(status, reason, lang);
  if (!m) return null;
  const es = lang !== 'en';
  const hola = `${es ? 'Hola' : 'Hi'}${name ? ' ' + L.esc(name) : ''},`;
  const bodyHtml = `<h1 style="margin:0 0 10px;font-family:${L.FONT};font-size:22px;color:${L.C.ink}">${L.esc(m.title)}</h1>
    <p style="margin:0 0 12px">${hola}</p>${m.lines.map((l) => `<p style="margin:0 0 12px">${L.esc(l)}</p>`).join('')}
    ${L.button(L.SITE, es ? 'Abrir Barkwalk' : 'Open Barkwalk')}`;
  return { subject: m.subject, html: L.emailShell({ title: m.title, preheader: m.lines[0], bodyHtml, lang: es ? 'es' : 'en' }),
    text: [m.title, hola, ...m.lines, L.SITE].join('\n\n'), push: m.push };
}

async function processWalkerReviews({ dryRun = false } = {}) {
  const rows = await sbOrThrow(`/rest/v1/walker_reviews?notified_at=is.null&status=in.(verified,rejected,suspended)&select=*&order=created_at.asc&limit=${MAX_PER_RUN}`);
  const out = { checked: rows.length, sent: 0, pushOnly: 0, failed: 0, dryRun };
  for (const r of rows) {
    if (dryRun) continue;
    // Reclamo atómico: otra ejecución no lo vuelve a enviar
    const claim = await sbOrThrow(`/rest/v1/walker_reviews?id=eq.${enc(r.id)}&notified_at=is.null`,
      { method: 'PATCH', body: { notified_at: new Date().toISOString() }, prefer: 'return=representation' });
    if (!claim.length) continue;
    try {
      const [p] = await sbOrThrow(`/rest/v1/profiles?id=eq.${enc(r.walker_id)}&select=email,full_name&limit=1`);
      const lang = 'es';
      const msg = buildEmail(r.status, r.reason, lang, p && p.full_name);
      const push = await sendPushToUsers([r.walker_id], { title: msg.push[0], body: msg.push[1], url: '/', tag: `walker-review-${r.id}` }).catch(() => ({ sent: 0 }));
      const key = (process.env.RESEND_API_KEY || '').trim();
      if (key && p && p.email) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `walker-review-${r.id}` },
          body: JSON.stringify({ from: (process.env.DISPATCH_EMAIL_FROM || process.env.EMAIL_FROM || 'Barkwalk USA <no-reply@barkwalkusa.com>').trim(),
            to: [p.email], reply_to: L.SUPPORT, subject: msg.subject, html: msg.html, text: msg.text }),
        });
        if (!res.ok) throw new Error(`resend ${res.status}`);
        out.sent++;
      } else if (push.sent) out.pushOnly++;
      else throw new Error('sin correo ni push');
    } catch (e) {
      out.failed++;
      // Se libera para reintentar en la próxima ronda
      await sb(`/rest/v1/walker_reviews?id=eq.${enc(r.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { notified_at: null, notify_error: String(e.message || e).slice(0, 300) } });
    }
  }
  return out;
}

module.exports = { reviewMessage, buildEmail, processWalkerReviews };
