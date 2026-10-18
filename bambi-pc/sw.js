/* Bambi Vocab Service Worker
 * - 核心文件（页面/样式/脚本/词库数据）：stale-while-revalidate
 *   先返回缓存秒开，后台联网更新，下次打开生效 → 离线可用 & 部署新版本后能拿到更新
 * - media/*.mp3 内容不变：缓存优先；支持页面发消息一次性缓存全部音频
 */
const CORE_CACHE = 'bambi-core-v2';
const MEDIA_CACHE = 'bambi-media-v1';

const CORE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/data.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CORE_CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => ![CORE_CACHE, MEDIA_CACHE].includes(k))
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.includes('/media/')) {
    // 音频：缓存优先，未命中则联网并写入缓存
    e.respondWith(
      caches.open(MEDIA_CACHE).then(cache =>
        cache.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
          if (resp.ok) cache.put(e.request, resp.clone());
          return resp;
        }))
      )
    );
    return;
  }

  // 其余：stale-while-revalidate
  e.respondWith(
    caches.open(CORE_CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        const refreshing = fetch(e.request).then(resp => {
          if (resp.ok) cache.put(e.request, resp.clone());
          return resp;
        }).catch(() => cached || caches.match('./index.html'));
        return cached || refreshing;
      })
    )
  );
});

/* 页面请求：一次性缓存全部音频（离线畅听） */
self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'CACHE_ALL_MEDIA') return;
  const port = e.ports[0];
  const files = e.data.files || [];
  e.waitUntil((async () => {
    const cache = await caches.open(MEDIA_CACHE);
    let done = 0, failed = 0;
    const CHUNK = 8;
    for (let i = 0; i < files.length; i += CHUNK) {
      await Promise.all(files.slice(i, i + CHUNK).map(async f => {
        const req = new Request('./media/' + f);
        if (await cache.match(req)) { done++; return; }
        try {
          const resp = await fetch(req);
          if (resp.ok) { await cache.put(req, resp); done++; }
          else failed++;
        } catch { failed++; }
      }));
      if (port) port.postMessage({ done, failed, total: files.length });
    }
    if (port) port.postMessage({ finished: true, done, failed, total: files.length });
  })());
});
