// ── La Dolorosa — Service Worker ──────────────────────────────
const CACHE_VERSION = 'v2';
const CACHE_NAME    = `la-dolorosa-${CACHE_VERSION}`;

const APP_SHELL = [
  '/LaDolorosa/',
  '/LaDolorosa/index.html',
  '/LaDolorosa/styles.css',
  '/LaDolorosa/app.js',
  '/LaDolorosa/manifest.json',
  '/LaDolorosa/icons/icon-192x192.png',
  '/LaDolorosa/icons/icon-512x512.png',
];

// ── Instalación ───────────────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(APP_SHELL).catch(err => {
        console.warn('[SW] No se pudieron cachear todos los archivos:', err);
      });
    })
  );
});

// ── Activación: limpia cachés antiguas ────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('la-dolorosa-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: Network-First con fallback a caché ─────────────────
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Firebase y googleapis: solo red
  if (
    url.includes('firebasedatabase.app') ||
    url.includes('firebaseapp.com') ||
    url.includes('googleapis.com') ||
    url.includes('gstatic.com')
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200 && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('/LaDolorosa/index.html');
          }
          return new Response('Sin conexión', { status: 503 });
        });
      })
  );
});
