// Privacidad de ubicación ("mapa unidireccional")
// ---------------------------------------------------------------------------
// Regla de Barkwalk:
//   · El CLIENTE ve en vivo la ubicación del PASEADOR durante su paseo (seguridad de la mascota).
//   · El PASEADOR nunca ve la ubicación en vivo del dueño: solo la DIRECCIÓN DE RECOGIDA acordada en la reserva.
// Cómo se cumple en los datos:
//   · walk_requests.latitude/longitude/lat/lng/location_updated_at = posición del PASEADOR. Solo la escribe el
//     paseador asignado (trigger bw_walk_requests_guard); el cliente solo puede cambiar 'status'.
//   · La posición del dueño no se guarda en ninguna tabla. Las coordenadas de recogida salen de GEOCODIFICAR la
//     dirección escrita (no del GPS del teléfono) y se redondean aquí a ~11 m antes de guardarse.
//   · El mapa de veterinarios del cliente usa su GPS solo en su propio teléfono (y para /api/places, que no lo guarda).
// ---------------------------------------------------------------------------
const WALKER_LIVE_COLUMNS = ['latitude', 'longitude', 'lat', 'lng', 'location_updated_at'];
const PICKUP_COLUMNS = ['pickup_address', 'address', 'pickup_latitude', 'pickup_longitude'];

// Coordenadas de recogida válidas, redondeadas a 4 decimales (~11 m: suficiente para navegar a la puerta,
// sin guardar una precisión de GPS de teléfono). Devuelve null si no son válidas.
function sanitizePickupCoords(lat, lng) {
  if (lat === null || lng === null || lat === undefined || lng === undefined || lat === '' || lng === '') return null;
  const la = Number(lat), lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180 || (la === 0 && lo === 0)) return null;
  const r = (v) => Math.round(v * 1e4) / 1e4;
  return { lat: r(la), lng: r(lo) };
}

// Lo único de ubicación del DUEÑO que puede ver un paseador: la dirección/punto de recogida acordados
function ownerLocationForWalker(walk) {
  const w = walk || {};
  const address = String(w.pickup_address || w.address || '').trim() || null;
  const coords = sanitizePickupCoords(w.pickup_latitude, w.pickup_longitude);
  return { address, coords };
}

// ¿Puede este usuario escribir la ubicación EN VIVO de este paseo? (refleja el trigger de la base)
function canWriteLiveLocation(walk, userId) {
  if (!walk || !userId) return false;
  const st = walk.status || 'pending';
  const assigned = walk.walker_id && String(walk.walker_id) === String(userId);
  const accepting = !walk.walker_id && st === 'pending';
  return !!(assigned || accepting);
}

module.exports = { WALKER_LIVE_COLUMNS, PICKUP_COLUMNS, sanitizePickupCoords, ownerLocationForWalker, canWriteLiveLocation };
