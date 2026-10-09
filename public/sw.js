// PCMPC meter-reading app service worker (PHASE-06 T6.4).
// Only the reading app is handled: /read (network first, falls back to the last copy when there
// is no signal) and Next's static assets (cache first; their file names change with every build).
// Readings themselves are queued in IndexedDB by the page and synced when the signal returns.

const CACHE = "pcmpc-reader-v1";
const PAGE = "/read";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(["/manifest.webmanifest", "/reader-icon.svg"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("pcmpc-reader-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate" && url.pathname === PAGE) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(PAGE, copy));
          }
          return res;
        })
        .catch(() => caches.match(PAGE).then((hit) => hit || new Response("Offline: open the reading app once with signal first.", { status: 503, headers: { "content-type": "text/plain" } }))),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/manifest.webmanifest" || url.pathname === "/reader-icon.svg") {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
