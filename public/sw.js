// sw.js – cache control más seguro
const STATIC_CACHE = 'static-v5';
const RUNTIME_CACHE = 'runtime-v5';

const PRECACHE = [
  '/', '/index.html', '/dashboard.html',
  '/login.css', '/dashboard.css',
  '/main.js', '/manifest.json', '/icon-192.png'
];

// Instala y precachea lo básico
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting(); // activa la nueva versión sin esperar
});

// Elimina caches viejas
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => ![STATIC_CACHE, RUNTIME_CACHE].includes(k))
        .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Estrategias:
// - HTML/CSS/JS: network-first (toma lo último del servidor; si falla, cache)
// - Imágenes/otros: cache-first (rápido y offline)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isHTML = req.mode === 'navigate' || url.pathname.endsWith('.html');
  const isCode = url.pathname.endsWith('.css') || url.pathname.endsWith('.js');

  if (isHTML || isCode) {
    // NETWORK FIRST
    event.respondWith(
      fetch(req, { cache: 'no-store' }).then((res) => {
        const copy = res.clone();
        caches.open(RUNTIME_CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // CACHE FIRST para lo demás (ej. imágenes)
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
