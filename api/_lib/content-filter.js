// Filtro de lenguaje de Barkwalk USA (español + inglés) · servidor Y navegador
// ---------------------------------------------------------------------------
// FUENTE ÚNICA. El navegador carga una copia idéntica en /content-filter.js (window.BWContentFilter):
//   node scripts/build-content-filter.js   → copia este archivo a la raíz y regenera la función SQL
//   (supabase/migrations/20261126_content_filter.sql), que aplica la MISMA regla en la base de datos
//   (walk_messages, pets, pet_passports, profiles), así que no se puede saltar desde el navegador.
// Las pruebas (tests/security.test.js) fallan si las copias no están sincronizadas.
//
// Diseño (pensado para una app de perros: nada de falsos positivos con "perra", "bitch", "cono"…):
//   · normaliza: minúsculas, sin acentos, "leet" (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s, !→i)
//   · tolera letras repetidas ("fuuuck") y separadores entre letras ("f.u.c.k", "p*u*t*a")
//   · respeta límites de palabra ("computadora" no contiene "puta"); '*' al inicio/fin = se permite pegado
//   · lista blanca para razas/palabras legítimas que se parecen ("shih tzu"/"shitzu", "shiitake")
// detectContact(): NO bloquea; detecta teléfonos, correos y apps de pago para avisar del riesgo de
// tratar por fuera de Barkwalk.
// ---------------------------------------------------------------------------
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BWContentFilter = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TERMS = [
    // Español
    'puta', 'putas', 'puto', 'putos', 'hijueputa', 'hijoputa', 'hijo de perra', 'hija de perra',
    'pendej*', 'cabron*', 'chingad*', 'chingar*', 'chinga', 'chingas', 'chingues', 'verga', 'vergas',
    'culero', 'culera', 'culeros', 'culeras', 'mierd*', 'pinche', 'pinches', 'joto', 'jotos',
    'marica', 'maricas', 'maricon', 'maricones', 'gilipoll*', 'mamon', 'mamona', 'mamones',
    'malparid*', 'gonorrea', 'idiota', 'idiotas', 'imbecil', 'imbeciles', 'estupido', 'estupida',
    'estupidos', 'estupidas', 'sudaca', 'sudacas', 'mayate',
    // English
    '*fuck*', '*shit*', 'asshole*', 'dumbass', 'bastard', 'bastards', 'cunt', 'cunts', 'dickhead*',
    'whore', 'whores', 'slut', 'sluts', 'son of a bitch', 'sonofabitch', 'motherfuck*', 'twat', 'twats',
    'wanker', 'wankers', 'douchebag*', 'retard', 'retards', 'retarded', 'idiot', 'idiots', 'moron', 'morons',
    'imbecile', 'faggot*', 'nigger*', 'nigga*', 'kike', 'kikes', 'chink', 'chinks', 'spic', 'spics',
    'wetback*', 'beaner', 'beaners',
  ];
  // Palabras legítimas que se parecen a un término (se ignoran antes de comprobar)
  const ALLOW = ['shih tzu', 'shihtzu', 'shitzu', 'shitsu', 'shiitake', 'shiatsu'];

  const LEET_FROM = 'áàâäãéèêëíìîïóòôöõúùûüñç013457@$!';
  const LEET_TO   = 'aaaaaeeeeiiiiooooouuuuncoieastasi';

  function normalize(text) {
    let s = String(text == null ? '' : text).toLowerCase();
    let out = '';
    for (const ch of s) { const i = LEET_FROM.indexOf(ch); out += i >= 0 ? LEET_TO[i] : ch; }
    for (const w of ALLOW) out = out.split(w).join(' ');
    return out;
  }

  // Regex (compatible con JavaScript y con las expresiones avanzadas de PostgreSQL)
  const SEP = '[._*-]*';
  function termPattern(term) {
    const pre = term.startsWith('*'), suf = term.endsWith('*');
    const core = term.replace(/^\*|\*$/g, '');
    const body = core.split(' ').map((word) => word.split('').map((c) => `${c}+`).join(SEP)).join('\\s+');
    return `${pre ? '' : '(^|[^a-z])'}${body}${suf ? '' : '($|[^a-z])'}`;
  }
  const PATTERN = TERMS.map((t) => `(${termPattern(t)})`).join('|');
  const RE = new RegExp(PATTERN);

  // { ok: true } | { ok: false, reason: 'profanity' }
  function check(text) {
    if (text == null || text === '') return { ok: true };
    return RE.test(normalize(text)) ? { ok: false, reason: 'profanity' } : { ok: true };
  }

  // Revisa varios campos { nombre: texto } → { ok, field }
  function checkFields(fields) {
    for (const [field, value] of Object.entries(fields || {})) {
      if (!check(value).ok) return { ok: false, reason: 'profanity', field };
    }
    return { ok: true };
  }

  // Datos de contacto / pagos por fuera (solo aviso)
  const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
  const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
  const PAY = /\b(venmo|cash\s?app|cashapp|zelle|paypal|apple\s?cash|western\s?union|efectivo|cash\s+only|pay\s+(me\s+)?(directly|outside|in\s+cash)|p[aá]game\s+(directo|aparte|por\s+fuera)|por\s+fuera\s+de\s+(la\s+)?app|outside\s+(of\s+)?(the\s+)?app|whats\s?app|telegram)\b/i;
  function detectContact(text) {
    const s = String(text || '');
    const kinds = [];
    if (PHONE.test(s)) kinds.push('phone');
    if (EMAIL.test(s)) kinds.push('email');
    if (PAY.test(s)) kinds.push('offplatform');
    return kinds;
  }

  const MESSAGES = {
    profanity: {
      es: 'Tu texto contiene palabras no permitidas en Barkwalk. Por favor, escríbelo de forma respetuosa.',
      en: 'Your text contains words that are not allowed on Barkwalk. Please keep it respectful.',
    },
    contact: {
      es: '⚠️ Por tu seguridad, no compartas teléfonos, correos ni acuerdes paseos o pagos por fuera de Barkwalk USA: perderías la cobertura, el soporte y la protección de la plataforma. Si aun así quieres enviarlo, toca Enviar otra vez.',
      en: "⚠️ For your safety, don't share phone numbers or emails, or arrange walks or payments outside Barkwalk USA: you'd lose coverage, support and platform protection. To send it anyway, tap Send again.",
    },
  };
  function message(reason, lang) { const m = MESSAGES[reason] || MESSAGES.profanity; return lang === 'en' ? m.en : m.es; }

  return { check, checkFields, detectContact, normalize, message, PATTERN, LEET_FROM, LEET_TO, ALLOW, TERMS };
});
