/**
 * Basic offline shell + runtime cache for signed audio URLs (short TTL — best-effort).
 * Safari PWA: may evict aggressively; regenerate signed URLs when online.
 */
const CACHE_SHELL = "nihon-shell-v1";
const CACHE_AUDIO = "nihon-audio-v1";

const SHELL = ["./", "./index.html", "./css/styles.css", "./js/config.js", "./js/app.js", "./manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_SHELL).then((cache) => cache.addAll(SHELL)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.pathname.endsWith(".mp3") || url.search.includes("token=")) {
    event.respondWith(
      caches.open(CACHE_AUDIO).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch (e) {
          return hit || Promise.reject(e);
        }
      }),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (req.mode === "navigate" && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_SHELL).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match("./index.html"));
    }),
  );
});
