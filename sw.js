const CACHE_VERSION = 'v5';
const CACHE_NAME = 'carncal-' + CACHE_VERSION;
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './app.js',
  './sync.js',
  './firebase-config.js',
  './icons/cc-72.png',
  './icons/cc-96.png',
  './icons/cc-144.png',
  './icons/cc-192.png',
  './icons/cc-512.png',
  './icons/cc-512-maskable.png'
];

// Install: cache each asset independently so one missing/failed file
// (e.g. a renamed icon) can't sink the whole install and leave the
// app with zero offline capability.
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const results = await Promise.allSettled(ASSETS.map((url) => cache.add(url)));
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.warn('[SW] Failed to cache (app still installs):', ASSETS[i], r.reason);
        }
      });
    })
  );
});

// Activate: drop old cache versions and take control of open pages
// immediately, so a code update actually reaches devices in the field
// on next launch instead of being stuck on a stale cache forever.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: cache-first, with a network fallback, and an offline fallback
// to the cached index.html for navigations so users never see a raw
// browser error page when offline and a route isn't cached.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).catch(() => {
        if (e.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return undefined;
      });
    })
  );
});
