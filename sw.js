const CACHE_VERSION = "v2";
const CACHE_NAME = `diet-with-friend-${CACHE_VERSION}`;

// version-pinned Firebase SDK URLs (immutable — safe to cache-first)
const FIREBASE_SDK_URLS = [
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js",
];

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/mood-tired.png",
  "./assets/mood-stuffed.png",
  "./assets/mood-happy.png",
  "./assets/mood-failed.png",
  "./assets/praise.png",
  "./assets/cheer.png",
  ...FIREBASE_SDK_URLS,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  const isFirebaseSdk = FIREBASE_SDK_URLS.includes(request.url);

  if (url.origin !== self.location.origin && !isFirebaseSdk) return; // let Firestore/Google/font requests hit the network directly

  const isStaticAsset = isFirebaseSdk || /\.(?:png|jpg|jpeg|svg|ico|webp)$/.test(url.pathname);

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        });
      })
    );
    return;
  }

  // network-first for html/css/js so updates roll out quickly, falling back to cache offline
  event.respondWith(
    fetch(request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
  );
});
