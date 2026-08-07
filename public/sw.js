/* Service Worker — Leons Group Panel
   - Cachea el "app shell" para carga rápida/offline.
   - NUNCA cachea /api/* (datos siempre frescos desde la red).
   - Maneja notificaciones push (Fase 4).
*/
// El servidor reemplaza __SW_VERSION__ en cada reinicio → invalida caché en cada deploy
const CACHE = '__SW_VERSION__';
const SHELL = [
  '/login.html',
  '/index.html',
  '/m/',
  '/m/index.html',
  '/os/sp-os.css',
  '/sw-reg.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo manejamos GET del mismo origen
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // API y streams: siempre red, nunca caché
  if (url.pathname.startsWith('/api/')) return;

  // Navegación / HTML / JS / CSS: red primero, caché de respaldo
  // (JS/CSS red-primero evita que el shell viejo quede pegado tras un deploy)
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')
      || url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match('/index.html')))
    );
    return;
  }

  // Estáticos (iconos, manifest, etc): caché primero
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }))
  );
});

// --- Notificaciones push (Fase 4) ---
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Leons Group';
  const options = {
    body: data.body || 'Tienes un nuevo mensaje de un cliente.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [120, 60, 120],
    tag: data.tag || 'sp-lead',
    renotify: true,
    data: { leadId: data.leadId || null, url: '/m/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const leadId = event.notification.data && event.notification.data.leadId;
  const targetUrl = leadId ? `/m/?lead=${leadId}` : '/m/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ((client.url.includes('/m/')) && 'focus' in client) {
          client.focus();
          client.postMessage({ type: 'open_lead', leadId });
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
