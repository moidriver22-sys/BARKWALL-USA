// Barkwalk USA · Flujo de reserva por pasos (window.BWBookingFlow)
// ---------------------------------------------------------------------------
// 4 pasos sobre el MISMO formulario de #bookingModal (mismos ids: el cobro, Stripe, anti-bots, filtro y aviso
// antifuga no cambian):  1 🐾 Mascotas · 2 🚶 Servicio y extras · 3 📅 Cuándo y dónde · 4 ✅ Revisar y pagar
// · createFlow(): máquina de estados PURA (sin DOM) → se prueba en Node (tests/booking-flow.test.js).
// · La capa de pantalla solo dibuja lo que dice la máquina: indicadores hecho/activo/pendiente, transición
//   animada según la dirección, resumen en vivo, revisión final animada y el panel amable de Cancelar.
// · Cancelar NUNCA borra nada hasta que la persona lo confirma; "Seguir con mi reserva" vuelve al mismo paso.
// · prefers-reduced-motion: sin animaciones ni esperas.
// ---------------------------------------------------------------------------
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BWBookingFlow = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STEPS = [
    { id: 'pets', icon: '🐾', es: 'Mascotas', en: 'Pets' },
    { id: 'service', icon: '🚶', es: 'Servicio', en: 'Service' },
    { id: 'when', icon: '📅', es: 'Cuándo', en: 'When' },
    { id: 'review', icon: '✅', es: 'Revisar', en: 'Review' },
  ];

  const MSG = {
    no_pets: ['Elige al menos una mascota (o regístrala en "Mis mascotas").', 'Choose at least one pet (or add one in "My pets").'],
    no_service: ['Elige un servicio y su duración.', 'Choose a service and its duration.'],
    no_days: ['Elige al menos un día para el servicio.', 'Choose at least one day for the service.'],
    no_time: ['Elige la hora del servicio.', 'Choose the service time.'],
    past_time: ['La hora del primer día ya pasó. Elige una hora más tarde u otro día.', 'The time on the first day has already passed. Choose a later time or another day.'],
    no_address: ['Escribe la dirección de recogida.', 'Please enter the pickup address.'],
    liability: ['Para pagar, acepta la Exención de responsabilidad de acceso al hogar y custodia de llaves.', 'To pay, accept the Key Handling & House Access Release of Liability.'],
  };
  function message(code, lang) { const m = MSG[code]; return m ? (lang === 'en' ? m[1] : m[0]) : ''; }

  // s = { petsCount, serviceId, variantLabel, days, time, firstStartMs, now, address, liability }
  function validateStep(index, s) {
    const st = s || {};
    switch (STEPS[index] && STEPS[index].id) {
      case 'pets': return st.petsCount > 0 ? { ok: true } : { ok: false, code: 'no_pets' };
      case 'service': return st.serviceId && st.variantLabel ? { ok: true } : { ok: false, code: 'no_service' };
      case 'when':
        if (!(st.days > 0)) return { ok: false, code: 'no_days' };
        if (!/^\d{2}:\d{2}$/.test(st.time || '')) return { ok: false, code: 'no_time' };
        if (Number.isFinite(st.firstStartMs) && st.firstStartMs < (st.now || Date.now())) return { ok: false, code: 'past_time' };
        if (!String(st.address || '').trim()) return { ok: false, code: 'no_address' };
        return { ok: true };
      case 'review': return st.liability ? { ok: true } : { ok: false, code: 'liability' };
      default: return { ok: false, code: 'unknown_step' };
    }
  }
  // Primer paso con datos incompletos ANTES de `upTo` (o -1 si todos están bien)
  function firstInvalidBefore(upTo, s) {
    for (let i = 0; i < upTo; i++) if (!validateStep(i, s).ok) return i;
    return -1;
  }
  function stepStatus(i, current, s) {
    if (i === current) return 'active';
    if (i < current) return validateStep(i, s).ok ? 'done' : 'error';
    return 'pending';
  }
  function hasProgress(s) {
    const st = s || {};
    return !!(st.touched || st.days > 0 || st.address || st.liability || (st.grooming && st.grooming.length));
  }

  // Máquina de estados del flujo. getState() devuelve los datos actuales del formulario.
  function createFlow(getState, onChange) {
    const st = { step: 0, dir: 'forward', error: null, cancelOpen: false, cancelled: false };
    const emit = () => { if (onChange) onChange({ ...st }); return { ...st }; };
    const data = () => (typeof getState === 'function' ? getState() : {}) || {};
    return {
      get state() { return { ...st }; },
      reset() { st.step = 0; st.dir = 'forward'; st.error = null; st.cancelOpen = false; st.cancelled = false; return emit(); },
      next() {
        const v = validateStep(st.step, data());
        if (!v.ok) { st.error = v.code; return emit(); }
        st.error = null;
        if (st.step < STEPS.length - 1) { st.step++; st.dir = 'forward'; }
        return emit();
      },
      back() { st.error = null; if (st.step > 0) { st.step--; st.dir = 'back'; } return emit(); },
      // Ir a un paso desde el indicador: atrás siempre; adelante solo si todo lo anterior está completo
      goTo(i) {
        if (i < 0 || i >= STEPS.length || i === st.step) return emit();
        if (i > st.step) {
          const bad = firstInvalidBefore(i, data());
          if (bad !== -1) { st.dir = bad < st.step ? 'back' : 'forward'; st.step = bad; st.error = validateStep(bad, data()).code; return emit(); }
        }
        st.dir = i > st.step ? 'forward' : 'back'; st.step = i; st.error = null;
        return emit();
      },
      // Antes de pagar: todo completo (si algo falta, lleva a ese paso con su mensaje)
      checkout() {
        const bad = firstInvalidBefore(STEPS.length, data());
        if (bad === -1) { st.error = null; emit(); return true; }
        if (bad !== st.step) { st.dir = bad < st.step ? 'back' : 'forward'; st.step = bad; }
        st.error = validateStep(bad, data()).code; emit(); return false;
      },
      clearError() { st.error = null; return emit(); },
      requestCancel() { st.cancelOpen = true; return emit(); },
      keepBooking() { st.cancelOpen = false; return emit(); },              // nada se pierde
      confirmCancel() { st.cancelOpen = false; st.cancelled = true; st.step = 0; st.error = null; return emit(); },
    };
  }

  // Fichas del resumen en vivo
  function summaryChips(sum, lang) {
    const es = lang !== 'en';
    const s = sum || {};
    const chips = [];
    if (s.petNames && s.petNames.length) chips.push({ k: 'pets', icon: '🐾', text: s.petNames.join(' + ') });
    if (s.serviceName) chips.push({ k: 'service', icon: s.serviceIcon || '🚶', text: `${s.serviceName}${s.duration ? ' · ' + s.duration : ''}` });
    if (s.days) chips.push({ k: 'days', icon: '📅', text: `${s.days} ${es ? (s.days === 1 ? 'día' : 'días') : (s.days === 1 ? 'day' : 'days')}` });
    if (s.time) chips.push({ k: 'time', icon: '🕘', text: s.time });
    if (Number.isFinite(s.total)) chips.push({ k: 'total', icon: '💲', text: `$${s.total.toFixed(2)}` });
    return chips;
  }

  // ======================= Estilos (Tailwind está precompilado) =======================
  // Usa las variables del tema (--bw-*) para funcionar en modo claro y oscuro.
  const CSS = `
  .bk-card{position:relative}
  .bk-stepper{margin:2px 0 6px}
  .bk-stepper ol{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;list-style:none;margin:0;padding:0}
  .bk-stepper button{width:100%;display:flex;flex-direction:column;align-items:center;gap:5px;background:none;border:0;padding:4px 2px;cursor:pointer;border-radius:14px;color:rgb(var(--bw-text-rgb)/.55);font:inherit}
  .bk-stepper button:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(0,168,89,.35)}
  .bk-dot{width:32px;height:32px;border-radius:999px;display:grid;place-items:center;font-size:13px;font-weight:900;border:2px solid var(--bw-line);background:var(--bw-surface);color:rgb(var(--bw-text-rgb)/.55);transition:background .3s,border-color .3s,color .3s,transform .3s}
  .bk-dot-label{font-size:10.5px;font-weight:800;letter-spacing:.01em}
  .bk-stepper [data-status="active"]{color:var(--bw-ink)}
  .bk-stepper [data-status="active"] .bk-dot{background:#1B4D3E;border-color:#1B4D3E;color:#fff;transform:scale(1.08);box-shadow:0 0 0 5px rgba(0,168,89,.16)}
  .bk-stepper [data-status="done"]{color:var(--bw-ink)}
  .bk-stepper [data-status="done"] .bk-dot{background:#00A859;border-color:#00A859;color:#fff}
  .bk-stepper [data-status="error"] .bk-dot{background:#FDECEA;border-color:#E2574C;color:#B3261E}
  .bk-stepper [data-status="pending"] .bk-dot{border-style:dashed}
  .bk-track{position:relative;height:4px;border-radius:999px;background:var(--bw-line);margin:8px 16px 0;overflow:hidden}
  .bk-track span{position:absolute;inset:0 auto 0 0;width:0;border-radius:999px;background:linear-gradient(90deg,#00A859,#1B4D3E);transition:width .45s cubic-bezier(.16,1,.3,1)}
  .bk-live{display:flex;flex-wrap:wrap;gap:6px;min-height:28px;padding:8px 10px;border-radius:16px;background:var(--bw-soft);border:1px dashed var(--bw-dash)}
  .bk-chip{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;background:var(--bw-surface);border:1px solid var(--bw-line);font-size:11px;font-weight:800;color:var(--bw-text);transition:transform .2s,border-color .2s}
  .bk-chip[data-k="total"]{background:#1B4D3E;color:#fff;border-color:#1B4D3E}
  .bk-chip-pop{animation:bkPop .38s cubic-bezier(.34,1.56,.64,1)}
  .bk-step[hidden]{display:none!important}
  .bk-step > * + *{margin-top:22px}
  .bk-step-title{font-size:12px;font-weight:900;letter-spacing:.04em;text-transform:uppercase;color:var(--bw-ink);padding-bottom:8px;border-bottom:2px solid var(--bw-line)}
  .bk-in-forward{animation:bkInR .34s cubic-bezier(.16,1,.3,1)}
  .bk-in-back{animation:bkInL .34s cubic-bezier(.16,1,.3,1)}
  .bk-navbar{position:sticky;bottom:-24px;margin:18px -24px -24px;padding:14px 24px 16px;background:linear-gradient(180deg,rgba(0,0,0,0),var(--bw-card) 30%);display:grid;gap:8px;z-index:5}
  .bk-navrow{display:flex;gap:8px}
  .bk-btn{min-height:48px;border-radius:14px;font-weight:900;font-size:13px;cursor:pointer;transition:transform .15s,box-shadow .2s,background .2s;border:0}
  .bk-btn:active{transform:scale(.97)}
  .bk-btn:focus-visible{outline:none;box-shadow:0 0 0 4px rgba(0,168,89,.3)}
  .bk-btn-primary{flex:1;background:#1B4D3E;color:#fff;box-shadow:0 8px 18px -10px rgba(27,77,62,.8)}
  .bk-btn-primary:hover{background:#163F33}
  .bk-btn-ghost{padding:0 16px;background:var(--bw-surface);color:var(--bw-ink);border:2px solid var(--bw-line)}
  .bk-cancel-link{justify-self:center;background:none;border:0;color:rgb(var(--bw-text-rgb)/.6);font-size:11.5px;font-weight:800;text-decoration:underline;text-underline-offset:3px;cursor:pointer;padding:4px 8px}
  .bk-error{display:none;font-size:12px;font-weight:800;color:#8A1C12;background:#FDECEA;border:1px solid #F3B8B0;border-radius:12px;padding:9px 12px}
  .bk-error.is-on{display:block}
  .bk-shake{animation:bkShake .4s}
  .bk-pet{transition:border-color .2s,background .2s,transform .2s,box-shadow .2s}
  .bk-pet:hover{transform:translateY(-1px)}
  .bk-pet.is-on{background:var(--bw-selected-alt);box-shadow:0 6px 16px -12px rgba(27,77,62,.9);animation:bkPop .35s cubic-bezier(.34,1.56,.64,1)}
  #bookingModal .svc-tile,#bookingModal .variant-pill,#bookingModal .addon-card,#bookingModal .cat-tab{transition:transform .18s,border-color .2s,background .2s,box-shadow .2s}
  #bookingModal .svc-tile.is-selected{animation:bkPop .35s cubic-bezier(.34,1.56,.64,1)}
  #bookingModal .variant-pill[aria-checked="true"]{transform:scale(1.04)}
  .bk-review{border-radius:22px;padding:16px;background:var(--bw-surface);border:2px solid var(--bw-line);box-shadow:0 18px 30px -24px rgba(27,77,62,.7)}
  .bk-rv-hero{display:flex;align-items:center;gap:12px;margin-bottom:10px}
  .bk-rv-paw{font-size:34px;display:inline-block;animation:bkBounce 1.6s ease-in-out infinite}
  .bk-rv-kicker{font-size:11px;font-weight:900;color:#00A859;text-transform:uppercase;letter-spacing:.06em;margin:0}
  .bk-rv-title{font-size:18px;font-weight:900;color:var(--bw-ink);margin:0}
  .bk-rv-list{list-style:none;margin:0;padding:0}
  .bk-rv-item{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--bw-line);opacity:0;animation:bkUp .4s cubic-bezier(.16,1,.3,1) forwards}
  .bk-rv-ic{width:30px;height:30px;border-radius:10px;display:grid;place-items:center;background:var(--bw-soft);flex:none}
  .bk-rv-txt{flex:1;min-width:0;display:flex;flex-direction:column}
  .bk-rv-k{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:rgb(var(--bw-text-rgb)/.5)}
  .bk-rv-v{font-size:13px;font-weight:800;color:var(--bw-text);overflow-wrap:anywhere}
  .bk-rv-edit{background:none;border:0;color:#00A859;font-weight:900;font-size:11px;cursor:pointer;padding:6px}
  .bk-rv-total{display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding:12px 14px;border-radius:16px;background:linear-gradient(135deg,#1B4D3E,#00A859);color:#fff;font-weight:800;font-size:13px;opacity:0;animation:bkUp .45s cubic-bezier(.16,1,.3,1) forwards}
  .bk-rv-total b{font-size:22px;font-weight:900}
  .bk-cancel{position:absolute;inset:0;z-index:20;display:grid;place-items:center;padding:24px;border-radius:inherit;background:rgba(245,240,230,.86);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
  html.dark .bk-cancel{background:rgba(14,21,18,.86)}
  .bk-cancel[hidden]{display:none}
  .bk-cancel-box{width:100%;max-width:320px;text-align:center;background:var(--bw-surface);border:2px solid var(--bw-line);border-radius:24px;padding:22px 18px;box-shadow:0 24px 40px -24px rgba(0,0,0,.45)}
  .bk-cancel-emoji{font-size:42px;display:inline-block;animation:bkWave 1.4s ease-in-out infinite;transform-origin:70% 80%}
  .bk-cancel-box h4{margin:8px 0 6px;font-size:17px;font-weight:900;color:var(--bw-ink)}
  .bk-cancel-box p{margin:0 0 16px;font-size:12.5px;line-height:1.45;color:rgb(var(--bw-text-rgb)/.75)}
  .bk-cancel-box .bk-btn{width:100%}
  .bk-cancel-box .bk-btn + .bk-btn{margin-top:8px}
  .bk-btn-soft{background:transparent;color:rgb(var(--bw-text-rgb)/.7);border:2px solid var(--bw-line)}
  .bk-cancel-in{animation:bkFade .22s ease-out}.bk-cancel-in .bk-cancel-box{animation:bkPopIn .32s cubic-bezier(.34,1.56,.64,1)}
  .bk-cancel-out{animation:bkFadeOut .22s ease-in forwards}
  .bk-cancel.is-bye .bk-cancel-box .bk-btn{display:none}
  .bk-cancel.is-bye .bk-cancel-emoji{animation:bkBye 1.1s ease-in-out forwards}
  @keyframes bkInR{from{opacity:0;transform:translateX(26px)}to{opacity:1;transform:none}}
  @keyframes bkInL{from{opacity:0;transform:translateX(-26px)}to{opacity:1;transform:none}}
  @keyframes bkUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  @keyframes bkPop{0%{transform:scale(.96)}60%{transform:scale(1.03)}100%{transform:scale(1)}}
  @keyframes bkPopIn{from{opacity:0;transform:scale(.88) translateY(10px)}to{opacity:1;transform:none}}
  @keyframes bkFade{from{opacity:0}to{opacity:1}}
  @keyframes bkFadeOut{from{opacity:1}to{opacity:0}}
  @keyframes bkShake{0%,100%{transform:none}20%{transform:translateX(-6px)}40%{transform:translateX(5px)}60%{transform:translateX(-3px)}80%{transform:translateX(2px)}}
  @keyframes bkBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
  @keyframes bkWave{0%,100%{transform:rotate(0)}25%{transform:rotate(-12deg)}75%{transform:rotate(12deg)}}
  @keyframes bkBye{0%{transform:scale(1)}40%{transform:scale(1.25) rotate(-10deg)}100%{transform:scale(1.1) rotate(8deg);opacity:.9}}
  @media (prefers-reduced-motion: reduce){
    .bk-in-forward,.bk-in-back,.bk-chip-pop,.bk-shake,.bk-pet.is-on,.bk-rv-paw,.bk-rv-item,.bk-rv-total,.bk-cancel-in,.bk-cancel-in .bk-cancel-box,.bk-cancel-out,.bk-cancel-emoji,.bk-cancel.is-bye .bk-cancel-emoji,#bookingModal .svc-tile.is-selected{animation:none!important}
    .bk-rv-item,.bk-rv-total{opacity:1}
    .bk-dot,.bk-track span,.bk-chip,.bk-pet,.bk-btn,#bookingModal .svc-tile,#bookingModal .variant-pill,#bookingModal .addon-card,#bookingModal .cat-tab{transition:none!important}
    .bk-pet:hover,#bookingModal .variant-pill[aria-checked="true"]{transform:none}
  }`;
  function injectCss() {
    if (typeof document === 'undefined' || document.getElementById('bkFlowCss')) return;
    const st = document.createElement('style'); st.id = 'bkFlowCss'; st.textContent = CSS; document.head.appendChild(st);
  }

  // ======================= Capa de pantalla (solo navegador) =======================
  function mountDom(win) {
    const doc = win.document;
    const $ = (id) => doc.getElementById(id);
    const lang = () => { try { return win.currentLang === 'en' || (typeof currentLang !== 'undefined' && currentLang === 'en') ? 'en' : 'es'; } catch (e) { return 'es'; } }; // eslint-disable-line no-undef
    const tr = (es, en) => (lang() === 'en' ? en : es);
    const reduced = () => !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const call = (name, ...a) => { const f = win[name]; return typeof f === 'function' ? f(...a) : undefined; };

    // Datos actuales del formulario (las funciones globales de index.html son la fuente de verdad)
    function readState() {
      const sum = call('getBookingSummary') || {};
      const time = ($('inputBookingTime') || {}).value || '';
      const first = sum.dates && sum.dates[0];
      const iso = first && /^\d{2}:\d{2}$/.test(time) ? call('birminghamToUtcIso', first, time) : null;
      return {
        petsCount: (sum.pets || []).length, serviceId: sum.serviceName ? 'ok' : '', variantLabel: sum.duration,
        days: sum.days || 0, time, firstStartMs: iso ? Date.parse(iso) : NaN, now: Date.now(),
        address: (($('inputPickupAddress') || {}).value || '').trim(), liability: !!($('chkLiability') || {}).checked,
        grooming: (sum.lines || []).map((l) => l.name), touched: flowTouched, sum,
      };
    }
    let flowTouched = false;
    const flow = createFlow(readState, render);

    function render(st) {
      const s = readState();
      injectCss();
      ['bkStepper', 'bkNavBar'].forEach((id) => { const el = $(id); if (el) el.hidden = false; }); // solo con este script
      // Pasos
      doc.querySelectorAll('#bookingModal .bk-step').forEach((sec) => {
        const i = Number(sec.dataset.step);
        const on = i === st.step;
        sec.hidden = !on;
        sec.classList.toggle('is-active', on);
        sec.classList.remove('bk-in-forward', 'bk-in-back');
        if (on && !reduced()) { void sec.offsetWidth; sec.classList.add(st.dir === 'back' ? 'bk-in-back' : 'bk-in-forward'); }
      });
      // Indicador
      doc.querySelectorAll('#bkStepper [data-goto]').forEach((b) => {
        const i = Number(b.dataset.goto);
        const status = stepStatus(i, st.step, s);
        b.dataset.status = status;
        b.setAttribute('aria-current', status === 'active' ? 'step' : 'false');
        const lbl = b.querySelector('.bk-dot-label'); if (lbl) lbl.textContent = tr(STEPS[i].es, STEPS[i].en);
        const dot = b.querySelector('.bk-dot'); if (dot) dot.textContent = status === 'done' ? '✓' : (status === 'error' ? '!' : String(i + 1));
      });
      const bar = $('bkProgressBar'); if (bar) bar.style.width = `${(st.step / (STEPS.length - 1)) * 100}%`;
      // Navegación
      const back = $('bkBack'), next = $('bkNext');
      if (back) { back.hidden = st.step === 0; back.textContent = tr('← Atrás', '← Back'); }
      if (next) { next.hidden = st.step === STEPS.length - 1; next.textContent = st.step === STEPS.length - 2 ? tr('Revisar mi reserva →', 'Review my booking →') : tr('Continuar →', 'Continue →'); }
      const cancelLink = $('bkCancelLink'); if (cancelLink) cancelLink.textContent = tr('Cancelar reserva', 'Cancel booking');
      const err = $('bkStepError');
      if (err) { err.textContent = st.error ? message(st.error, lang()) : ''; err.classList.toggle('is-on', !!st.error); if (st.error && !reduced()) { err.classList.remove('bk-shake'); void err.offsetWidth; err.classList.add('bk-shake'); } }
      doc.querySelectorAll('#bookingModal .bk-step-title').forEach((h) => {
        const i = Number(h.dataset.title); h.textContent = `${STEPS[i].icon} ${tr(STEPS[i].es, STEPS[i].en)} · ${tr('paso', 'step')} ${i + 1}/${STEPS.length}`;
      });
      renderLive(s.sum);
      if (st.step === STEPS.length - 1) renderReview(s);
      // Cancelar
      const panel = $('bkCancel');
      if (panel) {
        const abierto = st.cancelOpen;
        if (abierto && panel.hidden) { panel.hidden = false; panel.classList.remove('bk-cancel-out'); void panel.offsetWidth; panel.classList.add('bk-cancel-in'); setTimeout(() => { const k = $('bkKeep'); if (k) k.focus(); }, 30); }
        if (!abierto && !panel.hidden) { panel.classList.remove('bk-cancel-in'); panel.classList.add('bk-cancel-out'); setTimeout(() => { if (!flow.state.cancelOpen) panel.hidden = true; }, reduced() ? 0 : 220); }
        const tt = $('bkCancelTitle'); if (tt) tt.textContent = tr('¿Quieres cancelar tu reserva?', 'Cancel your booking?');
        const tx = $('bkCancelText'); if (tx) tx.textContent = tr('Tranquilo: no se ha hecho ningún cargo. Si sigues, todo lo que elegiste se queda tal cual.', "No worries: you haven't been charged. If you continue, everything you picked stays just as it is.");
        const kb = $('bkKeep'); if (kb) kb.textContent = tr('💚 Seguir con mi reserva', '💚 Keep my booking');
        const cb = $('bkConfirmCancel'); if (cb) cb.textContent = tr('Sí, cancelar', 'Yes, cancel');
      }
      if (win.lucide && win.lucide.createIcons) try { win.lucide.createIcons(); } catch (e) { /* iconos opcionales */ }
    }

    // Resumen en vivo (fichas que "saltan" cuando cambian)
    let lastChips = {};
    function renderLive(sum) {
      const box = $('bkLive'); if (!box || !sum) return;
      const chips = summaryChips({ petNames: (sum.pets || []).map((p) => p.name), serviceName: sum.serviceName, duration: sum.duration,
        days: sum.days, time: (($('inputBookingTime') || {}).value || ''), total: sum.days ? sum.grandTotal : sum.perDay }, lang());
      box.innerHTML = chips.map((c) => `<span class="bk-chip ${lastChips[c.k] !== undefined && lastChips[c.k] !== c.text && !reduced() ? 'bk-chip-pop' : ''}" data-k="${c.k}"><span aria-hidden="true">${c.icon}</span>${esc(c.text)}</span>`).join('');
      lastChips = Object.fromEntries(chips.map((c) => [c.k, c.text]));
    }

    // Revisión final animada (cada línea aparece en cascada; "Cambiar" lleva a su paso)
    function renderReview(s) {
      const box = $('bkReview'); if (!box) return;
      const sum = s.sum || {};
      const fmt = (d) => (typeof win.fmtBookingDate === 'function' ? win.fmtBookingDate(d) : d);
      const items = [
        ['🐾', tr('Mascotas', 'Pets'), (sum.pets || []).map((p) => p.name).join(' + ') || '—', 0],
        ['🚶', tr('Servicio', 'Service'), `${sum.serviceLabel || sum.serviceName || '—'}${sum.duration ? ' · ' + sum.duration : ''}`, 1],
        ['✨', tr('Extras', 'Extras'), (sum.lines || []).map((l) => l.name).join(', ') || tr('Ninguno', 'None'), 1],
        ['📅', tr('Días', 'Days'), (sum.dates || []).map(fmt).join(' · ') || '—', 2],
        ['🕘', tr('Hora', 'Time'), `${s.time || '—'} (Birmingham, AL)`, 2],
        ['📍', tr('Recogida', 'Pickup'), s.address || '—', 2],
      ];
      const total = sum.days ? sum.grandTotal : sum.perDay;
      box.innerHTML = `
        <div class="bk-rv-hero"><span class="bk-rv-paw" aria-hidden="true">🐶</span>
          <div><p class="bk-rv-kicker">${esc(tr('¡Casi listo!', 'Almost done!'))}</p>
          <p class="bk-rv-title">${esc(tr('Revisa tu reserva', 'Review your booking'))}</p></div></div>
        <ul class="bk-rv-list">${items.map(([ic, k, v, step], n) => `
          <li class="bk-rv-item" style="animation-delay:${reduced() ? 0 : n * 60}ms">
            <span class="bk-rv-ic" aria-hidden="true">${ic}</span>
            <span class="bk-rv-txt"><span class="bk-rv-k">${esc(k)}</span><span class="bk-rv-v">${esc(v)}</span></span>
            <button type="button" class="bk-rv-edit" data-edit="${step}">${esc(tr('Cambiar', 'Edit'))}</button>
          </li>`).join('')}
        </ul>
        <div class="bk-rv-total" style="animation-delay:${reduced() ? 0 : items.length * 60}ms"><span>${esc(tr('Total a pagar', 'Total to pay'))}</span><b>$${Number(total || 0).toFixed(2)}</b></div>`;
    }

    // Despedida amable al cancelar y cierre
    function farewellAndClose() {
      const panel = $('bkCancel');
      const done = () => {
        call('resetBookingAfterSuccess');                     // días, checkout y exención
        try { if (typeof BOOKING !== 'undefined' && BOOKING.grooming) BOOKING.grooming.clear(); } catch (e) { /* opcional */ } // eslint-disable-line no-undef
        const big = $('chkLargeDog'); if (big) big.checked = false;
        flowTouched = false;
        if (panel) { panel.hidden = true; panel.classList.remove('bk-cancel-in', 'bk-cancel-out', 'is-bye'); }
        const modal = $('bookingModal'); if (modal) modal.classList.add('hidden');
        call('renderCatalog');
        flow.reset();
        if (typeof win.showToast === 'function') win.showToast(tr('Reserva cancelada. No se hizo ningún cargo. ¡Aquí estaremos cuando quieras! 🐾', "Booking cancelled. You weren't charged. We'll be here whenever you need us! 🐾"), 'info', 4000);
      };
      if (panel && !reduced()) {
        panel.hidden = false; panel.classList.add('is-bye');
        const tt = $('bkCancelTitle'); if (tt) tt.textContent = tr('¡Hasta pronto! 👋', 'See you soon! 👋');
        const tx = $('bkCancelText'); if (tx) tx.textContent = tr('Tu reserva se canceló sin ningún cargo.', 'Your booking was cancelled with no charge.');
        setTimeout(done, 1100);
      } else done();
    }

    function wire() {
      const modal = $('bookingModal'); if (!modal || modal.dataset.bkWired) return;
      modal.dataset.bkWired = '1';
      const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
      on('bkNext', () => { flowTouched = true; flow.next(); scrollTop(); });
      on('bkBack', () => { flow.back(); scrollTop(); });
      on('bkCancelLink', () => flow.requestCancel());
      on('bkKeep', () => flow.keepBooking());
      on('bkConfirmCancel', () => { flow.confirmCancel(); farewellAndClose(); });
      doc.querySelectorAll('#bkStepper [data-goto]').forEach((b) => b.addEventListener('click', () => { flow.goTo(Number(b.dataset.goto)); scrollTop(); }));
      modal.addEventListener('click', (e) => {
        const ed = e.target.closest && e.target.closest('[data-edit]');
        if (ed) { flow.goTo(Number(ed.dataset.edit)); scrollTop(); }
      });
      // Cualquier cambio en el formulario actualiza resumen e indicadores (y quita el error del paso)
      const refresh = () => { flowTouched = true; if (flow.state.error && validateStep(flow.state.step, readState()).ok) flow.clearError(); else render(flow.state); };
      modal.addEventListener('change', refresh);
      modal.addEventListener('input', (e) => { if (e.target && e.target.id === 'inputPickupAddress') refresh(); });
      doc.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) { e.preventDefault(); flow.state.cancelOpen ? flow.keepBooking() : flow.requestCancel(); }
      });
    }
    function scrollTop() { const card = $('bookingModal') && $('bookingModal').querySelector('.bk-card'); if (card) card.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); }

    return {
      flow,
      open() { wire(); flow.reset(); },
      refresh() { if ($('bookingModal') && !$('bookingModal').classList.contains('hidden')) render(flow.state); },
      requestClose() {   // la X del modal: si hay algo elegido, pregunta con cariño antes de cerrar
        if (hasProgress(readState())) flow.requestCancel();
        else { const m = $('bookingModal'); if (m) m.classList.add('hidden'); }
      },
      // Botón Pagar: todo completo (incluida la exención), sin alert(); luego el cobro de siempre
      confirm() { flowTouched = true; if (!flow.checkout()) { scrollTop(); return false; } return call('confirmBooking'); },
    };
  }

  let dom = null;
  function ui() { if (!dom && typeof window !== 'undefined') dom = mountDom(window); return dom; }

  return {
    STEPS, MSG, CSS, message, validateStep, firstInvalidBefore, stepStatus, hasProgress, createFlow, summaryChips,
    open: () => ui() && ui().open(), refresh: () => ui() && ui().refresh(),
    requestClose: () => ui() && ui().requestClose(), confirm: () => ui() && ui().confirm(),
  };
});
