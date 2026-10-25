/*
 * ReliefRelay service worker.
 *
 * Scope, deliberately narrow:
 *   * caches the interface shell so the app opens on a poor connection;
 *   * serves a cached shell when a navigation fails;
 *   * never caches an API response, because a stale shelter capacity or
 *     request status read as current would be worse than no answer at all;
 *   * never queues or sends a request. Submissions are queued in the page's
 *     own outbox (src/lib/client/outbox.ts), where the user can see their
 *     state and retry them, and where "not yet sent" means exactly that.
 *
 * The app is NOT fully offline-capable and this file does not pretend
 * otherwise. Speech recognition needs the network; so does submitting.
 */

const CACHE = 'reliefrelay-shell-v1';
const SHELL = ['/', '/ask', '/ask/form', '/find', '/offline', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // A missing entry must not fail the whole install.
      Promise.allSettled(SHELL.map((path) => cache.add(new Request(path, { cache: 'reload' })))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache data. A cached request status or capacity figure would be
  // presented as current, and that is the one thing this app must not do.
  if (url.pathname.startsWith('/api/')) return;

  // Private tracking pages are never cached either.
  if (url.pathname.startsWith('/track/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match('/offline');
          return offline ?? new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } });
        }),
    );
    return;
  }

  // Static assets: cache first, then network.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && (url.pathname.startsWith('/_next/static/') || SHELL.includes(url.pathname))) {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
