/* CACSF Admin PWA service worker. Authenticated pages and Supabase/API responses are deliberately NOT cached. */
const CACHE_NAME = "cacsf-admin-shell-v2";
const OFFLINE_URL = "./offline.html";
const SHELL = [OFFLINE_URL, "./icons/icon-192.png", "./icons/icon-512.png", "./manifest.webmanifest"];
self.addEventListener("install", event => { event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("cacsf-admin-shell-") && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", event => {
  const request=event.request, url=new URL(request.url);
  if(request.method!=="GET" || url.origin!==self.location.origin) return;
  if(request.mode==="navigate" && url.pathname.startsWith("/admin/")) {
    event.respondWith(fetch(request).catch(()=>caches.match(OFFLINE_URL).then(response=>response||Response.error()))); return;
  }
  if(url.pathname.startsWith("/admin/icons/") || url.pathname.endsWith("/manifest.webmanifest") || url.pathname.endsWith("/offline.html")) {
    event.respondWith(caches.match(request).then(cached=>cached||fetch(request)));
  }
});
