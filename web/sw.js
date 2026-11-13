// RELAY service worker: makes the app installable and lets the shell open offline.
// Only RELAY's own files and the pinned CDN libraries are cached. Stellar network
// calls (Horizon, friendbot, prices) always go to the network, so balances are never stale.
const VERSION = 'relay-v2';
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/relay.js',
  './js/i18n.js',
  './manifest.webmanifest',
  './assets/logo.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/pattern.svg',
  './assets/amma.svg',
  './assets/phone.svg',
  './assets/scattered.svg',
  './assets/alone.svg',
  './assets/hidden.svg',
  './assets/use-medicine.svg',
  './assets/use-hospital.svg',
  './assets/use-groceries.svg',
  './assets/use-home.svg',
  'https://cdn.jsdelivr.net/npm/@stellar/stellar-sdk@13.3.0/dist/stellar-sdk.min.js',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const own = url.origin === self.location.origin;
  const cdn = url.hostname === 'cdn.jsdelivr.net' || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com');
  if (!own && !cdn) return; // Stellar, friendbot, prices: network only.
  // Own files: network first (so updates show up), cache as fallback offline.
  if (own) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
    );
    return;
  }
  // Pinned CDN files never change: cache first.
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
    const copy = res.clone();
    caches.open(VERSION).then((c) => c.put(e.request, copy));
    return res;
  })));
});
