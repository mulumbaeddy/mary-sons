// INV SYSTEM service worker: keeps the app files available offline. Database calls (Supabase) are never cached here.
const CACHE = 'inv-system-v5';
const SHELL = ['./', 'index.html', 'css/styles.css', 'config.js', 'pwa.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/main.js', 'js/api.js', 'js/offline.js', 'js/store.js', 'js/ui.js', 'js/icons.js', 'js/payment-modal.js', 'js/supabase.js', 'js/utils.js', 'js/lineitems.js',
  'js/pages/dashboard.js', 'js/pages/sales.js', 'js/pages/products.js', 'js/pages/purchases.js', 'js/pages/payments.js', 'js/pages/expenses.js', 'js/pages/reports.js'];
const CDN = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await Promise.all(SHELL.map((u) => c.add(u).catch(() => {})));
    const req = new Request('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4', { mode: 'no-cors' });
    await fetch(req).then((res) => c.put(req, res)).catch(() => {});
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((n) => n !== CACHE).map((n) => caches.delete(n)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET') return;
  const sameOrigin = u.origin === location.origin;
  if (!sameOrigin && !CDN.includes(u.hostname)) return;             // Supabase etc. go straight to the network
  const fromCache = () => caches.match(r, { ignoreSearch: true }).then((m) => m || (r.mode === 'navigate' ? caches.match('index.html') : undefined));
  const network = fetch(r).then((res) => { if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)); } return res; });
  // Fresh from the network when it answers within 4 seconds, otherwise the saved copy (works offline and on weak signal).
  e.respondWith(Promise.race([network, new Promise((_, rej) => setTimeout(rej, 4000))]).catch(() => fromCache().then((m) => m || network)));
});
