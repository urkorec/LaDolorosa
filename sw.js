// ── La Dolorosa — Service Worker ──────────────────────────────
// Versión del caché: incrementa este número para forzar actualización
const CACHE_VERSION = 'v1';
const CACHE_NAME    = `la-dolorosa-${CACHE_VERSION}`;

// Archivos del "app shell" que se cachean al instalar
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// ── Instalación: pre-cachea el app shell ──────────────────────
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

// ── Fetch: estrategia Network-First con fallback a caché ──────
// Para Firebase (API externa) siempre va a red sin cachear.
// Para archivos propios intenta red primero; si falla usa caché.
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Peticiones a Firebase y googleapis: solo red, sin cachear
  if (
    url.includes('firebasedatabase.app') ||
    url.includes('firebaseapp.com') ||
    url.includes('googleapis.com') ||
    url.includes('gstatic.com')
  ) {
    return; // el navegador gestiona la petición normalmente
  }

  // Para el resto: Network-First
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Clonamos la respuesta para guardarla en caché
        if (
          response &&
          response.status === 200 &&
          event.request.method === 'GET'
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Sin red: devuelve desde caché
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // Fallback para navegación: devuelve index.html
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return new Response('Sin conexión', { status: 503 });
        });
      })
  );
});
