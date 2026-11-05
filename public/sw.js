const CACHE_SHELL = 'mj-shell-v3';
const CACHE_IMAGES = 'mj-posters-v3';
const CACHE_API = 'mj-api-v3';
const PRECACHE_ASSETS = [
  '/manifest.json',
  '/icon.svg',
  '/apple-touch-icon.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_SHELL).then((cache) => cache.addAll(PRECACHE_ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_SHELL && k !== CACHE_IMAGES && k !== CACHE_API)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never intercept Vite dev transforms or auth/sync mutations
  if (
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/node_modules/') ||
    url.pathname.endsWith('.tsx') ||
    url.pathname.endsWith('.ts') ||
    url.pathname.startsWith('/api/auth/') ||
    url.pathname.startsWith('/api/user-sync/') ||
    url.pathname.startsWith('/api/admin/')
  ) {
    return;
  }

  // 1. TMDB Posters & Backdrops: Cache-First with background refresh
  if (url.hostname === 'image.tmdb.org') {
    event.respondWith(
      caches.open(CACHE_IMAGES).then(async (cache) => {
        const cached = await cache.match(req);
        const fetchPromise = fetch(req)
          .then((netRes) => {
            if (netRes && netRes.ok) {
              cache.put(req, netRes.clone()).catch(() => {});
            }
            return netRes;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // 2. TMDB Proxy GET API: Network-First with offline cache fallback
  if (url.pathname.startsWith('/api/tmdb/')) {
    event.respondWith(
      caches.open(CACHE_API).then(async (cache) => {
        try {
          const netRes = await fetch(req);
          if (netRes && netRes.ok) {
            cache.put(req, netRes.clone()).catch(() => {});
          }
          return netRes;
        } catch (err) {
          const cached = await cache.match(req);
          if (cached) return cached;
          throw err;
        }
      })
    );
    return;
  }

  // 3. HTML Navigation & Static Assets: Network-First with offline shell fallback
  if (req.mode === 'navigate' || url.origin === self.location.origin) {
    event.respondWith(
      caches.open(CACHE_SHELL).then(async (cache) => {
        try {
          const netRes = await fetch(req);
          if (netRes && netRes.ok && url.origin === self.location.origin) {
            cache.put(req, netRes.clone()).catch(() => {});
          }
          return netRes;
        } catch (err) {
          const cached = await cache.match(req);
          if (cached) return cached;
          if (req.mode === 'navigate') {
            const rootCached = await cache.match('/');
            if (rootCached) return rootCached;
          }
          throw err;
        }
      })
    );
  }
});
