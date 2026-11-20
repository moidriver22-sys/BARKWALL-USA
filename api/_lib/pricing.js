// Tarifas de Barkwalk USA (fuente de verdad del SERVIDOR).
// ---------------------------------------------------------------------------
// El navegador muestra los mismos precios (SERVICE_CATALOG / GROOMING_ADDONS en index.html),
// pero el monto que se cobra en Stripe SIEMPRE se calcula aquí. Si cambias un precio,
// cámbialo en los dos sitios (la prueba local compara ambos catálogos).
//
// Fórmula por reserva:
//   precio_por_día = precio_servicio
//                  + extras_de_grooming × número_de_mascotas   (baño/uñas para cada perro)
//                  + recargo_perro_grande                       (si se marcó)
//                  + (número_de_mascotas − 1) × EXTRA_PET_FEE    (tarifa fija por perro extra)
//   precio_por_día_cobrado = round(precio_por_día × (1 − descuento_socio))   (Barkwalk Club: 10 %)
//   total = precio_por_día_cobrado × número_de_días
// El pago al paseador se calcula sobre el precio de LISTA (sin descuento): Barkwalk absorbe el descuento.
// Cada día se registra como un servicio independiente (una fila de walk_requests por día).
// ---------------------------------------------------------------------------

const SERVICES = {
  walk_std:  { name: { es: 'Paseo Estándar', en: 'Standard Walk' },          icon: '🚶', variants: [['15 min', 16], ['30 min', 22], ['60 min', 32]] },
  walk_vip:  { name: { es: 'Paseo VIP 1 a 1', en: 'VIP Single-Dog Walk' },   icon: '👑', variants: [['30 min', 30], ['60 min', 45]] },
  walk_run:  { name: { es: 'Running / Atlético', en: 'Running / Athletic' }, icon: '🏃', variants: [['30 min', 28], ['45 min', 36]] },
  dropin:    { name: { es: 'Visita a domicilio', en: 'Drop-in Visit' },      icon: '🏠', variants: [['30 min', 24], ['60 min', 38]] },
  daycare:   { name: { es: 'Guardería de día', en: 'Daycare' },              icon: '☀️', variants: [['1 day', 35]] },
  overnight: { name: { es: 'Cuidado nocturno', en: 'Overnight Care' },       icon: '🌙', variants: [['1 night', 45]] },
};

const GROOMING = {
  bath:  { name: { es: 'Baño exprés + secado', en: 'Express bath & blow dry' }, price: 20 },
  nails: { name: { es: 'Corte de uñas', en: 'Nail trim' },                     price: 12 },
};

const LARGE_DOG_FEE = 4;   // perro grande / alta energía (por día)
const EXTRA_PET_FEE = 8;   // cada mascota adicional del mismo hogar (por día)
const MAX_PETS = 4;
const MAX_DAYS = 31;
const MEMBER_DISCOUNT_PCT = 10; // Barkwalk Club. Si cambia, cámbialo también en index.html (MEMBER_DISCOUNT_PCT)

class QuoteError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

// selection: { serviceId, variantIdx, grooming: [ids], largeDog, petsCount, dates: ['YYYY-MM-DD'] }
// memberDiscountPct: 0 o MEMBER_DISCOUNT_PCT (lo decide el servidor según la membresía activa del cliente)
function computeQuote(selection, { today, memberDiscountPct = 0 } = {}) {
  const s = selection || {};
  const svc = SERVICES[s.serviceId];
  if (!svc) throw new QuoteError('invalid_service');
  const variantIdx = Number.isInteger(s.variantIdx) ? s.variantIdx : Number(s.variantIdx);
  const variant = svc.variants[variantIdx];
  if (!variant) throw new QuoteError('invalid_variant');

  const pets = Number(s.petsCount);
  if (!Number.isInteger(pets) || pets < 1 || pets > MAX_PETS) throw new QuoteError('invalid_pets');

  const grooming = Array.isArray(s.grooming) ? [...new Set(s.grooming.map(String))] : [];
  for (const g of grooming) if (!GROOMING[g]) throw new QuoteError('invalid_grooming');

  const dates = normalizeDates(s.dates, today);

  const lines = [{ code: 'service', label: `${svc.name.en} · ${variant[0]}`, unit: variant[1], qty: 1 }];
  for (const g of grooming) lines.push({ code: `grooming_${g}`, label: GROOMING[g].name.en, unit: GROOMING[g].price, qty: pets });
  if (s.largeDog) lines.push({ code: 'large_dog', label: 'Large / high-energy dog', unit: LARGE_DOG_FEE, qty: 1 });
  if (pets > 1) lines.push({ code: 'extra_pets', label: 'Additional dog', unit: EXTRA_PET_FEE, qty: pets - 1 });

  const perDay = lines.reduce((sum, l) => sum + l.unit * l.qty, 0);
  const perDayListCents = Math.round(perDay * 100);
  const pct = memberDiscountPct === MEMBER_DISCOUNT_PCT ? MEMBER_DISCOUNT_PCT : 0; // solo valores conocidos
  const perDayCents = Math.round(perDayListCents * (100 - pct) / 100);
  if (pct) lines.push({ code: 'member_discount', label: `Barkwalk Club −${pct}%`, unit: -(perDayListCents - perDayCents) / 100, qty: 1 });
  return {
    serviceId: s.serviceId, variantIdx, variantLabel: variant[0], serviceName: svc.name, serviceIcon: svc.icon,
    grooming, largeDog: !!s.largeDog, petsCount: pets, dates, days: dates.length,
    lines, perDay: perDayCents / 100, perDayListCents, perDayCents, memberDiscountPct: pct,
    totalCents: perDayCents * dates.length, currency: 'usd',
  };
}

// Fechas únicas, ordenadas, formato YYYY-MM-DD, desde hoy (hora de Birmingham) hasta 1 año
function normalizeDates(dates, today) {
  if (!Array.isArray(dates) || !dates.length) throw new QuoteError('no_dates');
  const hoy = today || todayInZone('America/Chicago');
  const limite = addDays(hoy, 366);
  const unicas = [...new Set(dates.map(String))].sort();
  if (unicas.length > MAX_DAYS) throw new QuoteError('too_many_dates');
  for (const d of unicas) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d + 'T00:00:00Z'))) throw new QuoteError('invalid_date');
    if (new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) !== d) throw new QuoteError('invalid_date'); // p. ej. 2026-02-30
    if (d < hoy) throw new QuoteError('past_date');
    if (d > limite) throw new QuoteError('date_too_far');
  }
  return unicas;
}

function todayInZone(timeZone) {
  // en-CA da el formato YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

module.exports = { SERVICES, GROOMING, LARGE_DOG_FEE, EXTRA_PET_FEE, MAX_PETS, MAX_DAYS, MEMBER_DISCOUNT_PCT, computeQuote, normalizeDates, todayInZone, addDays, QuoteError };
