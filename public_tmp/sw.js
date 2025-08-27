const CACHE_NAME = "app-cache-v1";
const CACHE_TTL = 5 * 60 * 1000; 


let lastUpdate = {};


self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll([
        "/", 
        "/index.html"
        
      ]);
    })
  );
  self.skipWaiting();
});


self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});


self.addEventListener("fetch", event => {
  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const url = event.request.url;
      const cached = await cache.match(event.request);
      const now = Date.now();

      
      if (cached && lastUpdate[url] && now - lastUpdate[url] < CACHE_TTL) {
        return cached;
      }

      
      return fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            cache.put(event.request, response.clone());
            lastUpdate[url] = now;
          }
          return response;
        })
        .catch(() => {
          
          return cached || new Response("Offline", { status: 503 });
        });
    })
  );
});
