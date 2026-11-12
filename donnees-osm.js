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
  const to = setTimeout(() => { im.src = ""; rej(new Error("tuile relief " + x + "/" + y + " : pas de réponse en 30 s")); }, 30000);
  im.onerror = () => { clearTimeout(to); rej(new Error("tuile relief " + x + "/" + y)); };
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
   if (!d) { failed = e0; throw e0; }
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
const OVP = {echecs:{}, file:new Map(), etat:""};
// une requête à la fois sur les serveurs qui l'exigent
function chacunSonTour(srv, fn){
 if (srv.par > 1) return fn();
 const p = (OVP.file.get(srv.u) || Promise.resolve()).then(fn);
 OVP.file.set(srv.u, p.catch(() => {}));
 return p;
}
const OSM_VER = "q1"; // à changer si la requête change : invalide le cache des tuiles
const osmQuery = bb => `[out:json][timeout:90][maxsize:536870912][bbox:${bb}];(   // demande modeste : mieux acceptée par un serveur chargé
way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|track)$"];
way["railway"~"^(rail|light_rail|narrow_gauge)$"];
way["waterway"~"^(river|canal|stream|ditch|drain)$"];
way["barrier"="hedge"];
way["natural"="coastline"];
way["natural"~"^(water|wood|wetland|grassland)$"];
way["landuse"~"^(forest|residential|industrial|commercial|retail|vineyard|orchard|reservoir|basin|meadow)$"];
relation["natural"~"^(water|wood|wetland|grassland)$"];
relation["landuse"~"^(forest|residential|industrial|commercial|vineyard|orchard|reservoir|meadow)$"];
node["highway"="motorway_junction"];
node["railway"="level_crossing"];
node["ford"="yes"];
);out geom;`;
const bbStr = b => [b.s, b.w, b.n, b.e].map(v => v.toFixed(5)).join(",");
// une requête Overpass : deux serveurs, trois tours, pause croissante entre les tours ; une réponse tronquée (remark) est un échec
async function overpass(q, onRetry, bbox){
 let last;
 for (let tour = 0; tour < OVP_DELAIS.length; tour++) {
  // serveurs utilisables pour cette zone, ceux qui viennent d'échouer en dernier
  const rang = v => (OVP.echecs[v.u] || 0) >= 2 ? OVP.echecs[v.u] : 0;
  const liste = OVERPASS.filter(v => !v.zone || !bbox || v.zone(bbox)).sort((x, y) => rang(x) - rang(y));   // un échec isolé ne change pas l'ordre, deux de suite si
  for (const srv of liste) {
   arretSi();
   const delai = OVP_DELAIS[tour];
   let refus = false;
   try {
    const els = await chacunSonTour(srv, async () => {
     arretSi();
     const ac = new AbortController(), to = setTimeout(() => ac.abort(), delai*1000), stop = () => ac.abort();
     if (ABORT) ABORT.signal.addEventListener("abort", stop);
     OVP.etat = "serveur " + srv.nom;
     try {
      const r = await fetch(srv.u, {signal:ac.signal, method:"POST", body:"data=" + encodeURIComponent(q), headers:{"Content-Type":"application/x-www-form-urlencoded"}});
      if (r.status === 429 || r.status === 406) refus = true;
      if (!r.ok) throw new Error("HTTP " + r.status + (r.status === 429 || r.status === 504 ? " (saturé)" : r.status === 406 ? " (refusé)" : ""));
      const j = await r.json();
      if (j.remark && /error|timed out|memory/i.test(j.remark)) throw new Error("réponse incomplète (" + j.remark.slice(0, 80) + ")");
      const e = j.elements || [];
      if (!e.length && srv.videSuspect) throw new Error("réponse vide (zone hors de sa couverture ?)");
      return e;
     } catch(e) { throw e.name === "AbortError" ? new Error("pas de réponse en " + delai + " s") : e; }
     finally { clearTimeout(to); if (ABORT) ABORT.signal.removeEventListener("abort", stop); }
    });
    OVP.echecs[srv.u] = 0;
    return els;
   } catch(e) {
    arretSi();
    OVP.echecs[srv.u] = (OVP.echecs[srv.u] || 0) + 1;
    last = new Error("serveur " + srv.nom + " : " + e.message);
    if (onRetry) onRetry(last);
    if (refus) { OVP.etat = "pause de 30 s demandée par le serveur " + srv.nom; await pause(30000); }
   }
  }
  if (tour < OVP_DELAIS.length - 1) { OVP.etat = "tous les serveurs ont échoué, nouvel essai dans " + 10*(tour + 1) + " s"; await pause(10000*(tour + 1)); }
 }
 throw new Error("OpenStreetMap indisponible (" + (last ? last.message : "aucun serveur") + "). Réessayer plus tard avec « Reprendre » : les tuiles déjà reçues sont gardées.");
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
async function loadOSM(b, prog){
 const tiles = tilesOf(b), keys = tileKeys(b), parts = new Array(tiles.length);
 let next = 0, done = 0, cached = 0, failed = null, dernier = "";
 try { await osmPurge(); } catch(e) { console.warn(e); }
 OVP.etat = "";
 const vie = setInterval(() => { if (done < tiles.length && !failed) prog(done, tiles.length, cached, [OVP.etat, dernier].filter(Boolean).join(" · ")); }, 1000);   // le temps écoulé avance, le serveur essayé est nommé
 try {
 const worker = async () => {                       // deux requêtes simultanées au plus (règle des serveurs Overpass)
  while (next < tiles.length && !failed) {
   const q = next++; let els = null;
   try { const c = await osmDo("readonly", s => s.get(keys[q])); if (c) { els = c.els; cached++; } } catch(e) { console.warn(e); }
   if (!els) {
    try { els = await overpass(osmQuery(bbStr(tiles[q])), e => { dernier = "tuile " + (q+1) + " : " + e.message + ", nouvel essai…"; prog(done, tiles.length, cached, dernier); }, tiles[q]); }
    catch(e) { failed = e; throw e; }
    try { await osmDo("readwrite", s => s.put({k:keys[q], t:Date.now(), els})); } catch(e) { console.warn("cache OSM", e); }
   }
   parts[q] = els; done++; prog(done, tiles.length, cached, "");
  }
 };
 await Promise.all(Array.from({length:Math.min(2, tiles.length)}, worker));
 } finally { clearInterval(vie); }
 return {els: parts.length === 1 ? parts[0] : mergeOSM(parts), keys};
}
function areaCat(t){
 if (t.landuse === "forest" || t.natural === "wood") return "foret";
 if (t.natural === "water" || t.landuse === "reservoir" || t.landuse === "basin") return "eau";
 if (t.natural === "wetland") return "marais";
 if (["residential","industrial","commercial","retail"].includes(t.landuse)) return "bati";
 if (t.landuse === "vineyard" || t.landuse === "orchard") return "vigne";
 if (t.landuse === "meadow" || t.natural === "grassland") return "prairie";
 return null;
}
function assemble(members){
 const segs = (members || []).filter(m => m.type === "way" && m.geometry)
  .map(m => m.geometry.filter(Boolean));
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

/* ---------- faits bruts : rasterisation et voies ---------- */
function extractFacts(els, b, n, cell){
 // tracés mémorisés par couche, puis rastérisés couche par couche sur un seul canevas (mémoire : 1 canevas au lieu de 11)
 const W = n*S, pxm = S/cell, C = {};
 for (const k of LAYERS) C[k] = [];
 const X = p => (p.lon - b.w)/(b.e - b.w)*W, Y = p => (b.n - p.lat)/(b.n - b.s)*W;
 const fill = (k, rings) => C[k].push([0, rings]), stroke = (k, pts, w) => C[k].push([1, pts, w]);
 const fillG = (g, rings) => { g.beginPath(); for (const r of rings) { r.forEach((p, i) => i ? g.lineTo(X(p), Y(p)) : g.moveTo(X(p), Y(p))); g.closePath(); } g.fill("evenodd"); };
 const strokeG = (g, pts, w) => { g.lineWidth = w; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(X(p), Y(p)) : g.moveTo(X(p), Y(p))); g.stroke(); };
 const ways = [], pnodes = [], cote = [], rivs = [], rus = [];
 const r6 = v => Math.round(v*1e6)/1e6;
 for (const el of els) {
  const t = el.tags || {};
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
   if (t.waterway && !tu && !br) { // busé ou pont-canal : pas d'obstacle
    if (t.waterway === "river" || t.waterway === "canal") {
     const w = parseFloat(t.width) || (t.waterway === "river" ? 30 : 15);
     stroke("eau", pts, Math.max(1.2, w*pxm));
     rivs.push({w:parseFloat(t.width) || 0, k:t.waterway === "river" ? "r" : "c", nm:t.name || "", g:g()}); // largeur OSM (0 = non renseignée)
    } else { stroke("ruisseau", pts, 1.2); rus.push(g()); } // tracé gardé pour le dessin en vraies lignes
   }
  } else if (el.type === "relation" && a) fill(a, assemble(el.members));
 }
 const sea = cote.length ? seaMask(cote, W) : null;
 const cv = document.createElement("canvas"); cv.width = cv.height = W;
 const g = cv.getContext("2d", {willReadFrequently:true});
 const L = {}, M = new Uint8Array(W*W);
 for (const k of LAYERS) {
  g.clearRect(0, 0, W, W); g.fillStyle = g.strokeStyle = "#fff"; g.lineCap = g.lineJoin = "round";
  for (const o of C[k]) o[0] ? strokeG(g, o[1], o[2]) : fillG(g, o[1]);
  if (k === "eau" && sea) g.drawImage(sea, 0, 0);
  C[k] = null;
  const d = g.getImageData(0, 0, W, W).data, f = new Float32Array(n*n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
   let s = 0;
   for (let y = 0; y < S; y++) { const row = ((j*S + y)*W + i*S)*4 + 3; for (let x = 0; x < S; x++) s += d[row + x*4]; }
   f[j*n + i] = s/(S*S*255);
  }
  L[k] = f;
  if (BIT[k]) for (let p = 0; p < W*W; p++) if (d[p*4+3] > 64) M[p] |= BIT[k];
 }
 return {L, M, W, ways, pnodes, rivs, rus};
}
// mer : le trait de côte OSM a la terre à gauche et la mer à droite dans le sens de la ligne.
// On découpe le cadre en régions séparées par le trait de côte, puis chaque région est déclarée
// mer ou terre selon les points de contrôle pris juste à droite (mer) et à gauche (terre) de chaque segment.
function seaMask(runs, W){
 const c = document.createElement("canvas"); c.width = c.height = W;
 const g = c.getContext("2d"); g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.lineCap = g.lineJoin = "round";
 for (const r of runs) { g.beginPath(); r.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke(); }
 const d = g.getImageData(0, 0, W, W).data, lab = new Int32Array(W*W).fill(-1), st = new Int32Array(W*W);
 let nl = 0;
 for (let p0 = 0; p0 < W*W; p0++) {
  if (lab[p0] >= 0 || d[p0*4+3] > 64) continue;
  let top = 0; st[top++] = p0; lab[p0] = nl;
  while (top) { const p = st[--top], x = p % W;
   for (const q of [x > 0 ? p-1 : -1, x < W-1 ? p+1 : -1, p-W, p+W])
    if (q >= 0 && q < W*W && lab[q] < 0 && d[q*4+3] <= 64) { lab[q] = nl; st[top++] = q; } }
  nl++;
 }
 const vote = new Float64Array(nl), off = 2.5;
 const at = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y); return xi >= 0 && yi >= 0 && xi < W && yi < W ? lab[yi*W + xi] : -1; };
 for (const r of runs) for (let k = 1; k < r.length; k++) {
  const [x0, y0] = r[k-1], [x1, y1] = r[k], dx = x1-x0, dy = y1-y0, l = Math.hypot(dx, dy); if (l < 0.5) continue;
  const nx = -dy/l*off, ny = dx/l*off, ns = Math.max(1, Math.ceil(l/8)); // normale droite (y vers le bas) ; un contrôle tous les 8 px
  for (let q = 0; q < ns; q++) { const t = (q + 0.5)/ns, mx = x0 + dx*t, my = y0 + dy*t;
   const sea = at(mx+nx, my+ny), land = at(mx-nx, my-ny);
   if (sea >= 0) vote[sea] += l/ns; if (land >= 0) vote[land] -= l/ns; }
 }
 const out = g.createImageData(W, W);
 for (let p = 0; p < W*W; p++) { const L0 = lab[p]; let mer = L0 >= 0 && vote[L0] > 0;
  if (L0 < 0) { const x = p % W; mer = [p-1, p+1, p-W, p+W].some(q => q >= 0 && q < W*W && Math.abs(q % W - x) <= 1 && lab[q] >= 0 && vote[lab[q]] > 0); }
  if (mer) out.data[p*4+3] = 255; }
 g.clearRect(0, 0, W, W); g.putImageData(out, 0, 0);
 return c;
}
function slopes(elev, b, n, cell){
 const m = n*2, E = new Float32Array(m*m), d = cell/2;
 for (let j = 0; j < m; j++) for (let i = 0; i < m; i++)
  E[j*m + i] = elev(b.w + (i+0.5)/m*(b.e-b.w), b.n - (j+0.5)/m*(b.n-b.s));
 const sl = new Float32Array(n*n), el = new Float32Array(n*n), gx = new Float32Array(n*n), gy = new Float32Array(n*n);
 for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
  let s = 0, z = 0, ax = 0, ay = 0;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
   const fi = i*2 + dx, fj = j*2 + dy;
   const xa = Math.max(0, fi-1), xb = Math.min(m-1, fi+1), ya = Math.max(0, fj-1), yb = Math.min(m-1, fj+1);
   const px = (E[fj*m+xb] - E[fj*m+xa])/((xb-xa)*d), py = (E[yb*m+fi] - E[ya*m+fi])/((yb-ya)*d);
   s += 100*Math.hypot(px, py); z += E[fj*m+fi]; ax += px; ay += py;
  }
  const k = j*n+i; sl[k] = s/4; el[k] = z/4; gx[k] = ax/4; gy[k] = ay/4; // gy orienté vers le sud
 }
 return {sl, el, gx, gy};
}
