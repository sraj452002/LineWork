/* WorkLine Apps' service worker (registered by /mobile): it opens offline to the last copy of the app,
   and keeps built assets (they're named by their content) once fetched. The API is never cached. */
const CACHE = 'workline-apps-v1';
const SHELL = ['/mobile', '/mobile.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/p/')) return;
  // Pages: the network first (always the newest app), the saved copy when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => { if (url.pathname === '/mobile') { const copy = res.clone(); caches.open(CACHE).then(c => c.put('/mobile', copy)); } return res; })
      .catch(() => caches.match('/mobile')));
    return;
  }
  // Built files never change under the same name: the cache first.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; })));
  }
});
