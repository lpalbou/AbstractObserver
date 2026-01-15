// Minimal service worker (PWA shell cache).
// Note: PWA on iOS requires HTTPS (except localhost) and has platform-specific limitations.

const CACHE_NAME = "abstractobserver-pwa-v1";

function isHtmlRequest(req) {
  const accept = req.headers.get("accept") || "";
  return req.mode === "navigate" || accept.includes("text/html");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Cache only the root shell for offline fallback. Navigation requests are still network-first.
      await cache.addAll(["/"]);
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_NAME ? Promise.resolve() : caches.delete(k))));
      self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never cache API calls.
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Only handle same-origin GET requests.
  if (req.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);

      // HTML (SPA navigations): network-first so UI updates on normal refresh.
      if (isHtmlRequest(req)) {
        try {
          const resp = await fetch(req);
          if (resp && resp.status === 200) cache.put(req, resp.clone());
          return resp;
        } catch {
          return cached || (await cache.match("/")) || new Response("Offline", { status: 503 });
        }
      }

      // Other assets: stale-while-revalidate to avoid "sticky" old bundles.
      const fetchPromise = fetch(req)
        .then((resp) => {
          if (resp && resp.status === 200) cache.put(req, resp.clone());
          return resp;
        })
        .catch(() => undefined);

      if (cached) {
        event.waitUntil(fetchPromise);
        return cached;
      }

      const resp = await fetchPromise;
      return resp || new Response("Offline", { status: 503 });
    })()
  );
});

