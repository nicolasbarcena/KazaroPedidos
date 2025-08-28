// sw.js — actualización fiable de assets sin congelarlos
const SW_VERSION = 'v7';
const STATIC_CACHE  = `static-${SW_VERSION}`;
const RUNTIME_CACHE = `runtime-${SW_VERSION}`;

// Precarga solo el "shell" mínimo. No metas .css /.js aquí
const PRECACHE = [
  '/', '/index.html', '/dashboard.html',
  '/manifest.json', '/icon-192.png'
];

// Instala y precachea lo básico
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting(); // activa la nueva versión sin esperar
});

// Elimina caches viejas y toma control
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => ![STATIC_CACHE, RUNTIME_CACHE].includes(k))
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
     .then(async () => {
       // (opcional) pide a las pestañas recargarse para que tomen la versión nueva
       const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
       for (const client of clients) client.navigate(client.url);
     })
  );
});

// Permite forzar skipWaiting desde la página (por si lo necesitás)
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Estrategias:
// - HTML/CSS/JS: network-first (toma lo último; si falla, cache)
// - Otros (imágenes, etc.): cache-first
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isHTML = req.mode === 'navigate' || url.pathname.endsWith('.html');
  const isCode = url.pathname.endsWith('.css') || url.pathname.endsWith('.js');

  if (isHTML || isCode) {
    // NETWORK FIRST para ver cambios inmediatamente
    event.respondWith(
      fetch(req, { cache: 'no-store' }).then((res) => {
        const copy = res.clone();
        caches.open(RUNTIME_CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // CACHE FIRST para lo demás
  event.respondWith(
    caches.match(req).then(cached => {
      return cached || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(RUNTIME_CACHE).then(c => c.put(req, copy));
        return res;
      });
    })
  );
});
