// Barkwalk USA · Seguridad en el navegador (window.BWSafety)
// ---------------------------------------------------------------------------
// · Anti-bots: honeypot + Cloudflare Turnstile. La clave pública la da GET /api/signup?config=1;
//   mientras no exista en Vercel, getHumanToken() devuelve null y todo funciona como antes.
// · Avisos: IA (orientativa, no reemplaza al veterinario), antifuga (no tratar por fuera de Barkwalk)
//   y privacidad del mapa. Bilingües según el idioma activo; refresh() los actualiza al cambiar de idioma.
// · Filtro de lenguaje: usa window.BWContentFilter (/content-filter.js, copia de api/_lib/content-filter.js).
//   La base de datos aplica la MISMA regla, así que esto es solo para avisar antes y con claridad.
// ---------------------------------------------------------------------------
(function () {
  'use strict';
  const lang = () => { try { return currentLang === 'en' ? 'en' : 'es'; } catch (e) { return 'es'; } }; // eslint-disable-line no-undef
  const t = (es, en) => (lang() === 'en' ? en : es);
  const CF = () => window.BWContentFilter || null;

  // ---------- Estilos propios (Tailwind está precompilado) ----------
  const css = `
  .bw-hp{position:absolute!important;left:-10000px!important;top:auto!important;width:1px!important;height:1px!important;overflow:hidden!important;opacity:0!important}
  .bw-note{font-size:11px;line-height:1.45;font-weight:600;border-radius:12px;padding:8px 10px;margin:6px 0}
  .bw-note-ai{background:rgba(255,255,255,.12);color:rgba(255,255,255,.88);border:1px solid rgba(255,255,255,.18)}
  .bw-note-leak{background:#FFF7E6;color:#7A4B00;border:1px solid #F2C77B}
  .bw-note-leak-dark{background:rgba(255,193,7,.14);color:#FFE6A3;border:1px solid rgba(255,193,7,.35)}
  .bw-note-privacy{background:#EEF7F1;color:#1B4D3E;border:1px solid #CFE6D8}
  .bw-note-privacy-dark{background:rgba(255,255,255,.08);color:rgba(255,255,255,.75);border:1px solid rgba(255,255,255,.14)}
  .bw-note-alert{background:#FDECEA;color:#8A1C12;border:1px solid #F3B8B0}
  #bwTurnstileHost{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999}`;
  function injectCss() {
    if (document.getElementById('bwSafetyCss')) return;
    const s = document.createElement('style'); s.id = 'bwSafetyCss'; s.textContent = css; document.head.appendChild(s);
  }

  // ---------- Textos ----------
  const TXT = {
    ai: () => t('🤖 Barky es una inteligencia artificial. Su información es orientativa y puede contener errores: no es un veterinario ni da diagnósticos. Cualquier tema de salud o cuidado delicado verifícalo con tu veterinario o un profesional. Si es urgente, llama a tu veterinario o a una clínica de emergencia.',
               "🤖 Barky is an artificial intelligence. Its information is for guidance only and may contain mistakes: it is not a veterinarian and does not diagnose. Check any health or delicate-care matter with your veterinarian or a qualified professional. If it's urgent, call your vet or an emergency clinic."),
    leakClient: () => t('🛡️ Por tu seguridad: no compartas teléfonos, correos, códigos de tu casa ni datos personales, y no aceptes paseos ni pagos por fuera de Barkwalk USA (Venmo, Zelle, Cash App, efectivo…). Fuera de la app pierdes la cobertura, el soporte y la protección de Barkwalk.',
                        "🛡️ For your safety: don't share phone numbers, emails, home codes or personal data, and don't accept walks or payments outside Barkwalk USA (Venmo, Zelle, Cash App, cash…). Outside the app you lose Barkwalk's coverage, support and protection."),
    leakWalker: () => t('🛡️ Recuerda: no compartas tus datos personales ni ofrezcas o aceptes paseos o cobros por fuera de Barkwalk USA. Fuera de la app no hay cobertura, soporte ni pago garantizado, y puede suspenderse tu cuenta.',
                        "🛡️ Reminder: don't share personal data or offer/accept walks or payments outside Barkwalk USA. Off-app there's no coverage, support or guaranteed pay, and your account may be suspended."),
    translateAi: () => t('🌐 Las traducciones del chat las hace una IA y pueden no ser exactas.', '🌐 Chat translations are made by AI and may not be exact.'),
    mapClient: () => t('🔒 Tu ubicación nunca se comparte con el paseador: solo ve la dirección de recogida de tu reserva. Tú sí ves al paseador en vivo durante el paseo.',
                       '🔒 Your location is never shared with the walker: they only see your booking\'s pickup address. You see the walker live during the walk.'),
    mapWalker: () => t('📍 Solo ves la dirección de recogida acordada. La ubicación en vivo del dueño es privada.', '📍 You only see the agreed pickup address. The owner\'s live location is private.'),
  };

  function ensureNote(anchor, where, id, cls) {
    if (!anchor) return null;
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('p'); el.id = id; el.className = `bw-note ${cls}`; el.setAttribute('role', 'note');
      anchor.insertAdjacentElement(where, el);
    }
    return el;
  }

  function refresh() {
    injectCss();
    const ai = TXT.ai();
    const f = ensureNote(document.getElementById('floatAiBox'), 'beforebegin', 'bwAiNoteFloat', 'bw-note-ai'); if (f) f.textContent = ai;
    const p = ensureNote(document.getElementById('publicAiBox'), 'beforebegin', 'bwAiNotePublic', 'bw-note-ai'); if (p) p.textContent = ai;
    const b = ensureNote(document.getElementById('liabilityBox'), 'beforebegin', 'bwLeakBooking', 'bw-note-leak'); if (b) b.textContent = TXT.leakClient();
    const composer = document.getElementById('walkerChatInput') && document.getElementById('walkerChatInput').closest('.c-composer');
    const c = ensureNote(composer, 'afterend', 'bwLeakClientChat', 'bw-note-leak');
    if (c) c.textContent = `${TXT.leakClient()} ${TXT.translateAi()}`;
    const gps = document.getElementById('gpsMap');
    const m = ensureNote(gps && (gps.closest('.c-map-frame') || gps), 'afterend', 'bwMapPrivacy', 'bw-note-privacy'); if (m) m.textContent = TXT.mapClient();
  }

  // ---------- Filtro de lenguaje / antifuga ----------
  // Revisa { campo: texto } → null si todo bien, o el mensaje a mostrar
  function checkText(fields) {
    const cf = CF(); if (!cf) return null;
    const r = cf.checkFields(fields);
    return r.ok ? null : cf.message('profanity', lang());
  }
  // Chat: insultos → bloquea. Datos de contacto/pagos por fuera → avisa la 1.ª vez; reenviar el MISMO texto lo envía.
  let lastWarned = '';
  function guardChat(text) {
    const cf = CF(); if (!cf) return { ok: true };
    if (!cf.check(text).ok) return { ok: false, kind: 'profanity', message: cf.message('profanity', lang()) };
    const kinds = cf.detectContact(text);
    if (kinds.length && lastWarned !== text) { lastWarned = text; return { ok: false, kind: 'contact', message: cf.message('contact', lang()) }; }
    if (lastWarned === text) lastWarned = '';
    return { ok: true };
  }
  // Error de la base (trigger bw_content_guard) → mensaje claro
  function dbErrorMessage(err) {
    if (err && (err.message === 'content_blocked' || /content_blocked/.test(err.message || ''))) {
      const cf = CF(); return cf ? cf.message('profanity', lang()) : t('Texto no permitido.', 'Text not allowed.');
    }
    return null;
  }
  const SERVER_ERRORS = {
    content_blocked: () => (CF() ? CF().message('profanity', lang()) : t('Texto no permitido.', 'Text not allowed.')),
    captcha_required: () => t('Completa la verificación de seguridad e inténtalo de nuevo.', 'Please complete the security check and try again.'),
    captcha_failed: () => t('No pudimos verificar que eres una persona. Recarga la página e inténtalo de nuevo.', "We couldn't verify you're human. Reload the page and try again."),
    captcha_unavailable: () => t('La verificación de seguridad no responde. Inténtalo en un momento.', 'The security check is not responding. Please try again in a moment.'),
    bot_detected: () => t('No se pudo completar la solicitud. Recarga la página e inténtalo de nuevo.', 'The request could not be completed. Reload the page and try again.'),
    rate_limited: () => t('Demasiados intentos. Espera unos minutos e inténtalo de nuevo.', 'Too many attempts. Please wait a few minutes and try again.'),
  };
  function serverErrorMessage(code) { const f = SERVER_ERRORS[code]; return f ? f() : null; }

  // ---------- Anti-bots ----------
  const BOT = { siteKey: null, ready: null };
  function loadConfig() {
    if (BOT.ready) return BOT.ready;
    BOT.ready = fetch('/api/signup?config=1', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : {})).then((j) => { BOT.siteKey = (j && j.turnstileSiteKey) || null; return BOT.siteKey; })
      .catch(() => null);
    return BOT.ready;
  }
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (BOT.script) return BOT.script;
    BOT.script = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true; s.onload = () => resolve(window.turnstile || null); s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });
    return BOT.script;
  }
  // Token de un solo uso para 'signup' o 'booking'. null = Turnstile no activado (o no se pudo cargar).
  async function getHumanToken(action) {
    const key = await loadConfig();
    if (!key) return null;
    const ts = await loadTurnstile();
    if (!ts) return null;
    let host = document.getElementById('bwTurnstileHost');
    if (!host) { host = document.createElement('div'); host.id = 'bwTurnstileHost'; document.body.appendChild(host); }
    return new Promise((resolve) => {
      let id = null, done = false;
      const finish = (tok) => { if (done) return; done = true; try { if (id !== null) ts.remove(id); } catch (e) {} resolve(tok || null); };
      try {
        id = ts.render(host, { sitekey: key, action, appearance: 'interaction-only', language: lang(),
          callback: finish, 'error-callback': () => finish(null), 'expired-callback': () => finish(null) });
      } catch (e) { finish(null); }
      setTimeout(() => finish(null), 45000);
    });
  }
  // Valor del campo trampa (siempre vacío para una persona)
  function honeypot(id) { const el = document.getElementById(id); return el ? el.value : ''; }

  function init() { refresh(); loadConfig(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.BWSafety = { refresh, checkText, guardChat, dbErrorMessage, serverErrorMessage, getHumanToken, honeypot, text: TXT };
})();
