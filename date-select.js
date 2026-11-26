// Selector de fecha Mes / Día / Año (fecha de nacimiento del registro y de la pantalla de Términos, y
// vencimiento del ID en la postulación del paseador y fecha lejana de la reserva con { future: true })
// ---------------------------------------------------------------------------
// · Al cambiar el AÑO (o el mes) se conservan el mes y el día ya elegidos. Si la combinación no existe
//   (29 de febrero en un año no bisiesto, 31 en un mes de 30 días) el día se ajusta al último día válido
//   de ese mes (28/29/30) — nunca se reinicia a un valor por defecto.
// · Mientras falte el año, febrero admite hasta el 29 (podría ser bisiesto); al elegir el año se ajusta.
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
        ui.state = key === 'y' ? withYear(ui.state, v) : key === 'm' ? withMonth(ui.state, v) : adjust({ ...ui.state, d: v });
        ui.render();
        const iso = toIso(ui.state);
        if (input.value !== iso) {
          input.value = iso;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      };
      ui.m.addEventListener('change', onPick('m'));
      ui.d.addEventListener('change', onPick('d'));
      ui.y.addEventListener('change', onPick('y'));
    }

    function options(sel, items, selected, placeholder) {
      sel.innerHTML = `<option value="">${placeholder}</option>` + items.map(([v, t]) => `<option value="${v}"${v === selected ? ' selected' : ''}>${t}</option>`).join('');
    }
    function render() {
      const es = lang() === 'es';
      const s = ui.state;
      const fmt = new Intl.DateTimeFormat(es ? 'es-US' : 'en-US', { month: 'long', timeZone: 'UTC' });
      const meses = Array.from({ length: 12 }, (_, i) => { const t = fmt.format(new Date(Date.UTC(2000, i, 1))); return [i + 1, t.charAt(0).toUpperCase() + t.slice(1)]; });
      const dias = Array.from({ length: daysInMonth(s.y, s.m) }, (_, i) => [i + 1, String(i + 1)]);
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
    ui.render = render;
    // Si alguien fijó el valor del input por código, se respeta
    if (input.value && input.value !== toIso(ui.state)) ui.state = fromIso(input.value);
    render();
    return ui;
  }

  return { isLeap, daysInMonth, adjust, withYear, withMonth, toIso, fromIso, attach, CSS };
});
