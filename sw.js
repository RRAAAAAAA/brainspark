/**
 * BrainSpark Studio — Service Worker
 *
 * Offline strategy:
 *  /m/:slug          → serve cached index.html (app handles #play= in JS)
 *  /                 → cache-first
 *  /index.html       → cache-first
 *  /api/modules/:slug → cache-first, update cache in background
 *  /api/responses    → network-only (POST — SW never intercepts)
 *  CDN assets        → cache on first use
 */

const CACHE   = 'brainspark-v3';
const SHELL   = ['/index.html', '/'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Never intercept non-GET (POST responses, publish, etc.)
  if (request.method !== 'GET') return;

  // /m/:slug  — offline-friendly: serve index.html, let app JS handle #play=
  // The app already sets location.hash when online; offline we just need the shell.
  if (/^\/m\/[a-f0-9]{6,16}$/.test(url.pathname)) {
    e.respondWith(
      caches.match('/index.html').then(cached => {
        if (cached) return cached;
        // Not cached yet — try network
        return fetch(request).catch(() =>
          new Response('<h2>No internet connection</h2><p>Please open this link once while online so BrainSpark can save it for offline use.</p>',
            { status: 503, headers: { 'Content-Type': 'text/html' } })
        );
      })
    );
    return;
  }

  // /api/modules/:slug — cache-first, refresh in background
  if (/^\/api\/modules\/[a-f0-9]{6,16}$/.test(url.pathname)) {
    e.respondWith(cacheFirstUpdate(request));
    return;
  }

  // Skip /api/responses GET (always needs network for live data)
  if (url.pathname.startsWith('/api/responses')) return;

  // CDN assets (fonts, scripts) — cache on first use
  const CDN = ['fonts.googleapis.com','fonts.gstatic.com','cdnjs.cloudflare.com'];
  if (CDN.some(d => url.hostname.includes(d))) {
    e.respondWith(cacheFirst(request));
    return;
  }

  // App shell
  if (url.origin === self.location.origin) {
    e.respondWith(cacheFirst(request));
  }
});

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) {
      const c = await caches.open(CACHE);
      c.put(req, res.clone());
    }
    return res;
  } catch {
    return new Response('Offline — not cached yet.', { status: 503 });
  }
}

async function cacheFirstUpdate(req) {
  const cache  = await caches.open(CACHE);
  const cached = await cache.match(req);
  // Always try to refresh in background
  const fresh = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached || fresh || new Response(
    JSON.stringify({ error: 'Module not available offline' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } }
  );
}
