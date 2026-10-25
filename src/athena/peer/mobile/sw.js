// The phone page's service worker (ADR 0140, WP4). It registers only in a secure context (app.js
// checks `isSecureContext`), which the plain-http overlay address is not; it is here for the day
// the page is served over HTTPS. It caches the shell - never an API answer - so a phone that
// cannot reach the beacon still opens the page, which then says the beacon is asleep.

const SHELL = "athena-shell-v2";
// Every name phone.py FILES serves but this worker itself (tests/peer/test_phone.py holds it).
const FILES = ["./", "index.html", "app.js", "turn.js", "app.css", "manifest.webmanifest", "icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Only the shell, only GET, only this origin. /peer/* always goes to the network.
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith("/m/")) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match("index.html"))),
  );
});
