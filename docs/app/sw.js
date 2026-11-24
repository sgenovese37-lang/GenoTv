/* GenoTv web app: funziona anche con connessione debole.
   L'app (pagine, stile, icone) viene dalla cache; i dati (canali, guida) prima dalla rete, poi dalla cache. */
const V = "genotv-app-1";
const SHELL = ["./", "index.html", "app.css", "app.js", "manifest.webmanifest", "icone/icona-180.png", "icone/icona-192.png", "icone/icona-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;   // video, radio e loghi: direttamente dalla rete
  if (u.pathname.includes("/data/")) {
    e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => {
    const net = fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
