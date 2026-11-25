// Foto OBLIGATORIA de entrega segura (antes de completar un paseo) — bucket PRIVADO 'delivery-photos'
// ---------------------------------------------------------------------------
// · Paseador: en "Finalizar y entregar" ve las instrucciones de entrega del cliente y debe tomar la foto del
//   perro en el lugar de entrega. Se sube a delivery-photos/<walk_id>/… (RLS: solo el paseador ASIGNADO).
// · La base lo exige: el trigger bw_walk_requests_delivery_photo rechaza pasar a 'completed' si no hay una foto
//   en la carpeta de ese paseo subida después de iniciarlo (migración 20261205_delivery_photo.sql).
// · Cliente: ve la foto en el resumen del paseo con una URL firmada de 10 min (RLS: participantes y admin).
// Módulo UMD: funciona en Node (pruebas) y en el navegador (window.BWDeliveryPhoto).
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BWDeliveryPhoto = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BUCKET = 'delivery-photos';
  const SIGNED_URL_SECONDS = 600;
  const MAX_BYTES = 5 * 1024 * 1024;

  // Ruta única dentro de la carpeta del paseo (la evidencia anterior nunca se sobrescribe)
  function buildPath(walkId, now = Date.now()) { return `${walkId}/${now}-delivery-${Math.random().toString(36).slice(2, 8)}.jpg`; }

  // Instrucciones de entrega que dejó el cliente (función pura): método de acceso + notas del hogar + notas de la reserva
  const METHOD = { lockbox: ['Caja de llaves', 'Lockbox'], smartlock: ['Cerradura inteligente', 'Smart lock'], concierge: ['Conserjería / recepción', 'Concierge / front desk'] };
  function instructions({ method, homeNotes, bookingNotes, locked } = {}, lang = 'es') {
    const t = (es, en) => (lang === 'en' ? en : es);
    const out = [];
    if (method && METHOD[method]) out.push(`${t('Acceso', 'Access')}: ${lang === 'en' ? METHOD[method][1] : METHOD[method][0]}`);
    if (homeNotes) out.push(`${t('Indicaciones del hogar', 'Home instructions')}: ${homeNotes}`);
    if (bookingNotes) out.push(`${t('Notas de la reserva', 'Booking notes')}: ${bookingNotes}`);
    if (!out.length) out.push(locked
      ? t('Las indicaciones del hogar se muestran desde 1 hora antes del paseo.', 'Home instructions are shown starting 1 hour before the walk.')
      : t('El cliente no dejó indicaciones: entrega al perro dentro de la casa, en un lugar seguro y cerrado, o en mano al dueño.', 'The client left no instructions: leave the dog inside the home, in a safe closed area, or hand it to the owner.'));
    return out;
  }

  // ¿Se puede completar? (función pura) dogs: [{ id, deliveryPhoto }]
  function missingPhotos(dogs) { return (dogs || []).filter((d) => !d.deliveryPhoto).map((d) => d.id); }

  // Mensaje claro cuando la base rechaza completar sin foto
  function friendlyError(msg, lang = 'es') {
    return /foto de entrega|delivery photo/i.test(String(msg || ''))
      ? (lang === 'en' ? 'Take the safe drop-off photo before completing the walk.' : 'Toma la foto de entrega segura antes de completar el paseo.')
      : String(msg || '');
  }

  function mount(win) {
    const db = () => win.supabaseClient;
    // Sube la foto (con el sello de agua de la app si está disponible). Devuelve { path } o { error }
    async function upload(walkId, file) {
      if (!file || !/^image\//.test(file.type)) return { error: 'file_type' };
      let blob = file;
      try { if (typeof win.watermarkImage === 'function') blob = await win.watermarkImage(file); } catch (e) { blob = file; }
      if (blob.size > MAX_BYTES) return { error: 'file_size' };
      const path = buildPath(walkId);
      const { error } = await db().storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      return error ? { error: error.message } : { path };
    }
    // Última foto de entrega de un paseo como URL firmada (cliente, paseador o admin)
    async function signedUrl(walkId) {
      const { data, error } = await db().storage.from(BUCKET).list(String(walkId), { limit: 20, sortBy: { column: 'created_at', order: 'desc' } });
      if (error || !data || !data.length) return null;
      const s = await db().storage.from(BUCKET).createSignedUrl(`${walkId}/${data[0].name}`, SIGNED_URL_SECONDS);
      return s.error ? null : s.data.signedUrl;
    }
    async function showInto(walkId, el) {
      if (!el) return;
      const url = await signedUrl(walkId).catch(() => null);
      if (!url) { el.hidden = true; return; }
      const es = win.currentLang !== 'en';
      el.hidden = false;
      el.innerHTML = `<p class="font-bold text-brandDarkGreen">📸 ${es ? 'Foto de entrega segura' : 'Safe drop-off photo'}</p>
        <img src="${url}" alt="${es ? 'Tu mascota en el lugar de entrega' : 'Your pet at the drop-off spot'}" referrerpolicy="no-referrer" class="w-full rounded-xl mt-1.5" style="max-height:320px;object-fit:cover">`;
    }
    return { upload, signedUrl, showInto };
  }

  let ui = null;
  const api = () => { if (!ui && typeof window !== 'undefined') ui = mount(window); return ui; };
  return {
    BUCKET, SIGNED_URL_SECONDS, MAX_BYTES, buildPath, instructions, missingPhotos, friendlyError,
    upload: (w, f) => api() && api().upload(w, f), signedUrl: (w) => api() && api().signedUrl(w), showInto: (w, el) => api() && api().showInto(w, el),
  };
});
