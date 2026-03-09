// ============================================================
// Revamp Hub - Service Worker
// ============================================================
// Caches app shell for offline support. API calls are always
// network-first (device status must be live).
// ============================================================

const CACHE_NAME = 'revamp-hub-v13';
const APP_SHELL = [
  '/',
  '/index.html',
  '/js/app.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-180.png'
];

// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for app shell
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls: always network (device data must be live)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // App shell: network-first, fallback to cache (avoids stale JS)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Update cache with fresh version
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
