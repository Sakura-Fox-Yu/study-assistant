/* =====================================================================
 * sw.js —— Service Worker（离线缓存）
 *
 * 作用：把静态资源缓存下来，让应用离线也能用、可被安装成 App。
 * 注意：Service Worker 只能在 http(s) / localhost 下注册生效，
 *       直接双击 index.html（file://）不会生效——请用本地服务器或部署后使用。
 *
 * 缓存策略：cache-first（先读缓存，读不到再联网并回填），
 *           更新缓存只需把下面的 CACHE 版本号 +1。
 *
 * 【修复】
 *   1. install 用 Promise.all + 单条容错，避免某个资源 404 导致整个 SW 装不上。
 *   2. fetch 只缓存同源、res.ok 的正常响应，不再把 opaque / 错误响应写进缓存
 *      （旧版会把任何 GET 响应 put 进 cache，形成缓存投毒面）。
 *   3. 导航请求改为 network-first：保证用户能拿到新版 index.html，不会被
 *      cache-first 永久锁死在旧版本。
 * ===================================================================== */
const CACHE = 'zhuyin-v2';

const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/config.js',
  './js/audio.js',
  './js/storage.js',
  './js/timer.js',
  './js/app.js',
  './manifest.json',
  './icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // 【修复】逐条添加并忽略单条失败，避免一个 404 拖垮整个安装
      .then((c) => Promise.all(
        ASSETS.map((url) => c.add(url).catch(() => null))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 只缓存「同源 + 成功 + 基本类型」的响应
function isCacheable(req, res) {
  if (!res || !res.ok) return false;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return false; // 不缓存跨域
  if (res.type !== 'basic' && res.type !== 'default') return false;
  return true;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // 【修复】页面导航用 network-first，保证能拿到新版本
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (isCacheable(req, res)) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // 其余静态资源：cache-first
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (isCacheable(req, res)) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
