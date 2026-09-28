/* global self, caches, Response, URL, fetch */
// Arbo service worker (R25). Makes both doors installable and lets the SHELL
// open with no signal. Law: it NEVER caches /api, /webhooks or /talk — a
// customer record must not sit in a phone cache, and a stale number shown as
// current would break §1B. Offline, the shell opens and every panel says it
// could not read, exactly as it does when a feed is down.
const VERSION = '__ARBO_VERSION__';
const SHELL = 'arbo-shell-' + VERSION;
const PRECACHE = [
  '/app', '/crew',
  '/fonts/fraunces.woff2', '/fonts/instrument-sans.woff2',
  '/icons/arbo-180.png', '/icons/arbo-192.png', '/icons/arbo-512.png',
  '/manifest.webmanifest', '/crew.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('arbo-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function neverCache(url) {
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/webhooks/') || url.pathname.startsWith('/talk');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || neverCache(url)) return; // straight to the network
  // Fonts and icons: cache first (they change only with a deploy).
  if (url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
    return;
  }
  // The two app pages: network first so a deploy shows at once; the cached
  // copy only when there is no signal.
  if (url.pathname === '/app' || url.pathname === '/crew' || url.pathname === '/crew/') {
    const key = url.pathname === '/app' ? '/app' : '/crew';
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(key, copy)); }
          return res;
        })
        .catch(() => caches.match(key).then((hit) => hit || Response.error())),
    );
  }
});
