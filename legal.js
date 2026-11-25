// Barkwalk USA · Páginas legales: idioma (ES / EN) y botón "Volver"
(function () {
  function guardado() { try { return localStorage.getItem('barkwalk_legal_lang'); } catch (e) { return null; } }
  function guardar(l) { try { localStorage.setItem('barkwalk_legal_lang', l); } catch (e) {} }
  var params = new URLSearchParams(location.search);
  var lang = params.get('lang');
  if (lang !== 'es' && lang !== 'en') lang = guardado();
  if (lang !== 'es' && lang !== 'en') lang = /^es\b/i.test(navigator.language || '') ? 'es' : 'en';

  function aplicar(l) {
    lang = l;
    document.documentElement.lang = l;
    document.querySelectorAll('[data-doc-lang]').forEach(function (a) { a.hidden = a.getAttribute('data-doc-lang') !== l; });
    document.querySelectorAll('[data-es][data-en]').forEach(function (el) { el.textContent = el.getAttribute('data-' + l); });
    document.querySelectorAll('[data-set-lang]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-set-lang') === l)); });
    // El idioma viaja con los enlaces entre documentos
    document.querySelectorAll('a[href^="/terminos-"], a[href^="/privacidad"]').forEach(function (a) {
      var href = a.getAttribute('href'), hash = href.indexOf('#') >= 0 ? href.slice(href.indexOf('#')) : '';
      a.setAttribute('href', href.split('#')[0].split('?')[0] + '?lang=' + l + hash); // conserva #sección
    });
    var h1 = document.querySelector('[data-doc-lang="' + l + '"] h1');
    if (h1) document.title = h1.textContent + ' · Barkwalk USA LLC';
    guardar(l);
  }
  document.querySelectorAll('[data-set-lang]').forEach(function (b) {
    b.addEventListener('click', function () { aplicar(b.getAttribute('data-set-lang')); });
  });
  aplicar(lang);

  // Volver: a la pantalla anterior de Barkwalk si venimos de la app; si no, al inicio
  window.lgBack = function () {
    var deAqui = document.referrer && document.referrer.indexOf(location.origin) === 0;
    if (deAqui && history.length > 1) history.back();
    else location.href = '/';
  };
})();
