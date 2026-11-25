// Cierre / eliminación de cuenta (Perfil → Zona de peligro → "Eliminar mi cuenta")
// ---------------------------------------------------------------------------
// POST /api/signup { action: 'close_account_check' }               → qué impide cerrar (para la pantalla)
// POST /api/signup { action: 'close_account', confirm: 'DELETE' }  → cierra (Authorization: Bearer <token>)
//   confirm: DELETE / ELIMINAR (también CERRAR / CLOSE de versiones anteriores de la app) o el correo de la cuenta.
//
// Se BLOQUEA si hay: paseos activos o pendientes (como cliente o paseador), pagos al paseador sin liquidar,
// reembolsos por cancelación en curso, disputas abiertas o una membresía todavía activa en Stripe.
// Al cerrar:
//   · constancia en public.account_closures (closed_at, rol, si operó, IP, navegador) — la escribe solo el servidor;
//   · se desactiva: Supabase Auth bloquea el inicio de sesión y, si es paseador, queda 'suspended' (no ve paseos).
//     Si la desactivación en Auth falla, se DESHACE la constancia (no queda una cuenta "cerrada" que aún puede entrar);
//   · se borra lo que ya no hace falta: avisos push, tarjetas guardadas (tokens), códigos de acceso al hogar,
//     pasaportes de salud, mascotas y sus fotos (bucket pet-photos); se dan de baja los correos de fidelización.
//     Una mascota que figura en un paseo (walk_requests.pet_id, FK sin ON DELETE) no se borra: se le quitan foto y notas;
//   · se CONSERVAN los registros legales y financieros: legal_consents, bookings, walk_requests, pagos, reembolsos.
// Fotos de identidad (walker-docs): las borra api/_lib/doc-retention.js — 3 años tras el cierre si operó,
// 90 días si nunca operó (Política de Privacidad, sección 5).
// ---------------------------------------------------------------------------
const { sb, sbOrThrow, enc, supabaseConfig } = require('./supabase');

const CONFIRM_WORDS = new Set(['DELETE', 'ELIMINAR', 'CERRAR', 'CLOSE']);
const PET_BUCKET = 'pet-photos';
const ACTIVE_STATES = '(pending,accepted,en_camino,in_progress)';
const WALKER_ACTIVE = '(accepted,en_camino,in_progress)';
const UNSETTLED_PAYOUT = '(unpaid,processing,failed)';
const OPEN_REFUND = '(pending,refunding,needs_review)';
const SUB_BLOCKING = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']);
const WALKER_ROLES = new Set(['walker', 'shopper']);

// ¿Confirmó? Palabra clave o el correo exacto de la cuenta (sin distinguir mayúsculas)
function isConfirmed(value, email) {
  const v = String(value || '').trim();
  if (CONFIRM_WORDS.has(v.toUpperCase())) return true;
  return !!email && v.includes('@') && v.toLowerCase() === String(email).trim().toLowerCase();
}

const count = async (q) => (await sbOrThrow(`${q}&select=id&limit=50`)).length;

// Qué impide cerrar la cuenta (lista vacía = se puede cerrar)
async function closureBlockers(userId) {
  const [p] = await sbOrThrow(`/rest/v1/profiles?id=eq.${enc(userId)}&select=id,role,membership_status,stripe_subscription_id&limit=1`);
  if (!p) return { profile: null, blockers: [{ code: 'profile_not_found', count: 1 }] };
  const [cerrada] = await sbOrThrow(`/rest/v1/account_closures?user_id=eq.${enc(userId)}&select=user_id&limit=1`);
  if (cerrada) return { profile: p, blockers: [{ code: 'already_closed', count: 1 }] };
  const b = [];
  const add = (code, n) => { if (n > 0) b.push({ code, count: n }); };
  const walker = WALKER_ROLES.has(p.role);
  add('active_walks', await count(`/rest/v1/walk_requests?client_id=eq.${enc(userId)}&payment_status=eq.paid&status=in.${ACTIVE_STATES}`));
  if (walker) {
    add('active_walks_as_walker', await count(`/rest/v1/walk_requests?walker_id=eq.${enc(userId)}&status=in.${WALKER_ACTIVE}`));
    add('unsettled_payouts', await count(`/rest/v1/walk_requests?walker_id=eq.${enc(userId)}&status=eq.completed&payment_status=eq.paid&walker_payout_status=in.${UNSETTLED_PAYOUT}`));
  }
  add('pending_refunds', (await sbOrThrow(`/rest/v1/walk_cancellations?client_id=eq.${enc(userId)}&status=in.${OPEN_REFUND}&select=walk_id&limit=50`)).length);
  const disputas = await sbOrThrow(`/rest/v1/bookings?client_id=eq.${enc(userId)}&dispute_status=not.is.null&select=dispute_status&limit=50`);
  add('open_disputes', disputas.filter((d) => !['won', 'lost', 'warning_closed'].includes(d.dispute_status)).length);
  if (p.stripe_subscription_id && SUB_BLOCKING.has(p.membership_status)) add('active_membership', 1);
  return { profile: p, blockers: b };
}

// Desactiva el inicio de sesión en Supabase Auth (~100 años). La sesión abierta la cierra la app.
async function banAuthUser(userId) {
  const { url, key } = supabaseConfig();
  const r = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ban_duration: '876000h' }),
  });
  if (!r.ok) throw new Error(`auth ban ${r.status}`);
}

// Mascotas: borra pasaportes de salud, fotos y las mascotas que no figuran en ningún paseo
// (las que sí figuran se conservan por la FK de walk_requests, pero sin foto ni notas)
async function deletePetData(userId) {
  const { url, key } = supabaseConfig();
  const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  await sbOrThrow(`/rest/v1/pet_passports?client_id=eq.${enc(userId)}`, { method: 'DELETE', prefer: 'return=minimal' });
  const pets = (await sbOrThrow(`/rest/v1/pets?owner_id=eq.${enc(userId)}&select=id&limit=200`)).map((p) => String(p.id));
  if (pets.length) {
    const usadas = new Set((await sbOrThrow(`/rest/v1/walk_requests?client_id=eq.${enc(userId)}&pet_id=not.is.null&select=pet_id&limit=2000`)).map((w) => String(w.pet_id)));
    const libres = pets.filter((id) => !usadas.has(id));
    const enUso = pets.filter((id) => usadas.has(id));
    const lista = (ids) => ids.map(enc).join(',');
    if (libres.length) await sbOrThrow(`/rest/v1/pets?owner_id=eq.${enc(userId)}&id=in.(${lista(libres)})`, { method: 'DELETE', prefer: 'return=minimal' });
    if (enUso.length) await sbOrThrow(`/rest/v1/pets?owner_id=eq.${enc(userId)}&id=in.(${lista(enUso)})`, { method: 'PATCH', body: { photo_url: null, dog_photo_url: null, notes: null }, prefer: 'return=minimal' });
  }
  const l = await fetch(`${url}/storage/v1/object/list/${PET_BUCKET}`, { method: 'POST', headers: h, body: JSON.stringify({ prefix: `${userId}/`, limit: 1000 }) });
  if (!l.ok) throw new Error(`pet-photos list ${l.status}`);
  const files = ((await l.json()) || []).filter((f) => f && f.name).map((f) => `${userId}/${f.name}`);
  if (files.length) {
    const d = await fetch(`${url}/storage/v1/object/${PET_BUCKET}`, { method: 'DELETE', headers: h, body: JSON.stringify({ prefixes: files }) });
    if (!d.ok) throw new Error(`pet-photos delete ${d.status}`);
  }
  return { pets: pets.length, photos: files.length };
}

async function closeAccount({ user, body, ip, userAgent }) {
  if (!isConfirmed(body && body.confirm, user && user.email)) return { status: 400, body: { error: 'confirmation_required' } };
  const { profile, blockers } = await closureBlockers(user.id);
  if (!profile) return { status: 404, body: { error: 'profile_not_found' } };
  if (blockers.length) return { status: 409, body: { error: blockers[0].code === 'already_closed' ? 'already_closed' : 'close_blocked', blockers } };

  const walker = WALKER_ROLES.has(profile.role);
  const operated = walker ? (await sbOrThrow(`/rest/v1/walk_requests?walker_id=eq.${enc(user.id)}&select=id&limit=1`)).length > 0 : false;
  const now = new Date().toISOString();
  // 1) Constancia (si ya existe, otra petición la cerró: no se duplica)
  const r = await sb('/rest/v1/account_closures', { method: 'POST', prefer: 'return=minimal', body: {
    user_id: user.id, role: profile.role, closed_at: now, operated,
    reason: String((body && body.reason) || '').trim().slice(0, 500) || null, ip_address: ip || null, user_agent: String(userAgent || '').slice(0, 500),
  } });
  if (!r.ok) return { status: r.status === 409 ? 409 : 500, body: { error: r.status === 409 ? 'already_closed' : 'internal_error' } };

  // 2) Desactivar el inicio de sesión. Si falla, se deshace la constancia y la persona puede reintentar.
  try { await banAuthUser(user.id); } catch (e) {
    console.error('close_account ban:', e.message);
    await sb(`/rest/v1/account_closures?user_id=eq.${enc(user.id)}`, { method: 'DELETE', prefer: 'return=minimal' });
    return { status: 502, body: { error: 'deactivate_failed' } };
  }

  // 3) La cuenta YA está cerrada: cada limpieza es independiente y un fallo no cambia la respuesta
  //    (queda en el log y en cleanupPending). Los registros legales y financieros NO se tocan.
  const pendientes = [];
  const paso = async (name, fn) => { try { await fn(); } catch (e) { pendientes.push(name); console.error(`close_account ${name}:`, e.message); } };
  if (walker) await paso('walker_suspend', () => sbOrThrow(`/rest/v1/profiles?id=eq.${enc(user.id)}`, { method: 'PATCH', body: { walker_status: 'suspended' }, prefer: 'return=minimal' }));
  await paso('growth_opt_out', () => sbOrThrow(`/rest/v1/profiles?id=eq.${enc(user.id)}&growth_opt_out_at=is.null`, { method: 'PATCH', body: { growth_opt_out_at: now }, prefer: 'return=minimal' }));
  await paso('push', () => sbOrThrow(`/rest/v1/push_subscriptions?user_id=eq.${enc(user.id)}`, { method: 'DELETE', prefer: 'return=minimal' }));
  await paso('cards', () => sbOrThrow(`/rest/v1/payment_methods?client_id=eq.${enc(user.id)}`, { method: 'DELETE', prefer: 'return=minimal' }));
  await paso('home_access', () => sbOrThrow(`/rest/v1/home_access?client_id=eq.${enc(user.id)}`, { method: 'DELETE', prefer: 'return=minimal' }));
  await paso('pets', () => deletePetData(user.id));
  return { status: 200, body: { status: 'closed', closedAt: now, operated, ...(pendientes.length ? { cleanupPending: pendientes } : {}) } };
}

module.exports = { CONFIRM_WORDS, isConfirmed, closureBlockers, closeAccount, banAuthUser, deletePetData };
