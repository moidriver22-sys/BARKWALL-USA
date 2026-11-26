// Perfil → "Zona de peligro" → Eliminar mi cuenta.
//   · renderCard(el): tarjeta Danger Zone con lo que se elimina y lo que la ley obliga a conservar.
//   · open(): modal de confirmación. Revisa bloqueos en el servidor, exige escribir DELETE (o ELIMINAR, o el correo de
//     la cuenta) para habilitar el botón rojo, muestra spinner y errores en pantalla y, al terminar, cierra la sesión,
//     vuelve a la portada y avisa con un mensaje.
// El servidor decide y aplica todo (POST /api/signup action=close_account_check / close_account; ver
// api/_lib/account-closure.js). Módulo UMD: funciona en Node (pruebas) y en el navegador (window.BWAccountClose).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BWAccountClose = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Texto de cada bloqueo (función pura, bilingüe)
  const BLOCKERS = {
    active_walks: ['Tienes paseos pagados que aún no terminan (pendientes o en curso). Cancélalos o espera a que terminen.', 'You have paid walks that have not finished yet (pending or in progress). Cancel them or wait until they end.'],
    active_walks_as_walker: ['Tienes servicios asignados como paseador (aceptados, en camino, en curso o programados a futuro). Antes de cerrar tu cuenta debes completarlos o resolverlos con el cliente y el soporte de Barkwalk: hay perros que cuentan contigo.', 'You have services assigned to you as a walker (accepted, on the way, in progress or scheduled for the future). Before closing your account you must complete them or resolve them with the client and Barkwalk support: there are dogs counting on you.'],
    unsettled_payouts: ['Tienes pagos de paseos completados sin liquidar. Espera a recibirlos (48 h después de cada paseo) o escríbenos.', 'You have completed-walk payouts not yet settled. Wait to receive them (48 h after each walk) or contact us.'],
    pending_refunds: ['Tienes un reembolso por cancelación en proceso. Espera a que se complete.', 'You have a cancellation refund in progress. Wait until it is completed.'],
    open_disputes: ['Tienes una disputa de pago abierta con tu banco. Debe resolverse antes de cerrar la cuenta.', 'You have an open payment dispute with your bank. It must be resolved before closing the account.'],
    active_membership: ['Tu membresía sigue activa. Cancélala primero desde Club → Administrar (portal de Stripe).', 'Your membership is still active. Cancel it first from Club → Manage (Stripe portal).'],
    already_closed: ['Esta cuenta ya está cerrada.', 'This account is already closed.'],
    profile_not_found: ['No encontramos el perfil de esta cuenta. Escríbenos a barkwalkusallc@gmail.com.', 'We could not find this account’s profile. Email barkwalkusallc@gmail.com.'],
  };
  const WORDS = ['DELETE', 'ELIMINAR', 'CERRAR', 'CLOSE'];
  // Palabra clave (sin distinguir mayúsculas) o el correo exacto de la cuenta
  function isConfirm(v, email) {
    const s = String(v || '').trim();
    if (WORDS.includes(s.toUpperCase())) return true;
    return !!email && s.includes('@') && s.toLowerCase() === String(email).trim().toLowerCase();
  }
  function blockerText(code, lang) { const m = BLOCKERS[code]; return m ? (lang === 'en' ? m[1] : m[0]) : code; }
  // Mensaje de error del servidor → texto para la persona (función pura)
  function errorText(err, lang) {
    const es = lang !== 'en';
    switch (err) {
      case 'unauthorized': return es ? 'Tu sesión expiró. Inicia sesión de nuevo para eliminar tu cuenta.' : 'Your session expired. Log in again to delete your account.';
      case 'rate_limited': return es ? 'Demasiados intentos. Espera un minuto e inténtalo otra vez.' : 'Too many attempts. Wait a minute and try again.';
      case 'confirmation_required': return es ? 'Escribe DELETE (o tu correo) exactamente para confirmar.' : 'Type DELETE (or your email) exactly to confirm.';
      case 'deactivate_failed': return es ? 'No pudimos desactivar tu acceso. No se cambió nada: inténtalo de nuevo.' : 'We could not deactivate your access. Nothing was changed: please try again.';
      case 'network': return es ? 'Sin conexión con el servidor. Revisa tu internet e inténtalo de nuevo.' : 'Could not reach the server. Check your connection and try again.';
      case 'timeout': return es ? 'El servidor tardó demasiado. Inténtalo de nuevo en un momento.' : 'The server took too long. Please try again in a moment.';
      default: return es ? 'Algo salió mal. No se eliminó nada: inténtalo de nuevo o escríbenos a barkwalkusallc@gmail.com.' : 'Something went wrong. Nothing was deleted: try again or email barkwalkusallc@gmail.com.';
    }
  }

  const CSS = `
  .dz-card{border:1px solid rgba(185,28,28,.28);background:linear-gradient(180deg,rgba(254,242,242,.85),rgba(254,242,242,.55));border-radius:20px;padding:18px;color:var(--bw-text,#2B2621)}
  html.dark .dz-card{background:linear-gradient(180deg,rgba(127,29,29,.22),rgba(127,29,29,.10));border-color:rgba(248,113,113,.3)}
  .dz-head{display:flex;gap:12px;align-items:flex-start}
  .dz-ico{flex:none;width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:#B91C1C;color:#fff}
  .dz-ico svg{width:20px;height:20px}
  .dz-kicker{font-size:10.5px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:#B91C1C}
  html.dark .dz-kicker{color:#FCA5A5}
  .dz-title{font-size:17px;font-weight:900;line-height:1.2;margin-top:2px}
  .dz-text{font-size:12.5px;line-height:1.5;opacity:.8;margin-top:4px}
  .dz-list{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:6px}
  .dz-list li{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;line-height:1.45}
  .dz-list li b{flex:none;width:18px;height:18px;border-radius:999px;display:grid;place-items:center;font-size:11px;margin-top:1px;background:rgba(185,28,28,.12);color:#B91C1C}
  html.dark .dz-list li b{background:rgba(248,113,113,.18);color:#FCA5A5}
  .dz-list.is-kept li b{background:rgba(0,168,89,.14);color:#00A859}
  .dz-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:0 18px;border-radius:14px;font-weight:900;font-size:13.5px;cursor:pointer;border:1px solid transparent;width:100%}
  .dz-btn-danger{background:#B91C1C;color:#fff;box-shadow:0 10px 24px -14px rgba(185,28,28,.9)}
  .dz-btn-danger:hover:not(:disabled){background:#991B1B}
  .dz-btn-danger:disabled{background:#E5A9A9;color:#fff;box-shadow:none;cursor:not-allowed;opacity:1}
  html.dark .dz-btn-danger:disabled{background:#5B2626;color:rgba(255,255,255,.6)}
  .dz-btn-outline{background:transparent;color:#B91C1C;border-color:rgba(185,28,28,.45)}
  html.dark .dz-btn-outline{color:#FCA5A5;border-color:rgba(248,113,113,.45)}
  .dz-btn-outline:hover{background:rgba(185,28,28,.06)}
  .dz-btn-ghost{background:transparent;color:var(--bw-text,#2B2621);border-color:var(--bw-line,#EBE3D5)}
  .dz-btn:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(185,28,28,.35)}
  .dz-overlay{position:fixed;inset:0;z-index:90;background:rgba(10,13,11,.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center;padding:0}
  @media (min-width:640px){.dz-overlay{align-items:center;padding:24px}}
  .dz-modal{width:100%;max-width:460px;max-height:92dvh;overflow-y:auto;background:var(--bw-surface,#fff);color:var(--bw-text,#2B2621);border-radius:24px 24px 0 0;padding:22px 20px calc(20px + env(safe-area-inset-bottom,0px));box-shadow:0 30px 60px -20px rgba(0,0,0,.5);animation:dzIn .22s cubic-bezier(.16,1,.3,1)}
  @media (min-width:640px){.dz-modal{border-radius:24px;padding:24px}}
  @keyframes dzIn{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
  @media (prefers-reduced-motion:reduce){.dz-modal{animation:none}.dz-spin{animation-duration:2s}}
  .dz-x{position:absolute;top:14px;right:14px;width:36px;height:36px;border-radius:999px;display:grid;place-items:center;background:var(--bw-card,#F5F0E6);color:var(--bw-text,#2B2621);cursor:pointer}
  .dz-x:disabled{opacity:.4}
  .dz-label{display:block;font-size:12px;font-weight:800;margin-top:14px}
  .dz-label code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:900;color:#B91C1C;background:rgba(185,28,28,.08);padding:1px 6px;border-radius:6px}
  html.dark .dz-label code{color:#FCA5A5;background:rgba(248,113,113,.14)}
  .dz-input{width:100%;margin-top:6px;min-height:46px;padding:10px 12px;border-radius:12px;border:1.5px solid var(--bw-line,#EBE3D5);background:var(--bw-soft,#FAF7F1);color:var(--bw-text,#2B2621);font-size:15px;user-select:text;-webkit-user-select:text}
  .dz-input:focus{outline:none;border-color:#B91C1C;box-shadow:0 0 0 3px rgba(185,28,28,.15)}
  .dz-input.is-ok{border-color:#B91C1C}
  textarea.dz-input{min-height:64px;font-size:13.5px;resize:vertical}
  .dz-alert{display:flex;gap:8px;align-items:flex-start;margin-top:12px;padding:10px 12px;border-radius:12px;font-size:12.5px;font-weight:700;line-height:1.45;background:rgba(185,28,28,.08);color:#991B1B;border:1px solid rgba(185,28,28,.25)}
  html.dark .dz-alert{color:#FECACA;background:rgba(127,29,29,.3)}
  .dz-alert[hidden]{display:none}
  .dz-spin{width:18px;height:18px;border-radius:999px;border:2.5px solid currentColor;border-right-color:transparent;animation:dzSpin .7s linear infinite;flex:none}
  .dz-spin.is-lg{width:34px;height:34px;border-width:3px;color:#B91C1C}
  @keyframes dzSpin{to{transform:rotate(360deg)}}
  .dz-center{text-align:center;padding:28px 6px}
  .dz-sub{font-size:11.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;opacity:.6;margin-top:16px}
  .dz-actions{display:grid;gap:8px;margin-top:16px}
  `;
  const ICON_ALERT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
  const ICON_X = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  function mount(win) {
    const doc = win.document;
    const lang = () => (win.currentLang === 'en' ? 'en' : 'es');
    const tr = (es, en) => (lang() === 'en' ? en : es);
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const isWalker = () => ['walker', 'shopper'].includes(win.currentUser && win.currentUser.role);
    function css() { if (!doc.getElementById('bwDzStyle')) { const s = doc.createElement('style'); s.id = 'bwDzStyle'; s.textContent = CSS; doc.head.appendChild(s); } }

    let state = { busy: false, email: '', lastFocus: null };

    // Llamada al servidor: nunca lanza; siempre devuelve { ok, j } (j.error = código)
    async function api(body) {
      const db = win.supabaseClient;
      let ses = null;
      try { ses = db ? (await db.auth.getSession()).data.session : null; } catch (e) { ses = null; }
      if (!ses || !ses.access_token) return { ok: false, j: { error: 'unauthorized' } };
      state.email = (ses.user && ses.user.email) || state.email;
      const ctrl = typeof win.AbortController === 'function' ? new win.AbortController() : null;
      const timer = ctrl ? win.setTimeout(() => ctrl.abort(), 25000) : null;
      try {
        const r = await win.fetch('/api/signup', { method: 'POST', signal: ctrl ? ctrl.signal : undefined,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ses.access_token}` }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        return { ok: r.ok, status: r.status, j: j || {} };
      } catch (e) {
        return { ok: false, j: { error: e && e.name === 'AbortError' ? 'timeout' : 'network' } };
      } finally { if (timer) win.clearTimeout(timer); }
    }

    // ---------- Tarjeta "Zona de peligro" (Perfil) ----------
    function renderCard(el) {
      if (!el) return;
      css();
      el.innerHTML = `
        <div class="dz-card" role="region" aria-labelledby="dzCardTitle">
          <div class="dz-head">
            <span class="dz-ico">${ICON_ALERT}</span>
            <div class="min-w-0">
              <p class="dz-kicker">${esc(tr('Zona de peligro', 'Danger zone'))}</p>
              <h3 id="dzCardTitle" class="dz-title">${esc(tr('Eliminar mi cuenta', 'Delete my account'))}</h3>
              <p class="dz-text">${esc(tr('Es permanente: ya no podrás iniciar sesión, reservar ni recibir paseos.', 'This is permanent: you will no longer be able to log in, book or receive walks.'))}</p>
            </div>
          </div>
          <ul class="dz-list">
            <li><b aria-hidden="true">✕</b><span>${esc(tr('Tu perfil y acceso a la app', 'Your profile and access to the app'))}</span></li>
            <li><b aria-hidden="true">✕</b><span>${esc(tr('Mascotas registradas, pasaportes de salud y fotos', 'Registered pets, health passports and photos'))}</span></li>
            <li><b aria-hidden="true">✕</b><span>${esc(tr('Tu historial de paseos en la app, tarjetas guardadas y códigos de tu hogar', 'Your walk history in the app, saved cards and home access codes'))}</span></li>
          </ul>
          <button type="button" class="dz-btn dz-btn-outline" style="margin-top:14px" data-dz-open>
            ${esc(tr('Eliminar mi cuenta…', 'Delete my account…'))}
          </button>
        </div>`;
      el.querySelector('[data-dz-open]').addEventListener('click', open);
    }

    // ---------- Modal ----------
    function onKey(e) {
      const ov = doc.getElementById('bwCloseAccount'); if (!ov) return;
      if (e.key === 'Escape' && !state.busy) { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      const f = [...ov.querySelectorAll('button:not([disabled]),input,textarea,a[href]')];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    function close() {
      if (state.busy) return;
      const el = doc.getElementById('bwCloseAccount');
      if (el) el.remove();
      doc.removeEventListener('keydown', onKey, true);
      doc.documentElement.style.overflow = '';
      const back = state.lastFocus; state.lastFocus = null;
      if (back && typeof back.focus === 'function' && doc.contains(back)) { try { back.focus(); } catch (e) {} }
    }
    function frame(inner) {
      const el = doc.getElementById('bwCloseAccount'); if (!el) return null;
      const m = el.querySelector('.dz-modal');
      m.innerHTML = `<button type="button" class="dz-x" data-x aria-label="${esc(tr('Cerrar', 'Close'))}"${state.busy ? ' disabled' : ''}>${ICON_X}</button>${inner}`;
      m.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', close));
      return m;
    }
    function toast(text) {
      let t = doc.getElementById('bwDzToast');
      if (!t) { t = doc.createElement('div'); t.id = 'bwDzToast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); doc.body.appendChild(t); }
      t.className = 'w-toast'; t.textContent = text;
      win.setTimeout(() => { if (t.parentNode) t.remove(); }, 6000);
    }

    function showLoading() {
      frame(`<div class="dz-center" aria-busy="true"><span class="dz-spin is-lg" style="display:inline-block"></span>
        <p style="font-size:13.5px;font-weight:800;margin-top:12px">${esc(tr('Revisando tu cuenta…', 'Checking your account…'))}</p></div>`);
    }
    function showError(code, retry) {
      const m = frame(`
        <h3 id="bwCloseTitle" class="dz-title" style="padding-right:40px">${esc(tr('No pudimos continuar', 'We could not continue'))}</h3>
        <div class="dz-alert" role="alert"><span aria-hidden="true">⚠️</span><span>${esc(errorText(code, lang()))}</span></div>
        <div class="dz-actions">
          ${code === 'unauthorized'
            ? `<button type="button" class="dz-btn dz-btn-danger" data-login>${esc(tr('Iniciar sesión de nuevo', 'Log in again'))}</button>`
            : `<button type="button" class="dz-btn dz-btn-danger" data-retry>${esc(tr('Reintentar', 'Try again'))}</button>`}
          <button type="button" class="dz-btn dz-btn-ghost" data-x>${esc(tr('Volver', 'Back'))}</button>
        </div>`);
      if (!m) return;
      m.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', close));
      const r = m.querySelector('[data-retry]'); if (r) r.addEventListener('click', retry);
      const l = m.querySelector('[data-login]');
      if (l) l.addEventListener('click', () => { close(); if (typeof win.logoutUser === 'function') win.logoutUser(); });
      (r || l).focus();
    }
    function showBlocked(blockers) {
      const items = blockers.map((b) => `<li><b aria-hidden="true">!</b><span>${esc(blockerText(b.code, lang()))}</span></li>`).join('');
      const m = frame(`
        <h3 id="bwCloseTitle" class="dz-title" style="padding-right:40px">${esc(tr('Aún no puedes eliminar tu cuenta', 'You can’t delete your account yet'))}</h3>
        <p class="dz-text">${esc(tr('Primero hay que resolver esto:', 'These need to be resolved first:'))}</p>
        <ul class="dz-list">${items}</ul>
        <p class="dz-text" style="font-size:11.5px">${esc(tr('Cuando se resuelva, vuelve a intentarlo. Dudas: barkwalkusallc@gmail.com', 'Once resolved, try again. Questions: barkwalkusallc@gmail.com'))}</p>
        <div class="dz-actions"><button type="button" class="dz-btn dz-btn-ghost" data-x>${esc(tr('Entendido', 'Got it'))}</button></div>`);
      if (m) { m.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', close)); m.querySelector('.dz-actions [data-x]').focus(); }
    }
    function showConfirm(errCode) {
      const walker = isWalker();
      const m = frame(`
        <div class="dz-head" style="padding-right:40px">
          <span class="dz-ico">${ICON_ALERT}</span>
          <div><p class="dz-kicker">${esc(tr('Acción permanente', 'Permanent action'))}</p>
          <h3 id="bwCloseTitle" class="dz-title">${esc(tr('¿Eliminar tu cuenta de Barkwalk?', 'Delete your Barkwalk account?'))}</h3></div>
        </div>
        <p class="dz-sub">${esc(tr('Se elimina', 'Will be deleted'))}</p>
        <ul class="dz-list">
          <li><b aria-hidden="true">✕</b><span>${esc(tr('Tu perfil y el acceso: no podrás volver a iniciar sesión.', 'Your profile and access: you won’t be able to log in again.'))}</span></li>
          <li><b aria-hidden="true">✕</b><span>${esc(tr('Tus mascotas registradas, pasaportes de salud y sus fotos.', 'Your registered pets, health passports and their photos.'))}</span></li>
          <li><b aria-hidden="true">✕</b><span>${esc(tr('Tu historial de paseos en la app, tarjetas guardadas, códigos de acceso a tu hogar y avisos al teléfono.', 'Your walk history in the app, saved cards, home access codes and phone notifications.'))}</span></li>
          ${walker ? `<li><b aria-hidden="true">✕</b><span>${esc(tr('Dejas de recibir paseos. Las fotos de tu ID y selfie se borran 3 años después si trabajaste (respaldo fiscal) o a los 90 días si nunca trabajaste.', 'You stop receiving walks. Your ID photos and selfie are deleted after 3 years if you worked (tax records) or after 90 days if you never worked.'))}</span></li>` : ''}
        </ul>
        <p class="dz-sub">${esc(tr('Lo que la ley nos obliga a conservar', 'What the law requires us to keep'))}</p>
        <ul class="dz-list is-kept">
          <li><b aria-hidden="true">✓</b><span>${esc(tr('Registros de pagos, reembolsos y tus aceptaciones de los documentos legales (no se ven en ninguna app).', 'Payment and refund records and your acceptance of the legal documents (not visible in any app).'))}</span></li>
        </ul>
        <label class="dz-label" for="bwCloseReason">${esc(tr('¿Por qué te vas? (opcional)', 'Why are you leaving? (optional)'))}</label>
        <textarea id="bwCloseReason" maxlength="500" rows="2" class="dz-input"></textarea>
        <label class="dz-label" for="bwCloseConfirm">${tr('Para confirmar, escribe <code>DELETE</code> o tu correo', 'To confirm, type <code>DELETE</code> or your email')}</label>
        <input id="bwCloseConfirm" class="dz-input" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="DELETE" aria-describedby="bwCloseErr">
        <div id="bwCloseErr" class="dz-alert" role="alert"${errCode ? '' : ' hidden'}><span aria-hidden="true">⚠️</span><span>${esc(errCode ? errorText(errCode, lang()) : '')}</span></div>
        <div class="dz-actions">
          <button type="button" id="bwCloseGo" class="dz-btn dz-btn-danger" disabled>${esc(tr('Eliminar mi cuenta definitivamente', 'Permanently delete my account'))}</button>
          <button type="button" class="dz-btn dz-btn-ghost" data-x>${esc(tr('Cancelar', 'Cancel'))}</button>
        </div>`);
      if (!m) return;
      m.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', close));
      const inp = doc.getElementById('bwCloseConfirm'), go = doc.getElementById('bwCloseGo');
      const sync = () => { const ok = isConfirm(inp.value, state.email); go.disabled = !ok; inp.classList.toggle('is-ok', ok); };
      inp.addEventListener('input', sync);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !go.disabled) go.click(); });
      go.addEventListener('click', () => submit(inp.value));
      win.setTimeout(() => { try { inp.focus(); } catch (e) {} }, 60);
    }
    function showDone() {
      const m = frame(`<div class="dz-center" role="status">
        <div style="font-size:40px" aria-hidden="true">👋</div>
        <h3 id="bwCloseTitle" class="dz-title" style="margin-top:8px">${esc(tr('Tu cuenta fue eliminada', 'Your account was deleted'))}</h3>
        <p class="dz-text">${esc(tr('Gracias por haber confiado en Barkwalk USA. Cerrando tu sesión…', 'Thank you for trusting Barkwalk USA. Signing you out…'))}</p>
        <span class="dz-spin is-lg" style="display:inline-block;margin-top:14px"></span></div>`);
      if (m) { const x = m.querySelector('.dz-x'); if (x) x.remove(); }
    }

    async function submit(value) {
      if (state.busy || !isConfirm(value, state.email)) return;
      const go = doc.getElementById('bwCloseGo'), inp = doc.getElementById('bwCloseConfirm'), reason = doc.getElementById('bwCloseReason');
      state.busy = true;
      if (go) { go.disabled = true; go.setAttribute('aria-busy', 'true'); go.innerHTML = `<span class="dz-spin" aria-hidden="true"></span><span>${esc(tr('Eliminando tu cuenta…', 'Deleting your account…'))}</span>`; }
      [inp, reason].forEach((x) => { if (x) x.disabled = true; });
      const xb = doc.querySelector('#bwCloseAccount .dz-x'); if (xb) xb.disabled = true;
      const res = await api({ action: 'close_account', confirm: String(value).trim(), reason: (reason && reason.value) || '' });
      state.busy = false;
      // Ya cerrada (p. ej. doble clic o un intento anterior que sí terminó): también es éxito
      if (res.ok || res.j.error === 'already_closed') return finish();
      if (res.j.error === 'close_blocked') return showBlocked(res.j.blockers || []);
      if (res.j.error === 'unauthorized') return showError('unauthorized');
      const keepReason = reason ? reason.value : '';
      showConfirm(res.j.error || 'internal_error');
      const r2 = doc.getElementById('bwCloseReason'); if (r2) r2.value = keepReason;
    }
    async function finish() {
      state.busy = true;
      showDone();
      await new Promise((r) => win.setTimeout(r, 1600));
      state.busy = false;
      close();
      try { if (typeof win.logoutUser === 'function') await win.logoutUser(); else { await win.supabaseClient.auth.signOut({ scope: 'local' }); win.location.replace('/'); } }
      catch (e) { try { await win.supabaseClient.auth.signOut({ scope: 'local' }); } catch (_) {} win.location.replace('/'); return; }
      try { win.scrollTo(0, 0); } catch (e) {}
      toast(tr('✅ Tu cuenta fue eliminada. Gracias por haber usado Barkwalk USA.', '✅ Your account was deleted. Thank you for using Barkwalk USA.'));
    }

    async function load() {
      showLoading();
      const { ok, j } = await api({ action: 'close_account_check' });
      if (!doc.getElementById('bwCloseAccount')) return; // la persona cerró el modal mientras cargaba
      if (!ok) return showError(j.error || 'internal_error', load);
      const blockers = j.blockers || [];
      if (blockers.some((b) => b.code === 'already_closed')) return finish();
      if (!j.canClose) return showBlocked(blockers);
      showConfirm();
    }

    function open() {
      css();
      if (doc.getElementById('bwCloseAccount')) return;
      state = { busy: false, email: (win.currentUser && win.currentUser.email) || '', lastFocus: doc.activeElement };
      const el = doc.createElement('div');
      el.id = 'bwCloseAccount';
      el.className = 'dz-overlay';
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'bwCloseTitle');
      el.innerHTML = '<div class="dz-modal" style="position:relative"></div>';
      doc.body.appendChild(el);
      doc.documentElement.style.overflow = 'hidden';
      el.addEventListener('click', (e) => { if (e.target === el) close(); });
      doc.addEventListener('keydown', onKey, true);
      load();
    }
    return { open, close, renderCard };
  }

  let ui = null;
  const apiUi = () => { if (!ui && typeof window !== 'undefined') ui = mount(window); return ui; };
  return {
    BLOCKERS, isConfirm, blockerText, errorText,
    open: () => apiUi() && apiUi().open(),
    close: () => apiUi() && apiUi().close(),
    renderCard: (el) => apiUi() && apiUi().renderCard(el),
  };
});
