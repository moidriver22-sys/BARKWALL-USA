// Barkwalk USA · Notificaciones push OBLIGATORIAS (cliente)
// ---------------------------------------------------------------------------
// Al entrar al panel, el usuario debe activar las notificaciones de este dispositivo antes de reservar o
// aceptar paseos. La suscripción (Web Push, VAPID) se guarda en Supabase con la RPC bw_register_push().
// Estados de la pantalla: ask (pedir permiso) · denied (bloqueadas: cómo habilitarlas) · ios_install
// (iPhone en Safari: instalar en pantalla de inicio) · unsupported (navegador sin push) · error (fallo técnico).
// Si falta la migración 20261124_push_subscriptions.sql, NO bloquea a nadie (se registra el aviso en consola).
// La clave pública debe ser la pareja de VAPID_PRIVATE_KEY en Vercel.
// ---------------------------------------------------------------------------
(function () {
  'use strict';
  var VAPID_PUBLIC_KEY = 'BFzm2sdrfEeUr1-1OZlJf3vEADvXV4TmHYX_BK1ZjA-G5i_vE0Av7rJZmCDYTYpPQvERG2QnCtOF1TT6MzW8chA';
  var ID = 'pushGateModal';
  var S = { ready: false, busy: false, errors: 0 };

  function es() { return typeof currentLang === 'undefined' || currentLang === 'es'; }
  function t(a, b) { return es() ? a : b; }
  function db() { return window.supabaseClient; }

  function env() {
    var ua = navigator.userAgent || '';
    var ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    var inApp = /FBAN|FBAV|Instagram|Line\/|WhatsApp|TikTok|Snapchat/i.test(ua);
    var supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
    return { ios: ios, standalone: standalone, inApp: inApp, supported: supported, android: /Android/i.test(ua) };
  }

  function b64ToBytes(s) {
    var pad = '='.repeat((4 - (s.length % 4)) % 4);
    var raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function registration() {
    var reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    return reg;
  }

  // Suscribe (o reutiliza) y guarda en Supabase. Devuelve 'ok' | 'missing' (sin migración).
  async function subscribeAndSave() {
    var reg = await registration();
    var sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
    var j = sub.toJSON();
    var r = await db().rpc('bw_register_push', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_user_agent: navigator.userAgent });
    if (r.error) {
      var m = String(r.error.message || '') + ' ' + String(r.error.code || '');
      if (/PGRST202|42883|bw_register_push|schema cache/i.test(m)) { console.warn('Push: falta la migración 20261124_push_subscriptions.sql; no se bloquea al usuario.'); return 'missing'; }
      throw r.error;
    }
    return 'ok';
  }

  function close() { var el = document.getElementById(ID); if (el) el.remove(); document.documentElement.style.overflow = ''; }

  function steps(list) {
    return '<ol style="margin:10px 0 0;padding-left:20px;font-size:13.5px;line-height:1.55;color:var(--bw-text)">' +
      list.map(function (s) { return '<li style="margin:4px 0">' + s + '</li>'; }).join('') + '</ol>';
  }

  function view(state, detail) {
    var e = env();
    var titulo, texto, extra = '', botones = '';
    var btn = function (cls, onclick, label) { return '<button type="button" class="w-btn ' + cls + ' w-full" style="width:100%;margin-top:10px" onclick="' + onclick + '">' + label + '</button>'; };
    var salir = '<button type="button" style="display:block;width:100%;margin-top:14px;background:none;border:0;font-size:12px;font-weight:700;color:var(--bw-ink);text-decoration:underline;cursor:pointer" onclick="bwPushGate.logout()">' + t('Cerrar sesión', 'Log out') + '</button>';
    if (state === 'ask') {
      titulo = t('Activa las notificaciones 🔔', 'Turn on notifications 🔔');
      texto = t('Para reservar o aceptar paseos necesitas recibir avisos en este dispositivo: solicitudes nuevas, recordatorios antes de cada paseo y alertas si algo se retrasa.',
                'To book or accept walks you need alerts on this device: new requests, reminders before each walk and alerts if something is running late.');
      botones = btn('w-btn-primary', 'bwPushGate.activate(this)', t('Activar notificaciones', 'Turn on notifications'));
    } else if (state === 'denied') {
      titulo = t('Las notificaciones están bloqueadas', 'Notifications are blocked');
      texto = t('Este navegador tiene bloqueados los avisos de Barkwalk. Actívalos así y luego toca "Ya las activé":',
                'This browser is blocking Barkwalk alerts. Turn them on like this, then tap "I turned them on":');
      extra = e.ios ? steps([t('Abre <b>Ajustes</b> del iPhone → <b>Notificaciones</b>.', 'Open iPhone <b>Settings</b> → <b>Notifications</b>.'), t('Busca <b>Barkwalk USA</b> y activa <b>Permitir notificaciones</b>.', 'Find <b>Barkwalk USA</b> and turn on <b>Allow Notifications</b>.')])
        : e.android ? steps([t('Toca el ícono 🔒 o ⓘ junto a la dirección (barkwalkusa.com).', 'Tap the 🔒 or ⓘ icon next to the address (barkwalkusa.com).'), t('<b>Permisos</b> → <b>Notificaciones</b> → <b>Permitir</b>.', '<b>Permissions</b> → <b>Notifications</b> → <b>Allow</b>.'), t('Si instalaste la app: mantén presionado su ícono → ⓘ → Notificaciones → Permitir.', 'If you installed the app: long-press its icon → ⓘ → Notifications → Allow.')])
        : steps([t('Haz clic en el ícono 🔒 junto a la dirección (barkwalkusa.com).', 'Click the 🔒 icon next to the address (barkwalkusa.com).'), t('En <b>Notificaciones</b>, elige <b>Permitir</b>.', 'Set <b>Notifications</b> to <b>Allow</b>.'), t('Recarga la página si te lo pide.', 'Reload the page if asked.')]);
      botones = btn('w-btn-primary', 'bwPushGate.recheck(this)', t('Ya las activé', 'I turned them on'));
    } else if (state === 'ios_install') {
      titulo = t('Instala Barkwalk en tu iPhone', 'Install Barkwalk on your iPhone');
      texto = t('En iPhone, las notificaciones solo funcionan con la app instalada en la pantalla de inicio (iOS 16.4 o posterior):',
                'On iPhone, notifications only work with the app installed on your Home Screen (iOS 16.4 or later):');
      extra = steps([t('En Safari, toca <b>Compartir</b> (□↑).', 'In Safari, tap <b>Share</b> (□↑).'), t('Elige <b>Agregar a pantalla de inicio</b> → <b>Agregar</b>.', 'Choose <b>Add to Home Screen</b> → <b>Add</b>.'), t('Abre Barkwalk desde el ícono nuevo e inicia sesión: ahí podrás activar las notificaciones.', 'Open Barkwalk from the new icon and log in: you can turn on notifications there.')]);
    } else if (state === 'unsupported') {
      titulo = t('Abre Barkwalk en tu navegador', 'Open Barkwalk in your browser');
      texto = e.inApp ? t('Estás dentro de otra app (Instagram, Facebook, WhatsApp…) y no permite notificaciones. Toca ⋯ y elige <b>Abrir en el navegador</b> (Chrome o Safari).',
                          'You are inside another app (Instagram, Facebook, WhatsApp…) that does not allow notifications. Tap ⋯ and choose <b>Open in browser</b> (Chrome or Safari).')
        : t('Este navegador no admite notificaciones. Usa Chrome, Edge, Firefox o Safari actualizados.', 'This browser does not support notifications. Use an up-to-date Chrome, Edge, Firefox or Safari.');
    } else { // error técnico: reintentar; tras 2 fallos se permite continuar (un fallo nuestro no deja a nadie fuera)
      titulo = t('No pudimos activar las notificaciones', "We couldn't turn on notifications");
      texto = t('Hubo un problema técnico al registrar este dispositivo. Inténtalo de nuevo.', 'There was a technical problem registering this device. Please try again.') + (detail ? '<br><small style="opacity:.6">' + String(detail).replace(/[<>&]/g, '') + '</small>' : '');
      botones = btn('w-btn-primary', 'bwPushGate.activate(this)', t('Reintentar', 'Try again')) +
        (S.errors >= 2 ? btn('w-btn-ghost', 'bwPushGate.skip()', t('Continuar sin notificaciones por ahora', 'Continue without notifications for now')) : '');
    }
    var html = '<div role="dialog" aria-modal="true" aria-labelledby="pushGateTitle" style="width:100%;max-width:420px;max-height:90vh;overflow-y:auto;background:var(--bw-surface);color:var(--bw-text);border:1px solid var(--bw-line);border-radius:24px;padding:24px;box-shadow:0 24px 60px rgba(0,0,0,.45)">' +
      '<div style="display:flex;justify-content:center;margin-bottom:12px"><img src="/icon-192.png" alt="" width="56" height="56" style="border-radius:16px"></div>' +
      '<h2 id="pushGateTitle" style="margin:0 0 8px;font-size:20px;font-weight:900;text-align:center;color:var(--bw-ink)">' + titulo + '</h2>' +
      '<p style="margin:0;font-size:13.5px;line-height:1.55;text-align:center">' + texto + '</p>' + extra + botones + salir +
      '<p id="pushGateStatus" role="status" style="margin:10px 0 0;min-height:1em;font-size:12px;font-weight:700;text-align:center;color:#B3412E"></p></div>';
    var el = document.getElementById(ID);
    if (!el) {
      el = document.createElement('div');
      el.id = ID;
      // Encima del panel, la barra de pestañas y la burbuja (z 60-70); debajo de los avisos (10000+). No se cierra tocando fuera.
      el.style.cssText = 'position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(5,12,9,.82);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)';
      document.body.appendChild(el);
    }
    el.innerHTML = html;
    document.documentElement.style.overflow = 'hidden';
  }

  function status(msg) { var s = document.getElementById('pushGateStatus'); if (s) s.textContent = msg || ''; }

  async function done(res) {
    S.ready = true; close();
    if (res === 'ok' && typeof showToast === 'function') showToast('🔔 ' + t('Notificaciones activadas en este dispositivo.', 'Notifications are on for this device.'), 'ok', 3500);
  }

  // Comprueba el estado sin pedir nada (al entrar al panel). Si falta algo, muestra la pantalla obligatoria.
  async function check() {
    if (!window.currentUser || !db()) return;
    var e = env();
    if (!e.supported) { view(e.ios && !e.standalone ? 'ios_install' : 'unsupported'); return; }
    if (Notification.permission === 'denied') { view('denied'); return; }
    if (Notification.permission !== 'granted') { view('ask'); return; }
    try { await done(await subscribeAndSave() === 'missing' ? 'missing' : 'silent'); }
    catch (err) { S.errors++; console.warn('Push:', err); view('error', err && err.message); }
  }

  // Botón "Activar": el permiso solo se puede pedir dentro de un toque del usuario
  async function activate(btn) {
    if (S.busy) return; S.busy = true;
    if (btn) { btn.disabled = true; btn.textContent = t('Activando…', 'Turning on…'); }
    try {
      var perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (perm === 'granted') { await done(await subscribeAndSave()); }
      else if (perm === 'denied') { view('denied'); }
      else { view('ask'); status(t('Debes tocar "Permitir" para continuar.', 'You need to tap "Allow" to continue.')); }
    } catch (err) {
      S.errors++; console.warn('Push:', err); view('error', err && err.message);
    } finally { S.busy = false; }
  }

  async function recheck(btn) {
    if (btn) { btn.disabled = true; }
    if (Notification.permission === 'denied') { view('denied'); status(t('Siguen bloqueadas. Revisa los pasos y vuelve a intentarlo.', 'Still blocked. Check the steps and try again.')); return; }
    await activate(null);
  }

  // Al cerrar sesión: este dispositivo deja de recibir avisos de esa cuenta
  async function unregister() {
    S.ready = false; close();
    try {
      if (!('serviceWorker' in navigator)) return;
      var reg = await navigator.serviceWorker.getRegistration('/');
      var sub = reg && await reg.pushManager.getSubscription();
      if (sub && db()) { await db().rpc('bw_unregister_push', { p_endpoint: sub.endpoint }); await sub.unsubscribe(); }
    } catch (err) { console.warn('Push (cerrar sesión):', err); }
  }

  // ¿Puede reservar / aceptar? Si no, muestra la pantalla obligatoria.
  function require_() { if (S.ready) return true; check(); return false; }

  window.bwPushGate = {
    check: check, activate: activate, recheck: recheck, unregister: unregister, require: require_,
    ready: function () { return S.ready; },
    skip: function () { if (S.errors >= 2) { S.ready = true; close(); } },
    logout: function () { close(); if (typeof logoutUser === 'function') logoutUser(); },
  };
})();
