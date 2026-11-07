/* MeowCare minimal service worker: installable + offline fallback page.
   Bump CACHE_VERSION whenever you change OFFLINE_URL or PRECACHE. */
const CACHE_VERSION = 'meowcare-v1';
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Only page navigations are handled: network first, offline page if the network fails.
   Everything else (Supabase API, images, audio, _next assets) goes straight to the network,
   which also avoids Safari's problems with audio Range requests going through a service worker. */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.mode !== 'navigate') return;
  event.respondWith(
    fetch(req).catch(() => caches.match(OFFLINE_URL).then(r => r || Response.error()))
  );
});