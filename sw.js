// Training Log — service worker
// - HTML: red primero (siempre abre la última versión) con respaldo en caché si no hay señal.
// - Íconos y manifest: caché primero y se actualizan en segundo plano.
// - Fuentes de Google: caché primero (para que se vean sin conexión).
// Sube VERSION solo si cambias la lista CORE.
const VERSION = 'training-log-v2';
const CORE = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
const NAV_TIMEOUT_MS = 3000;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION).then(cache =>
      // cada archivo por separado: si falta uno (p. ej. un ícono) no se cae toda la instalación
      Promise.all(CORE.map(url =>
        cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n !== VERSION).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    const isPage = req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/');
    event.respondWith(isPage ? networkFirst(req) : staleWhileRevalidate(event, req));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req));
  }
  // cualquier otra cosa: red normal
});

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  const fallback = async () => (await cache.match(req, { ignoreSearch: true })) || (await cache.match('./index.html'));

  const network = fetch(req).then(res => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  });
  network.catch(() => {}); // evita "unhandled rejection" si pierde la carrera contra el timeout

  const timeout = new Promise(resolve => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    // señal lenta: abre ya lo guardado; la red sigue y actualiza la caché para la próxima
    return (await fallback()) || network;
  } catch (e) {
    return (await fallback()) || Response.error();
  }
}

async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(req, { ignoreSearch: true });
  const update = fetch(req)
    .then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; })
    .catch(() => null);
  event.waitUntil(update);
  return cached || (await update) || Response.error();
}

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}
