/* Practice Pad service worker.
   - App shell: precached at install, served network-first (so a reopen picks up updates) with cache fallback (offline).
   - OCR engine + language data: cached the first time they're fetched, then served cache-first.
   - Android share target: receives the shared image, stores it, and opens ./?shared=1 */
importScripts("version.js");
const VERSION = self.PP_VERSION;
const SHELL = "pp-shell-" + VERSION;
const RUNTIME = "pp-runtime-v1"; // OCR files rarely change; kept across app versions
const SHELL_FILES = ["./", "index.html", "styles.css", "app.js", "ocr.js", "version.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png",
  "fonts/barlow-latin-400-normal.woff2", "fonts/barlow-latin-500-normal.woff2", "fonts/barlow-latin-600-normal.woff2",
  "fonts/barlow-condensed-latin-500-normal.woff2", "fonts/barlow-condensed-latin-600-normal.woff2", "fonts/barlow-condensed-latin-700-normal.woff2"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("pp-shell-") && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.method === "POST" && url.pathname.endsWith("/share-target")) {
    e.respondWith((async () => {
      try {
        const form = await req.formData();
        const file = form.get("image") || [...form.values()].find(v => v instanceof File);
        if (file) {
          const c = await caches.open("pp-share");
          await c.put("shared-image", new Response(file, { headers: { "Content-Type": file.type || "image/png" } }));
        }
      } catch (err) { /* fall through to the app */ }
      return Response.redirect(new URL("./?shared=1", self.registration.scope).href, 303);
    })());
    return;
  }
  if (req.method !== "GET") return;

  if (url.pathname.includes("/vendor/")) {
    e.respondWith(caches.open(RUNTIME).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // Shell: network first with a short timeout, then cache.
  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    try {
      const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000))]);
      if (res.ok && res.type === "basic") cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === "navigate" && await cache.match("./"));
      return hit || Response.error();
    }
  })());
});
