// PicViewer Service Worker — PWA offline support
const CACHE_NAME = 'picviewer-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/icons/icon-192.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/picture.svg',
  '/icons/picture-folder.svg',
  '/icons/folder.svg',
  '/icons/folder-open.svg',
  '/icons/folder-list.svg',
  '/icons/house.svg',
  '/icons/menu.svg',
  '/icons/close.svg',
  '/icons/search.svg',
  '/icons/refresh.svg',
  '/icons/star.svg',
  '/icons/info.svg',
  '/icons/note.svg',
  '/icons/play.svg',
  '/icons/pause.svg',
  '/icons/download.svg',
  '/icons/video-camera.svg',
  '/icons/camera.svg',
  '/icons/grid.svg',
  '/icons/waterfall.svg',
  '/icons/list.svg',
  '/icons/all.svg',
  '/icons/go-back.svg',
  '/icons/chevron-left.svg',
  '/icons/chevron-right.svg',
  '/icons/moon.svg',
  '/icons/sun.svg',
];

// Install: cache static assets individually (avoid all-or-nothing failure)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Caching static assets');
      for (const asset of STATIC_ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn('[SW] Failed to cache:', asset, err.message);
        }
      }
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch: cache-first for static, network-first for API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests and API calls
  if (event.request.method !== 'GET') return;

  // API requests: network-first (don't cache stale data)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      })
    );
    return;
  }

  // Thumbnail/image requests: network-first with fallback
  if (url.pathname.startsWith('/api/image/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response('', { status: 503 });
      })
    );
    return;
  }

  // Static assets: cache-first with robust error handling
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((response) => {
        // Only cache successful same-origin responses (skip auth redirects)
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch((err) => {
        console.warn('[SW] Fetch failed:', url.pathname, err.message);
        return cached || new Response('', { status: 503 });
      });
      return cached || fetchPromise;
    })
  );
});
