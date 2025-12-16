const CACHE_NAME = 'carncal-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './app.js', // Functional Improvement
  './icons/cc-72.png',
  './icons/cc-96.png',
  './icons/cc-144.png',
  './icons/cc-192.png',
  './icons/cc-512.png'
];

// Install event: cache the files
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Note: If you place your icons in a separate folder, ensure the paths are correct.
      return cache.addAll(ASSETS);
    })
  );
});

// Fetch event: serve from cache if offline
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
