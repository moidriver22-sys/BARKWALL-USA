// Bloqueo de Términos y Condiciones (todas las cuentas: clientes y paseadores)
// ---------------------------------------------------------------------------
// Si la última constancia del usuario (public.legal_consents, que solo él y el admin pueden leer) no cubre las
// versiones VIGENTES, se muestra un bloqueo a pantalla completa hasta aceptarlas. La aceptación la guarda el
// SERVIDOR (POST /api/signup { action: 'accept_terms' }) con fecha y hora, IP, navegador y versiones.
// El servidor vuelve a validarlo en cada reserva, membresía y cobro (api/_lib/terms.js), y la base en
// public.bw_is_verified_walker() (sin aceptación vigente, el paseador no ve ni acepta paseos).
// Mismas versiones que api/_lib/terms.js, index.html y private.bw_consent_rules() (lo comprueban las pruebas).
// Módulo UMD: funciona en Node (pruebas) y en el navegador (window.BWTermsGate).
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BWTermsGate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CURRENT = Object.freeze({ terms: '2026-11-24.2', privacy: '2026-11-24', waiver: '2026-11-16', contractor: '2026-11-24.2' });
  const MIN_AGE = 19;
  const isWalker = (role) => ['walker', 'shopper'].includes(String(role || ''));

  // Misma regla que el servidor (api/_lib/terms.js → missingDocs)
  function missingDocs(row, role) {
    const m = [];
    if (!row || row.terms_version !== CURRENT.terms || !row.terms_accepted_at) m.push('terms');
    if (!row || row.privacy_version !== CURRENT.privacy || !row.privacy_accepted_at) m.push('privacy');
    if (isWalker(role) && (!row || row.contractor_version !== CURRENT.contractor || !row.contractor_accepted_at)) m.push('contractor');
    return m;
  }

  // Cuerpo para POST /api/signup (función pura)
  function acceptanceBody({ role, terms, privacy, contractor, birthDate }) {
    return {
      action: 'accept_terms',
      termsAccepted: terms === true, termsVersion: CURRENT.terms,
      privacyAccepted: privacy === true, privacyVersion: CURRENT.privacy,
      ...(isWalker(role) ? { contractorAccepted: contractor === true, contractorVersion: CURRENT.contractor } : {}),
      ...(birthDate ? { birthDate } : {}),
    };
  }

  const ERR = {
    terms_not_accepted: ['Marca la casilla de los Términos para continuar.', 'Check the Terms box to continue.'],
    privacy_not_accepted: ['Marca la casilla de la Política de Privacidad.', 'Check the Privacy Policy box.'],
    contractor_not_accepted: ['Marca la casilla del Acuerdo para Paseadores.', 'Check the Walker Agreement box.'],
    invalid_birth_date: ['Escribe tu fecha de nacimiento.', 'Enter your date of birth.'],
    underage: ['Debes tener 19 años o más para usar Barkwalk (mayoría de edad en Alabama).', 'You must be 19 or older to use Barkwalk (age of majority in Alabama).'],
    unauthorized: ['Tu sesión expiró. Inicia sesión de nuevo.', 'Your session expired. Please log in again.'],
    rate_limited: ['Demasiados intentos. Espera un minuto.', 'Too many attempts. Wait a minute.'],
  };

  const CSS = `
  #bwTermsGate{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;
    padding:max(16px,env(safe-area-inset-top,0px)) 16px max(16px,env(safe-area-inset-bottom,0px));background:rgba(10,20,16,.72);
    -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
  #bwTermsGate[hidden]{display:none}
  .tg-card{width:100%;max-width:440px;max-height:calc(100dvh - 32px);overflow-y:auto;background:var(--bw-surface,#fff);color:var(--bw-text,#2B2621);
    border:1px solid var(--bw-line,#EBE3D5);border-radius:24px;padding:22px 20px;box-shadow:0 30px 60px -24px rgba(0,0,0,.55)}
  .tg-card h2{margin:6px 0 6px;font-size:20px;font-weight:900;color:var(--bw-ink,#1B4D3E);letter-spacing:-.01em}
  .tg-card p{margin:0 0 12px;font-size:13px;line-height:1.5}
  .tg-ic{font-size:30px}
  .tg-row{display:flex;gap:10px;align-items:flex-start;padding:11px 12px;border:1.5px solid var(--bw-line,#EBE3D5);border-radius:14px;margin:0 0 8px;cursor:pointer;font-size:13px;line-height:1.4}
  .tg-row input{width:20px;height:20px;margin-top:1px;flex:none;accent-color:#1B4D3E}
  .tg-row a{color:#00804A;font-weight:800;text-decoration:underline;text-underline-offset:2px}
  .tg-field{display:block;margin:4px 0 10px;font-size:12px;font-weight:800}
  .tg-field input{display:block;width:100%;margin-top:4px;padding:11px 12px;border:1.5px solid var(--bw-line,#EBE3D5);border-radius:12px;font-size:14px;background:var(--bw-surface,#fff);color:inherit}
  .tg-err{display:none;margin:4px 0 10px;padding:9px 12px;border-radius:12px;background:#FDECEA;color:#8A1C12;font-size:12px;font-weight:800}
  .tg-err.is-on{display:block}
  .tg-btn{width:100%;min-height:52px;border:0;border-radius:16px;font-size:14px;font-weight:900;color:#fff;cursor:pointer;
    background:linear-gradient(135deg,#1B4D3E,#0F7A4F);box-shadow:0 14px 26px -14px rgba(15,122,79,.95)}
  .tg-btn:disabled{opacity:.6;cursor:wait}
  .tg-out{display:block;margin:10px auto 0;background:none;border:0;color:rgb(var(--bw-text-rgb,43 38 33)/.65);font-size:12px;font-weight:800;text-decoration:underline;cursor:pointer}
  .tg-note{font-size:11px!important;color:rgb(var(--bw-text-rgb,43 38 33)/.6)}`;

  // ---------- Pantalla (solo navegador) ----------
  function mount(win) {
    const doc = win.document;
    const lang = () => (win.currentLang === 'en' ? 'en' : 'es');
    const tr = (es, en) => (lang() === 'en' ? en : es);
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const state = { open: false, needsBirth: false, role: 'client', checking: null };

    function urls(role) {
      const l = lang();
      const doc_ = isWalker(role) ? 'paseadores' : 'clientes';
      return { terms: `/terminos-${doc_}?lang=${l}`, privacy: `/privacidad?lang=${l}`, contractor: `/terminos-paseadores?lang=${l}#${l}-2` };
    }

    function render() {
      let el = doc.getElementById('bwTermsGate');
      if (!el) {
        const st = doc.createElement('style'); st.textContent = CSS; doc.head.appendChild(st);
        el = doc.createElement('div'); el.id = 'bwTermsGate'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-labelledby', 'tgTitle'); doc.body.appendChild(el);
      }
      const u = urls(state.role);
      const walker = isWalker(state.role);
      el.innerHTML = `<form class="tg-card" id="tgForm" novalidate>
        <div class="tg-ic" aria-hidden="true">📜</div>
        <h2 id="tgTitle">${esc(tr('Antes de continuar', 'Before you continue'))}</h2>
        <p>${esc(walker
          ? tr('Para recibir y aceptar paseos debes aceptar la versión vigente de estos documentos. Guardamos la fecha, la hora y la versión que aceptas.', 'To receive and accept walks you must accept the current version of these documents. We record the date, time and version you accept.')
          : tr('Para reservar paseos debes aceptar la versión vigente de estos documentos. Guardamos la fecha, la hora y la versión que aceptas.', 'To book walks you must accept the current version of these documents. We record the date, time and version you accept.'))}</p>
        <label class="tg-row"><input type="checkbox" id="tgTerms"><span>${esc(tr('He leído y acepto los', 'I have read and accept the'))}
          <a href="${u.terms}" target="_blank" rel="noopener">${esc(walker ? tr('Términos y Acuerdo para Paseadores', 'Walker Terms & Agreement') : tr('Términos para Clientes', 'Client Terms'))}</a>
          (${esc(tr('versión', 'version'))} ${CURRENT.terms}).</span></label>
        ${walker ? `<label class="tg-row"><input type="checkbox" id="tgContractor"><span>${esc(tr('Acepto trabajar como', 'I agree to work as an'))}
          <a href="${u.contractor}" target="_blank" rel="noopener">${esc(tr('contratista independiente (1099)', 'independent contractor (1099)'))}</a>,
          ${esc(tr('no como empleado de Barkwalk.', 'not as a Barkwalk employee.'))}</span></label>` : ''}
        <label class="tg-row"><input type="checkbox" id="tgPrivacy"><span>${esc(tr('He leído la', 'I have read the'))}
          <a href="${u.privacy}" target="_blank" rel="noopener">${esc(tr('Política de Privacidad', 'Privacy Policy'))}</a> (${CURRENT.privacy}).</span></label>
        ${state.needsBirth ? `<label class="tg-field">${esc(tr('Fecha de nacimiento (debes tener 19 años o más)', 'Date of birth (you must be 19 or older)'))}
          <input type="date" id="tgBirth" required max="${new Date().toISOString().slice(0, 10)}"></label>` : ''}
        <p class="tg-err" id="tgErr" role="alert"></p>
        <button type="submit" class="tg-btn" id="tgSubmit">${esc(tr('Aceptar y continuar', 'Accept and continue'))}</button>
        <p class="tg-note" style="margin:10px 0 0">${esc(tr('Si no los aceptas, puedes cerrar sesión; tu cuenta no se borra.', "If you don't accept them, you can log out; your account is not deleted."))}</p>
        <button type="button" class="tg-out" id="tgLogout">${esc(tr('Cerrar sesión', 'Log out'))}</button>
      </form>`;
      el.hidden = false;
      // Fecha de nacimiento en Mes / Día / Año (date-select.js): mismo #tgBirth, cambiar el año conserva mes y día
      if (state.needsBirth && win.BWDateSelect) win.BWDateSelect.attach(doc.getElementById('tgBirth'), { win });
      el.querySelector('#tgForm').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
      el.querySelector('#tgLogout').addEventListener('click', () => { hide(); if (typeof win.logoutUser === 'function') win.logoutUser(); });
      const first = el.querySelector('input'); if (first) setTimeout(() => first.focus(), 30);
    }

    function hide() { state.open = false; const el = doc.getElementById('bwTermsGate'); if (el) el.hidden = true; }
    function showError(code, fallback) {
      const e = doc.getElementById('tgErr'); if (!e) return;
      const m = ERR[code];
      e.textContent = m ? tr(m[0], m[1]) : (fallback || tr('No se pudo guardar tu aceptación. Intenta de nuevo.', 'Could not save your acceptance. Please try again.'));
      e.classList.add('is-on');
    }

    async function submit() {
      const $ = (id) => doc.getElementById(id);
      const body = acceptanceBody({ role: state.role, terms: !!($('tgTerms') || {}).checked, privacy: !!($('tgPrivacy') || {}).checked,
        contractor: !!($('tgContractor') || {}).checked, birthDate: state.needsBirth ? ($('tgBirth') || {}).value : undefined });
      if (!body.termsAccepted) return showError('terms_not_accepted');
      if (isWalker(state.role) && !body.contractorAccepted) return showError('contractor_not_accepted');
      if (!body.privacyAccepted) return showError('privacy_not_accepted');
      if (state.needsBirth && !body.birthDate) return showError('invalid_birth_date');
      const btn = $('tgSubmit'); if (btn) { btn.disabled = true; btn.textContent = tr('Guardando…', 'Saving…'); }
      try {
        const db = win.supabaseClient;
        const ses = db ? (await db.auth.getSession()).data.session : null;
        if (!ses) return showError('unauthorized');
        const r = await win.fetch('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ses.access_token}` }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return showError(j.error);
        const u = win.currentUser || {};
        Object.assign(u, { terms_version: CURRENT.terms, terms_accepted_at: j.acceptedAt });
        hide();
        if (typeof win.showToast === 'function') win.showToast(tr('✅ Gracias. Tu aceptación quedó registrada.', '✅ Thank you. Your acceptance was recorded.'), 'ok', 4000);
        if (typeof win.renderWalkerAccountStatus === 'function') win.renderWalkerAccountStatus();
      } catch (e) {
        showError(null, tr('Sin conexión. Revisa tu internet e intenta de nuevo.', 'No connection. Check your internet and try again.'));
      } finally {
        const b = $('tgSubmit'); if (b) { b.disabled = false; b.textContent = tr('Aceptar y continuar', 'Accept and continue'); }
      }
    }

    // Revisa la constancia del usuario con sesión y bloquea si falta algo
    async function check() {
      const u = win.currentUser, db = win.supabaseClient;
      if (!u || !db) { hide(); return { ok: true, skipped: true }; }
      const { data, error } = await db.from('legal_consents').select('terms_version,terms_accepted_at,privacy_version,privacy_accepted_at,contractor_version,contractor_accepted_at,birth_date')
        .eq('user_id', u.id).order('created_at', { ascending: false }).limit(1);
      if (error) { console.warn('Términos (legal_consents):', error.message); return { ok: true, skipped: true }; } // el servidor igual lo exige
      const row = (data && data[0]) || null;
      const role = u.role || 'client';
      const falta = missingDocs(row, role);
      u.terms_missing = falta;
      if (!falta.length) { hide(); return { ok: true }; }
      const { data: p } = await db.from('profiles').select('birth_date').eq('id', u.id).maybeSingle();
      state.role = role; state.needsBirth = !(p && p.birth_date) && !(row && row.birth_date); state.open = true;
      render();
      return { ok: false, missing: falta };
    }

    // El servidor respondió 'terms_required' (p. ej. cambió la versión con la app abierta)
    function require_() { const u = win.currentUser; if (!u) return; state.role = u.role || 'client'; return check(); }

    return { check, require: require_, hide, isOpen: () => state.open };
  }

  let ui = null;
  const api = () => { if (!ui && typeof window !== 'undefined') ui = mount(window); return ui; };
  return {
    CURRENT, MIN_AGE, missingDocs, acceptanceBody, ERR, CSS,
    check: () => api() && api().check(), require: () => api() && api().require(), hide: () => api() && api().hide(),
    isOpen: () => !!(ui && ui.isOpen()),
  };
});
