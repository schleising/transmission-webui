var VERSION = "0.0.2";
var CACHE = "twui-" + VERSION;
var SHELL = [
  "/transmission/web/",
  "/transmission/web/index.html?v0.0.2",
  "/transmission/web/app.css?v0.0.2",
  "/transmission/web/boot.js?v0.0.2",
  "/transmission/web/format.js?v0.0.2",
  "/transmission/web/rpc.js?v0.0.2",
  "/transmission/web/app.js?v0.0.2",
  "/transmission/web/manifest.webmanifest?v0.0.2",
  "/transmission/web/icons/favicon.svg?v0.0.2",
  "/transmission/web/icons/icon-192.png?v0.0.2",
  "/transmission/web/icons/icon-512.png?v0.0.2",
  "/transmission/web/icons/icon-maskable-512.png?v0.0.2"
];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) { return key !== CACHE; }).map(function (key) { return caches.delete(key); }));
  }));
  self.clients.claim();
});

function cleanRequest(request) {
  var url = new URL(request.url);
  if (!url.username && !url.password) return request;
  url.username = "";
  url.password = "";
  return new Request(url.href, request);
}

self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (!url.pathname.startsWith("/transmission/web/")) return;
  var request = cleanRequest(event.request);
  var documentRequest = event.request.mode === "navigate" || /\/transmission\/web\/(index\.html)?$/.test(url.pathname);
  if (documentRequest) {
    event.respondWith(fetch(request).then(function (response) {
      var copy = response.clone();
      caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
      return response;
    }).catch(function () {
      return caches.match(request).then(function (hit) { return hit || caches.match("/transmission/web/"); });
    }));
    return;
  }
  event.respondWith(caches.match(request).then(function (hit) {
    return hit || fetch(request).then(function (response) {
      if (response.ok) {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
      }
      return response;
    });
  }));
});
