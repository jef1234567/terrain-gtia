"use strict";
/* Données du terrain (outil Terrain, index.html) : relief (tuiles Terrarium), OpenStreetMap (Overpass : serveurs, files, délais, replis, cache des tuiles),
   faits bruts (rastérisation, voies, barrières), masque mer / trait de côte, pentes.
   Script classique chargé avant le script principal d'index.html : même portée globale. */
/* ---------- relief (tuiles Terrarium) ---------- */
const DZ = 12;
function gpx(lon, lat){
 const n = 256 * 2 ** DZ, r = lat*Math.PI/180;
 return [(lon+180)/360*n, (1 - Math.log(Math.tan(r) + 1/Math.cos(r))/Math.PI)/2*n];
}
function loadTile(x, y){
 return new Promise((res, rej) => {
  const im = new Image(); im.crossOrigin = "anonymous";
  im.onload = () => { const c = document.createElement("canvas"); c.width = c.height = 256;
   const g = c.getContext("2d"); g.drawImage(im, 0, 0); res(g.getImageData(0,0,256,256).data); };
  const to = setTimeout(() => { im.src = ""; rej(new Error("tuile de relief " + x + "/" + y + " : pas de réponse en 30 s")); }, 30000);
  im.onerror = () => { clearTimeout(to); rej(new Error("tuile de relief " + x + "/" + y + " refusée ou injoignable")); };
  const ok = im.onload; im.onload = () => { clearTimeout(to); ok(); };
  im.src = TERR.replace("{z}", DZ).replace("{x}", x).replace("{y}", y);
 });
}
async function loadDEM(b, prog){
 const [x0, y0] = gpx(b.w, b.n), [x1, y1] = gpx(b.e, b.s);
 const tiles = new Map(), list = [];
 for (let tx = Math.floor(x0/256)-1; tx <= Math.floor(x1/256)+1; tx++)
  for (let ty = Math.floor(y0/256)-1; ty <= Math.floor(y1/256)+1; ty++) list.push([tx, ty]);
 let next = 0, done = 0, failed = null;
 const worker = async () => {                       // 8 téléchargements simultanés au plus, 3 essais par tuile
  while (next < list.length && !failed) {
   const [tx, ty] = list[next++]; let d = null, e0;
   for (let a = 0; a < 3 && !d; a++) { arretSi(); try { d = await loadTile(tx, ty); } catch(e) { e0 = e; await pause(2000*(a+1)); } }
   if (!d) { failed = new Error("relief indisponible (" + e0.message + ", 3 essais). Vérifier la connexion puis « Reprendre »"); throw failed; }
   tiles.set(tx + "," + ty, d); done++; if (prog) prog(done, list.length);
  }
 };
 await Promise.all(Array.from({length:Math.min(8, list.length)}, worker));
 const px = (xi, yi) => { const d = tiles.get(Math.floor(xi/256) + "," + Math.floor(yi/256)); if (!d) return NaN;
  const k = ((yi & 255)*256 + (xi & 255))*4; return d[k]*256 + d[k+1] + d[k+2]/256 - 32768; };
 return (lon, lat) => { let [x, y] = gpx(lon, lat); x -= 0.5; y -= 0.5;
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  return px(xi,yi)*(1-fx)*(1-fy) + px(xi+1,yi)*fx*(1-fy) + px(xi,yi+1)*(1-fx)*fy + px(xi+1,yi+1)*fx*fy; };
}

/* ---------- OpenStreetMap (Overpass) ---------- */
/* Serveurs Overpass (publics, tenus par des bénévoles), dans l'ordre mesuré le 10/11/2026 sur une tuile de 10 km :
   Europe 6 s, principal 36 s, private.coffee (ex-kumi.systems) sans réponse en 75 s.
   Le serveur Europe (extrait Geofabrik, mis à jour chaque nuit, 4 requêtes simultanées admises) ne sert que si la zone est en Europe.
   Le serveur principal interdit les requêtes en parallèle et demande 30 s de pause après un refus (429 / 406).
   Volontairement absent : maps.mail.ru (VK, Russie), chaque requête montrant la zone analysée au serveur. */
const OVERPASS = [
 {nom:"Europe", u:"https://ovp.dresel.systems/api/interpreter", par:2, zone:b => b.s > 34 && b.n < 72 && b.w > -25 && b.e < 45, videSuspect:true},
 {nom:"principal", u:"https://overpass-api.de/api/interpreter", par:1},
 {nom:"private.coffee", u:"https://overpass.private.coffee/api/interpreter", par:1}
];
const OVP_DELAIS = [45, 75, 100];   // secondes d'attente par requête, selon le tour
const OVP_PAUSES = {refus:30000, tour:10000};   // pause après un refus du serveur ; pause entre deux tours (×1, ×2)
// echecs : échecs de suite par serveur (deux de suite = serveur essayé en dernier), remis à zéro au début de chaque analyse
const OVP = {echecs:{}, file:new Map(), etat:"", avert:[]};
function ovpRaz(){ OVP.echecs = {}; OVP.avert = []; OVP.etat = ""; }
// une requête à la fois sur les serveurs qui l'exigent
function chacunSonTour(srv, fn){
 if (srv.par > 1) return fn();
 const p = (OVP.file.get(srv.u) || Promise.resolve()).then(fn);
 OVP.file.set(srv.u, p.catch(() => {}));
 return p;
}
const OSM_VER = "q2"; // à changer si la requête change : invalide le cache des tuiles
const OSM_FILTRES = `way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|track)$"];
way["railway"~"^(rail|light_rail|narrow_gauge)$"];
way["waterway"~"^(river|canal|stream|ditch|drain|riverbank)$"];
way["barrier"="hedge"];
way["natural"="coastline"];
way["natural"~"^(water|wood|wetland|grassland)$"];
way["landuse"~"^(forest|residential|industrial|commercial|retail|vineyard|orchard|reservoir|basin|meadow)$"];
relation["natural"~"^(water|wood|wetland|grassland)$"];
relation["waterway"="riverbank"];
relation["landuse"~"^(forest|residential|industrial|commercial|vineyard|orchard|reservoir|meadow)$"];
node["highway"="motorway_junction"];
node["railway"="level_crossing"];
node["ford"="yes"];
`;
const osmQuery = bb => `[out:json][timeout:90][maxsize:536870912][bbox:${bb}];(   // demande modeste : mieux acceptée par un serveur chargé
${OSM_FILTRES});out geom;`;
// requête de contrôle légère : mêmes objets, mais seulement leur nombre (quelques octets en retour)
const osmControle = bb => `[out:json][timeout:30][bbox:${bb}];(
${OSM_FILTRES});out count;`;
const bbStr = b => [b.s, b.w, b.n, b.e].map(v => v.toFixed(5)).join(",");
// erreur réseau ou serveur, en clair
function texteErreur(e, delai){
 if (e && e.name === "AbortError") return "pas de réponse en " + delai + " s";
 if (e instanceof TypeError) return typeof navigator !== "undefined" && navigator.onLine === false ? "pas de connexion réseau" : "serveur injoignable (réseau coupé, filtré ou serveur arrêté)";
 if (e instanceof SyntaxError) return "réponse illisible (page d'erreur au lieu des données)";
 return e && e.message || String(e);
}
const texteHTTP = st => st === 429 ? "trop de demandes, serveur saturé (HTTP 429)" : st === 504 ? "serveur saturé, délai dépassé (HTTP 504)"
 : st === 406 || st === 400 ? "demande refusée (HTTP " + st + ")" : st === 403 ? "accès refusé (HTTP 403, réseau filtré ?)" : st >= 500 ? "panne du serveur (HTTP " + st + ")" : "HTTP " + st;
// attente interrompue par le bouton « Arrêter » ou par l'arrêt du téléchargement (signal local)
const attendre = (ms, sig) => new Promise(res => { let t = 0; const fin = () => { clearTimeout(t); if (ABORT) ABORT.signal.removeEventListener("abort", fin); if (sig) sig.removeEventListener("abort", fin); res(); }; t = setTimeout(fin, ms);
 if (ABORT) ABORT.signal.addEventListener("abort", fin, {once:true}); if (sig) sig.addEventListener("abort", fin, {once:true}); });
// envoi d'une requête à un serveur : file d'attente, délai, arrêt ; renvoie les éléments ; info.refus = le serveur demande une pause
function ovpEnvoi(srv, q, delai, info, sig){
 return chacunSonTour(srv, async () => {
  arretSi(); if (sig && sig.aborted) throw new Error("téléchargement interrompu");
  const ac = new AbortController(), to = setTimeout(() => ac.abort(), delai*1000), stop = () => ac.abort();
  if (ABORT) ABORT.signal.addEventListener("abort", stop); if (sig) sig.addEventListener("abort", stop);
  OVP.etat = "serveur " + srv.nom;
  try {
   const r = await fetch(srv.u, {signal:ac.signal, method:"POST", body:"data=" + encodeURIComponent(q), headers:{"Content-Type":"application/x-www-form-urlencoded"}});
   if (r.status === 429 || r.status === 406) info.refus = true;
   if (!r.ok) throw new Error(texteHTTP(r.status));
   const j = await r.json();
   if (j.remark && /error|timed out|memory/i.test(j.remark)) throw new Error("réponse incomplète (" + j.remark.slice(0, 80) + ")");
   return j.elements || [];
  } catch(e) { throw new Error(texteErreur(e, delai)); }
  finally { clearTimeout(to); if (ABORT) ABORT.signal.removeEventListener("abort", stop); if (sig) sig.removeEventListener("abort", stop); }
 });
}
/* une requête Overpass : serveurs dans l'ordre, trois tours, pause croissante entre les tours ; une réponse tronquée (remark) est un échec.
   Réponse vide d'un serveur « videSuspect » (Europe : extrait régional, vide hors de sa couverture) : ce n'est pas un échec,
   mais elle est vérifiée par une requête de contrôle légère (nombre d'objets) sur le serveur suivant.
   Contrôle nul = tuile réellement vide (mer, zone sans objet), acceptée sans pénaliser personne ; contrôle non nul = le serveur suspect
   s'est trompé (échec compté) et la tuile complète est demandée au serveur qui a répondu.
   Si aucun autre serveur ne peut confirmer, la réponse vide est gardée à la fin des tours, avec un avertissement. */
async function overpass(q, onRetry, bbox, opt){
 opt = opt || {}; const sig = opt.signal, tuile = opt.tuile || "", dern = new Map();
 const verif = () => { arretSi(); if (sig && sig.aborted) throw new Error("téléchargement interrompu"); };
 let vide = null, last = null;
 for (let tour = 0; tour < OVP_DELAIS.length; tour++) {
  // serveurs utilisables pour cette zone, ceux qui viennent d'échouer en dernier
  const rang = v => (OVP.echecs[v.u] || 0) >= 2 ? OVP.echecs[v.u] : 0;
  const liste = OVERPASS.filter(v => !v.zone || !bbox || v.zone(bbox)).sort((x, y) => rang(x) - rang(y));   // un échec isolé ne change pas l'ordre, deux de suite si
  for (const srv of liste) {
   if (srv === vide) continue;                    // il a déjà répondu (vide) : on attend la confirmation d'un autre
   verif();
   const delai = OVP_DELAIS[tour], info = {};
   try {
    if (vide && bbox) {
     OVP.etat = "tuile vide d'après le serveur " + vide.nom + " : contrôle auprès du serveur " + srv.nom;
     const c = await ovpEnvoi(srv, osmControle(bbStr(bbox)), Math.min(delai, 45), info, sig), t = c[0] && c[0].tags;
     const nb = t ? +t.total || 0 : c.length;
     OVP.echecs[srv.u] = 0;
     if (!nb) { OVP.echecs[vide.u] = 0; return []; }      // vide confirmé : personne n'a échoué
     OVP.echecs[vide.u] = (OVP.echecs[vide.u] || 0) + 1;  // le serveur suspect s'est trompé
     dern.set(vide.nom, "réponse vide alors que la tuile contient " + nb + " objets");
     if (onRetry) onRetry(new Error("serveur " + vide.nom + " : réponse vide à tort (" + nb + " objets ailleurs), tuile demandée au serveur " + srv.nom));
     vide = null; verif();
    }
    const els = await ovpEnvoi(srv, q, delai, info, sig);
    if (!els.length && srv.videSuspect && bbox) { vide = srv; continue; }   // à confirmer par le serveur suivant
    OVP.echecs[srv.u] = 0;
    return els;
   } catch(e) {
    verif();
    OVP.echecs[srv.u] = (OVP.echecs[srv.u] || 0) + 1;
    dern.set(srv.nom, e.message);
    last = new Error("serveur " + srv.nom + " : " + e.message);
    if (onRetry) onRetry(last);
    if (info.refus) { OVP.etat = "pause de " + OVP_PAUSES.refus/1000 + " s demandée par le serveur " + srv.nom; await attendre(OVP_PAUSES.refus, sig); }
   }
  }
  if (tour < OVP_DELAIS.length - 1) { const ms = OVP_PAUSES.tour*(tour + 1); OVP.etat = (vide ? "confirmation de la tuile vide impossible" : "tous les serveurs ont échoué") + ", nouvel essai dans " + Math.round(ms/1000) + " s"; await attendre(ms, sig); }
 }
 verif();
 if (vide) { OVP.avert.push((tuile ? "tuile " + tuile : "une tuile") + " vide d'après le serveur " + vide.nom + " sans confirmation possible (mer ou zone sans objet ?)"); return []; }
 const det = [...dern].map(([k, v]) => k + " : " + v).join(" ; ");
 const err = new Error("OpenStreetMap indisponible" + (tuile ? " pour la tuile " + tuile : "") + " : aucun serveur n'a répondu après " + OVP_DELAIS.length + " essais (" + (det || (last ? last.message : "aucun serveur")) + ")");
 err.osm = true; throw err;
}
/* cache des tuiles OSM (base séparée) : une analyse interrompue reprend sans retélécharger */
let OSMDBP = null;
function osmDB(){
 return OSMDBP || (OSMDBP = new Promise((res, rej) => {
  const r = indexedDB.open("terrain-gtia-osm", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("tuiles", {keyPath:"k"}).createIndex("t", "t");
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
 }));
}
async function osmDo(mode, fn){
 const db = await osmDB();
 return new Promise((res, rej) => { const tx = db.transaction("tuiles", mode), rq = fn(tx.objectStore("tuiles"));
  tx.oncomplete = () => res(rq && rq.result); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
}
async function osmLire(keys){ // tuiles en cache (undefined si absente), en une transaction
 const db = await osmDB();
 return new Promise((res, rej) => { const tx = db.transaction("tuiles", "readonly"), st = tx.objectStore("tuiles"), out = new Array(keys.length);
  keys.forEach((k, q) => { const r = st.get(k); r.onsuccess = () => { if (r.result) out[q] = r.result.els; }; });
  tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
}
async function osmPurge(keys){ // tuiles données, ou à défaut tuiles de plus de 30 jours (le terrain change peu ; moins de requêtes aux serveurs)
 await osmDo("readwrite", s => {
  if (keys) { keys.forEach(k => s.delete(k)); return null; }
  const rq = s.index("t").openKeyCursor(IDBKeyRange.upperBound(Date.now() - 30*864e5));
  rq.onsuccess = () => { const c = rq.result; if (c) { s.delete(c.primaryKey); c.continue(); } };
  return null;
 });
}
// fusion des tuiles : un même objet vu par plusieurs tuiles n'a de coordonnées que dans chacune d'elles (null ailleurs)
function mergeGeom(a, b){
 if (!a) return b; if (!b) return a;
 if (a.length !== b.length) return a.filter(Boolean).length >= b.filter(Boolean).length ? a : b;
 for (let i = 0; i < a.length; i++) if (!a[i] && b[i]) a[i] = b[i];
 return a;
}
function mergeOSM(parts){
 const m = new Map();
 for (const els of parts) for (const el of els) {
  const key = el.type[0] + el.id, o = m.get(key);
  if (!o) { m.set(key, el); continue; }
  if (el.type === "way") o.geometry = mergeGeom(o.geometry, el.geometry);
  else if (el.type === "relation" && o.members && el.members && o.members.length === el.members.length)
   o.members.forEach((mb, i) => { mb.geometry = mergeGeom(mb.geometry, el.members[i].geometry); });
 }
 return [...m.values()];
}
const tilesOf = b => { // une seule requête jusqu'à 20 km, sinon tuiles d'environ 10 km
 const wM = distM([b.w, (b.n+b.s)/2], [b.e, (b.n+b.s)/2]), k = wM > 21500 ? Math.ceil(wM/10500 - 0.05) : 1, t = [];
 for (let j = 0; j < k; j++) for (let i = 0; i < k; i++)
  t.push({s:b.s + (b.n-b.s)*j/k, n:b.s + (b.n-b.s)*(j+1)/k, w:b.w + (b.e-b.w)*i/k, e:b.w + (b.e-b.w)*(i+1)/k});
 return t;
};
const tileKeys = b => tilesOf(b).map(t => OSM_VER + "|" + bbStr(t));
// marge autour de la zone : Overpass coupe les voies au bord du cadre (dernier tronçon perdu), la marge rejette ces trous hors de la zone
const elargir = (b, m) => { const dLat = m/110574, dLon = m/(111320*Math.cos((b.n + b.s)/2*Math.PI/180)); return {s:b.s - dLat, n:b.n + dLat, w:b.w - dLon, e:b.e + dLon}; };
/* téléchargement de la zone par tuiles. Reprise : les tuiles déjà en cache (analyse interrompue, arrêtée ou en échec) sont relues d'abord,
   seules les manquantes sont demandées aux serveurs. Les compteurs d'échecs des serveurs repartent de zéro à chaque analyse.
   Renvoie {els, keys, cached, avert} ; prog(faites, total, du cache, message). */
async function loadOSM(b, prog){
 const tiles = tilesOf(b), keys = tileKeys(b), parts = new Array(tiles.length), N = tiles.length;
 let done = 0, cached = 0, failed = null, dernier = "", cachePlein = false;
 ovpRaz();
 try { await osmPurge(); } catch(e) { console.warn(e); }
 // 1. ce qui est déjà en cache
 try {
  const lus = await osmLire(keys);
  lus.forEach((els, q) => { if (els) { parts[q] = els; done++; cached++; } });
 } catch(e) { console.warn("cache OSM illisible", e); }
 if (cached) prog(done, N, cached, cached + " tuile(s) reprise(s) du cache, " + (N - cached) + " à télécharger");
 // 2. le reste, deux requêtes simultanées au plus (règle des serveurs Overpass) ; un échec définitif arrête l'autre requête
 const manque = [], local = new AbortController(); for (let q = 0; q < N; q++) if (!parts[q]) manque.push(q);
 let next = 0;
 const vie = setInterval(() => { if (done < N && !failed) prog(done, N, cached, [OVP.etat, dernier].filter(Boolean).join(" · ")); }, 1000);   // le temps écoulé avance, le serveur essayé est nommé
 try {
  const worker = async () => {
   while (next < manque.length && !failed) {
    const q = manque[next++], lab = (q+1) + "/" + N;
    let els;
    try { els = await overpass(osmQuery(bbStr(tiles[q])), e => { dernier = "tuile " + lab + " : " + e.message + ", nouvel essai…"; prog(done, N, cached, dernier); }, tiles[q], {signal:local.signal, tuile:lab}); }
    catch(e) { if (!failed) { failed = e; local.abort(); } return; }
    try { await osmDo("readwrite", s => s.put({k:keys[q], t:Date.now(), els})); }
    catch(e) { console.warn("cache OSM", e); if (!cachePlein) { cachePlein = true; OVP.avert.push("mémoire du navigateur pleine : les tuiles ne sont plus gardées pour une reprise"); } }
    parts[q] = els; done++; dernier = ""; prog(done, N, cached, "");
   }
  };
  await Promise.all(Array.from({length:Math.min(2, manque.length)}, worker));
 } finally { clearInterval(vie); }
 arretSi();
 if (failed) {
  const e = new Error(failed.message + ". " + (done ? done + " tuile(s) sur " + N + " déjà reçue(s) et gardée(s) : « Reprendre » repartira de là" : "Aucune tuile reçue : « Reprendre »") + ", de préférence dans quelques minutes (serveurs publics parfois saturés)");
  e.osm = true; throw e;
 }
 return {els: parts.length === 1 ? parts[0] : mergeOSM(parts), keys, cached, avert:OVP.avert.slice()};
}
// metresOSM (lecture prudente des largeurs et profondeurs OSM) et EAU_TRACE_M sont dans moteur-terrain.js (chargé avant)
function areaCat(t){
 if (t.landuse === "forest" || t.natural === "wood") return "foret";
 if (t.natural === "water" || t.waterway === "riverbank" || t.landuse === "reservoir" || t.landuse === "basin") return "eau";
 if (t.natural === "wetland") return "marais";
 if (["residential","industrial","commercial","retail"].includes(t.landuse)) return "bati";
 if (t.landuse === "vineyard" || t.landuse === "orchard") return "vigne";
 if (t.landuse === "meadow" || t.natural === "grassland") return "prairie";
 return null;
}
function assemble(members){
 const segs = (members || []).filter(m => m.type === "way" && m.geometry)
  .map(m => m.geometry.filter(Boolean)).filter(s => s.length > 1);   // membre entièrement hors du cadre : sans coordonnées, ignoré
 const same = (a, b) => Math.abs(a.lat-b.lat) < 1e-7 && Math.abs(a.lon-b.lon) < 1e-7;
 const rings = [];
 while (segs.length) {
  let cur = segs.shift().slice();
  let guard = 0;
  while (!same(cur[0], cur[cur.length-1]) && guard++ < 5000) {
   const end = cur[cur.length-1];
   const i = segs.findIndex(s => same(s[0], end) || same(s[s.length-1], end));
   if (i < 0) break;
   let s = segs.splice(i, 1)[0];
   if (!same(s[0], end)) s = s.slice().reverse();
   cur = cur.concat(s.slice(1));
  }
  if (cur.length > 2) rings.push(cur);
 }
 return rings;
}

/* ---------- calcul en séquences : enSequences(), finir(), rendreLaMain() sont dans moteur-terrain.js (chargé avant) ---------- */
/* Chaque étape lourde est un générateur : « yield [texte, avancement 0-1] » marque un point où l'on peut s'interrompre, la valeur de retour est le résultat. */

/* ---------- faits bruts : rasterisation et voies ---------- */
const LAYER_LBL = {foret:"forêts", eau:"eau et mer", bati:"bâti", marais:"marais", vigne:"vignes et vergers", prairie:"prairies", ruisseau:"ruisseaux", autoroute:"autoroutes", fer:"voies ferrées", haie:"haies", route:"routes"};
// alt : altitudes par maille (n×n, sortie de slopes), utilisées pour la mer sans trait de côte (facultatif)
function extractFacts(els, b, n, cell, alt){ return finir(extractFactsEtapes(els, b, n, cell, alt)); }
function* extractFactsEtapes(els, b, n, cell, alt){
 // tracés mémorisés par couche, puis rastérisés couche par couche sur un seul canevas (mémoire : 1 canevas au lieu de 11)
 const W = n*S, pxm = S/cell, C = {};
 for (const k of LAYERS) C[k] = [];
 const X = p => (p.lon - b.w)/(b.e - b.w)*W, Y = p => (b.n - p.lat)/(b.n - b.s)*W;
 const fill = (k, rings) => C[k].push([0, rings]), stroke = (k, pts, w) => C[k].push([1, pts, w]);
 const fillG = (g, rings) => { g.beginPath(); for (const r of rings) { r.forEach((p, i) => i ? g.lineTo(X(p), Y(p)) : g.moveTo(X(p), Y(p))); g.closePath(); } g.fill("evenodd"); };
 const strokeG = (g, pts, w) => { g.lineWidth = w; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(X(p), Y(p)) : g.moveTo(X(p), Y(p))); g.stroke(); };
 const ways = [], pnodes = [], cote = [], rivs = [], rus = [];
 // surfaces d'eau de rivière (rivière dessinée en surface) : mesure de la largeur des tronçons sur le tracé (mesureLargeurEau, moteur)
 const surfRiv = [], estSurfRiv = t => t.waterway === "riverbank" || (t.natural === "water" && /^(river|canal)$/.test(t.water || ""));
 const r6 = v => Math.round(v*1e6)/1e6;
 for (let q0 = 0; q0 < els.length; q0++) {
  if ((q0 & 2047) === 2047) yield ["lecture des objets OpenStreetMap", 0.1*q0/els.length];
  const el = els[q0], t = el.tags || {};
  if (el.type === "node") {
   if (t.highway === "motorway_junction") pnodes.push({id:el.id, t:"echangeur", lon:el.lon, lat:el.lat, nm: t.ref ? "sortie " + t.ref + (t.name ? " – " + t.name : "") : (t.name || "")});
   else if (t.railway === "level_crossing") pnodes.push({id:el.id, t:"pn", lon:el.lon, lat:el.lat, nm:""});
   else if (t.ford === "yes") pnodes.push({id:el.id, t:"gue", lon:el.lon, lat:el.lat, nm:t.name || ""});
   continue;
  }
  const a = areaCat(t);
  if (el.type === "way" && el.geometry && t.natural === "coastline") { // tronçons continus (Overpass laisse des trous hors du cadre)
   let run = [];
   for (const q of el.geometry.concat([null])) { if (q) run.push([X(q), Y(q)]); else { if (run.length > 1) cote.push(run); run = []; } }
   continue;
  }
  if (el.type === "way" && el.geometry) {
   const idx = []; el.geometry.forEach((p, i) => { if (p) idx.push(i); });
   const pts = idx.map(i => el.geometry[i]); if (pts.length < 2) continue;
   const closed = pts.length > 3 && pts[0].lat === pts[pts.length-1].lat && pts[0].lon === pts[pts.length-1].lon;
   if (a && closed) fill(a, [pts]);
   if (closed && estSurfRiv(t)) surfRiv.push([pts.map(p => [p.lon, p.lat])]);
   const br = yes(t.bridge), tu = yes(t.tunnel) && t.tunnel !== "building_passage";
   const g = () => pts.map(p => [r6(p.lon), r6(p.lat)]);
   if (roadCat(t.highway) >= 0) {
    stroke("route", pts, 1.2);
    if (t.highway === "motorway" && !br && !tu) stroke("autoroute", pts, 1.5); // un viaduc ou un tunnel ne fait pas obstacle
    const nd = el.nodes && el.nodes.length === el.geometry.length ? idx.map(i => el.nodes[i]) : null;
    ways.push({hw:t.highway, br:br ? 1 : 0, tu:tu ? 1 : 0, fd:t.ford === "yes" ? 1 : 0, nm:t.name || t["bridge:name"] || t["tunnel:name"] || t.ref || "", nd, g:g()});
   }
   if (/^(rail|light_rail|narrow_gauge)$/.test(t.railway || "")) {
    if (!br && !tu) stroke("fer", pts, 1.5);
    if (br) ways.push({rail:1, br:1, tu:0, nm:t.name || "", g:g()});
   }
   if (t.barrier === "hedge") stroke("haie", pts, 1.2);
   if (t.waterway && t.waterway !== "riverbank" && !tu && !br) { // busé ou pont-canal : pas d'obstacle ; riverbank = surface (ci-dessus)
    if (t.waterway === "river" || t.waterway === "canal") {
     const w = metresOSM(t.width), p = metresOSM(t.depth);   // en mètres, 0 = non renseignée (règle verdictEau du moteur : valeur supposée)
     stroke("eau", pts, Math.max(1.2, (w || EAU_TRACE_M[t.waterway === "river" ? "r" : "c"])*pxm));
     rivs.push({id:"eau:w" + el.id, w, p, wm:0, k:t.waterway === "river" ? "r" : "c", nm:t.name || "", g:g()});
    } else { stroke("ruisseau", pts, 1.2); rus.push(g()); } // tracé gardé pour le dessin en vraies lignes
   }
  } else if (el.type === "relation" && a) { fill(a, assemble(el.members));
   if (estSurfRiv(t)) { const ext = assemble((el.members || []).filter(m => m.role !== "inner")).map(r => r.map(p => [p.lon, p.lat])); if (ext.length) surfRiv.push(ext); } }
 }
 // largeur mesurée sur le tracé (0 = rivière non dessinée en surface) : prime sur l'étiquette width (règle valeursEau du moteur)
 if (surfRiv.length) for (let q = 0; q < rivs.length; q++) { rivs[q].wm = mesureLargeurEau(rivs[q].g, surfRiv); if ((q & 63) === 63) yield ["largeur des rivières en surface", 0.1]; }
 const cv = document.createElement("canvas"); cv.width = cv.height = W;
 const g = cv.getContext("2d", {willReadFrequently:true});
 const L = {}, M = new Uint8Array(W*W);
 // l'eau en dernier : la mer sans trait de côte se décide d'après les autres couches (objets terrestres) ; chaque couche est indépendante, l'ordre ne change rien
 const ordre = LAYERS.filter(k => k !== "eau").concat(LAYERS.includes("eau") ? ["eau"] : []);
 for (let ik = 0; ik < ordre.length; ik++) {
  const k = ordre[ik], a0 = 0.1 + 0.9*ik/ordre.length, da = 0.9/ordre.length, lbl = "couche " + (LAYER_LBL[k] || k);
  let sea = null;
  if (k === "eau") {
   const terre = c => L.route[c] > 0 || L.fer[c] > 0 || L.haie[c] > 0 || L.autoroute[c] > 0 || L.ruisseau[c] > 0 || L.foret[c] > 0.05 || L.bati[c] > 0.05 || L.vigne[c] > 0.05 || L.prairie[c] > 0.05 || L.marais[c] > 0.05;
   sea = yield* seaMaskEtapes(cote, W, alt ? {n, alt, terre} : null, a0, da*0.5);
  }
  g.clearRect(0, 0, W, W); g.fillStyle = g.strokeStyle = "#fff"; g.lineCap = g.lineJoin = "round";
  const ops = C[k];
  for (let q = 0; q < ops.length; q++) { const o = ops[q]; o[0] ? strokeG(g, o[1], o[2]) : fillG(g, o[1]); if ((q & 511) === 511) yield [lbl, a0 + da*(k === "eau" ? 0.5 : 0)+ da*0.3*q/ops.length]; }
  if (k === "eau" && sea) g.drawImage(sea, 0, 0);
  C[k] = null;
  yield [lbl, a0 + da*0.6];
  const d = g.getImageData(0, 0, W, W).data, f = new Float32Array(n*n);
  for (let j = 0; j < n; j++) {
   for (let i = 0; i < n; i++) {
    let s = 0;
    for (let y = 0; y < S; y++) { const row = ((j*S + y)*W + i*S)*4 + 3; for (let x = 0; x < S; x++) s += d[row + x*4]; }
    f[j*n + i] = s/(S*S*255);
   }
   if ((j & 15) === 15) yield [lbl, a0 + da*(0.6 + 0.3*j/n)];
  }
  L[k] = f;
  if (BIT[k]) { const bk = BIT[k]; for (let y = 0; y < W; y++) { const r0 = y*W; for (let p = r0; p < r0 + W; p++) if (d[p*4+3] > 64) M[p] |= bk; if ((y & 127) === 127) yield [lbl, a0 + da*0.95]; } }
 }
 return {L, M, W, ways, pnodes, rivs, rus};
}
/* mer : le trait de côte OSM a la terre à gauche et la mer à droite dans le sens de la ligne.
   On découpe le cadre (zone entière, toutes tuiles assemblées) en régions séparées par le trait de côte, puis chaque région est déclarée
   mer ou terre selon les points de contrôle pris juste à droite (mer) et à gauche (terre) de chaque segment.
   Une tuile sans trait de côte fait partie de la région de sa voisine côtière (même région tant qu'aucune côte ne les sépare) ; une île est une
   région entourée de côte, déclarée terre par ses propres points de contrôle.
   Région sans aucun point de contrôle (zone entièrement en mer ou entièrement à terre, sans côte ; recoin isolé) : mer si au moins 90 % de
   ses mailles sont à 0 m ou moins sur le relief (le relief Terrarium donne la profondeur en mer, en négatif) ET si elle ne contient presque
   aucun objet terrestre OSM (routes, voies ferrées, haies, ruisseaux, bois, bâti, cultures : au plus 0,2 % de sa surface) ; sinon terre.
   Ainsi un polder sous le niveau de la mer reste à terre (il a des routes), et une zone vide au-dessus de 0 m aussi.
   ctx = {n, alt, terre(c)} ; sans ctx, une région sans point de contrôle est à terre (comportement d'avant).
   Renvoie un canevas (mer opaque) ou null s'il n'y a pas de mer. */
function seaMask(runs, W, ctx){ return finir(seaMaskEtapes(runs, W, ctx, 0, 1)); }
function* seaMaskEtapes(runs, W, ctx, a0, da){
 const N = W*W, lbl = "mer et trait de côte";
 a0 = a0 || 0; da = da || 1;
 const c = document.createElement("canvas"); c.width = c.height = W;
 const g = c.getContext("2d"); g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.lineCap = g.lineJoin = "round";
 let lab, nl = 0, vote;
 if (runs.length) {
  for (let q = 0; q < runs.length; q++) { const r = runs[q]; g.beginPath(); r.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke(); if ((q & 255) === 255) yield [lbl, a0]; }
  const d = g.getImageData(0, 0, W, W).data, mur = new Uint8Array(N);
  for (let p = 0; p < N; p++) mur[p] = d[p*4+3] > 64;
  yield [lbl, a0 + da*0.1];
  lab = new Int32Array(N).fill(-1); const st = new Int32Array(N);
  let cpt = 0;
  for (let p0 = 0; p0 < N; p0++) {
   if (lab[p0] >= 0 || mur[p0]) continue;
   let top = 0; st[top++] = p0; lab[p0] = nl;
   while (top) { const p = st[--top], x = p % W;
    if (x > 0 && lab[p-1] < 0 && !mur[p-1]) { lab[p-1] = nl; st[top++] = p-1; }
    if (x < W-1 && lab[p+1] < 0 && !mur[p+1]) { lab[p+1] = nl; st[top++] = p+1; }
    if (p >= W && lab[p-W] < 0 && !mur[p-W]) { lab[p-W] = nl; st[top++] = p-W; }
    if (p + W < N && lab[p+W] < 0 && !mur[p+W]) { lab[p+W] = nl; st[top++] = p+W; }
    if ((++cpt & 0x3FFFF) === 0) yield [lbl, a0 + da*(0.1 + 0.5*cpt/N)]; }
   nl++;
  }
  vote = new Float64Array(nl); const off = 2.5;
  const at = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y); return xi >= 0 && yi >= 0 && xi < W && yi < W ? lab[yi*W + xi] : -1; };
  for (const r of runs) for (let k = 1; k < r.length; k++) {
   const [x0, y0] = r[k-1], [x1, y1] = r[k], dx = x1-x0, dy = y1-y0, l = Math.hypot(dx, dy); if (l < 0.5) continue;
   const nx = -dy/l*off, ny = dx/l*off, ns = Math.max(1, Math.ceil(l/8)); // normale droite (y vers le bas) ; un contrôle tous les 8 px
   for (let q = 0; q < ns; q++) { const t = (q + 0.5)/ns, mx = x0 + dx*t, my = y0 + dy*t;
    const sea = at(mx+nx, my+ny), land = at(mx-nx, my-ny);
    if (sea >= 0) vote[sea] += l/ns; if (land >= 0) vote[land] -= l/ns; }
  }
 } else { lab = null; nl = 1; vote = new Float64Array(1); }   // pas de côte : une seule région, la zone entière
 yield [lbl, a0 + da*0.65];
 const mer = new Uint8Array(nl); for (let r = 0; r < nl; r++) mer[r] = vote[r] > 0;
 // régions sans point de contrôle : relief et objets terrestres
 const sans = []; for (let r = 0; r < nl; r++) if (vote[r] === 0) sans.push(r);
 if (sans.length && ctx && ctx.alt) {
  const {n, alt, terre} = ctx, nb = new Float64Array(nl), bas = new Float64Array(nl), ter = new Float64Array(nl);
  if (!lab) { for (let cc = 0; cc < n*n; cc++) { nb[0]++; if (alt[cc] <= 0) bas[0]++; if (terre(cc)) ter[0]++; } }
  else {
   const sv = new Uint8Array(nl); for (const r of sans) sv[r] = 1;
   const cb = new Uint8Array(n*n), ct = new Uint8Array(n*n); for (let cc = 0; cc < n*n; cc++) { cb[cc] = alt[cc] <= 0; ct[cc] = terre(cc) ? 1 : 0; }
   for (let y = 0; y < W; y++) { const jn = Math.min(n-1, (y/S) | 0)*n;
    for (let x = 0, p = y*W; x < W; x++, p++) { const r = lab[p]; if (r < 0 || !sv[r]) continue; const cc = jn + Math.min(n-1, (x/S) | 0); nb[r]++; bas[r] += cb[cc]; ter[r] += ct[cc]; }
    if ((y & 127) === 127) yield [lbl, a0 + da*(0.65 + 0.2*y/W)]; }
  }
  for (const r of sans) mer[r] = nb[r] > 0 && bas[r] >= 0.9*nb[r] && ter[r] <= 0.002*nb[r] ? 1 : 0;
 }
 if (!mer.some(v => v)) return null;
 const out = g.createImageData(W, W);
 if (!lab) { for (let p = 0; p < N; p++) out.data[p*4+3] = 255; }
 else for (let y = 0; y < W; y++) { for (let x = 0, p = y*W; x < W; x++, p++) { const L0 = lab[p]; let m = L0 >= 0 && mer[L0];
   if (L0 < 0) m = (x > 0 && lab[p-1] >= 0 && mer[lab[p-1]]) || (x < W-1 && lab[p+1] >= 0 && mer[lab[p+1]]) || (p >= W && lab[p-W] >= 0 && mer[lab[p-W]]) || (p + W < N && lab[p+W] >= 0 && mer[lab[p+W]]);
   if (m) out.data[p*4+3] = 255; }
  if ((y & 255) === 255) yield [lbl, a0 + da*(0.85 + 0.15*y/W)]; }
 g.clearRect(0, 0, W, W); g.putImageData(out, 0, 0);
 return c;
}
function slopes(elev, b, n, cell){ return finir(slopesEtapes(elev, b, n, cell)); }
function* slopesEtapes(elev, b, n, cell){
 const m = n*2, E = new Float32Array(m*m), d = cell/2;
 for (let j = 0; j < m; j++) { for (let i = 0; i < m; i++)
  E[j*m + i] = elev(b.w + (i+0.5)/m*(b.e-b.w), b.n - (j+0.5)/m*(b.n-b.s));
  if ((j & 31) === 31) yield ["altitudes", 0.6*j/m]; }
 const sl = new Float32Array(n*n), el = new Float32Array(n*n), gx = new Float32Array(n*n), gy = new Float32Array(n*n);
 for (let j = 0; j < n; j++) { for (let i = 0; i < n; i++) {
  let s = 0, z = 0, ax = 0, ay = 0;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
   const fi = i*2 + dx, fj = j*2 + dy;
   const xa = Math.max(0, fi-1), xb = Math.min(m-1, fi+1), ya = Math.max(0, fj-1), yb = Math.min(m-1, fj+1);
   const px = (E[fj*m+xb] - E[fj*m+xa])/((xb-xa)*d), py = (E[yb*m+fi] - E[ya*m+fi])/((yb-ya)*d);
   s += 100*Math.hypot(px, py); z += E[fj*m+fi]; ax += px; ay += py;
  }
  const k = j*n+i; sl[k] = s/4; el[k] = z/4; gx[k] = ax/4; gy[k] = ay/4; // gy orienté vers le sud
 }
 if ((j & 31) === 31) yield ["pentes", 0.6 + 0.4*j/n]; }
 return {sl, el, gx, gy};
}
/* obstacles entre mailles voisines, en séquences : barriersEtapes() de moteur-terrain.js (bandes de lignes, résultat identique à barriers()) */
