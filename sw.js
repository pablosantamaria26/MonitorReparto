const CACHE_NAME = 'monitor-reparto-v7';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
];

// ── Install: cache static assets ────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ───────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: network-first for API, cache-first for assets ─────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Let Supabase and CDN requests go through always
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('unpkg.com') ||
      url.hostname.includes('jsdelivr.net') ||
      url.hostname.includes('openstreetmap.org') ||
      url.hostname.includes('nominatim') ||
      url.hostname.includes('cartocdn.com') ||
      url.hostname.includes('basemaps')) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Cache successful responses
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── Push notifications (for future Cloudflare Worker integration) ─────────────
self.addEventListener('push', e => {
  const data = e.data?.json() ?? {};
  const title = data.title || '📦 Monitor Reparto';
  const opts = {
    body:    data.body  || '',
    icon:    '/icons/icon-192.png',
    badge:   '/icons/icon-192.png',
    tag:     data.tag   || 'reparto',
    data:    data,
    vibrate: [200, 100, 200],
    actions: data.actions || [],
    requireInteraction: data.requireInteraction || false,
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      if (clientList.length > 0) {
        return clientList[0].focus();
      }
      return clients.openWindow('./');
    })
  );
});

// ── Background sync (placeholder for offline saves) ──────────────────────────
self.addEventListener('sync', e => {
  if (e.tag === 'sync-data') {
    // Future: sync any offline-queued operations
  }
});
