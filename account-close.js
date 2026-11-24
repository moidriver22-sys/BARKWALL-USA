// Perfil → "Cerrar mi cuenta": confirmación explícita (escribir CERRAR / CLOSE), bloqueos y cierre de sesión.
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
    active_walks_as_walker: ['Tienes paseos aceptados o en curso como paseador. Termínalos primero.', 'You have accepted or in-progress walks as a walker. Finish them first.'],
    unsettled_payouts: ['Tienes pagos de paseos completados sin liquidar. Espera a recibirlos (48 h después de cada paseo) o escríbenos.', 'You have completed-walk payouts not yet settled. Wait to receive them (48 h after each walk) or contact us.'],
    pending_refunds: ['Tienes un reembolso por cancelación en proceso. Espera a que se complete.', 'You have a cancellation refund in progress. Wait until it is completed.'],
    open_disputes: ['Tienes una disputa de pago abierta con tu banco. Debe resolverse antes de cerrar la cuenta.', 'You have an open payment dispute with your bank. It must be resolved before closing the account.'],
    active_membership: ['Tu membresía sigue activa. Cancélala primero desde Club → Administrar (portal de Stripe).', 'Your membership is still active. Cancel it first from Club → Manage (Stripe portal).'],
    already_closed: ['Esta cuenta ya está cerrada.', 'This account is already closed.'],
  };
  const isConfirm = (v) => ['CERRAR', 'CLOSE'].includes(String(v || '').trim().toUpperCase());
  function blockerText(code, lang) { const m = BLOCKERS[code]; return m ? (lang === 'en' ? m[1] : m[0]) : code; }

  function mount(win) {
    const doc = win.document;
    const tr = (es, en) => (win.currentLang === 'en' ? en : es);
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    async function api(body) {
      const db = win.supabaseClient; const ses = db ? (await db.auth.getSession()).data.session : null;
      if (!ses) return { ok: false, j: { error: 'unauthorized' } };
      const r = await win.fetch('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ses.access_token}` }, body: JSON.stringify(body) });
      return { ok: r.ok, j: await r.json().catch(() => ({})) };
    }
    function close() { const el = doc.getElementById('bwCloseAccount'); if (el) el.remove(); }

    async function open() {
      close();
      const el = doc.createElement('div');
      el.id = 'bwCloseAccount';
      el.className = 'fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4';
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'bwCloseTitle');
      el.innerHTML = `<div class="w-card w-full max-w-md max-h-[90vh] overflow-y-auto"><p class="text-[13px] font-bold">${esc(tr('Revisando tu cuenta…', 'Checking your account…'))}</p></div>`;
      doc.body.appendChild(el);
      el.addEventListener('click', (e) => { if (e.target === el) close(); });
      const { ok, j } = await api({ action: 'close_account_check' });
      const card = el.firstElementChild;
      if (!ok) { card.innerHTML = `<p class="text-[13px] font-bold text-red-700">${esc(tr('No se pudo revisar tu cuenta. Intenta de nuevo.', 'Could not check your account. Try again.'))}</p><button type="button" class="w-btn w-btn-ghost w-full mt-3" data-x>${esc(tr('Cerrar', 'Close'))}</button>`; card.querySelector('[data-x]').onclick = close; return; }
      const lang = win.currentLang === 'en' ? 'en' : 'es';
      const bloqueos = (j.blockers || []).map((b) => `<li class="flex gap-2"><span aria-hidden="true">⛔</span><span>${esc(blockerText(b.code, lang))}</span></li>`).join('');
      const walker = ['walker', 'shopper'].includes(win.currentUser && win.currentUser.role);
      card.innerHTML = `
        <h3 id="bwCloseTitle" class="text-[18px] font-black text-brandDarkGreen">${esc(tr('Cerrar mi cuenta', 'Close my account'))}</h3>
        ${j.canClose ? `
          <p class="text-[12.5px] mt-2 leading-relaxed">${esc(tr('Al cerrar tu cuenta ya no podrás iniciar sesión ni reservar o recibir paseos. Esto no se puede deshacer desde la app.', 'Once closed, you will no longer be able to log in or book or receive walks. This cannot be undone from the app.'))}</p>
          <ul class="text-[12px] mt-3 space-y-1.5 leading-snug">
            <li>🗑️ ${esc(tr('Borramos tus avisos al teléfono, tarjetas guardadas y códigos de acceso a tu hogar, y dejas de recibir correos de promociones.', 'We delete your phone notifications, saved cards and home access codes, and you stop receiving promotional emails.'))}</li>
            <li>📁 ${esc(tr('Conservamos lo que la ley exige: tus aceptaciones de los documentos legales y los registros de pagos y reembolsos.', 'We keep what the law requires: your acceptance of the legal documents and payment and refund records.'))}</li>
            ${walker ? `<li>🪪 ${esc(tr('Fotos de tu ID y selfie: se borran 3 años después del cierre si trabajaste como paseador (respaldo operativo y fiscal), o a los 90 días si nunca trabajaste.', 'Your ID photos and selfie: deleted 3 years after closing if you worked as a walker (operational and tax records), or after 90 days if you never worked.'))}</li>` : ''}
          </ul>
          <label class="block text-[12px] font-bold mt-4">${esc(tr('Motivo (opcional)', 'Reason (optional)'))}
            <textarea id="bwCloseReason" maxlength="500" rows="2" class="bw-field mt-1"></textarea></label>
          <label class="block text-[12px] font-bold mt-3">${esc(tr('Escribe CERRAR para confirmar', 'Type CLOSE to confirm'))}
            <input id="bwCloseConfirm" autocomplete="off" autocapitalize="characters" class="bw-field mt-1" placeholder="${esc(tr('CERRAR', 'CLOSE'))}"></label>
          <p id="bwCloseErr" class="text-[12px] font-bold text-red-700 mt-2" hidden></p>
          <button type="button" id="bwCloseGo" class="w-btn w-full mt-3" style="background:#B91C1C;color:#fff" disabled>${esc(tr('Cerrar mi cuenta definitivamente', 'Permanently close my account'))}</button>`
        : `
          <p class="text-[12.5px] mt-2">${esc(tr('Por ahora no puedes cerrar tu cuenta:', 'You cannot close your account yet:'))}</p>
          <ul class="text-[12.5px] mt-2 space-y-2 leading-snug">${bloqueos}</ul>
          <p class="text-[11.5px] mt-3 text-brandTextDark/65">${esc(tr('Cuando se resuelva, vuelve a intentarlo. Dudas: soporte@barkwalkusa.com', 'Once resolved, try again. Questions: soporte@barkwalkusa.com'))}</p>`}
        <button type="button" class="w-btn w-btn-ghost w-full mt-2" data-x>${esc(tr('Volver', 'Back'))}</button>`;
      card.querySelector('[data-x]').onclick = close;
      const inp = doc.getElementById('bwCloseConfirm'), go = doc.getElementById('bwCloseGo');
      if (!inp || !go) return;
      inp.addEventListener('input', () => { go.disabled = !isConfirm(inp.value); });
      go.addEventListener('click', async () => {
        if (!isConfirm(inp.value)) return;
        go.disabled = true; go.textContent = tr('Cerrando…', 'Closing…');
        const res = await api({ action: 'close_account', confirm: inp.value.trim().toUpperCase(), reason: (doc.getElementById('bwCloseReason') || {}).value || '' });
        if (!res.ok) {
          const e = doc.getElementById('bwCloseErr'); e.hidden = false;
          e.textContent = res.j.error === 'close_blocked' ? (res.j.blockers || []).map((b) => blockerText(b.code, lang)).join(' ') : tr('No se pudo cerrar la cuenta. Intenta de nuevo.', 'Could not close the account. Try again.');
          go.disabled = false; go.textContent = tr('Cerrar mi cuenta definitivamente', 'Permanently close my account');
          return;
        }
        card.innerHTML = `<div class="text-center"><div class="text-4xl" aria-hidden="true">👋</div><h3 class="text-[18px] font-black text-brandDarkGreen mt-2">${esc(tr('Tu cuenta fue cerrada', 'Your account was closed'))}</h3>
          <p class="text-[12.5px] mt-2">${esc(tr('Gracias por haber usado Barkwalk USA. Cerramos tu sesión ahora.', 'Thank you for using Barkwalk USA. We are logging you out now.'))}</p></div>`;
        win.setTimeout(() => { close(); if (typeof win.logoutUser === 'function') win.logoutUser(); }, 2200);
      });
    }
    return { open, close };
  }

  let ui = null;
  const apiUi = () => { if (!ui && typeof window !== 'undefined') ui = mount(window); return ui; };
  return { BLOCKERS, isConfirm, blockerText, open: () => apiUi() && apiUi().open(), close: () => apiUi() && apiUi().close() };
});
