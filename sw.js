/**
 * BrainSpark Studio — Service Worker
 * Strategy:
 *   App shell      → Cache-first (installed on SW activation)
 *   /api/modules/* → Cache-first with network fallback + cache update
 *   /api/responses → Network-only with offline queue (handled in app)
 *   CDN assets     → Cache-first, cached on first use
 */

const CACHE = 'brainspark-v1';

// Assets to pre-cache on install (app shell)
const PRECACHE = [
  '/',
  '/index.html',
];

// CDN patterns to cache on first use
const CDN_ORIGINS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
];

// ── Install: pre-cache app shell ─────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────
self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Never intercept POST requests (responses, publish) — let them go to network
  if (request.method !== 'GET') return;

  // /api/modules/:slug — cache-first, refresh in background
  if (url.pathname.startsWith('/api/modules/')) {
    e.respondWith(cacheFirstThenUpdate(request));
    return;
  }

  // Skip /api/responses (GET) — always network
  if (url.pathname.startsWith('/api/responses')) return;

  // CDN assets — cache-first
  if (CDN_ORIGINS.some(o => url.hostname.includes(o))) {
    e.respondWith(cacheFirst(request));
    return;
  }

  // App shell (/, /index.html, /m/:slug redirect) — cache-first
  if (url.origin === self.location.origin) {
    e.respondWith(cacheFirst(request));
    return;
  }
});

// Cache-first: return cache if available, else network (and cache result)
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline — resource not cached yet.', { status: 503 });
  }
}

// Cache-first but also update cache in background with latest from network
async function cacheFirstThenUpdate(request) {
  const cache  = await caches.open(CACHE);
  const cached = await cache.match(request);

  const networkFetch = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || networkFetch || new Response(
    JSON.stringify({ error: 'Offline and module not cached' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } }
  );
}
