// Vercel Serverless Function: GET /api/places
// ---------------------------------------------------------------------------
// Lugares cercanos para los mapas de la app, con datos de OpenStreetMap (Overpass API). Sin API key.
//   ?kind=vet&lat=33.4718&lng=-86.8008   -> veterinarios y hospitales de emergencia (vista cliente)
//   ?kind=walk&lat=33.4718&lng=-86.8008  -> dog parks, parques, agua y bolsas (vista paseador)
// Respuesta: { places: [{ id, type, name, lat, lng, phone, website, address, hours, open24 }], cell }
//
// Overpass público es lento (30 s+) y se satura. Para que la app no dependa de él en cada visita:
//  - la ubicación se ajusta a una celda de cuadrícula: todos los usuarios de la misma zona comparten
//    una sola respuesta, que la CDN de Vercel guarda 24 h (y sirve vieja hasta 7 días si Overpass falla);
//  - api/_lib/places-seed.json trae las celdas del área de servicio (Homewood / BHAM) ya resueltas:
//    ahí se responde al instante sin consultar Overpass (fuera del área sí se consulta).
// Datos © OpenStreetMap contributors (ODbL); los mapas muestran la atribución.
// ---------------------------------------------------------------------------
const { send, clientIp, makeRateLimiter, cors } = require('./_lib/http');

let SEED = {};
try { SEED = require('./_lib/places-seed.json'); } catch (e) { SEED = {}; }

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];
// cell: tamaño de la celda (grados) · pad: margen alrededor de la celda para cubrir a quien está en el borde
const GRID = { vet: { cell: 0.1, pad: 0.1 }, walk: { cell: 0.04, pad: 0.03 } };
const CACHE_MS = 12 * 60 * 60 * 1000;
const cache = new Map();
const allow = makeRateLimiter({ windowMs: 60 * 1000, max: 20 });

function cellOf(kind, lat, lng) {
  const g = GRID[kind];
  const cy = Math.floor(lat / g.cell), cx = Math.floor(lng / g.cell);
  const r = (v) => Math.round(v * 1e4) / 1e4;
  return {
    key: `${kind}:${cy}:${cx}`,
    bbox: [r(cy * g.cell - g.pad), r(cx * g.cell - g.pad), r((cy + 1) * g.cell + g.pad), r((cx + 1) * g.cell + g.pad)]
  };
}

function buildQuery(kind, bbox) {
  const b = `(${bbox.join(',')})`;
  const body = kind === 'vet'
    ? `nwr["amenity"="veterinary"]${b};nwr["healthcare"="veterinary"]${b};`
    : `nwr["leisure"="dog_park"]${b};nwr["leisure"="park"]["name"]${b};nwr["leisure"="nature_reserve"]["name"]${b};` +
      `node["amenity"="drinking_water"]${b};node["vending"="excrement_bags"]${b};`;
  return `[out:json][timeout:40];(${body});out center tags 400;`;
}

function classify(kind, t) {
  if (kind === 'vet') {
    const is24 = /^\s*24\/7\s*$/.test(t.opening_hours || '');
    const emergency = t.emergency === 'yes' || is24 || /emergenc|urgent|24[\s-]*(hour|hr|h)\b/i.test(t.name || '');
    return emergency ? 'emergency' : 'vet';
  }
  if (t.leisure === 'dog_park') return 'dog_park';
  if (t.leisure === 'park' || t.leisure === 'nature_reserve') return 'park';
  if (t.amenity === 'drinking_water') return 'water';
  return 'bags';
}

function normalize(kind, el) {
  const t = el.tags || {};
  const lat = el.lat != null ? el.lat : el.center && el.center.lat;
  const lng = el.lon != null ? el.lon : el.center && el.center.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const type = classify(kind, t);
  if ((type === 'vet' || type === 'emergency' || type === 'park') && !t.name) return null;
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const clip = (v, n) => (v ? String(v).slice(0, n) : '');
  const web = t.website || t['contact:website'] || '';
  return {
    id: `${el.type[0]}${el.id}`,
    type,
    name: clip(t.name, 90),
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    phone: clip(t.phone || t['contact:phone'], 30),
    website: /^https?:\/\//i.test(web) ? clip(web, 200) : '',
    address: clip([street, t['addr:city']].filter(Boolean).join(', '), 120),
    hours: clip(t.opening_hours, 120),
    open24: /^\s*24\/7\s*$/.test(t.opening_hours || '')
  };
}

function normalizeAll(kind, data) {
  const seen = new Set();
  return (data.elements || []).map((el) => normalize(kind, el)).filter((p) => {
    if (!p) return false;
    const k = p.name ? `${p.type}:${p.name.toLowerCase()}` : p.id; // un parque mapeado como nodo y área, una sola vez
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Se consultan los servidores en paralelo y gana el primero que responda.
// Overpass exige un User-Agent que identifique la app (sin él responde 406).
async function overpass(query) {
  const ctrls = ENDPOINTS.map(() => new AbortController());
  const timer = setTimeout(() => ctrls.forEach((c) => c.abort()), 50000);
  try {
    return await Promise.any(ENDPOINTS.map(async (url, i) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'BarkwalkUSA/1.0 (+https://www.barkwalkusa.com)' },
        body: 'data=' + encodeURIComponent(query),
        signal: ctrls[i].signal
      });
      if (!r.ok) throw new Error('overpass_' + r.status);
      const data = await r.json();
      ctrls.forEach((c, j) => { if (j !== i) c.abort(); });
      return data;
    }));
  } catch (e) {
    throw (e && e.errors && e.errors[0]) || e;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCell(kind, cell) {
  return normalizeAll(kind, await overpass(buildQuery(kind, cell.bbox)));
}

function reply(res, places, cell, maxAge) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', `public, max-age=600, s-maxage=${maxAge}, stale-while-revalidate=604800`);
  res.end(JSON.stringify({ places, cell: cell.bbox }));
}

async function handler(req, res) {
  if (cors(req, res, { methods: 'GET' })) return;
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  const q = new URL(req.url, 'http://x').searchParams;
  const kind = ['vet', 'walk'].includes(q.get('kind')) ? q.get('kind') : null;
  const lat = Number(q.get('lat')), lng = Number(q.get('lng'));
  if (!kind || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return send(res, 400, { error: 'bad_request' });
  }
  const cell = cellOf(kind, lat, lng);
  const hit = cache.get(cell.key);
  if (hit && Date.now() - hit.t < CACHE_MS) return reply(res, hit.places, cell, 86400);
  // Área de servicio (Homewood / BHAM): respuesta inmediata con las celdas precargadas.
  // Parques y clínicas cambian poco; para actualizarlas, regenerar api/_lib/places-seed.json.
  if (SEED[cell.key]) return reply(res, SEED[cell.key], cell, 86400);

  if (allow(clientIp(req))) {
    try {
      const places = await fetchCell(kind, cell);
      cache.set(cell.key, { t: Date.now(), places });
      if (cache.size > 300) cache.delete(cache.keys().next().value);
      return reply(res, places, cell, 86400);
    } catch (e) {
      console.error('places: Overpass no respondió', e && e.message);
    }
  }
  // Respaldo: caché vieja de esta instancia (CDN solo 1 h, para reintentar pronto)
  const backup = hit && hit.places;
  if (backup) return reply(res, backup, cell, 3600);
  return send(res, 502, { error: 'upstream_unavailable' });
}

module.exports = handler;
module.exports.cellOf = cellOf;
module.exports.fetchCell = fetchCell;
module.exports._internal = { overpass, buildQuery, normalizeAll, GRID };
