/* =====================================================================
 * sw.js —— Service Worker（离线缓存）
 *
 * 作用：把静态资源缓存下来，让应用离线也能用、可被安装成 App。
 * 注意：Service Worker 只能在 http(s) / localhost 下注册生效，
 *       直接双击 index.html（file://）不会生效——请用本地服务器或部署后使用。
 *
 * 缓存策略：cache-first（先读缓存，读不到再联网并回填），
 *           更新缓存只需把下面的 CACHE 版本号 +1。
 * ===================================================================== */
const CACHE = 'zhuyin-v1';

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
      .then((c) => c.addAll(ASSETS))
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

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      });
    })
  );
});
