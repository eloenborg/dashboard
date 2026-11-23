// Service worker.
//
// Online: every file is fetched from the web and checked against the server
// (a cheap "not modified" answer when nothing changed), so a new version
// appears on the next load. Offline: the last good copy is used, so the app
// still opens.
//
// The cache is named after the app version, which app code passes in the
// address (sw.js?v=3). Older caches are deleted when a new version starts.

const CACHE = 'dashboard-v' + (new URL(self.location.href).searchParams.get('v') || '0');

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Other sites (APIs, the Ask Claude relay) and one-off requests with a query
  // string (the version check) go straight to the network, never cached.
  if (url.origin !== self.location.origin || url.search) return;
  event.respondWith(networkFirst(url, req.mode === 'navigate'));
});

async function networkFirst(url, isPage) {
  try {
    const res = await fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' });
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(url.href, copy));
    }
    // Safari refuses a page answer that came through a redirect, so rebuild it.
    if (isPage && res.redirected) {
      return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
    }
    return res;
  } catch (err) {
    const hit = await caches.match(url.href);
    if (hit) return hit;
    if (isPage) {
      const home = await caches.match(new URL('./', self.location.href).href);
      if (home) return home;
    }
    return Response.error();
  }
}
