// sw.js — actualiza HTML/CSS/JS al instante y mantiene offline básico
const SW_VERSION = 'v14';                       // ⬅️ súbelo v13, v14... cuando cambies el SW
const STATIC_CACHE  = `static-${SW_VERSION}`;
const RUNTIME_CACHE = `runtime-${SW_VERSION}`;

// Precarga solo HTML/manifest/icon (no CSS/JS para evitar “congelarlos”)
const PRECACHE = [
  '/', '/index.html',
  '/dashboard.html', '/admin.html', '/supervisor.html',
  '/manifest.json', '/icon-192.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then(c => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => ![STATIC_CACHE, RUNTIME_CACHE].includes(k))
        .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
     .then(async () => {
       // Recarga todas las pestañas para tomar el SW nuevo
       const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
       for (const client of clients) client.navigate(client.url);
     })
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// HTML/CSS/JS: network-first → siempre trae lo último del servidor
// Otros (imágenes, etc.): cache-first
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isHTML = req.mode === 'navigate' || url.pathname.endsWith('.html');
  const isCode = url.pathname.endsWith('.css') || url.pathname.endsWith('.js');

  if (isHTML || isCode) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(res => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached =>
      cached || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(RUNTIME_CACHE).then(c => c.put(req, copy));
        return res;
      })
    )
  );
});
