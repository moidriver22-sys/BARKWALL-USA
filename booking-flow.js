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
    { id: 'pets', icon: '🐾', es: 'Mascotas', en: 'Pets', hintEs: '¿Quién sale a pasear?', hintEn: 'Who is going out?' },
    { id: 'service', icon: '🚶', es: 'Servicio', en: 'Service', hintEs: 'Elige el paseo, la duración y los extras', hintEn: 'Pick the walk, duration and extras' },
    { id: 'when', icon: '📅', es: 'Cuándo', en: 'When', hintEs: 'Días, hora y dónde recogemos', hintEn: 'Days, time and pickup spot' },
    { id: 'review', icon: '✅', es: 'Revisar', en: 'Review', hintEs: 'Confirma que todo esté bien y paga seguro', hintEn: 'Check everything and pay securely' },
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
  const POLISH = `  /* ===== Acabado visual: profundidad, jerarquía y estados de selección ===== */
  #bookingModal .bk-card{padding:22px 20px 24px;background:radial-gradient(120% 60% at 100% 0%,rgba(0,168,89,.07),transparent 60%),var(--bw-bg);border-color:var(--bw-line);box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 40px 80px -30px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.03)}
  #bookingModal #modalTitleBooking{font-size:17px;font-weight:900;letter-spacing:-.01em}
  .bk-stepper{padding:12px 6px 12px;border-radius:20px;background:var(--bw-surface);border:1px solid var(--bw-line);box-shadow:0 1px 2px rgba(16,24,40,.04),0 12px 26px -20px rgba(27,77,62,.5)}
  .bk-dot{width:34px;height:34px;box-shadow:0 1px 2px rgba(16,24,40,.06)}
  .bk-stepper button:not([data-status="active"]):hover .bk-dot{transform:translateY(-1px);border-color:#C5A059}
  .bk-stepper [data-status="active"] .bk-dot{background:linear-gradient(145deg,#1B4D3E,#0F7A4F);border-color:transparent;box-shadow:0 0 0 3px var(--bw-surface),0 0 0 5px rgba(0,168,89,.4),0 10px 18px -8px rgba(0,168,89,.7)}
  .bk-stepper [data-status="done"] .bk-dot{background:linear-gradient(145deg,#00A859,#19C47D);border-color:transparent;box-shadow:0 6px 12px -8px rgba(0,168,89,.9)}
  .bk-stepper [data-status="active"] .bk-dot-label{color:var(--bw-ink)}
  .bk-track{height:5px;margin:10px 18px 0;background:var(--bw-soft)}
  .bk-track span{box-shadow:0 0 10px rgba(0,168,89,.55)}

  /* Resumen superior fijo: siempre visible al desplazarse */
  .bk-live{position:sticky;top:-22px;z-index:6;align-items:center;gap:6px;min-height:46px;padding:9px 10px;border-radius:18px;border:1px solid var(--bw-line);background:var(--bw-surface);background:color-mix(in srgb,var(--bw-surface) 90%,transparent);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);box-shadow:0 14px 30px -22px rgba(27,77,62,.7),0 1px 2px rgba(16,24,40,.04)}
  .bk-live:empty::before{content:attr(data-empty);font-size:11.5px;font-weight:700;color:rgb(var(--bw-text-rgb)/.5);padding:0 4px}
  .bk-chip{padding:5px 11px;background:var(--bw-soft);border-color:transparent;font-size:11.5px;max-width:100%}
  .bk-chip[data-k="total"]{margin-left:auto;padding:6px 13px;font-size:13.5px;font-weight:900;letter-spacing:-.01em;border:0;background:linear-gradient(135deg,#1B4D3E,#0F7A4F);box-shadow:0 8px 16px -10px rgba(15,122,79,.9)}

  /* Encabezado de cada paso */
  .bk-step-title{display:flex;align-items:center;gap:12px;padding:0 0 14px;border-bottom:1px solid var(--bw-line);text-transform:none;letter-spacing:0;font-size:inherit}
  .bk-st-ic{flex:none;width:44px;height:44px;border-radius:15px;display:grid;place-items:center;font-size:21px;background:linear-gradient(145deg,var(--bw-selected),var(--bw-surface));border:1px solid var(--bw-line);box-shadow:0 8px 16px -12px rgba(27,77,62,.6)}
  .bk-st-txt{display:flex;flex-direction:column;gap:2px;min-width:0}
  .bk-st-kicker{font-size:10.5px;font-weight:900;letter-spacing:.09em;text-transform:uppercase;color:#00A859}
  .bk-st-name{font-size:19px;font-weight:900;letter-spacing:-.015em;line-height:1.1;color:var(--bw-ink)}
  .bk-st-hint{font-size:12px;font-weight:600;line-height:1.3;color:rgb(var(--bw-text-rgb)/.6)}
  #bookingModal .bw-label{font-size:10.5px;letter-spacing:.1em;margin-bottom:8px}

  /* Mascotas: tarjeta con marca de selección */
  #bookingModal .bk-pet{position:relative;padding:12px 48px 12px 12px;border-width:1.5px;border-radius:20px;box-shadow:0 1px 2px rgba(16,24,40,.05),0 8px 18px -14px rgba(27,77,62,.45)}
  #bookingModal .bk-pet input[type="checkbox"]{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
  #bookingModal .bk-pet::after{content:"";position:absolute;top:50%;right:14px;width:24px;height:24px;margin-top:-12px;border-radius:999px;border:2px solid var(--bw-line);background:var(--bw-surface);display:grid;place-items:center;color:#fff;font-size:13px;font-weight:900;transition:background .2s,border-color .2s,transform .25s cubic-bezier(.34,1.56,.64,1)}
  #bookingModal .bk-pet:not(.is-on):hover{border-color:#C5A059;box-shadow:0 1px 2px rgba(16,24,40,.05),0 14px 24px -16px rgba(27,77,62,.55)}
  #bookingModal .bk-pet.is-on,#bookingModal .bk-pet:has(input:checked){border-color:#1B4D3E;background:linear-gradient(160deg,var(--bw-selected),var(--bw-surface) 75%);box-shadow:0 0 0 3px rgba(0,168,89,.16),0 14px 26px -18px rgba(27,77,62,.8)}
  #bookingModal .bk-pet.is-on::after,#bookingModal .bk-pet:has(input:checked)::after{content:"✓";background:#00A859;border-color:#00A859;transform:scale(1.05)}
  #bookingModal .bk-pet:has(input:focus-visible){box-shadow:0 0 0 4px rgba(0,168,89,.4)}

  /* Servicios, duración y extras */
  #bookingModal .cat-tab{padding:9px 15px;border-width:1.5px;box-shadow:0 1px 2px rgba(16,24,40,.04)}
  #bookingModal .cat-tab:hover{border-color:#C5A059}
  #bookingModal .cat-tab[aria-selected="true"]{background:linear-gradient(135deg,#1B4D3E,#0F7A4F);border-color:transparent;box-shadow:0 8px 16px -10px rgba(15,122,79,.9)}
  #bookingModal .svc-tile{border-width:1.5px;border-radius:20px;padding:15px;box-shadow:0 1px 2px rgba(16,24,40,.05),0 10px 22px -18px rgba(27,77,62,.5)}
  #bookingModal .svc-tile:not(.is-selected):hover{transform:translateY(-2px);box-shadow:0 1px 2px rgba(16,24,40,.05),0 16px 28px -18px rgba(27,77,62,.6)}
  #bookingModal .svc-tile.is-selected{border-color:#1B4D3E;background:linear-gradient(160deg,var(--bw-selected),var(--bw-surface) 70%);box-shadow:0 0 0 3px rgba(0,168,89,.16),0 18px 32px -20px rgba(27,77,62,.85)}
  #bookingModal .svc-emoji{position:relative;box-shadow:inset 0 0 0 1px var(--bw-line)}
  #bookingModal .svc-tile.is-selected .svc-emoji{background:linear-gradient(145deg,#1B4D3E,#0F7A4F);box-shadow:0 8px 16px -8px rgba(15,122,79,.9)}
  #bookingModal .svc-tile.is-selected .svc-emoji::after{content:"✓";position:absolute;right:-6px;bottom:-6px;width:20px;height:20px;border-radius:999px;display:grid;place-items:center;background:#00A859;color:#fff;font-size:11px;font-weight:900;border:2px solid var(--bw-surface)}
  #bookingModal .variant-row{gap:8px;margin-top:12px}
  #bookingModal .variant-pill{padding:9px 14px;border-width:1.5px;border-radius:14px;box-shadow:0 1px 2px rgba(16,24,40,.05)}
  #bookingModal .variant-pill:hover{border-color:#00A859}
  #bookingModal .variant-pill[aria-checked="true"]{background:linear-gradient(135deg,#1B4D3E,#0F7A4F);border-color:transparent;box-shadow:0 0 0 3px rgba(0,168,89,.18),0 10px 18px -10px rgba(15,122,79,.95)}
  #bookingModal .variant-pill[aria-checked="true"]::before{content:"✓ "}
  #bookingModal .variant-pill:focus-visible{outline:none;box-shadow:0 0 0 4px rgba(0,168,89,.4)}
  #bookingModal .addon-card{border-width:1.5px;border-radius:20px;box-shadow:0 1px 2px rgba(16,24,40,.05),0 8px 18px -16px rgba(27,77,62,.45)}
  #bookingModal .addon-card:hover{border-color:#C5A059}
  #bookingModal .addon-card:has(.addon-input:checked){border-color:#00A859;box-shadow:0 0 0 3px rgba(0,168,89,.14),0 12px 22px -16px rgba(0,168,89,.7)}
  #bookingModal .addon-card:has(.addon-input:checked) .addon-price{background:#00A859;color:#fff}

  /* Fecha, hora y dirección */
  #bookingModal .dp-card{border-width:1.5px;box-shadow:0 1px 2px rgba(16,24,40,.05),0 6px 14px -10px rgba(27,77,62,.4)}
  #bookingModal .dp-card.sel{box-shadow:0 0 0 3px rgba(0,168,89,.18),0 12px 20px -8px rgba(0,168,89,.6)}
  #bookingModal .bw-field{border-width:1.5px;border-radius:16px;min-height:50px;font-size:14px;box-shadow:inset 0 1px 2px rgba(16,24,40,.05);transition:border-color .2s,box-shadow .2s,background .2s}
  #bookingModal .bw-field:hover{border-color:#C5A059}
  #bookingModal .bw-field:focus{border-color:#00A859;box-shadow:0 0 0 4px rgba(0,168,89,.16)}
  #bookingModal #inputPickupAddress:not(:placeholder-shown){border-color:#1B4D3E;background:var(--bw-selected-alt)}

  /* Pago y paneles del paso final */
  #bookingModal .bk-panel{border:1px solid var(--bw-line);border-radius:20px;box-shadow:0 1px 2px rgba(16,24,40,.05),0 10px 24px -20px rgba(27,77,62,.55)}
  #bookingModal .pay-method{border-width:1.5px;border-radius:14px;transition:transform .15s,box-shadow .2s,background .2s}
  #bookingModal .pay-method-selected{background:linear-gradient(135deg,#1B4D3E,#0F7A4F)!important;border-color:transparent!important;box-shadow:0 0 0 3px rgba(0,168,89,.18),0 10px 18px -10px rgba(15,122,79,.95)}
  #bookingModal #btnConfirmBooking{position:relative;overflow:hidden;min-height:56px;border-radius:18px;font-size:14px;font-weight:900;letter-spacing:.01em;color:#fff;background:linear-gradient(135deg,#1B4D3E 0%,#0F7A4F 55%,#00A859 100%);box-shadow:0 16px 30px -14px rgba(15,122,79,.95),inset 0 1px 0 rgba(255,255,255,.2)}
  #bookingModal #btnConfirmBooking::after{content:"";position:absolute;inset:0 auto 0 -40%;width:35%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.28),transparent);transform:skewX(-18deg);animation:bkShine 3.2s ease-in-out 1s infinite;pointer-events:none}
  #bookingModal #btnConfirmBooking:hover{filter:brightness(1.05)}
  #bookingModal #btnConfirmBooking:focus-visible{outline:none;box-shadow:0 0 0 4px rgba(0,168,89,.45),0 16px 30px -14px rgba(15,122,79,.95)}

  /* Revisión final */
  .bk-review{padding:0;overflow:hidden;border:1px solid var(--bw-line);border-radius:24px;box-shadow:0 1px 2px rgba(16,24,40,.05),0 24px 40px -28px rgba(27,77,62,.8)}
  .bk-rv-hero{margin:0;padding:18px 18px 16px;background:linear-gradient(135deg,#1B4D3E 0%,#0F7A4F 60%,#00A859 100%);color:#fff;position:relative}
  .bk-rv-hero::after{content:"";position:absolute;right:-30px;top:-40px;width:140px;height:140px;border-radius:999px;background:radial-gradient(circle,rgba(255,255,255,.18),transparent 70%);pointer-events:none}
  .bk-rv-paw{width:52px;height:52px;border-radius:18px;display:grid;place-items:center;font-size:30px;background:rgba(255,255,255,.16);box-shadow:inset 0 0 0 1px rgba(255,255,255,.25)}
  .bk-rv-kicker{color:#BFF5D9}
  .bk-rv-title{color:#fff;font-size:20px;letter-spacing:-.015em}
  .bk-rv-list{padding:4px 16px 0}
  .bk-rv-item{padding:11px 0;gap:12px}
  .bk-rv-item:first-child{border-top:0}
  .bk-rv-ic{width:36px;height:36px;border-radius:12px;font-size:16px;background:var(--bw-selected);box-shadow:inset 0 0 0 1px var(--bw-line)}
  .bk-rv-v{font-size:13.5px;line-height:1.3}
  .bk-rv-edit{flex:none;padding:6px 11px;border-radius:999px;background:var(--bw-soft);border:1px solid var(--bw-line);color:var(--bw-ink);transition:background .2s,border-color .2s}
  .bk-rv-edit:hover{border-color:#00A859;background:var(--bw-selected)}
  .bk-rv-edit:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(0,168,89,.4)}
  .bk-rv-total{margin:6px 16px 0;padding:14px 16px;border-radius:18px;box-shadow:0 14px 26px -16px rgba(15,122,79,.95),inset 0 1px 0 rgba(255,255,255,.18)}
  .bk-rv-total b{font-size:26px;letter-spacing:-.02em}
  .bk-rv-trust{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 14px;margin:0;padding:12px 16px 16px;font-size:11px;font-weight:700;color:rgb(var(--bw-text-rgb)/.6)}

  /* Cancelar: tarjeta cálida y clara */
  .bk-cancel{padding:20px;background:rgba(245,240,230,.78)}
  html.dark .bk-cancel{background:rgba(10,16,13,.8)}
  .bk-cancel-box{max-width:340px;padding:0 0 18px;overflow:hidden;border:1px solid var(--bw-line);border-radius:26px;box-shadow:0 40px 70px -30px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.03)}
  .bk-cancel-head{padding:22px 18px 14px;background:linear-gradient(180deg,var(--bw-selected),var(--bw-surface))}
  .bk-cancel-emoji{width:72px;height:72px;border-radius:999px;display:inline-grid;place-items:center;font-size:38px;background:var(--bw-surface);box-shadow:0 0 0 6px rgba(0,168,89,.12),0 14px 24px -14px rgba(27,77,62,.8)}
  .bk-cancel-box h4{margin:14px 0 6px;font-size:19px;letter-spacing:-.015em}
  .bk-cancel-box p{margin:0;padding:0 6px;font-size:13px;line-height:1.5}
  .bk-cancel-sum{margin:14px 18px 16px;padding:10px 12px;border-radius:16px;background:var(--bw-soft);border:1px dashed var(--bw-dash);font-size:12px;font-weight:800;color:var(--bw-text);overflow-wrap:anywhere}
  .bk-cancel-sum:empty{display:none}
  .bk-cancel-sum small{display:block;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:rgb(var(--bw-text-rgb)/.5);margin-bottom:3px}
  .bk-cancel-box .bk-btn{width:calc(100% - 36px);margin:0 18px}
  .bk-cancel-box > p + .bk-btn,.bk-cancel-sum:empty + .bk-btn{margin-top:16px}
  .bk-cancel-box .bk-btn-primary{background:linear-gradient(135deg,#1B4D3E,#0F7A4F);box-shadow:0 14px 26px -14px rgba(15,122,79,.95)}
  .bk-btn-soft{border-width:1.5px;color:#9A3412;background:transparent}
  html.dark .bk-btn-soft{color:#FDBA74}
  .bk-btn-soft:hover{background:rgba(234,88,12,.08);border-color:rgba(234,88,12,.35)}
  .bk-cancel.is-bye .bk-cancel-sum{display:none}

  /* Barra inferior con efecto vidrio */
  .bk-navbar{bottom:-24px;margin:18px -20px -24px;padding:14px 20px 16px;background:var(--bw-bg);background:color-mix(in srgb,var(--bw-bg) 88%,transparent);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-top:1px solid var(--bw-line)}
  .bk-btn{min-height:52px;border-radius:16px;font-size:14px}
  .bk-btn-primary{background:linear-gradient(135deg,#1B4D3E,#0F7A4F);box-shadow:0 14px 24px -14px rgba(15,122,79,.95),inset 0 1px 0 rgba(255,255,255,.18)}
  .bk-btn-primary:hover{background:linear-gradient(135deg,#163F33,#0D6B45)}
  .bk-btn-ghost{border-width:1.5px;box-shadow:0 1px 2px rgba(16,24,40,.05)}
  .bk-error{display:none;align-items:flex-start;gap:8px;border-radius:14px;padding:10px 12px;box-shadow:0 8px 18px -14px rgba(179,38,30,.6)}
  .bk-error.is-on{display:flex}
  .bk-error.is-on::before{content:"!";flex:none;width:18px;height:18px;border-radius:999px;display:grid;place-items:center;background:#B3261E;color:#fff;font-size:11px;font-weight:900}
  @keyframes bkShine{0%{left:-40%}55%,100%{left:120%}}
  @media (prefers-reduced-motion: reduce){
    #bookingModal #btnConfirmBooking::after{animation:none!important;display:none}
    #bookingModal .bk-pet,#bookingModal .bk-pet::after,#bookingModal .svc-tile,#bookingModal .bw-field,#bookingModal .pay-method,.bk-rv-edit{transition:none!important}
    #bookingModal .bk-pet:hover,#bookingModal .svc-tile:hover,.bk-stepper button:hover .bk-dot{transform:none!important}
  }`;
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
  }` + POLISH;
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
        const i = Number(h.dataset.title);
        h.innerHTML = `<span class="bk-st-ic" aria-hidden="true">${STEPS[i].icon}</span><span class="bk-st-txt"><span class="bk-st-kicker">${esc(tr('Paso', 'Step'))} ${i + 1} ${esc(tr('de', 'of'))} ${STEPS.length}</span><span class="bk-st-name">${esc(tr(STEPS[i].es, STEPS[i].en))}</span><span class="bk-st-hint">${esc(tr(STEPS[i].hintEs, STEPS[i].hintEn))}</span></span>`;
      });
      renderLive(s.sum);
      if (st.step === STEPS.length - 1) renderReview(s);
      // Cancelar
      const panel = $('bkCancel');
      if (panel) {
        const abierto = st.cancelOpen;
        if (abierto && panel.hidden) { scrollTop(true); panel.hidden = false; panel.classList.remove('bk-cancel-out'); void panel.offsetWidth; panel.classList.add('bk-cancel-in'); setTimeout(() => { const k = $('bkKeep'); if (k) k.focus(); }, 30); }
        if (!abierto && !panel.hidden) { panel.classList.remove('bk-cancel-in'); panel.classList.add('bk-cancel-out'); setTimeout(() => { if (!flow.state.cancelOpen) panel.hidden = true; }, reduced() ? 0 : 220); }
        const tt = $('bkCancelTitle'); if (tt) tt.textContent = tr('¿Quieres cancelar tu reserva?', 'Cancel your booking?');
        const tx = $('bkCancelText'); if (tx) tx.textContent = tr('Tranquilo: no se ha hecho ningún cargo. Si sigues, todo lo que elegiste se queda tal cual.', "No worries: you haven't been charged. If you continue, everything you picked stays just as it is.");
        const kb = $('bkKeep'); if (kb) kb.textContent = tr('💚 Seguir con mi reserva', '💚 Keep my booking');
        const cb = $('bkConfirmCancel'); if (cb) cb.textContent = tr('Sí, cancelar', 'Yes, cancel');
        const cs = $('bkCancelSummary');
        if (cs && abierto) { const sm = s.sum || {}; const parts = [(sm.pets || []).map((p) => p.name).join(' + '), [sm.serviceName, sm.duration].filter(Boolean).join(' · '), sm.days ? `${sm.days} ${tr(sm.days === 1 ? 'día' : 'días', sm.days === 1 ? 'day' : 'days')}` : ''].filter(Boolean);
          cs.innerHTML = parts.length ? `<small>${esc(tr('Lo que tienes elegido', 'What you picked'))}</small>${esc(parts.join(' · '))}` : ''; }
      }
      if (win.lucide && win.lucide.createIcons) try { win.lucide.createIcons(); } catch (e) { /* iconos opcionales */ }
    }

    // Resumen en vivo (fichas que "saltan" cuando cambian)
    let lastChips = {};
    function renderLive(sum) {
      const box = $('bkLive'); if (!box || !sum) return;
      box.setAttribute('data-empty', tr('Tu reserva aparecerá aquí mientras eliges ✨', 'Your booking will appear here as you choose ✨'));
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
      // Barkwalk Club: ahorro real (socio) o ahorro posible (no socio). Solo informativo: el servidor calcula el precio.
      const MV = win.BWMembershipValue;
      const nota = MV && typeof win.isClubMember === 'function' ? MV.bookingNote(sum, { member: !!win.isClubMember(), lang: lang() }) : null;
      if (MV) MV.injectCss();
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
        <div class="bk-rv-total" style="animation-delay:${reduced() ? 0 : items.length * 60}ms"><span>${esc(tr('Total a pagar', 'Total to pay'))}</span><b>$${Number(total || 0).toFixed(2)}</b></div>
        ${nota ? `<p class="bk-club-note" data-kind="${nota.kind}">${nota.html}</p>` : ''}<p class="bk-rv-trust"><span>🔒 ${esc(tr('Pago seguro con Stripe', 'Secure payment with Stripe'))}</span><span>✓ ${esc(tr('Sin cargo hasta que pagues', 'No charge until you pay'))}</span></p>`;
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
    function scrollTop(instant) { const card = $('bookingModal') && $('bookingModal').querySelector('.bk-card'); if (card) card.scrollTo({ top: 0, behavior: instant || reduced() ? 'auto' : 'smooth' }); }

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
