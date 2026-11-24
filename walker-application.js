// Postulación de identidad del paseador (ID oficial VIGENTE + selfie) y reporte del agente para el admin
// ---------------------------------------------------------------------------
// · Paseador: completa sus datos, sube foto del ID y selfie al bucket PRIVADO 'walker-docs' (solo a su carpeta)
//   y envía la postulación a /api/signup { action: 'walker_application' }, que vuelve a validar todo.
//   Puede reenviar si fue rechazada o si su ID venció / está por vencer; el historial nunca se borra.
// · Admin: ve el reporte del agente auditor (checklist + alertas) y abre el ID y la selfie con URLs firmadas de
//   2 minutos (Storage RLS: solo el dueño y el admin). El agente NUNCA aprueba: decide el admin.
// Módulo UMD: funciona en Node (pruebas) y en el navegador (window.BWWalkerApp).
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BWWalkerApp = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BUCKET = 'walker-docs';
  const MAX_BYTES = 5 * 1024 * 1024;
  const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const WARN_DAYS = 30;
  const SIGNED_URL_SECONDS = 120;
  const MAX_SIDE = 2000; // las fotos del teléfono se reducen antes de subirlas (≤ 5 MB y legibles)

  // ---------- Reglas (mismas que api/_lib/walker-identity.js) ----------
  const days = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);
  function checkIdExpiry(expiry, today) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry || '') || Number.isNaN(Date.parse(`${expiry}T00:00:00Z`))) return { ok: false, error: 'invalid_id_expiry' };
    const d = days(expiry, today);
    if (d < 0) return { ok: false, error: 'id_expired', days: d };
    if (d > 365 * 12) return { ok: false, error: 'invalid_id_expiry' };
    return { ok: true, days: d, warning: d <= WARN_DAYS ? 'id_expiring_soon' : null };
  }
  function checkFile(f) {
    if (!f) return { ok: false, error: 'file_missing' };
    if (!TYPES.includes(f.type)) return { ok: false, error: 'file_type' };
    if (!(f.size > 0) || f.size > MAX_BYTES) return { ok: false, error: 'file_size' };
    return { ok: true };
  }
  const extOf = (type) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type] || 'jpg');
  // Ruta única por envío: la evidencia anterior nunca se sobrescribe (la RLS tampoco permite UPDATE)
  function buildPath(uid, kind, type, now = Date.now()) {
    return `${uid}/${now}-${kind}-${Math.random().toString(36).slice(2, 8)}.${extOf(type)}`;
  }
  // ¿Qué debe ver el paseador? (función pura) apps: sus envíos (más reciente primero)
  function viewState(walkerStatus, apps, today) {
    const latest = (apps || [])[0] || null;
    const aprobada = (apps || []).find((a) => a.status === 'approved');
    if (walkerStatus === 'suspended') return { mode: 'suspended', latest };
    if (!latest) return { mode: 'form', reason: 'first', latest };
    if (latest.status === 'rejected' || walkerStatus === 'rejected') return { mode: 'form', reason: 'rejected', latest };
    if (latest.status === 'submitted') return { mode: 'submitted', latest, canResubmit: true };
    if (aprobada) {
      const e = checkIdExpiry(aprobada.id_expiry, today);
      if (!e.ok) return { mode: 'form', reason: 'expired', latest: aprobada };
      if (e.warning) return { mode: 'approved', latest: aprobada, renew: true, days: e.days };
      return { mode: 'approved', latest: aprobada, days: e.days };
    }
    return { mode: 'form', reason: 'first', latest };
  }

  const ERR = {
    invalid_legal_name: ['Escribe tu nombre legal completo, como aparece en tu ID.', 'Enter your full legal name as it appears on your ID.'],
    invalid_phone: ['Escribe un teléfono de EE. UU. de 10 dígitos.', 'Enter a 10-digit U.S. phone number.'],
    invalid_city: ['Escribe tu ciudad.', 'Enter your city.'],
    invalid_zip: ['Escribe un código postal de 5 dígitos.', 'Enter a 5-digit ZIP code.'],
    invalid_id_type: ['Elige el tipo de identificación.', 'Choose the ID type.'],
    invalid_id_expiry: ['Escribe la fecha de vencimiento de tu ID.', 'Enter your ID expiration date.'],
    id_expired: ['Tu identificación está vencida. Sube una identificación vigente.', 'Your ID is expired. Upload a current ID.'],
    file_missing: ['Falta la foto.', 'The photo is missing.'],
    file_type: ['Usa una foto JPEG, PNG o WEBP.', 'Use a JPEG, PNG or WEBP photo.'],
    file_size: ['La foto supera 5 MB.', 'The photo is larger than 5 MB.'],
    id_photo_file_missing: ['No encontramos la foto del ID. Vuelve a subirla.', 'We could not find the ID photo. Upload it again.'],
    selfie_file_missing: ['No encontramos la selfie. Vuelve a subirla.', 'We could not find the selfie. Upload it again.'],
    terms_required: ['Antes debes aceptar los Términos y el Acuerdo para Paseadores vigentes.', 'You must first accept the current Terms and Walker Agreement.'],
    underage: ['Debes tener 19 años o más.', 'You must be 19 or older.'],
    already_approved: ['Tu identidad ya está aprobada y vigente.', 'Your identity is already approved and current.'],
    walker_suspended: ['Tu cuenta está suspendida. Escribe a soporte@barkwalkusa.com.', 'Your account is suspended. Email soporte@barkwalkusa.com.'],
    rate_limited: ['Demasiados intentos. Espera un minuto.', 'Too many attempts. Wait a minute.'],
    upload_failed: ['No se pudo subir la foto. Revisa tu conexión e intenta de nuevo.', 'Could not upload the photo. Check your connection and try again.'],
  };

  const CSS = `
  .wa-grid{display:grid;gap:10px}
  .wa-field{display:block;font-size:11.5px;font-weight:800;color:var(--bw-ink,#1B4D3E)}
  .wa-field input,.wa-field select{display:block;width:100%;margin-top:4px;padding:11px 12px;border:1.5px solid var(--bw-line,#EBE3D5);border-radius:12px;font-size:14px;background:var(--bw-surface,#fff);color:var(--bw-text,#2B2621)}
  .wa-row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .wa-photo{display:flex;align-items:center;gap:12px;padding:12px;border:1.5px dashed var(--bw-dash,#E2D6BF);border-radius:14px;cursor:pointer;background:var(--bw-soft,#FAF7F1)}
  .wa-photo img{width:64px;height:64px;object-fit:cover;border-radius:12px;flex:none;background:var(--bw-card,#F5F0E6)}
  .wa-photo.is-set{border-style:solid;border-color:#00A859}
  .wa-photo input{position:absolute;opacity:0;width:1px;height:1px}
  .wa-note{font-size:11px;color:rgb(var(--bw-text-rgb,43 38 33)/.6);line-height:1.4}
  .wa-warn{padding:9px 12px;border-radius:12px;background:#FEF3C7;color:#78350F;font-size:12px;font-weight:800}
  .wa-err{padding:9px 12px;border-radius:12px;background:#FDECEA;color:#8A1C12;font-size:12px;font-weight:800}
  .wa-ok{padding:10px 12px;border-radius:12px;background:#E7F6EE;color:#05603A;font-size:12.5px;font-weight:800}
  .wa-rep li{display:flex;gap:8px;align-items:flex-start;font-size:12px;line-height:1.35;padding:5px 0;border-top:1px solid var(--bw-line,#EBE3D5)}
  .wa-rep li:first-child{border-top:0}
  .wa-docs{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .wa-docs img{width:100%;aspect-ratio:3/4;object-fit:contain;background:#111;border-radius:12px}
  .wa-risk{display:inline-block;padding:2px 9px;border-radius:999px;font-size:10.5px;font-weight:900;text-transform:uppercase}
  .wa-risk.low{background:#E7F6EE;color:#05603A}.wa-risk.medium{background:#FEF3C7;color:#78350F}.wa-risk.high{background:#FDECEA;color:#8A1C12}`;

  // ---------- Navegador ----------
  function mount(win) {
    const doc = win.document;
    const tr = (es, en) => (win.currentLang === 'en' ? en : es);
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const msg = (code) => { const m = ERR[code]; return m ? tr(m[0], m[1]) : tr('No se pudo enviar. Intenta de nuevo.', 'Could not submit. Please try again.'); };
    const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const css = () => { if (!doc.getElementById('bwWaCss')) { const s = doc.createElement('style'); s.id = 'bwWaCss'; s.textContent = CSS; doc.head.appendChild(s); } };
    const pick = { id: null, selfie: null };

    // Reduce la foto (máx. 2000 px, JPEG 0.85) para que quepa en 5 MB y suba rápido por datos móviles
    async function shrink(file) {
      if (!file || !/^image\//.test(file.type)) return file;
      try {
        const bmp = await win.createImageBitmap(file);
        const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
        if (k === 1 && file.size <= MAX_BYTES && TYPES.includes(file.type)) return file;
        const c = doc.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
        return blob ? new win.File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file;
      } catch (e) { return file; }
    }

    async function loadOwn() {
      const db = win.supabaseClient, u = win.currentUser;
      const { data } = await db.from('walker_applications').select('id,status,id_expiry,submitted_at,decided_at,legal_name,id_type')
        .eq('walker_id', u.id).order('submitted_at', { ascending: false }).limit(20);
      const { data: rev } = await db.from('walker_reviews').select('status,reason,created_at').eq('walker_id', u.id).order('created_at', { ascending: false }).limit(10);
      return { apps: data || [], reviews: rev || [] };
    }

    function formHtml(st, rev) {
      const lastReject = (rev || []).find((r) => r.status === 'rejected');
      const aviso = st.reason === 'rejected'
        ? `<p class="wa-err">✖️ ${esc(tr('Tu postulación anterior no fue aprobada', 'Your previous application was not approved'))}${lastReject && lastReject.reason ? ': ' + esc(lastReject.reason) : ''}. ${esc(tr('Puedes corregirla y enviarla de nuevo; tu historial se conserva.', 'You can fix it and submit again; your history is kept.'))}</p>`
        : st.reason === 'expired' ? `<p class="wa-err">🪪 ${esc(tr('Tu identificación venció. Sube una vigente para volver a recibir paseos.', 'Your ID expired. Upload a current one to receive walks again.'))}</p>`
          : st.renew ? `<p class="wa-warn">🪪 ${esc(tr(`Tu identificación vence en ${st.days} días. Sube la renovada.`, `Your ID expires in ${st.days} days. Upload the renewed one.`))}</p>` : '';
      const u = win.currentUser || {};
      return `${aviso}
        <form id="waForm" class="wa-grid" novalidate>
          <label class="wa-field">${esc(tr('Nombre legal completo (como en tu ID)', 'Full legal name (as on your ID)'))}<input id="waName" autocomplete="name" value="${esc(u.full_name || '')}" required></label>
          <div class="wa-row2">
            <label class="wa-field">${esc(tr('Teléfono', 'Phone'))}<input id="waPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(205) 555-0123" required></label>
            <label class="wa-field">ZIP<input id="waZip" inputmode="numeric" maxlength="5" autocomplete="postal-code" placeholder="35209" required></label>
          </div>
          <label class="wa-field">${esc(tr('Ciudad', 'City'))}<input id="waCity" autocomplete="address-level2" placeholder="Homewood" required></label>
          <div class="wa-row2">
            <label class="wa-field">${esc(tr('Tipo de ID', 'ID type'))}<select id="waIdType"><option value="drivers_license">${esc(tr('Licencia de conducir', "Driver's license"))}</option><option value="state_id">State ID</option></select></label>
            <label class="wa-field">${esc(tr('Vence el', 'Expires on'))}<input id="waExpiry" type="date" min="${today()}" required></label>
          </div>
          <p id="waExpiryNote" class="wa-note"></p>
          <label class="wa-photo" id="waIdBox"><input type="file" id="waIdFile" accept="image/jpeg,image/png,image/webp" capture="environment"><img alt="" id="waIdPrev"><span><b>🪪 ${esc(tr('Foto de tu ID (frente)', 'Photo of your ID (front)'))}</b><br><span class="wa-note">${esc(tr('Clara, completa, sin reflejos. JPEG/PNG/WEBP.', 'Clear, whole, no glare. JPEG/PNG/WEBP.'))}</span></span></label>
          <label class="wa-photo" id="waSelfieBox"><input type="file" id="waSelfieFile" accept="image/jpeg,image/png,image/webp" capture="user"><img alt="" id="waSelfiePrev"><span><b>🤳 ${esc(tr('Selfie', 'Selfie'))}</b><br><span class="wa-note">${esc(tr('Tu cara de frente, con buena luz, sin lentes de sol.', 'Your face, facing the camera, good light, no sunglasses.'))}</span></span></label>
          <p class="wa-note">🔒 ${esc(tr('Tus fotos se guardan en un almacenamiento privado: solo tú y el administrador de Barkwalk pueden verlas. No usamos reconocimiento facial.', 'Your photos are stored privately: only you and the Barkwalk administrator can see them. We do not use facial recognition.'))}</p>
          <p id="waErr" class="wa-err" hidden></p>
          <button type="submit" id="waSubmit" class="w-btn w-btn-primary w-full">${esc(tr('Enviar postulación', 'Submit application'))}</button>
        </form>`;
    }

    function wireForm(box) {
      const $ = (id) => doc.getElementById(id);
      const preview = (inputId, imgId, boxId, key) => $(inputId).addEventListener('change', async (e) => {
        const f = await shrink(e.target.files && e.target.files[0]);
        pick[key] = f || null;
        if (f) { $(imgId).src = win.URL.createObjectURL(f); $(boxId).classList.add('is-set'); }
      });
      preview('waIdFile', 'waIdPrev', 'waIdBox', 'id');
      preview('waSelfieFile', 'waSelfiePrev', 'waSelfieBox', 'selfie');
      $('waExpiry').addEventListener('change', () => {
        const r = checkIdExpiry($('waExpiry').value, today());
        $('waExpiryNote').innerHTML = !$('waExpiry').value ? '' : !r.ok ? `<span class="wa-err" style="display:block">${esc(msg(r.error))}</span>`
          : r.warning ? `<span class="wa-warn" style="display:block">⚠️ ${esc(tr(`Tu ID vence en ${r.days} días. Puedes enviarlo, pero tendrás que renovarlo pronto.`, `Your ID expires in ${r.days} days. You can submit it, but you will need to renew it soon.`))}</span>` : '';
      });
      $('waForm').addEventListener('submit', async (e) => { e.preventDefault(); await submit(box); });
    }

    async function submit(box) {
      const $ = (id) => doc.getElementById(id);
      const err = (code) => { const el = $('waErr'); el.textContent = msg(code); el.hidden = false; };
      $('waErr').hidden = true;
      const exp = checkIdExpiry($('waExpiry').value, today());
      if (!exp.ok) return err(exp.error);
      for (const [k, code] of [['id', 'id_photo_file_missing'], ['selfie', 'selfie_file_missing']]) {
        const c = checkFile(pick[k]); if (!c.ok) return err(c.error === 'file_missing' ? code : c.error);
      }
      const btn = $('waSubmit'); btn.disabled = true; btn.textContent = tr('Subiendo fotos…', 'Uploading photos…');
      try {
        const db = win.supabaseClient, uid = win.currentUser.id;
        const paths = {};
        for (const k of ['id', 'selfie']) {
          const p = buildPath(uid, k === 'id' ? 'id' : 'selfie', pick[k].type);
          const { error } = await db.storage.from(BUCKET).upload(p, pick[k], { contentType: pick[k].type, upsert: false });
          if (error) { console.warn('walker-docs upload:', error.message); return err('upload_failed'); }
          paths[k] = p;
        }
        btn.textContent = tr('Enviando…', 'Submitting…');
        const ses = (await db.auth.getSession()).data.session;
        const r = await win.fetch('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ses.access_token}` },
          body: JSON.stringify({ action: 'walker_application', legalName: $('waName').value, phone: $('waPhone').value, city: $('waCity').value, zip: $('waZip').value,
            idType: $('waIdType').value, idExpiry: $('waExpiry').value, idPhotoPath: paths.id, selfiePath: paths.selfie }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { if (j.error === 'terms_required' && win.BWTermsGate) win.BWTermsGate.require(); return err(j.error); }
        pick.id = pick.selfie = null;
        if (typeof win.showToast === 'function') win.showToast(tr('✅ Postulación enviada. El equipo de Barkwalk la revisará.', '✅ Application submitted. The Barkwalk team will review it.'), 'ok', 5000);
        if (win.currentUser.walker_status === 'rejected') win.currentUser.walker_status = 'pending';
        await render(box.id);
        if (typeof win.renderWalkerAccountStatus === 'function') win.renderWalkerAccountStatus();
      } catch (e2) {
        err('upload_failed');
      } finally {
        const b = $('waSubmit'); if (b) { b.disabled = false; b.textContent = tr('Enviar postulación', 'Submit application'); }
      }
    }

    // Tarjeta del paseador (Walker Pro): formulario, "en revisión", aprobada o renovación
    async function render(containerId) {
      const box = doc.getElementById(containerId || 'walkerApplicationCard');
      const u = win.currentUser;
      if (!box || !u || !win.supabaseClient || !['walker', 'shopper'].includes(u.role)) { if (box) box.hidden = true; return; }
      css(); box.hidden = false;
      const { apps, reviews } = await loadOwn();
      const st = viewState(u.walker_status, apps, today());
      u.walker_app_mode = st.mode;
      const head = `<div class="w-card-head"><p class="w-eyebrow">🪪 ${esc(tr('Tu postulación · identidad', 'Your application · identity'))}</p></div>`;
      if (st.mode === 'suspended') { box.innerHTML = head + `<p class="wa-err">${esc(msg('walker_suspended'))}</p>`; return; }
      if (st.mode === 'submitted') {
        box.innerHTML = head + `<p class="wa-ok">⏳ ${esc(tr('Postulación enviada el', 'Application submitted on'))} ${esc(String(st.latest.submitted_at).slice(0, 10))}. ${esc(tr('El equipo de Barkwalk la está revisando; te avisaremos por correo y notificación.', 'The Barkwalk team is reviewing it; we will notify you by email and push.'))}</p>
          <details class="mt-2"><summary class="text-[12px] font-black text-brandDarkGreen cursor-pointer">${esc(tr('¿Te equivocaste? Envía una versión corregida', 'Made a mistake? Submit a corrected version'))}</summary><div class="mt-2" id="waFormSlot"></div></details>`;
        doc.getElementById('waFormSlot').innerHTML = formHtml({ reason: 'update' }, reviews); wireForm(box); return;
      }
      if (st.mode === 'approved' && !st.renew) {
        box.innerHTML = head + `<p class="wa-ok">✅ ${esc(tr('Identidad aprobada. Tu ID vence el', 'Identity approved. Your ID expires on'))} ${esc(st.latest.id_expiry)}.</p>`; return;
      }
      box.innerHTML = head + formHtml(st, reviews);
      wireForm(box);
    }

    // ---------- Admin: reporte del agente + documentos (URLs firmadas de 2 min) ----------
    async function renderAdminReview(walkerId, container) {
      const db = win.supabaseClient; if (!db || !container) return;
      css();
      container.innerHTML = `<p class="wa-note">${esc(tr('Cargando postulación…', 'Loading application…'))}</p>`;
      const { data: apps, error } = await db.from('walker_applications').select('*').eq('walker_id', walkerId).order('submitted_at', { ascending: false }).limit(10);
      if (error) { container.innerHTML = `<p class="wa-err">${esc(error.message)}</p>`; return; }
      const { data: revs } = await db.from('walker_reviews').select('status,reason,created_at').eq('walker_id', walkerId).order('created_at', { ascending: false }).limit(10);
      const a = (apps || [])[0];
      if (!a) { container.innerHTML = `<p class="wa-warn">${esc(tr('Aún no envió su postulación con ID y selfie: no se puede aprobar.', 'No ID + selfie application yet: cannot be approved.'))}</p>`; return; }
      const r = a.agent_report || {};
      const chk = (r.checklist || []).map((c) => `<li><span>${c.ok ? '✅' : '❌'}</span><span><b>${esc(c.label)}</b><br><span class="wa-note">${esc(c.detail)}</span></span></li>`).join('');
      const al = (r.alerts || []).map((x) => `<li><span>${x.level === 'high' ? '🔴' : x.level === 'medium' ? '🟠' : '🟡'}</span><span>${esc(x.message)}</span></li>`).join('')
        || `<li><span>✅</span><span>${esc(tr('Sin alertas.', 'No alerts.'))}</span></li>`;
      const hist = (apps || []).slice(1).map((x) => `${esc(String(x.submitted_at).slice(0, 10))} · ${esc(x.status)}`).join(' · ');
      const decis = (revs || []).map((x) => `${esc(String(x.created_at).slice(0, 10))} ${esc(x.status)}${x.reason ? ' — ' + esc(x.reason) : ''}`).join('<br>');
      container.innerHTML = `
        <div class="wa-grid mt-2">
          <p class="text-[12px] font-black">${esc(a.legal_name)} · ${esc(a.city)} ${esc(a.zip)} · ${esc(a.phone)} · ${esc(a.id_type === 'state_id' ? 'State ID' : tr('Licencia', 'License'))} ${esc(tr('vence', 'exp.'))} ${esc(a.id_expiry)}
            <span class="wa-risk ${esc(a.agent_risk || 'medium')}">${esc(tr('riesgo', 'risk'))} ${esc(a.agent_risk || '—')}</span></p>
          <p class="wa-note">${esc(r.summary || tr('El agente aún no analiza esta postulación.', 'The agent has not analyzed this application yet.'))} · ${esc(tr('estado', 'status'))}: ${esc(a.status)}</p>
          <p class="wa-note"><b>${esc(tr('El agente NO aprueba: revisa las fotos y decide tú.', 'The agent does NOT approve: review the photos and decide.'))}</b></p>
          <ul class="wa-rep">${chk}</ul>
          <p class="text-[12px] font-black">${esc(tr('Alertas para revisar con atención', 'Alerts to review carefully'))}</p>
          <ul class="wa-rep">${al}</ul>
          <div class="wa-docs" data-docs><button type="button" class="w-mini-btn bg-white border border-brandBeige" data-doc="${esc(a.id_photo_path)}">🪪 ${esc(tr('Ver ID', 'View ID'))}</button>
            <button type="button" class="w-mini-btn bg-white border border-brandBeige" data-doc="${esc(a.selfie_path)}">🤳 ${esc(tr('Ver selfie', 'View selfie'))}</button></div>
          ${hist ? `<p class="wa-note">${esc(tr('Envíos anteriores', 'Previous submissions'))}: ${hist}</p>` : ''}
          ${decis ? `<p class="wa-note">${esc(tr('Decisiones', 'Decisions'))}:<br>${decis}</p>` : ''}
        </div>`;
      container.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', async () => {
        const { data: s, error: e } = await db.storage.from(BUCKET).createSignedUrl(b.dataset.doc, SIGNED_URL_SECONDS);
        if (e || !s) { b.textContent = '⚠️ ' + (e ? e.message : 'error'); return; }
        const img = doc.createElement('img'); img.src = s.signedUrl; img.alt = b.textContent.trim(); img.referrerPolicy = 'no-referrer';
        b.replaceWith(img);
      }));
    }

    return { render, renderAdminReview };
  }

  let ui = null;
  const api = () => { if (!ui && typeof window !== 'undefined') ui = mount(window); return ui; };
  return {
    BUCKET, MAX_BYTES, TYPES, WARN_DAYS, SIGNED_URL_SECONDS, ERR, CSS, checkIdExpiry, checkFile, buildPath, viewState,
    render: (id) => api() && api().render(id), renderAdminReview: (w, c) => api() && api().renderAdminReview(w, c),
  };
});
