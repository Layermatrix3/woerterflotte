const CACHE = 'woerterflotte-v1';
const ASSETS = ['./', './index.html', './css/style.css', './manifest.json', './assets/ship.svg',
  './js/vendor/qrcode.js', './assets/radar.svg', './assets/touch.png', './data/fremdwoerter.json',
  ...['app','ui','board','game','questions','multiplayer','firebase-config','pages','sounds'].map(name => './js/' + name + '.js')];
const urls = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('woerterflotte-') && key !== CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (event.request.mode === 'navigate') url.search = '';
  if (!urls.has(url.href)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(url.href, copy)).catch(() => {}));
    }
    return response;
  }).catch(async () => (await caches.match(url.href)) || Response.error()));
});
