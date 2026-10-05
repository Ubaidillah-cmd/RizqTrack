/* RizqTrack service worker – bikin app bisa dipasang & jalan offline.
   Ganti angka VERSION setiap kali kamu mengubah file app supaya cache diperbarui. */
const VERSION = 'v1.5.0';
const CACHE = 'rizqtrack-' + VERSION;

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png'
];

// Library CDN yang dipakai app (di-cache supaya grafik & export tetap jalan offline)
const CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_SHELL);
    // CDN dicoba satu-satu; kalau gagal (offline) tidak menggagalkan instalasi
    await Promise.all(CDN.map(url =>
      fetch(url, { mode: 'no-cors' }).then(res => cache.put(url, res)).catch(() => {})
    ));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => (k.startsWith('rizqtrack-') || k.startsWith('duittrack-')) && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// File milik app (same-origin): coba jaringan dulu supaya pull-to-refresh mendapat versi terbaru,
// kalau offline / lambat (>4 dtk) pakai cache. File luar (CDN, font): cache dulu, update di belakang layar.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!['http:', 'https:'].includes(url.protocol)) return;
  if (url.pathname.endsWith('.apk')) return;      // file APK dibiarkan lewat jaringan, tidak di-cache
  event.respondWith(url.origin === self.location.origin ? networkFirst(req) : staleWhileRevalidate(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const fromNet = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  });
  try {
    return await Promise.race([
      fromNet,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
    ]);
  } catch (err) {
    const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (cached) return cached;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return fromNet.catch(() => Response.error());
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const network = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (cached) return cached;
  return (await network) || Response.error();
}
