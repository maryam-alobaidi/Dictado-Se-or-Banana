const CACHE = 'senor-banana-v5';
// The Angular build gives its JS/CSS bundles hashed names, so they are not listed here:
// they are cached the first time they load (see "fetch" below).
const FILES = [
  './',
  'index.html',
  'Haider22.webp',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
];
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});
self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);
// Network first (to get updates) and, without internet, the saved copy.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return r;
      })
      .catch(() => caches.match(e.request)),
  );
});
