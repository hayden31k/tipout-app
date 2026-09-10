const CACHE_NAME = 'tipout-cache-v7';
const FILES_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Lets the page ask which cache this exact SW instance is running, for the
// on-screen debug panel - proves whether a given page load's controller (if
// any) is actually this current SW or a stale one that hasn't updated yet.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'TIPOUT_GET_VERSION') {
    event.ports[0].postMessage({ cacheName: CACHE_NAME });
  }
});

function isIndexRequest(request) {
  if (request.mode === 'navigate') return true;
  const path = new URL(request.url).pathname;
  return path.endsWith('/') || path.endsWith('/index.html');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (new URL(request.url).pathname.endsWith('/version.json')) {
    // Always network, never cached: the page deliberately cache-busts this
    // URL with a unique query string on every check, so caching it here
    // would just accumulate one Cache Storage entry per load forever.
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (isIndexRequest(request)) {
    // Network-first: always serve the latest index.html when online, so app
    // updates show up without needing a CACHE_NAME bump. Only fall back to
    // the cached copy (e.g. mid-shift with no connection) if the fetch fails.
    //
    // cache: 'no-store' is required here - GitHub Pages serves index.html
    // with "Cache-Control: max-age=600", and a plain fetch() honors that,
    // meaning the browser's own HTTP cache (separate from, and underneath,
    // this service worker's Cache Storage) could silently return a stale
    // response for up to 10 minutes with zero network request at all,
    // completely defeating "network-first" regardless of this handler's
    // own logic.
    event.respondWith(
      fetch(request, { cache: 'no-store' }).then((response) => {
        if (response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for everything else (icons, manifest) - these change rarely,
  // so a CACHE_NAME bump is still the right way to force-refresh them.
  event.respondWith(
    caches.match(request).then((cached) => {
      return cached || fetch(request).then((response) => {
        return caches.open(CACHE_NAME).then((cache) => {
          if (request.method === 'GET' && response.status === 200) {
            cache.put(request, response.clone());
          }
          return response;
        });
      }).catch(() => cached);
    })
  );
});
