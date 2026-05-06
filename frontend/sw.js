/**
 * Offline shell + audio cache. App JS is network-first. MP3 is also network-first
 * so replaced Storage objects (same URL) are not stuck behind an old Service Worker cache.
 */
const CACHE_SHELL = "nihon-shell-v12";
const CACHE_AUDIO = "nihon-audio-v2";
const SHELL = ["./", "./index.html", "./css/styles.css", "./manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_SHELL).then((cache) => cache.addAll(SHELL)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== CACHE_SHELL && k !== CACHE_AUDIO)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const path = url.pathname;

  // Always try network first for app JS so PIN/config stay in sync with HTML after deploy.
  if (path.endsWith(".js") || path.includes("/js/")) {
    event.respondWith(
      fetch(req, { cache: "no-cache" })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_SHELL).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req)),
    );
    return;
  }

  // MP3: network-first. Storage URLs stay the same when file is replaced in-place
  // (e.g. loudness normalize), so cache-first would forever replay an old quiet clip.
  if (path.endsWith(".mp3") || url.search.includes("token=")) {
    event.respondWith(
      caches.open(CACHE_AUDIO).then(async (cache) => {
        try {
          const res = await fetch(req, { cache: "no-store" });
          if (res.ok) {
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        } catch {
          const hit = await cache.match(req);
          if (hit) return hit;
          return new Response("", { status: 503 });
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
            caches.open(CACHE_SHELL).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match("./index.html"));
    }),
  );
});
