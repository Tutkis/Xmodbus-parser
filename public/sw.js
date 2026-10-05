/**
 * Modbus Analyzer — Service Worker
 *
 * Strategy:
 *  - Navigation requests: network-first, fallback to cached index.html
 *    (so the app shell loads offline).
 *  - Static assets (_next/static/*, icons, manifest): cache-first.
 *  - Everything else: stale-while-revalidate.
 *
 * The app is a static export (output: 'export'), so all routes resolve to
 * /index.html or /<route>/index.html. We cache the app shell on install.
 *
 * VERSION is bumped on every deploy (read from build-time env) so old
 * caches are automatically cleaned up and users always get fresh code.
 */

const VERSION = 'v7';
const SHELL_CACHE = `modbus-shell-${VERSION}`;
const ASSET_CACHE = `modbus-assets-${VERSION}`;
const RUNTIME_CACHE = `modbus-runtime-${VERSION}`;

// App shell: the bare minimum to render the UI offline.
const SHELL_URLS = [
  './',
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shellCache = await caches.open(SHELL_CACHE);
      await shellCache.addAll(SHELL_URLS).catch(() => {
        // Some URLs may 404 in dev; ignore.
      });
      // Force activation immediately so the new SW takes over.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // Delete ALL old caches (any cache not matching current VERSION).
      await Promise.all(
        keys
          .filter((k) => ![SHELL_CACHE, ASSET_CACHE, RUNTIME_CACHE].includes(k))
          .map((k) => caches.delete(k)),
      );
      // Take control of all clients immediately.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Only handle same-origin requests; let cross-origin pass through.
  if (url.origin !== self.location.origin) return;

  // Navigation requests → network-first, fallback to cached shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(SHELL_CACHE);
          cache.put('./', fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cached = await caches.match('./') || await caches.match(req);
          if (cached) return cached;
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        }
      })(),
    );
    return;
  }

  // Static assets → cache-first.
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.webmanifest') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.woff2')
  ) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        try {
          const fresh = await fetch(req);
          if (fresh.ok) {
            const cache = await caches.open(ASSET_CACHE);
            cache.put(req, fresh.clone());
          }
          return fresh;
        } catch {
          return cached || new Response('', { status: 504 });
        }
      })(),
    );
    return;
  }

  // Everything else → stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      const networkPromise = fetch(req)
        .then((fresh) => {
          if (fresh.ok) {
            const cache = caches.open(RUNTIME_CACHE);
            cache.then((c) => c.put(req, fresh.clone()));
          }
          return fresh;
        })
        .catch(() => null);
      return cached || (await networkPromise) || new Response('', { status: 504 });
    })(),
  );
});

// Allow page to trigger immediate update.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
