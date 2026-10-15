// v20261015a
const CACHE = 'soiree-prizes-20261015a';
const PRECACHE_URLS = [
  'index.html',
  'bookmark-print.html',
  'manifest.json',
  'css/app.css',
  'js/logo.js',
  'js/storage.js',
  'js/auth.js',
  'js/state.js',
  'js/goals.js',
  'js/prizes.js',
  'js/app.js'
];
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE_URLS)).catch(() => {})
  );
  self.skipWaiting();
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request, {cache: 'no-store'})
      .then(res => {
        // Opportunistically keep the cache fresh with whatever loaded successfully
        const resClone = res.clone();
        caches.open(CACHE).then(cache => cache.put(e.request, resClone)).catch(() => {});
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(e.request);
        if (cached) return cached;
        // No network AND no cached copy — return a real Response instead of
        // undefined, so the browser shows a plain message instead of crashing
        // with "FetchEvent.respondWith received an error: Returned response is null."
        return new Response(
          'You appear to be offline and this page isn\'t saved for offline use yet. Please reconnect and reload.',
          { status: 503, headers: { 'Content-Type': 'text/plain' } }
        );
      })
  );
});