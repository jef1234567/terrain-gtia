/* Service worker : permet d'installer l'application et d'ouvrir les outils sans réseau (le fond de carte, lui, demande une connexion).
   Pages et scripts du site : réseau d'abord (les mises à jour arrivent), copie locale en secours.
   La bibliothèque de carte est dans le dépôt (lib/) : plus de dépendance à unpkg.com. */
const VERSION = "v6";
const CACHE = "terrain-gtia-" + VERSION;
const LOCAL = ["app.html", "index.html", "ennemi-prepa.html", "ennemi-conduite.html", "ennemi.html", "moteur-terrain.js", "commun.js", "lib/maplibre-gl.js", "lib/maplibre-gl.css", "terrain-demo.json", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await Promise.all(LOCAL.map(u => c.add(u).catch(() => {})));
  }).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("terrain-gtia-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (u.origin === location.origin) {
    e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); } return res; })
      .catch(() => caches.match(r, {ignoreSearch:true}).then(m => m || caches.match("app.html"))));
  }
});
