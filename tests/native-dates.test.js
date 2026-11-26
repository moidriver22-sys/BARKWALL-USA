// Fechas con el selector NATIVO del navegador (<input type="date">) y sus límites min/max, más la lógica de
// vacunas (fecha completa, con lectura del formato antiguo YYYY-MM) y la edad calculada desde la fecha de
// nacimiento de la mascota. El selector propio Mes/Día/Año (date-select.js) se retiró. Ejecuta: npm test
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('✓', name); };

t('sin selector propio: date-select.js no existe ni se carga; todas las fechas son <input type="date"> nativos', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'date-select.js')), false);
  for (const f of ['index.html', 'terms-gate.js', 'walker-application.js']) assert.doesNotMatch(read(f), /BWDateSelect|date-select/, f);
  const html = read('index.html');
  assert.match(html, /<input type="date" id="regBirth"/); assert.match(html, /<input type="date" id="inputBookingDate"/);
  assert.match(read('terms-gate.js'), /<input type="date" id="tgBirth" required max=/);
  assert.match(read('walker-application.js'), /<input id="waExpiry" type="date" min="\$\{today\(\)\}" max="\$\{maxExpiry\(\)\}" required>/);
});

t('límites min/max conservados en cada fecha', () => {
  const html = read('index.html');
  assert.match(html, /birth\.max = `\$\{lim\.getFullYear\(\)\}/, 'registro: 19 años o más');
  assert.match(html, /if \(input\) \{ input\.min = shiftYmd\(hoy, STRIP_DAYS\); input\.max = shiftYmd\(hoy, 366\); \}/, 'reserva: hoy+28 … hoy+366');
  assert.ok(html.includes("field('pp_vac_' + k, VACCINE_NAMES[k], vaccineDate((p.vaccines || {})[k]), 'date', vacRangeAttrs())"), 'vacunas: 5 años atrás … 5 adelante');
  assert.match(html, /<input id="pf_birth_\$\{i\}" type="date" min="[^"]+" max="\$\{petTodayYmd\(\)\}"/, 'mascota: nunca futura, máx. 30 años');
  // Vencimiento del ID: el tope de la app coincide con el del servidor (365 × 12 días)
  assert.match(read('walker-application.js'), /const maxExpiry = \(\) => new Date\(Date\.parse\(`\$\{today\(\)\}T00:00:00Z`\) \+ 365 \* 12 \* 864e5\)/);
  const ID = require(path.join(ROOT, 'api/_lib/walker-identity.js'));
  const d0 = '2026-11-26', max = new Date(Date.parse(`${d0}T00:00:00Z`) + 365 * 12 * 864e5).toISOString().slice(0, 10);
  const next = new Date(Date.parse(`${max}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
  assert.equal(ID.checkIdExpiry(max, d0).ok, true); assert.equal(ID.checkIdExpiry(next, d0).error, 'invalid_id_expiry');
});

t('vacunas: fecha completa con estado por días; los pasaportes antiguos (YYYY-MM) se siguen leyendo igual', () => {
  const html = read('index.html');
  const code = html.slice(html.indexOf('  // Vencimiento de vacunas: fecha completa'), html.indexOf('  function updatePetSummary'));
  assert.ok(code.includes('function vaccineStatusText'), 'bloque de vacunas encontrado');
  const vm = require('vm');
  const run = (hoy, lang = 'es') => {
    const RealDate = Date;
    class FakeDate extends RealDate { constructor(...a) { super(...(a.length ? a : [`${hoy}T17:00:00Z`])); } static now() { return new RealDate(`${hoy}T17:00:00Z`).getTime(); } }
    const ctx = { Date: FakeDate, Intl, String, Number, currentLang: lang, tr: (es, en) => (lang === 'en' ? en : es) };
    vm.runInNewContext(code + '\nthis.F = { vaccineDate, vaccineStatus, vaccineStatusText, vacRangeAttrs };', ctx);
    return ctx.F;
  };
  const F = run('2026-11-26');
  assert.equal(F.vaccineStatus('2026-11-25'), 'expired', 'ayer: vencida');
  assert.equal(F.vaccineStatus('2026-11-26'), 'soon', 'vence hoy: aún vigente, vence pronto');
  assert.equal(F.vaccineStatus('2026-12-27'), 'soon', '≤ 31 días'); assert.equal(F.vaccineStatus('2026-12-28'), 'ok');
  assert.equal(F.vaccineStatus(''), 'none'); assert.equal(F.vaccineStatus('abc'), 'none'); assert.equal(F.vaccineStatus(undefined), 'none');
  // Formato antiguo: misma lógica por meses que antes
  assert.equal(F.vaccineStatus('2026-10'), 'expired'); assert.equal(F.vaccineStatus('2026-12'), 'soon'); assert.equal(F.vaccineStatus('2027-03'), 'ok');
  assert.equal(F.vaccineStatusText('2027-03'), 'Al día (03/2027)');
  assert.match(F.vaccineStatusText('2027-03-15'), /^Al día \(15\/03\/2027\)$/);
  assert.match(run('2026-11-26', 'en').vaccineStatusText('2027-03-15'), /^Up to date \(03\/15\/2027\)$/);
  // Al editar un pasaporte antiguo, 'YYYY-MM' se muestra como el último día de ese mes (vigente todo el mes)
  assert.equal(F.vaccineDate('2027-02'), '2027-02-28'); assert.equal(F.vaccineDate('2028-02'), '2028-02-29');
  assert.equal(F.vaccineDate('2027-04'), '2027-04-30'); assert.equal(F.vaccineDate('2027-04-12'), '2027-04-12'); assert.equal(F.vaccineDate('x'), '');
  assert.equal(F.vacRangeAttrs(), 'min="2021-01-01" max="2031-12-31"', 'se puede registrar una vacuna ya vencida y una de 3 años');
});

t('integración: el pasaporte usa fecha nativa en las 3 vacunas y guarda lo que escribe el selector', () => {
  const html = read('index.html');
  assert.match(html, /field\('pp_vac_' \+ k, VACCINE_NAMES\[k\], vaccineDate\(\(p\.vaccines \|\| \{\}\)\[k\]\), 'date', vacRangeAttrs\(\)\)/, 'respaldo nativo type="date"');
  assert.doesNotMatch(html, /'pp_vac_' \+ k[^\n]*'month'/, 'ya no es un campo de solo mes');
  assert.match(html, /vaccines: Object\.fromEntries\(Object\.keys\(VACCINE_NAMES\)\.map\(k => \[k, val\('pp_vac_' \+ k\)\]\)\)/, 'guarda el valor del mismo input');
});

t('mascotas: la edad sale de la fecha de nacimiento (años cumplidos, siempre al día); sin fecha, la edad escrita', () => {
  const html = read('index.html');
  const code = html.slice(html.indexOf('  // Fecha de nacimiento opcional (pets.birth_date)'), html.indexOf('  // En el formulario: con fecha, la edad se llena sola'));
  const vm = require('vm'); const ctx = { Intl, Date, String, Number };
  vm.runInNewContext(code + '\nthis.F = { petAgeFromBirth, petAge, petTodayYmd };', ctx);
  const F = ctx.F;
  assert.equal(F.petAgeFromBirth('2022-11-26', '2026-11-26'), 4, 'cumple hoy');
  assert.equal(F.petAgeFromBirth('2022-11-27', '2026-11-26'), 3, 'cumple mañana');
  assert.equal(F.petAgeFromBirth('2024-02-29', '2025-02-28'), 0); assert.equal(F.petAgeFromBirth('2024-02-29', '2025-03-01'), 1, 'nacido un 29-feb');
  assert.equal(F.petAgeFromBirth('2026-11-27', '2026-11-26'), null, 'futura: no cuenta'); assert.equal(F.petAgeFromBirth('', '2026-11-26'), null);
  assert.match(F.petTodayYmd(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(F.petAge({ age: '7', birth_date: null }), '7', 'sin fecha: la edad escrita');
  assert.equal(F.petAge({ age: '' }), ''); assert.equal(F.petAge(null), '');
  const y = Number(F.petTodayYmd().slice(0, 4));
  assert.equal(F.petAge({ age: '1', birth_date: `${y - 6}-01-01` }), '6', 'con fecha manda la fecha (la edad guardada pudo quedar vieja)');
});

t('mascotas: formulario con fecha de nacimiento opcional (nativa) que llena la edad; la base la valida y calcula', () => {
  const html = read('index.html');
  const blk = html.slice(html.indexOf('function petFormBlock'), html.indexOf('function addPetFormBlock'));
  assert.match(blk, /\$\{completo \? `<div>\s*<label for="pf_birth_\$\{i\}"[^>]*>🎂 \$\{tr\('Fecha de nacimiento \(opcional\)'/, 'solo en el bloque completo, marcada como opcional');
  assert.match(blk, /<input id="pf_birth_\$\{i\}" type="date" min="[^"]+" max="\$\{petTodayYmd\(\)\}"[^>]*value="\$\{esc\(v\.birth_date \|\| ''\)\}" onchange="syncPetAgeFromBirth\(\$\{i\}\)">/, 'nunca futura; respaldo nativo');
  assert.doesNotMatch(blk, /pf_birth_[^\n]*required/, 'no es obligatoria');
  assert.match(blk, /value="\$\{esc\(petAge\(v\)\)\}"/, 'la edad se muestra al día al editar');
  const modal = html.slice(html.indexOf('function openMyPetsModal'), html.indexOf('function petFormBlock'));
  assert.match(modal, /syncPetAgeFromBirth\(0\);/);
  const save = html.slice(html.indexOf('async function savePetForm'), html.indexOf('// 3) Guardar en public.pets'));
  assert.match(save, /values\.birth_date = birth \|\| null;/); assert.match(save, /if \(desde != null\) values\.age = desde;/);
  for (const uso of ['ageLabel(petAge(pet))', 'ageLabel(petAge(p))', 'age: petAge(r) ||']) assert.ok(html.includes(uso), uso);
  const M = read('supabase/migrations/20261209_pet_birth_date.sql');
  assert.match(M, /add column if not exists birth_date date;/); assert.match(M, /new\.birth_date > hoy/); assert.match(M, /interval '30 years'/);
  assert.match(M, /new\.age := extract\(year from age\(hoy, new\.birth_date\)\)/); assert.match(M, /America\/Chicago/);
  assert.doesNotMatch(M, /create policy|grant /i, 'no cambia RLS ni permisos');
});

console.log(`
${n} pruebas OK`);
