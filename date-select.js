// Selector de fecha Mes / Día / Año (fecha de nacimiento del registro y de la pantalla de Términos, y
// vencimiento del ID en la postulación del paseador y fecha lejana de la reserva con { future: true })
// ---------------------------------------------------------------------------
// · Al cambiar el AÑO (o el mes) se conservan el mes y el día ya elegidos. Si la combinación no existe
//   (29 de febrero en un año no bisiesto, 31 en un mes de 30 días) el día se ajusta al último día válido
//   de ese mes (28/29/30) — nunca se reinicia a un valor por defecto.
// · Mientras falte el año, febrero admite hasta el 29 (podría ser bisiesto); al elegir el año se ajusta.
// · Rango exacto: solo se ofrecen los meses y días entre min y max del input. Si un cambio de año/mes deja la
//   fecha fuera, se lleva al límite más cercano (p. ej. min 24-dic-2026: marzo 2026 → diciembre, día 10 → 24),
//   sin vaciar ningún campo.
// · Escribe 'YYYY-MM-DD' en el MISMO <input> original (mismo id, que pasa a type="hidden"), así el resto de la
//   app (validación de edad, envío a /api/signup) no cambia. Sin este script queda el <input type="date"> nativo.
// Módulo UMD: funciona en Node (pruebas) y en el navegador (window.BWDateSelect).
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BWDateSelect = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  // Días del mes (m: 1-12). Sin año, febrero = 29 (aún podría ser bisiesto)
  function daysInMonth(y, m) {
    if (!m) return 31;
    if (m === 2) return !y ? 29 : isLeap(y) ? 29 : 28;
    return [4, 6, 9, 11].includes(m) ? 30 : 31;
  }
  const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };

  // Ajusta el día al último válido del mes/año SIN tocar mes ni año (función pura). 0 = sin elegir
  function adjust(state) {
    const y = toInt(state && state.y), m = toInt(state && state.m) > 12 ? 0 : toInt(state && state.m);
    let d = toInt(state && state.d);
    const max = daysInMonth(y, m);
    if (d > max) d = max;
    return { y, m, d };
  }
  // Cambiar solo el año: conserva mes y día (ajustando el día si no existe en ese año)
  const withYear = (state, y) => adjust({ ...(state || {}), y });
  const withMonth = (state, m) => adjust({ ...(state || {}), m });

  const pad = (n) => String(n).padStart(2, '0');
  function toIso(state) {
    const s = adjust(state);
    return s.y && s.m && s.d ? `${s.y}-${pad(s.m)}-${pad(s.d)}` : '';
  }
  function fromIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? adjust({ y: +m[1], m: +m[2], d: +m[3] }) : { y: 0, m: 0, d: 0 };
  }

  // ---------- Rango exacto [min, max] (atributos min/max del input; cualquiera puede faltar) ----------
  // Fecha límite completa 'YYYY-MM-DD' → { y, m, d }, o null si no hay límite
  const bound = (iso) => { const b = fromIso(iso); return b.y && b.m && b.d ? b : null; };
  // Meses que se pueden elegir en el año y (sin año: todos)
  function monthRange(y, min, max) {
    const lo = y && min && y === min.y ? min.m : 1;
    const hi = y && max && y === max.y ? max.m : 12;
    return [lo, hi];
  }
  // Días que se pueden elegir en y/m (sin año o sin mes: hasta 29 en febrero, 30/31 según el mes)
  function dayRange(y, m, min, max) {
    const tope = daysInMonth(y, m);
    const lo = y && m && min && y === min.y && m === min.m ? min.d : 1;
    const hi = y && m && max && y === max.y && m === max.m ? Math.min(max.d, tope) : tope;
    return [lo, hi];
  }
  // Ajuste seguro al rango SIN vaciar nada: conserva mes y día si caben; si no, los lleva al límite más cercano
  // (y el día al último válido del mes). Un año fuera de la lista (valor guardado) no se toca.
  function clampToRange(state, min, max) {
    let { y, m, d } = adjust(state);
    const enRango = y && (!min || y >= min.y) && (!max || y <= max.y);
    if (enRango && m) {
      const [mlo, mhi] = monthRange(y, min, max);
      if (m < mlo) m = mlo;
      if (m > mhi) m = mhi;
      if (d) {
        const [dlo, dhi] = dayRange(y, m, min, max);
        if (d < dlo) d = dlo;
        if (d > dhi) d = dhi;
      }
    }
    return adjust({ y, m, d });
  }

  const CSS = `
  .bw-dsel{display:grid;grid-template-columns:1.5fr .8fr 1fr;gap:6px;margin-top:4px;flex:1 1 230px;min-width:0}
  .bw-dsel select{display:block;width:100%;min-height:44px;padding:10px 8px;border:1.5px solid var(--bw-line,#EBE3D5);border-radius:12px;font-size:14px;background:var(--bw-surface,#fff);color:var(--bw-text,#2B2621)}
  .bw-dsel select:focus{outline:none;border-color:#1B4D3E}`;

  // Convierte un <input type="date"> en Mes/Día/Año. Idempotente: si ya está montado, solo actualiza idioma/años.
  // opts: { win, lang, future } — future: fechas que vienen (vencimientos): años de min (o el actual) a max
  // (o +12), en orden ascendente y sin autocompletar con la fecha de nacimiento.
  function attach(input, opts) {
    if (!input || typeof document === 'undefined') return null;
    const doc = input.ownerDocument || document;
    if (!doc.getElementById('bwDselCss')) { const s = doc.createElement('style'); s.id = 'bwDselCss'; s.textContent = CSS; doc.head.appendChild(s); }

    let ui = input._bwDsel;
    const o = opts || {};
    const win = o.win || (ui && ui.opts.win) || (typeof window !== 'undefined' ? window : null);
    // Las opciones viven en el control: los selectores siempre usan las del último montaje (p. ej. otro idioma)
    if (ui) ui.opts = { ...ui.opts, ...o, win };
    const conf = () => (ui ? ui.opts : { ...o, win });
    const lang = () => (conf().lang || (win && win.currentLang) || 'es') === 'en' ? 'en' : 'es';
    if (!ui) {
      const wrap = doc.createElement('div');
      wrap.className = 'bw-dsel'; wrap.setAttribute('role', 'group');
      const mk = (suffix, auto) => { const s = doc.createElement('select'); s.id = `${input.id}_${suffix}`; s.setAttribute('autocomplete', o.future ? 'off' : auto); if (input.className) s.className = input.className; wrap.appendChild(s); return s; };
      ui = { wrap, m: mk('m', 'bday-month'), d: mk('d', 'bday-day'), y: mk('y', 'bday-year'), state: fromIso(input.value), opts: { ...o, win } };
      input._bwDsel = ui;
      input.type = 'hidden';
      input.insertAdjacentElement('afterend', wrap);
      // La etiqueta y el foco (p. ej. "Indica tu fecha de nacimiento") llevan al primer selector
      const label = input.id ? doc.querySelector(`label[for="${input.id}"]`) : null;
      if (label) { if (!label.id) label.id = `${input.id}_lbl`; label.setAttribute('for', ui.m.id); wrap.setAttribute('aria-labelledby', label.id); }
      const desc = input.getAttribute('aria-describedby'); if (desc) wrap.setAttribute('aria-describedby', desc);
      // El input queda oculto: foco y desplazamiento (p. ej. avisos de error) van a los selectores visibles
      input.focus = (o2) => ui.m.focus(o2);
      input.scrollIntoView = (o2) => { if (typeof wrap.scrollIntoView === 'function') wrap.scrollIntoView(o2); };
      const onPick = (key) => () => {
        const v = toInt(ui[key].value);
        const next = key === 'y' ? withYear(ui.state, v) : key === 'm' ? withMonth(ui.state, v) : adjust({ ...ui.state, d: v });
        ui.state = clampToRange(next, ...ui.limits());
        ui.render();
        ui.sync();
      };
      ui.m.addEventListener('change', onPick('m'));
      ui.d.addEventListener('change', onPick('d'));
      ui.y.addEventListener('change', onPick('y'));
    }

    // Límites vigentes: min/max del input (renderBookingDates los mueve cada día). Nacimiento sin max → hoy.
    function limits() {
      const min = bound(input.getAttribute('min'));
      let max = bound(input.getAttribute('max'));
      if (!conf().future) {
        const t = new Date(), hoyB = { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
        if (!max || toIso(max) > toIso(hoyB)) max = hoyB;
      }
      return [min, max];
    }
    // Escribe el valor en el input original y avisa (solo si cambió)
    function sync() {
      const iso = toIso(ui.state);
      if (input.value !== iso) {
        input.value = iso;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    function options(sel, items, selected, placeholder) {
      sel.innerHTML = `<option value="">${placeholder}</option>` + items.map(([v, t]) => `<option value="${v}"${v === selected ? ' selected' : ''}>${t}</option>`).join('');
    }
    function render() {
      const es = lang() === 'es';
      const s = ui.state;
      const fmt = new Intl.DateTimeFormat(es ? 'es-US' : 'en-US', { month: 'long', timeZone: 'UTC' });
      const [min, max] = limits();
      const [mlo, mhi] = monthRange(s.y, min, max), [dlo, dhi] = dayRange(s.y, s.m, min, max);
      const mes = (i) => { const t = fmt.format(new Date(Date.UTC(2000, i - 1, 1))); return t.charAt(0).toUpperCase() + t.slice(1); };
      const meses = []; for (let i = mlo; i <= mhi; i++) meses.push([i, mes(i)]);
      const dias = []; for (let i = dlo; i <= dhi; i++) dias.push([i, String(i)]);
      // Un valor guardado fuera del rango (año que ya no está en la lista) se sigue mostrando para no perderlo
      if (s.m && !meses.some(([v]) => v === s.m)) meses.push([s.m, mes(s.m)]);
      if (s.d && !dias.some(([v]) => v === s.d)) dias.push([s.d, String(s.d)]);
      const hoy = new Date().getFullYear();
      const future = !!conf().future;
      const minAttr = toInt(String(input.getAttribute('min') || '').slice(0, 4));
      const maxAttr = toInt(String(input.getAttribute('max') || '').slice(0, 4));
      const anios = [];
      if (future) { // vencimientos: del año mínimo (o el actual) hacia adelante
        const minY = minAttr || hoy, maxY = Math.max(maxAttr || hoy + 12, minY);
        for (let y = minY; y <= maxY; y++) anios.push([y, String(y)]);
      } else {      // nacimiento: del máximo (nunca después de hoy) hacia atrás
        const minY = minAttr || 1900, maxY = Math.min(maxAttr || hoy, hoy);
        for (let y = maxY; y >= minY; y--) anios.push([y, String(y)]);
      }
      // Si el año guardado queda fuera del rango (p. ej. cambió el máximo), se muestra igual para no perderlo
      if (s.y && !anios.some(([v]) => v === s.y)) anios.push([s.y, String(s.y)]);
      options(ui.m, meses, s.m, es ? 'Mes' : 'Month');
      options(ui.d, dias, s.d, es ? 'Día' : 'Day');
      options(ui.y, anios, s.y, es ? 'Año' : 'Year');
      ui.m.setAttribute('aria-label', es ? 'Mes' : 'Month');
      ui.d.setAttribute('aria-label', es ? 'Día' : 'Day');
      ui.y.setAttribute('aria-label', es ? 'Año' : 'Year');
    }
    ui.render = render; ui.limits = limits; ui.sync = sync;
    // Si alguien fijó el valor del input por código, se respeta
    if (input.value && input.value !== toIso(ui.state)) ui.state = fromIso(input.value);
    // Al volver a montar con otro rango (p. ej. pasó la medianoche) la fecha elegida se ajusta al rango nuevo
    const antes = toIso(ui.state);
    ui.state = clampToRange(ui.state, ...limits());
    render();
    if (antes && toIso(ui.state) !== antes) sync();
    return ui;
  }

  return { isLeap, daysInMonth, adjust, withYear, withMonth, toIso, fromIso, bound, monthRange, dayRange, clampToRange, attach, CSS };
});
