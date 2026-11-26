// Barkwalk USA · Service worker de notificaciones push (Web Push / VAPID)
// Solo gestiona notificaciones: NO cachea la app (cada visita carga la versión desplegada).
// El servidor (/api/dispatch → api/_lib/push.js) envía JSON: { title, body, url, tag, urgent }.
// Sin manejador 'fetch': el navegador SIEMPRE pide la página al servidor (nunca una portada o app vieja).
// La versión nueva toma el control al instante y borra cualquier caché que hubiera dejado una versión anterior.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  try { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); } catch (e) { /* sin Cache Storage */ }
  await self.clients.claim();
})()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Barkwalk USA';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined,           // misma alerta = reemplaza a la anterior (sin duplicados en el teléfono)
    renotify: !!data.tag,
    requireInteraction: !!data.urgent,    // alertas críticas: se quedan hasta que el usuario las toque
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) { await w.focus(); if ('navigate' in w) w.navigate(url).catch(() => {}); return; }
    }
    await self.clients.openWindow(url);
  })());
});
