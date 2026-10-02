// Home-screen app support (n64-suite games). Network first, always: online play never sees a stale file. The small
// code / data files (html, js, css, json, webmanifest) are kept in a cache only so the app can still open offline.
// It also gives Chrome the fetch handler it wants before it offers "Install app" (beforeinstallprompt).
const CACHE = 'n64-app-v1';
const SMALL = /\.(?:html|js|css|json|webmanifest)$|\/$/;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || req.headers.has('range')) return;  // audio range requests etc. go straight to the network
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && res.status === 200 && SMALL.test(url.pathname)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || Response.error())));
});
