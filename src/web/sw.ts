// Service worker: versioned app-shell cache, network-first /api/state with cache fallback, Web Push display.
// Bundled by scripts/build.mjs into dist/public/sw.js (iife, no imports). __APP_VERSION__ is injected by esbuild.
declare const __APP_VERSION__: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sw = self as any;

const CACHE_PREFIX = 'mf-';
const CACHE = `${CACHE_PREFIX}${__APP_VERSION__}`;
const STATE_CACHE_KEY = '/api/state';
const PRECACHE = ['/', '/index.html', '/app.js', '/app.css', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];
const ICON = '/icon-192.png';
const FALLBACK = {
  title: 'My Finance / Tài chính của tôi',
  body: 'Open the app / Mở ứng dụng để xem',
};

sw.addEventListener('install', (event: any) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Optional assets must not fail the install (for example a missing icon or css).
      await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined)));
    })(),
  );
});

sw.addEventListener('activate', (event: any) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('message', (event: any) => {
  if (event.data && event.data.type === 'SKIP_WAITING') sw.skipWaiting();
});

async function networkFirstState(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) await cache.put(STATE_CACHE_KEY, res.clone());
    return res;
  } catch {
    const cached = await cache.match(STATE_CACHE_KEY);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
}

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok && res.type === 'basic') await cache.put(request, res.clone());
    return res;
  } catch {
    // Offline navigation: serve the app shell so the SPA can still load.
    if (request.mode === 'navigate') {
      const shell = await cache.match('/index.html');
      if (shell) return shell;
    }
    return new Response('Offline', { status: 503 });
  }
}

sw.addEventListener('fetch', (event: any) => {
  const request: Request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;

  if (url.pathname === STATE_CACHE_KEY) {
    event.respondWith(networkFirstState(request));
    return;
  }
  // Other API calls always go to the network.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  event.respondWith(cacheFirst(request));
});

async function fetchLatest(): Promise<{ locale?: string; notification: null | { kind: string; title: string; body: string; url: string } }> {
  const res = await fetch('/api/notifications/latest', { credentials: 'include' });
  if (!res.ok) throw new Error(`latest ${res.status}`);
  return res.json();
}

sw.addEventListener('push', (event: any) => {
  event.waitUntil(
    (async () => {
      let title = FALLBACK.title;
      let body = FALLBACK.body;
      let tag = 'general';
      let url = '/';
      try {
        const data = await fetchLatest();
        if (data.notification) {
          title = data.notification.title;
          body = data.notification.body;
          tag = data.notification.kind || tag;
          url = data.notification.url || url;
        }
      } catch {
        // Keep the generic text: a notification must still be shown for every push.
      }
      await sw.registration.showNotification(title, {
        body,
        icon: ICON,
        badge: ICON,
        data: { url },
        tag,
      });
    })(),
  );
});

sw.addEventListener('notificationclick', (event: any) => {
  event.notification.close();
  const url: string = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const target = new URL(url, sw.location.origin).href;
      const clients = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        if ('focus' in client) {
          try {
            if ('navigate' in client && client.url !== target) await client.navigate(target);
          } catch {
            // Navigation can be refused; focusing still brings the app forward.
          }
          return client.focus();
        }
      }
      return sw.clients.openWindow(target);
    })(),
  );
});
