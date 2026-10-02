// PicViewer Service Worker — PWA offline support
//
// ⚠️ 这是「模板」，不是最终产物。
// `client/vite-plugin-sw-version.js` 会在构建时替换下面两个占位符
// （分别是构建指纹和预缓存清单），把结果写到 client/dist/sw.js，
// 由服务器按 /sw.js 提供。开发环境（vite dev）下这个文件带占位符、不可用 ——
// 所以只在 production 注册 SW（见 src/pwa.js）。
//
// 注意：下面的注释里不要直接写出占位符名字，否则构建时会被一并替换掉。
//
// 缓存策略分层：
//   /api/*      → 网络优先（不缓存业务数据）
//   导航请求     → 网络优先，离线回退缓存（保证每次打开都拿到最新 HTML）
//   /assets/*   → 缓存优先（文件名带内容 hash，不可变）
//   其它同源 GET → 缓存优先 + 后台刷新（图标等）
const CACHE_NAME = 'picviewer-__SW_BUILD__';
const STATIC_ASSETS = __SW_PRECACHE__;

/** 构建产物文件名含内容 hash，永不变，可以放心缓存优先 */
function isImmutable(pathname) {
  return pathname.startsWith('/assets/');
}

function shouldCache(response) {
  return !!response && response.status === 200 && response.type === 'basic';
}

function putInCache(request, response) {
  const clone = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
}

// Install: 预缓存构建产物。
// CACHE_NAME 里带了构建指纹 —— 每次发布都是「新 sw.js + 新缓存名」，
// 浏览器才能可靠地检测到更新（旧版本写死 picviewer-v2，所以永远检测不到）。
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Precache', STATIC_ASSETS.length, 'assets @', CACHE_NAME);
      // 逐个缓存：单个资源失败（比如离线）不影响整体安装
      await Promise.all(
        STATIC_ASSETS.map((asset) =>
          cache.add(asset).catch((err) => console.warn('[SW] Precache failed:', asset, err.message))
        )
      );
    })
  );
  // 立即接管。本应用没有动态 import，旧页面不会再去请求已被清理的 chunk，
  // 所以这里不必等用户关闭页面。
  self.skipWaiting();
});

// Activate: 清掉所有旧版本缓存。
// 旧版本因为 CACHE_NAME 不变，这段代码从来没真正生效过。
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log('[SW] Deleting stale cache:', key);
            return caches.delete(key);
          })
      );
      await self.clients.claim();
    })()
  );
});

// 页面可以要求一个 waiting 中的新版本立即接管（applyUpdate 的兜底路径）
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Fetch
self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 跨域请求交给浏览器默认处理，不介入
  if (url.origin !== self.location.origin) return;

  // API：网络优先，绝不返回过期数据
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(JSON.stringify({ error: 'offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );
    return;
  }

  // 导航请求：网络优先。
  // 这是「PC 要刷两次 / 手机永远不更新」的根因所在 —— 以前这里是缓存优先，
  // 于是永远返回缓存里的旧 index.html，进而加载旧的 index-xxxx.js。
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (shouldCache(response)) putInCache(request, response);
          return response;
        })
        .catch(async () => {
          return (
            (await caches.match(request)) ||
            (await caches.match('/index.html')) ||
            (await caches.match('/')) ||
            new Response('', { status: 503 })
          );
        })
    );
    return;
  }

  // 带 hash 的构建产物：缓存优先（不可变，不可能过期）
  if (isImmutable(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (shouldCache(response)) putInCache(request, response);
          return response;
        });
      })
    );
    return;
  }

  // 其它同源 GET（图标等）：缓存优先 + 后台刷新
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (shouldCache(response)) putInCache(request, response);
          return response;
        })
        .catch((err) => {
          console.warn('[SW] Fetch failed:', url.pathname, err.message);
          return cached || new Response('', { status: 503 });
        });
      return cached || network;
    })
  );
});
