// sw.js — actualiza HTML/CSS/JS al instante y mantiene offline
const SW_VERSION = 'v10';                 // súbelo v11, v12... cuando edites este archivo
const STATIC_CACHE  = `static-${SW_VERSION}`;
const RUNTIME_CACHE = `runtime-${SW_VERSION}`;

// Precarga solo el "shell" (HTML principal y manifest/icon).
// Agrega aquí MÁS páginas si las tienes (p.ej. '/otra.html').
const PRECACHE = [
  '/', '/index.html',
  '/dashboard.html', '/admin.html', '/supervisor.html',
  '/manifest.json', '/icon-192.png'
];

// Instala y precachea lo básico
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(PRECACHE)));
  self.skipWaiting(); // activa la nueva versión sin esperar
});

// Activa, elimina caches viejos, toma control y recarga las pestañas
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => ![STATIC_CACHE, RUNTIME_CACHE].includes(k))
        .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
     .then(async () => {
       // recarga todas las ventanas para que tomen el SW nuevo
       const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
       for (const client of clients) client.navigate(client.url);
     })
  );
});

// Permite forzar skipWaiting desde la página si lo necesitás
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Estrategias:
// - HTML / CSS / JS -> network-first (toma lo último; si falla, cache)
// - Otros (imágenes, etc.) -> cache-first
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isHTML = req.mode === 'navigate' || url.pathname.endsWith('.html');
  const isCode = url.pathname.endsWith('.css') || url.pathname.endsWith('.js');

  if (isHTML || isCode) {
    // NETWORK FIRST (evita CSS/JS “congelados”)
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // CACHE FIRST para el resto (imágenes, etc.)
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
