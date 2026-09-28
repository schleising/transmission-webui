var VERSION = "1.0.25";
var CACHE = "twui-" + VERSION;

self.addEventListener("install", function () {
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

function store(request, response) {
  if (!response || !response.ok) return;
  var copy = response.clone();
  caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
}

self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (!url.pathname.startsWith("/transmission/web/")) return;
  var request = cleanRequest(event.request);
  var documentRequest = event.request.mode === "navigate" || /\/transmission\/web\/(index\.html)?$/.test(url.pathname);
  if (documentRequest) {
    event.respondWith(fetch(request).then(function (response) {
      store(request, response);
      return response;
    }).catch(function () {
      return caches.match(request).then(function (hit) { return hit || caches.match("/transmission/web/"); });
    }));
    return;
  }
  event.respondWith(caches.match(request).then(function (hit) {
    return hit || fetch(request).then(function (response) {
      store(request, response);
      return response;
    });
  }));
});
