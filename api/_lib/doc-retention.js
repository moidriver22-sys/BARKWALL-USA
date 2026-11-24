// Retención de documentos de identidad (Política de Privacidad, sección 5)
// ---------------------------------------------------------------------------
// Fotos del ID y selfies del bucket PRIVADO 'walker-docs':
//   · Postulación RECHAZADA y el paseador NUNCA operó → se BORRAN a los 90 días de la decisión.
//   · Si operó como paseador → se conservan (3 años tras cerrar la cuenta; hoy no existe el cierre de cuenta
//     en la app, así que no se borra nada de quien operó).
// Lo ejecuta /api/dispatch en cada ronda del cron (y ?action=doc_retention[&dry=1] a mano).
// Borra con la Storage API (Supabase no permite borrar archivos por SQL) y marca walker_applications.docs_deleted_at.
// La fila de la postulación (fechas, decisión, historial en walker_reviews) se conserva: solo desaparecen las fotos.
// ---------------------------------------------------------------------------
const { sb, sbOrThrow, enc, supabaseConfig } = require('./supabase');
const { BUCKET, listOwnFiles } = require('./walker-identity');

const RETENTION_DAYS = 90;
const OPERATED_RETENTION_YEARS = 3;   // paseador que operó: 3 años desde que cerró su cuenta (account_closures.closed_at)
const MAX_WALKERS_PER_RUN = 20;

// ¿Quiénes cumplen TODAS las condiciones? (función pura)
//   apps: postulaciones (cualquier paseador) · operated: Set de walker_id con algún paseo asignado · now: ms
function retentionCandidates(apps, operated, now = Date.now()) {
  const limite = now - RETENTION_DAYS * 864e5;
  const porPaseador = new Map();
  for (const a of apps || []) {
    if (!porPaseador.has(a.walker_id)) porPaseador.set(a.walker_id, []);
    porPaseador.get(a.walker_id).push(a);
  }
  const out = [];
  for (const [uid, lista] of porPaseador) {
    if (operated && operated.has(uid)) continue;                                   // operó: se conserva
    if (lista.some((a) => a.status === 'approved' || a.status === 'submitted')) continue; // aprobado alguna vez o en revisión
    const ultima = [...lista].sort((x, y) => String(y.submitted_at).localeCompare(String(x.submitted_at)))[0];
    if (!ultima || ultima.status !== 'rejected') continue;
    if (!ultima.decided_at || Date.parse(ultima.decided_at) > limite) continue;    // aún no pasan 90 días
    if (lista.every((a) => a.docs_deleted_at)) continue;                           // ya borradas
    out.push(uid);
  }
  return out.slice(0, MAX_WALKERS_PER_RUN);
}

async function deleteFiles(paths) {
  if (!paths.length) return;
  const { url, key } = supabaseConfig();
  const r = await fetch(`${url}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!r.ok) throw new Error(`storage delete ${r.status}`);
}

async function runRejectedRetention({ dryRun = false, now = Date.now() } = {}) {
  // Solo postulaciones de paseadores cuyo envío más reciente puede estar rechazado (las demás se descartan arriba)
  const apps = await sbOrThrow('/rest/v1/walker_applications?select=walker_id,status,submitted_at,decided_at,docs_deleted_at&order=submitted_at.desc&limit=2000');
  const rechazados = [...new Set(apps.filter((a) => a.status === 'rejected' && !a.docs_deleted_at).map((a) => a.walker_id))];
  const operated = new Set();
  for (const uid of rechazados) {
    const w = await sbOrThrow(`/rest/v1/walk_requests?walker_id=eq.${enc(uid)}&select=id&limit=1`);
    if (w.length) operated.add(uid);
  }
  const candidatos = retentionCandidates(apps, operated, now);
  const out = { checked: rechazados.length, eligible: candidatos.length, walkersCleaned: 0, filesDeleted: 0, failed: 0, dryRun };
  if (dryRun) return out;
  for (const uid of candidatos) {
    try {
      // Doble comprobación justo antes de borrar: sigue sin paseos y sin envíos nuevos
      const w = await sbOrThrow(`/rest/v1/walk_requests?walker_id=eq.${enc(uid)}&select=id&limit=1`);
      const abiertas = await sbOrThrow(`/rest/v1/walker_applications?walker_id=eq.${enc(uid)}&status=in.(submitted,approved)&select=id&limit=1`);
      if (w.length || abiertas.length) continue;
      const files = await listOwnFiles(uid);
      await deleteFiles(files.map((f) => f.path));
      await sbOrThrow(`/rest/v1/walker_applications?walker_id=eq.${enc(uid)}&docs_deleted_at=is.null`, {
        method: 'PATCH', body: { docs_deleted_at: new Date(now).toISOString() }, prefer: 'return=minimal' });
      out.walkersCleaned++; out.filesDeleted += files.length;
    } catch (e) {
      out.failed++;
      console.error(`doc_retention ${uid}:`, e.message);
    }
  }
  return out;
}

// ---------- Cuentas CERRADAS (public.account_closures) ----------
// Paseador que OPERÓ: 3 años desde closed_at. Paseador que NUNCA operó: 90 días desde closed_at. (función pura)
function closedCandidates(closures, now = Date.now()) {
  const tres = new Date(now); tres.setUTCFullYear(tres.getUTCFullYear() - OPERATED_RETENTION_YEARS);
  const noventa = now - RETENTION_DAYS * 864e5;
  return (closures || []).filter((c) => !c.docs_deleted_at && ['walker', 'shopper'].includes(c.role)
    && Date.parse(c.closed_at) <= (c.operated ? tres.getTime() : noventa)).map((c) => c.user_id).slice(0, MAX_WALKERS_PER_RUN);
}

async function runClosedRetention({ dryRun = false, now = Date.now() } = {}) {
  const r = await sb('/rest/v1/account_closures?docs_deleted_at=is.null&role=in.(walker,shopper)&select=user_id,role,closed_at,operated,docs_deleted_at&order=closed_at.asc&limit=500');
  if (!r.ok) return { error: `account_closures ${r.status}` };
  const candidatos = closedCandidates(r.data || [], now);
  const out = { checked: (r.data || []).length, eligible: candidatos.length, walkersCleaned: 0, filesDeleted: 0, failed: 0, dryRun };
  if (dryRun) return out;
  for (const uid of candidatos) {
    try {
      const files = await listOwnFiles(uid);
      await deleteFiles(files.map((f) => f.path));
      const ahora = new Date(now).toISOString();
      await sbOrThrow(`/rest/v1/walker_applications?walker_id=eq.${enc(uid)}&docs_deleted_at=is.null`, { method: 'PATCH', body: { docs_deleted_at: ahora }, prefer: 'return=minimal' });
      // Constancia del borrado en el registro del cierre
      await sbOrThrow(`/rest/v1/account_closures?user_id=eq.${enc(uid)}`, { method: 'PATCH', body: { docs_deleted_at: ahora, docs_deleted_count: files.length }, prefer: 'return=minimal' });
      out.walkersCleaned++; out.filesDeleted += files.length;
    } catch (e) { out.failed++; console.error(`doc_retention (cierre) ${uid}:`, e.message); }
  }
  return out;
}

// Ronda completa: rechazadas sin operar (90 días) + cuentas cerradas (3 años si operó / 90 días si no)
async function runDocRetention({ dryRun = false, now = Date.now() } = {}) {
  const rejected = await runRejectedRetention({ dryRun, now });
  const closed = await runClosedRetention({ dryRun, now }).catch((e) => ({ error: e.message }));
  return { ...rejected, closed };
}

module.exports = { RETENTION_DAYS, OPERATED_RETENTION_YEARS, retentionCandidates, closedCandidates, runDocRetention, runRejectedRetention, runClosedRetention, deleteFiles };
