/* moteur-terrain.js – moteur de calcul unique des outils terrain-gtia (outil terrain, Ennemi prépa, Ennemi conduite).
   Toute correction du modèle se fait ici, une seule fois.
   Variables globales attendues : G (zone chargée) et P (paramètres terrain). */
"use strict";
const ARMS = ["chenille","roue","logistique","fantassin"];
const ARM_LBL = {chenille:"Chenillé", roue:"Roue", logistique:"Logistique (gros porteur)", fantassin:"Fantassin (à pied)"};
const ARM_BIT = {chenille:1, roue:2, logistique:4, fantassin:8};
/* ---------- géométrie ---------- */
function bboxFrom(c, sizeM){
 const dLat = sizeM/2/110574, dLon = sizeM/2/(111320*Math.cos(c.lat*Math.PI/180));
 return {w:c.lng-dLon, e:c.lng+dLon, s:c.lat-dLat, n:c.lat+dLat};
}
const ring = b => [[b.w,b.n],[b.e,b.n],[b.e,b.s],[b.w,b.s],[b.w,b.n]];
const lineFeat = coords => ({type:"Feature", geometry:{type:"LineString", coordinates:coords}, properties:{}});
const ptFeat = (ll, props) => ({type:"Feature", geometry:{type:"Point", coordinates:ll}, properties:props || {}});
const FC = features => ({type:"FeatureCollection", features});
function distM(a, b){ // a, b = [lon, lat]
 const kx = 111320*Math.cos((a[1]+b[1])/2*Math.PI/180);
 return Math.hypot((b[0]-a[0])*kx, (b[1]-a[1])*110574);
}
function midLen(g){ // point milieu et longueur (m) d'une polyligne [[lon,lat],…]
 const d = []; let L = 0;
 for (let q = 1; q < g.length; q++) { d.push(distM(g[q-1], g[q])); L += d[q-1]; }
 let h = L/2;
 for (let q = 1; q < g.length; q++) {
  if (h <= d[q-1]) { const t = d[q-1] > 0 ? h/d[q-1] : 0;
   return [g[q-1][0] + (g[q][0]-g[q-1][0])*t, g[q-1][1] + (g[q][1]-g[q-1][1])*t, L]; }
  h -= d[q-1];
 }
 return [g[g.length-1][0], g[g.length-1][1], L];
}
const ROADKEYS = ["autoroute_kmh", "route_principale_kmh", "route_secondaire_kmh", "piste_kmh"];
function roadCat(h){ // index dans ROADKEYS ; une bretelle (_link) prend la catégorie de sa route mère
 if (!h) return -1;
 const m = h.replace(/_link$/, "");
 if (m === "motorway") return 0;
 if (/^(trunk|primary|secondary)$/.test(m)) return 1;
 if (/^(tertiary|unclassified|residential)$/.test(m)) return 2;
 if (m === "track") return 3;
 return -1;
}
const yes = v => v !== undefined && v !== "no";
const S = 4; // sur-échantillonnage (pixels par maille et par côté)
const LAYERS = ["foret","eau","bati","marais","vigne","prairie","ruisseau","autoroute","fer","haie","route"];
const BIT = {eau:1, ruisseau:2, autoroute:4, fer:8, route:16, haie:32}; // masque fin des obstacles linéaires
const BARRIER_BITS = 1|2|4|8|32;
function ensureLayers(L, n){ for (const k of LAYERS) if (!L[k]) L[k] = new Float32Array(n*n); return L; } // zones enregistrées avant l'ajout d'une couche
// obstacles traversés par le segment reliant deux centres de mailles voisines
// 4 directions canoniques : E, S, SE, SO (les 4 autres en sont les inverses)
const DIRS4 = [[1,0],[0,1],[1,1],[-1,1]];
// obstacles des lignes j0 ≤ j < j1, écrits dans F (n×n×4) : une bande de lignes à la fois (calcul en séquences)
function barriersLignes(M, n, W, F, j0, j1){
 for (let j = j0; j < j1; j++) for (let i = 0; i < n; i++) for (let d = 0; d < 4; d++) {
  const [dx, dy] = DIRS4[d], i2 = i+dx, j2 = j+dy;
  if (i2 < 0 || i2 >= n || j2 >= n) continue;
  const x0 = (i+0.5)*S, y0 = (j+0.5)*S, x1 = (i2+0.5)*S, y1 = (j2+0.5)*S;
  const steps = Math.ceil(Math.hypot(x1-x0, y1-y0)*2);
  let f = 0;
  for (let s = 0; s <= steps; s++) f |= M[Math.floor(y0 + (y1-y0)*s/steps)*W + Math.floor(x0 + (x1-x0)*s/steps)];
  F[(j*n + i)*4 + d] = f & BARRIER_BITS;
 }
 return F;
}
function barriers(M, n, W){ return barriersLignes(M, n, W, new Uint8Array(n*n*4), 0, n); }
// même calcul par bandes de 16 lignes (« yield » entre deux bandes) : résultat identique à barriers() ; avancement a0 → a0 + da
function* barriersEtapes(M, n, W, a0, da){
 a0 = a0 || 0; da = da === undefined ? 1 : da;
 const F = new Uint8Array(n*n*4);
 for (let j = 0; j < n; j += 16) { const j1 = Math.min(n, j + 16); barriersLignes(M, n, W, F, j, j1); yield ["obstacles entre mailles", a0 + da*j1/n]; }
 return F;
}
function edgeIdx(u, dx, dy){ // indice canonique de l'arc (maille u, direction dx, dy) dans G.F
 const n = G.n;
 if (dy < 0 || (dy === 0 && dx < 0)) { u = u + dy*n + dx; dx = -dx; dy = -dy; }
 return u*4 + (dy === 0 ? 0 : dx === 0 ? 1 : dx === 1 ? 2 : 3);
}
function edgeFlags(u, dx, dy){ return G.F[edgeIdx(u, dx, dy)]; }

/* ---------- cours d'eau sans pont : règle par classe (largeur, profondeur) ---------- */
// Largeur (m) à laquelle un cours d'eau sans largeur OSM est tracé dans le raster fin (donnees-osm.js) et en ligne (rendu-terrain.js).
// Le verdict, lui, prend P.eau.largeur_supposee_* ; le rattachement des pixels d'eau couvre la plus grande des deux (arcsEau).
const EAU_TRACE_M = {r:30, c:15};
// Valeur OSM de largeur ou de profondeur → mètres ; 0 = absente, illisible ou ambiguë (INCONNUE : la règle prend alors la valeur supposée,
// jamais une valeur minorée). Reconnu strictement : nombre décimal positif (point ou virgule), unité facultative m, cm, mm,
// ft / foot / feet / ', in / inch / inches / ", ou pieds-pouces 6'2" ; plage « a-b » → borne haute ; liste « a;b » → la plus grande.
// Tout le reste (notation exponentielle, négatif, zéro, « ~3 », « <1 », « 3 km », texte) → 0.
const UNITES_OSM = {"":1, m:1, cm:0.01, mm:0.001, ft:0.3048, foot:0.3048, feet:0.3048, "'":0.3048, in:0.0254, inch:0.0254, inches:0.0254, '"':0.0254};
function metresOSM(v){
 if (typeof v === "number") return v > 0 && isFinite(v) ? Math.round(v*100)/100 : 0;
 if (typeof v !== "string") return 0;
 const s = v.trim(); if (!s) return 0;
 // une valeur simple : [nombre, unité écrite ou ""] ou null
 const une = t => { t = t.trim();
  let m = t.match(/^(\d+)\s*'\s*(\d+(?:[.,]\d+)?)\s*"$/);   // pieds et pouces
  if (m) return [parseInt(m[1], 10)*0.3048 + parseFloat(m[2].replace(",", "."))*0.0254, "ft-in"];
  m = t.match(/^(\d+(?:[.,]\d+)?)\s*(m|cm|mm|ft|foot|feet|'|in|inch|inches|")?$/i);
  if (!m) return null;
  const u = (m[2] || "").toLowerCase();
  return [parseFloat(m[1].replace(",", ".")), u]; };
 const conv = ([x, u]) => u === "ft-in" ? x : x*UNITES_OSM[u];
 const plage = t => {   // « a-b » (tiret, tiret demi-cadratin) : borne haute ; unité seulement à la fin = commune aux deux bornes
  const p = t.split(/\s*[-\u2013]\s*/);
  if (p.length === 1) { const a = une(t); return a ? conv(a) : NaN; }
  if (p.length !== 2 || !p[0] || !p[1]) return NaN;
  const a = une(p[0]), b = une(p[1]); if (!a || !b) return NaN;
  if (a[1] === "" && b[1] !== "") a[1] = b[1];
  else if (a[1] !== "" && b[1] === "") return NaN;   // « 5 m-10 » : ambigu
  return Math.max(conv(a), conv(b)); };
 const xs = s.split(";").map(plage);
 if (xs.some(x => !(x > 0) || !isFinite(x))) return 0;
 const x = Math.round(Math.max(...xs)*100)/100;
 return x > 0 ? x : 0;
}
// Pour chaque arc tout-terrain qui traverse de l'eau (bit eau du raster fin), on cherche le cours d'eau OSM traversé
// (rivière ou canal de G.rivs, à moins de sa demi-largeur). Aucun cours d'eau trouvé = plan d'eau, mer ou rive cartographiée
// en surface : infranchissable pour toutes les classes. Sinon la classe passe si largeur ≤ eau_largeur_max_m et
// profondeur ≤ eau_profondeur_max_m (valeurs supposées P.eau.* quand OSM ne les donne pas), avec franchissement_eau_min.
// Arcs → liste des cours d'eau traversés (Map indice d'arc → tableau d'indices de G.rivs, -1 = plan d'eau)
function arcsEau(){
 // demi-largeur de rattachement d'un cours d'eau sans largeur OSM : la plus grande de la largeur tracée et de la largeur supposée
 // par les paramètres (P.eau), pour que les pixels d'eau suivent le verdict quand l'utilisateur change les paramètres
 const E = (P && P.eau) || DEF_TERRAIN.eau, sup = {r:Math.max(EAU_TRACE_M.r, +E.largeur_supposee_riviere_m || 0), c:Math.max(EAU_TRACE_M.c, +E.largeur_supposee_canal_m || 0)};
 const cle = sup.r + "|" + sup.c;
 if (G._arcsEau && G._arcsEauCle === cle) return G._arcsEau;
 const {n, W, M, b} = G, A = new Map(), riv = G.rivs || [], pxm = W/(n*G.cell);
 const X = lon => (lon - b.w)/(b.e - b.w)*W, Y = lat => (b.n - lat)/(b.n - b.s)*W;
 // segments des cours d'eau en pixels, rangés dans une grille de cases de S pixels
 const segs = [], H = new Map(), put = (k, s) => { let a = H.get(k); if (!a) H.set(k, a = []); a.push(s); };
 riv.forEach((r, ri) => {
  const w = r.w > 0 ? r.w : sup[r.k === "c" ? "c" : "r"], rad = Math.max(1.2, w*pxm)/2 + 1.5;   // demi-largeur tracée + marge (pixels)
  for (let q = 1; q < r.g.length; q++) {
   const s = {ri, rad, x0:X(r.g[q-1][0]), y0:Y(r.g[q-1][1]), x1:X(r.g[q][0]), y1:Y(r.g[q][1])}, si = segs.push(s) - 1;
   const i0 = Math.floor((Math.min(s.x0, s.x1) - rad)/S), i1 = Math.floor((Math.max(s.x0, s.x1) + rad)/S);
   const j0 = Math.floor((Math.min(s.y0, s.y1) - rad)/S), j1 = Math.floor((Math.max(s.y0, s.y1) + rad)/S);
   for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) put(i + "," + j, si);
  }
 });
 const rivAt = (x, y) => { // cours d'eau le plus proche couvrant le pixel (x, y), -1 sinon
  let best = -1, bd = Infinity;
  for (const si of H.get(Math.floor(x/S) + "," + Math.floor(y/S)) || []) { const s = segs[si], dx = s.x1 - s.x0, dy = s.y1 - s.y0, l2 = dx*dx + dy*dy;
   const t = l2 ? Math.max(0, Math.min(1, ((x - s.x0)*dx + (y - s.y0)*dy)/l2)) : 0, d = Math.hypot(s.x0 + t*dx - x, s.y0 + t*dy - y);
   if (d <= s.rad && d < bd) { bd = d; best = s.ri; } }
  return best;
 };
 for (let u = 0; u < n*n; u++) for (let d = 0; d < 4; d++) {
  const e = u*4 + d; if (!(G.F[e] & BIT.eau)) continue;
  const [dx, dy] = DIRS4[d], i = u % n, j = (u/n) | 0;
  const x0 = (i+0.5)*S, y0 = (j+0.5)*S, x1 = (i+dx+0.5)*S, y1 = (j+dy+0.5)*S, steps = Math.ceil(Math.hypot(x1-x0, y1-y0)*2), l = [];
  for (let s = 0; s <= steps; s++) { const x = x0 + (x1-x0)*s/steps, y = y0 + (y1-y0)*s/steps;
   if (!(M[Math.floor(y)*W + Math.floor(x)] & BIT.eau)) continue;
   const r = rivAt(Math.floor(x) + 0.5, Math.floor(y) + 0.5);
   if (r < 0) { l.length = 0; l.push(-1); break; }
   if (!l.includes(r)) l.push(r); }
  A.set(e, l.length ? l : [-1]);
 }
 G._arcsEauCle = cle;
 return G._arcsEau = A;
}
// verdict d'une classe pour un cours d'eau r de G.rivs (r < 0 ou absent = plan d'eau) : {ok, delai_min, largeur_m, profondeur_m, supposees, raison}
function verdictEau(r, k, p0){
 const pp = p0 || P, p = pp[k], E = pp.eau || DEF_TERRAIN.eau;
 if (!r) return {ok:false, raison:"plan d'eau, mer ou rive cartographiée en surface : infranchissable sans pont"};
 const canal = r.k === "c", sup = [];
 const larg = r.w > 0 ? r.w : (sup.push("largeur"), canal ? E.largeur_supposee_canal_m : E.largeur_supposee_riviere_m);
 const prof = r.p > 0 ? r.p : (sup.push("profondeur"), canal ? E.profondeur_supposee_canal_m : E.profondeur_supposee_riviere_m);
 const base = {largeur_m:larg, profondeur_m:prof, supposees:sup};
 if (canal && E.canal_infranchissable) return Object.assign(base, {ok:false, raison:"canal (berges aménagées) : infranchissable sans pont (eau.canal_infranchissable)"});
 if (!(p.franchissement_eau_min >= 0)) return Object.assign(base, {ok:false, raison:"classe sans franchissement d'eau (franchissement_eau_min < 0)"});
 const trop = [];
 if (!(larg <= p.eau_largeur_max_m)) trop.push(`largeur ${larg} m > ${p.eau_largeur_max_m} m`);
 if (!(prof <= p.eau_profondeur_max_m)) trop.push(`profondeur ${prof} m > ${p.eau_profondeur_max_m} m`);
 const sx = sup.length ? " (" + sup.join(" et ") + " supposée" + (sup.length > 1 ? "s" : "") + ")" : "";
 return trop.length ? Object.assign(base, {ok:false, raison:trop.join(", ") + sx})
  : Object.assign(base, {ok:true, delai_min:p.franchissement_eau_min, raison:`gué d'opportunité : largeur ${larg} m, profondeur ${prof} m${sx}, ${p.franchissement_eau_min} min`});
}
// délai (min) par arc traversant l'eau, pour une classe : Map indice d'arc → minutes, -1 = impossible ; mise en cache selon les paramètres
function penalitesEau(k){
 const A = arcsEau(), p = P[k], E = P.eau || {};
 const cle = JSON.stringify([E, p.eau_largeur_max_m, p.eau_profondeur_max_m, p.franchissement_eau_min]);
 const C = G._penEau || (G._penEau = {});
 if (C[k] && C[k].cle === cle && C[k].A === A) return C[k].m;
 const riv = G.rivs || [], v = riv.map((r, ri) => verdictEau(r, k)), m = new Map();
 for (const [e, l] of A) { let t = 0;
  for (const ri of l) { const x = ri < 0 ? null : v[ri]; if (!x || !x.ok) { t = -1; break; } t = Math.max(t, x.delai_min); }
  m.set(e, t); }
 C[k] = {cle, A, m};
 return m;
}
/* ---------- ouvrages et réseau routier ---------- */
function buildNetwork(){
 const {b, n, W, M} = G;
 const X = lon => (lon - b.w)/(b.e - b.w)*W, Y = lat => (b.n - lat)/(b.n - b.s)*W;
 const bitAlong = (g, mask) => {
  for (let q = 1; q < g.length; q++) {
   const x0 = X(g[q-1][0]), y0 = Y(g[q-1][1]), x1 = X(g[q][0]), y1 = Y(g[q][1]);
   const st = Math.max(1, Math.ceil(Math.hypot(x1-x0, y1-y0)*2));
   for (let s = 0; s <= st; s++) {
    const x = Math.floor(x0 + (x1-x0)*s/st), y = Math.floor(y0 + (y1-y0)*s/st);
    if (x >= 0 && y >= 0 && x < W && y < W && (M[y*W + x] & mask)) return true;
   }
  }
  return false;
 };
 // 1. ouvrages bruts
 const raw = [];
 G.ways.forEach((w, wi) => {
  if (w.rail) { // pont ferroviaire : passage d'une route sous la voie
   if (!bitAlong(w.g, BIT.eau | BIT.ruisseau) && bitAlong(w.g, BIT.route)) { const [lon, lat, len] = midLen(w.g); raw.push({type:"fer", sub:"dessous", lon, lat, nm:w.nm, len, maj:0, ways:[], nodes:[]}); }
   return;
  }
  if (w.fd) { const [lon, lat, len] = midLen(w.g); raw.push({type:"gue", sub:"", lon, lat, nm:w.nm, len, maj:0, ways:[wi], nodes:[]}); return; }
  if (!w.br && !w.tu) return;
  const [lon, lat, len] = midLen(w.g);
  let type = "deniv", sub = "", maj = 0;
  if (w.tu) type = "tunnel";
  else if (bitAlong(w.g, BIT.eau)) { type = "pont"; maj = 1; }
  else if (bitAlong(w.g, BIT.ruisseau)) type = "pont";
  else if (bitAlong(w.g, BIT.fer)) { type = "fer"; sub = "dessus"; }
  raw.push({type, sub, lon, lat, nm:w.nm, len, maj, ways:[wi], nodes:[]});
 });
 const PN = {pn:"fer", echangeur:"echangeur", gue:"gue"};
 for (const p of G.pnodes) raw.push({type:PN[p.t], sub: p.t === "pn" ? "pn" : "", lon:p.lon, lat:p.lat, nm:p.nm, len:0, maj:0, ways:[], nodes:["n" + p.id]});
 // 2. regroupement (chaussées doubles, tronçons successifs d'un même ouvrage)
 //    (grille de hachage de pas 2×tol : même résultat que la recherche du premier ouvrage à moins de tol, sans parcourir toute la liste)
 const tol = P.regroupement_ouvrages_m, feats = [], hs = 2*Math.max(1, tol), kx = 111320*Math.cos((b.n + b.s)/2*Math.PI/180), H = new Map();
 const hkey = (lon, lat) => Math.floor(lon*kx/hs) + "," + Math.floor(lat*110574/hs);
 const hput = (k, i) => { let a = H.get(k); if (!a) H.set(k, a = []); a.push(i); };
 for (const r of raw) {
  const bx = Math.floor(r.lon*kx/hs), by = Math.floor(r.lat*110574/hs);
  let fi = -1;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of H.get((bx+dx) + "," + (by+dy)) || [])
   if ((fi < 0 || i < fi) && feats[i].type === r.type && distM([feats[i].lon, feats[i].lat], [r.lon, r.lat]) <= tol) fi = i;
  if (fi >= 0) { const f = feats[fi], k0 = hkey(f.lon, f.lat);
   f.k++; f.lon += (r.lon - f.lon)/f.k; f.lat += (r.lat - f.lat)/f.k; f.nm = f.nm || r.nm; f.len = Math.max(f.len, r.len);
   f.maj = f.maj || r.maj; f.ways.push(...r.ways); f.nodes.push(...r.nodes); if (r.sub && !f.subs.includes(r.sub)) f.subs.push(r.sub);
   const k1 = hkey(f.lon, f.lat); if (k1 !== k0) { const a = H.get(k0); a.splice(a.indexOf(fi), 1); hput(k1, fi); } }
  else { feats.push({type:r.type, lon:r.lon, lat:r.lat, nm:r.nm, len:r.len, maj:r.maj, ways:r.ways.slice(), nodes:r.nodes.slice(), subs:r.sub ? [r.sub] : [], k:1, g:{}}); hput(hkey(r.lon, r.lat), feats.length - 1); }
 }
 const wayFeat = new Int32Array(G.ways.length).fill(-1), nodeFeat = new Map();
 feats.forEach((f, i) => { f.ways.forEach(w => wayFeat[w] = i); f.nodes.forEach(k => nodeFeat.set(k, i)); });
 idsOuvrages(feats);
 const isGue = key => { const f = nodeFeat.get(key); return f !== undefined && feats[f].type === "gue"; };
 // 3. graphe routier : nœuds = nœuds OSM (jonctions réelles), sortie tout-terrain interdite sur ponts, tunnels et autoroutes
 //    arc = [destination, longueur km, catégorie, ouvrage, gué (délai appliqué une seule fois par gué)]
 const R = {lon:[], lat:[], cell:[], dc:[], adj:[], exit:[]}, ids = new Map(), gueDone = new Set();
 const cellOf = (lon, lat) => { const i = Math.floor((lon-b.w)/(b.e-b.w)*n), j = Math.floor((b.n-lat)/(b.n-b.s)*n);
  return (i < 0 || j < 0 || i >= n || j >= n) ? -1 : j*n + i; };
 const nodeId = (key, lon, lat) => { let id = ids.get(key);
  if (id === undefined) { id = R.lon.length; ids.set(key, id); const c = cellOf(lon, lat);
   R.lon.push(lon); R.lat.push(lat); R.cell.push(c); R.adj.push([]); R.exit.push(0);
   R.dc.push(c < 0 ? 0 : distM([lon, lat], [b.w + (c%n + 0.5)/n*(b.e-b.w), b.n - (Math.floor(c/n) + 0.5)/n*(b.n-b.s)])/1000); }
  return id; };
 const roadF = [];
 G.ways.forEach((w, wi) => {
  if (w.rail) return;
  const cat = roadCat(w.hw), acc = !w.br && !w.tu && !/^motorway/.test(w.hw);
  roadF.push({type:"Feature", geometry:{type:"LineString", coordinates:w.g}, properties:{c:cat, tu:w.tu}});
  const keys = w.g.map((p, i) => w.nd ? "n" + w.nd[i] : p[0].toFixed(6) + "," + p[1].toFixed(6));
  const midEdge = Math.max(1, Math.floor(w.g.length/2));
  let prev = -1;
  w.g.forEach((p, i) => {
   const id = nodeId(keys[i], p[0], p[1]);
   if (acc) R.exit[id] = 1;
   if (prev >= 0 && prev !== id && R.cell[prev] >= 0 && R.cell[id] >= 0) {
    const len = distM([R.lon[prev], R.lat[prev]], [R.lon[id], R.lat[id]])/1000;
    let f = wayFeat[wi];
    if (f < 0) { f = nodeFeat.get(keys[i-1]) ?? nodeFeat.get(keys[i]) ?? -1; // passage à niveau, gué ponctuel, échangeur
     if (f >= 0 && feats[f].type === "echangeur" && w.hw === "motorway") f = -1; }  // échangeur : seules les bretelles en dépendent
    let gue = 0;
    if (w.fd) { if (i === midEdge) gue = 1; }
    else { const gk = isGue(keys[i]) ? keys[i] : isGue(keys[i-1]) ? keys[i-1] : null; if (gk && !gueDone.has(gk)) { gueDone.add(gk); gue = 1; } }
    R.adj[prev].push(id, len, cat, f, gue); R.adj[id].push(prev, len, cat, f, gue);
   }
   prev = id;
  });
 });
 const cellRoads = new Map();
 R.cell.forEach((c, r) => { if (c >= 0 && R.exit[r]) { if (!cellRoads.has(c)) cellRoads.set(c, []); cellRoads.get(c).push(r); } });
 G.R = R; G.cellRoads = cellRoads; G.feats = feats; G.roadsFC = FC(roadF);
}

// identifiant stable d'ouvrage : type + plus petit identifiant de nœud OSM de l'ouvrage (voies et points regroupés),
// à défaut type + position arrondie (~1 m) ; doublons départagés par « #2 », « #3 »… dans l'ordre des ouvrages.
// Il ne dépend que des données OSM : il survit à un recalcul et, en général, à une nouvelle analyse de la même zone.
function idsOuvrages(feats){
 const vus = new Map();
 for (const f of feats) {
  let m = null;
  const prend = id => { if (id == null) return; const s = String(id).replace(/^n/, ""); if (!/^\d+$/.test(s)) return; if (m === null || s.length < m.length || (s.length === m.length && s < m)) m = s; };
  f.nodes.forEach(prend);
  for (const wi of f.ways) { const w = G.ways[wi]; if (w && w.nd) w.nd.forEach(prend); }
  let id = f.type + ":" + (m !== null ? "n" + m : "@" + f.lon.toFixed(5) + "," + f.lat.toFixed(5));
  const k = (vus.get(id) || 0) + 1; vus.set(id, k); if (k > 1) id += "#" + k;
  f.id = id;
 }
}
// coupures d'ouvrages (détruit, bloqué, dégradé) : rattachées par identifiant stable d'ouvrage (champ « ouvrage ») ;
// repli pour les fichiers anciens ou un ouvrage disparu : même type à moins de max(100 m, regroupement_ouvrages_m).
// Une coupure rattachée par le repli reçoit l'identifiant de l'ouvrage trouvé (migration silencieuse).
const ETAT_COUPE = {detruit:1, bloque:1, degrade:2};
function appliquerCoupures(){
 const F = G.feats || [], c = new Uint8Array(F.length), idx = new Int32Array(F.length).fill(-1), parId = new Map();
 F.forEach((f, i) => { if (f.id) parId.set(f.id, i); });
 (G.coupures || []).forEach((x, j) => {
  let best = x.ouvrage != null && parId.has(x.ouvrage) ? parId.get(x.ouvrage) : -1;
  if (best >= 0 && F[best].type !== x.type && x.type) best = -1;
  x.par = best >= 0 ? "id" : "";
  if (best < 0) {
   let bd = Math.max(100, P.regroupement_ouvrages_m || 0);
   F.forEach((f, i) => { if (f.type !== x.type) return; const d = distM([f.lon, f.lat], [x.lon, x.lat]); if (d <= bd) { bd = d; best = i; } });
   if (best >= 0) { x.par = "position"; x.ouvrage = F[best].id; }
  }
  x.i = best; if (best >= 0) { c[best] = ETAT_COUPE[x.etat] || 0; idx[best] = j; }
 });
 G.coupe = c; G.coupeIdx = idx;
}

/* ---------- modèle ---------- */
const lin = (s, a, b) => s <= a ? 1 : s >= b ? 0 : 1 - (s-a)/(b-a);
const TOB0 = Math.exp(-3.5*0.05);
const tobler = s => Math.exp(-3.5*Math.abs(s/100 + 0.05))/TOB0; // s en % (signé), 1 sur le plat
// facteur de pente directionnel : montée/descente le long du mouvement + dévers
function slopeFactor(along, cross, p){
 const fa = p.modele_pente === "tobler" ? tobler(along)
  : along >= 0 ? lin(along, p.pente_GO_max_pct, p.pente_NOGO_pct) : lin(-along, p.pente_GO_max_pct*1.5, p.pente_NOGO_pct*1.2);
 return fa * lin(cross, p.devers_max*0.5, p.devers_max);
}
// facteur de pente isotrope (pente la plus forte de la maille, en montée) pour la couleur et l'explication
const slopeIso = (s, p) => p.modele_pente === "tobler" ? Math.min(1, tobler(s)) : lin(s, p.pente_GO_max_pct, p.pente_NOGO_pct);
const slopeClass = (s, p) => s < p.pente_GO_max_pct ? 3 : s < p.pente_NOGO_pct ? 2 : 1;
const covClass = r => r >= P.seuil_GO ? 3 : r >= P.seuil_SLOWGO ? 2 : 1;
function chamfer(seed, n){
 const D = new Float32Array(n*n);
 for (let k = 0; k < n*n; k++) D[k] = seed[k] ? 0 : 1e9;
 for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j*n+i; let v = D[k];
  if (i > 0) v = Math.min(v, D[k-1]+3);
  if (j > 0) { v = Math.min(v, D[k-n]+3); if (i > 0) v = Math.min(v, D[k-n-1]+4); if (i < n-1) v = Math.min(v, D[k-n+1]+4); }
  D[k] = v; }
 for (let j = n-1; j >= 0; j--) for (let i = n-1; i >= 0; i--) { const k = j*n+i; let v = D[k];
  if (i < n-1) v = Math.min(v, D[k+1]+3);
  if (j < n-1) { v = Math.min(v, D[k+n]+3); if (i < n-1) v = Math.min(v, D[k+n+1]+4); if (i > 0) v = Math.min(v, D[k+n-1]+4); }
  D[k] = v; }
 for (let k = 0; k < n*n; k++) D[k] /= 3;
 return D;
}
const NB = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
function labelMask(mask){ // composantes 8-connexes : liste des mailles de chacune, étiquette par maille (0 = aucune)
 const n = G.n, N = n*n, lab = new Int32Array(N), comps = [];
 for (let s = 0; s < N; s++) {
  if (!mask[s] || lab[s]) continue;
  const id = comps.length + 1, st = [s], cells = []; lab[s] = id;
  while (st.length) { const c = st.pop(); cells.push(c); const i = c % n, j = (c/n) | 0;
   for (const [dx, dy] of NB) { const a = i+dx, b = j+dy; if (a < 0 || b < 0 || a >= n || b >= n) continue; const w = b*n + a; if (mask[w] && !lab[w]) { lab[w] = id; st.push(w); } } }
  comps.push(cells);
 }
 return {lab, comps};
}
function zoneInfo(cells){ // surface, axe principal, dimensions, centre
 const n = G.n;
 let mx = 0, my = 0; for (const c of cells) { mx += c % n; my += (c/n) | 0; } mx /= cells.length; my /= cells.length;
 let xx = 0, yy = 0, xy = 0; for (const c of cells) { const x = c % n - mx, y = ((c/n) | 0) - my; xx += x*x; yy += y*y; xy += x*y; }
 const th = 0.5*Math.atan2(2*xy, xx - yy), ux = Math.cos(th), uy = Math.sin(th); // axe en (est, sud)
 let p0 = Infinity, p1 = -Infinity; for (const c of cells) { const pr = (c % n - mx)*ux + (((c/n) | 0) - my)*uy; p0 = Math.min(p0, pr); p1 = Math.max(p1, pr); }
 const bearing = ((Math.atan2(ux, -uy)*180/Math.PI) + 360) % 180;
 const area = cells.length*G.cell*G.cell/1e6, len = (p1 - p0 + 1)*G.cell/1000;
 return {area, len, wid: area/Math.max(len, 1e-6), axe: ["N-S","NE-SO","E-O","SE-NO"][Math.round(bearing/45) % 4],
  lon: G.b.w + (mx+0.5)/n*(G.b.e-G.b.w), lat: G.b.n - (my+0.5)/n*(G.b.n-G.b.s)};
}
function couloirsEtAxes(corr){
 const N = G.n*G.n, {comps} = labelMask(corr);
 const zs = comps.map(cells => Object.assign(zoneInfo(cells), {cells})).filter(z => z.area >= P.surface_min_couloir_km2).sort((a, b) => b.area - a.area);
 const keep = new Uint8Array(N); zs.forEach(z => z.cells.forEach(c => keep[c] = 1));
 const D = chamfer(keep, G.n), half = P.ecart_max_axe_m/2/G.cell, dil = new Uint8Array(N);
 for (let c = 0; c < N; c++) dil[c] = D[c] <= half;
 const L2 = labelMask(dil), groups = new Map();
 zs.forEach((z, i) => { const l = L2.lab[z.cells[0]]; if (!groups.has(l)) groups.set(l, []); groups.get(l).push(i); });
 const axes = [], mask = new Uint8Array(N);
 for (const [l, ids] of groups) {
  if (ids.length < 2) continue;
  const cells = ids.flatMap(i => zs[i].cells), info = zoneInfo(cells);
  axes.push(Object.assign(info, {nb:ids.length, couloirs:ids.map(i => i + 1)}));
  for (const c of L2.comps[l-1]) mask[c] = 1;
 }
 axes.sort((a, b) => b.area - a.area);
 return {zs, axes, mask};
}
/* ---------- coupures : recalcul du réseau, zones coupées ---------- */
// recalcul après une coupure : seul le réseau change (les classes GO/SLOW-GO/NO-GO des mailles restent les mêmes)
// étapes de a à b (avancement) : goulets par arme, couloirs A→B, zones coupées par arme
function* reseauEtapes(a = 0, b = 1){
 appliquerCoupures();
 G.feats.forEach(f => f.g = {});
 const st = (b - a)/(ARMS.length*2 + 1); let x = a;
 for (const k of ARMS) { yield ["Goulets : " + ARM_LBL[k].toLowerCase(), x]; x += st; G.gou[k] = goulets(k); for (const g of G.gou[k]) G.feats[g.f].g[k] = g.pct; }
 yield ["Couloirs A→B", x]; x += st;
 G.cl = G.couloirs.map(couloirMask);
 const any = G.coupe && G.coupe.some(v => v === 1), N = G.n*G.n; G.iso = {}; G.isoPct = {};
 for (const k of ARMS) { if (any) yield ["Zones coupées : " + ARM_LBL[k].toLowerCase(), x]; x += st; zoneCoupee(k, any, N); }
}
function recalcReseau(){ for (const _ of reseauEtapes()); }
// composantes connexes du graphe de déplacement d'une arme (avec ou sans les coupures)
function composantes(k, ignoreCut){
 const X = ctxOf(k); X.ignoreCut = ignoreCut;
 const N = X.N, M = N + X.R.lon.length, par = new Int32Array(M);
 for (let i = 0; i < M; i++) par[i] = i;
 const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
 for (let u = 0; u < M; u++) forEachEdge(u, X, w => { const a = find(u), b2 = find(w); if (a !== b2) par[a] = b2; });
 const root = new Int32Array(N), cnt = new Map(); let main = -1, best = 0;
 for (let c = 0; c < N; c++) { if (X.v[c] <= 0) { root[c] = -1; continue; }
  const r = find(c), q = (cnt.get(r) || 0) + 1; root[c] = r; cnt.set(r, q); if (q > best) { best = q; main = r; } }
 return {root, main};
}
// zones coupées : mailles reliées au reste de la zone avant les coupures, isolées après (par arme)
function zoneCoupee(k, any, N){
 const m = new Uint8Array(N); let s = 0;
 if (any) { const a = composantes(k, true), b2 = composantes(k, false);
  for (let c = 0; c < N; c++) if (a.root[c] === a.main && b2.root[c] !== b2.main) { m[c] = 1; s++; } }
 G.iso[k] = m; G.isoPct[k] = s/N*100;
}
function zonesCoupees(){ const N = G.n*G.n, any = G.coupe && G.coupe.some(x => x === 1); G.iso = {}; G.isoPct = {}; for (const k of ARMS) zoneCoupee(k, any, N); }



/* ---------- intervisibilité ---------- */
function surfaceHeights(){
 const {n, L, el} = G, V = P.vue, H = new Float32Array(n*n);
 for (let c = 0; c < n*n; c++) H[c] = el[c] + (L.foret[c] >= 0.5 ? V.hauteur_foret_m : L.bati[c] >= 0.5 ? V.hauteur_bati_m : 0);
 return H;
}
// mailles vues depuis une maille (rayons vers le pourtour du carré de portée, angle maximal cumulé)
function viewshed(o, H, hObs = P.vue.hauteur_observateur_m, hTgt = P.vue.hauteur_cible_m){
 const {n, cell, el} = G, V = P.vue, Rc = Math.ceil(V.portee_m/cell);
 const oi = o % n, oj = (o/n) | 0, z0 = el[o] + hObs, kc = 0.87/(2*6371000);
 const vis = new Uint8Array(n*n); vis[o] = 1;
 const ray = (ti, tj) => {
  const dx = ti - oi, dy = tj - oj, steps = Math.max(Math.abs(dx), Math.abs(dy))*2; let maxA = -Infinity;
  for (let s = 1; s <= steps; s++) {
   const fi = oi + dx*s/steps, fj = oj + dy*s/steps, i = Math.round(fi), j = Math.round(fj);
   if (i < 0 || j < 0 || i >= n || j >= n) break;
   const d = Math.hypot(fi - oi, fj - oj)*cell; if (d > V.portee_m) break;
   const c = j*n + i, drop = kc*d*d;
   if ((el[c] + hTgt - drop - z0)/d >= maxA) vis[c] = 1;
   const a = (H[c] - drop - z0)/d; if (a > maxA) maxA = a;
  }
 };
 for (let t = -Rc; t <= Rc; t++) { ray(oi+t, oj-Rc); ray(oi+t, oj+Rc); ray(oi-Rc, oj+t); ray(oi+Rc, oj+t); }
 return vis;
}
/* ---------- graphe de déplacement ---------- */
// nœuds 0..N-1 = mailles (tout-terrain), N..N+R-1 = nœuds routiers
function ctxOf(k){ return {n:G.n, N:G.n*G.n, R:G.R, p:P[k], v:G.v[k], dk:G.cell/1000, rs:ROADKEYS.map(x => P[k][x]), pe:penalitesEau(k)}; }
// appelle cb(w, temps_h, longueur_km, maille1, maille2, ouvrage) pour chaque arc sortant de u
function forEachEdge(u, X, cb){
 const {n, N, R, p, v, dk, rs} = X;
 if (u < N) {
  if (v[u] <= 0) return;
  const ui = u % n, uj = (u/n) | 0;
  for (const [dx, dy] of NB) {
   const i = ui+dx, j = uj+dy; if (i < 0 || j < 0 || i >= n || j >= n) continue;
   const w = j*n + i; if (v[w] <= 0) continue;
   const e = edgeIdx(u, dx, dy), fl = G.F[e];
   let pen = 0;
   if (fl & 1) { const t = X.pe.get(e); if (!(t >= 0)) continue; pen += t; }   // eau : gué selon largeur, profondeur et classe (sinon route seulement)
   if (fl & 2) { if (p.franchissement_ruisseau_min < 0) continue; pen += p.franchissement_ruisseau_min; }
   if (fl & 4) { if (p.franchissement_autoroute_min < 0) continue; pen += p.franchissement_autoroute_min; }
   if (fl & 8) { if (p.franchissement_voie_ferree_min < 0) continue; pen += p.franchissement_voie_ferree_min; }
   if (fl & 32) { if (p.franchissement_haie_min < 0) continue; pen += p.franchissement_haie_min; }
   const h = Math.hypot(dx, dy), len = h*dk, ex = dx/h, ey = dy/h;
   const along = (G.el[w] - G.el[u])/(len*1000)*100;
   const gx = (G.gx[u] + G.gx[w])/2, gy = (G.gy[u] + G.gy[w])/2, cross = Math.abs(gx*ey - gy*ex)*100;
   const fs = slopeFactor(along, cross, p); if (fs < 0.02) continue;
   cb(w, (len/2/v[u] + len/2/v[w])/fs + pen/60, len, u, w, -1);
  }
  const rr = G.cellRoads.get(u); if (rr) for (const r of rr) cb(N + r, R.dc[r]/v[u], R.dc[r], u, u, -1);
 } else {
  const r = u - N, a = R.adj[r];
  for (let q = 0; q < a.length; q += 5) {
   const sp = rs[a[q+2]]; if (!(sp > 0)) continue;
   let t = a[q+1]/sp;
   if (a[q+4]) { if (p.franchissement_gue_min < 0) continue; t += p.franchissement_gue_min/60; }
   const ce = a[q+3] >= 0 && G.coupe && !X.ignoreCut ? G.coupe[a[q+3]] : 0;   // ouvrage coupé (1) ou dégradé (2)
   if (ce === 1) continue; if (ce === 2) t *= P.facteur_temps_ouvrage_degrade || 3;
   cb(N + a[q], t, a[q+1], R.cell[r], R.cell[a[q]], a[q+3]);
  }
  const c = R.cell[r]; if (R.exit[r] && c >= 0 && v[c] > 0) cb(c, R.dc[r]/v[c], R.dc[r], c, c, -1);
 }
}
// Dijkstra multi-sources
function search(sources, k){
 const X = ctxOf(k), M = X.N + X.R.lon.length;
 const T = new Float64Array(M).fill(Infinity), done = new Uint8Array(M);
 const hk = [], hv = [];
 const push = (key, val) => { hk.push(key); hv.push(val); let i = hk.length-1;
  while (i > 0) { const q = (i-1) >> 1; if (hk[q] <= hk[i]) break; [hk[q],hk[i]] = [hk[i],hk[q]]; [hv[q],hv[i]] = [hv[i],hv[q]]; i = q; } };
 const pop = () => { const top = hv[0], lk = hk.pop(), lv = hv.pop();
  if (hk.length) { hk[0] = lk; hv[0] = lv; let i = 0;
   for (;;) { const l = 2*i+1, r = l+1; let m = i;
    if (l < hk.length && hk[l] < hk[m]) m = l; if (r < hk.length && hk[r] < hk[m]) m = r;
    if (m === i) break; [hk[m],hk[i]] = [hk[i],hk[m]]; [hv[m],hv[i]] = [hv[i],hv[m]]; i = m; } }
  return top; };
 for (const s of sources) { T[s] = 0; push(0, s); }
 let u;
 const relax = (w, dt) => { if (done[w]) return; const nt = T[u] + dt; if (nt < T[w]) { T[w] = nt; push(nt, w); } };
 while (hk.length) { u = pop(); if (done[u]) continue; done[u] = 1; forEachEdge(u, X, relax); }
 return T;
}
function cellAt(ll){
 const b = G.b, n = G.n;
 const i = Math.floor((ll.lng - b.w)/(b.e - b.w)*n), j = Math.floor((b.n - ll.lat)/(b.n - b.s)*n);
 return (i < 0 || j < 0 || i >= n || j >= n) ? -1 : j*n + i;
}
function cellLL(k){ const b = G.b, n = G.n, i = k % n, j = Math.floor(k/n);
 return [b.w + (i+0.5)/n*(b.e-b.w), b.n - (j+0.5)/n*(b.n-b.s)]; }
function b64(a){ const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = "";
 for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
const TA = {Float32Array, Float64Array, Uint8Array, Int32Array};
// encodage d'un tableau binaire : {type, b64} ; tolérant (absent = absent, déjà encodé = inchangé)
const enc = a => a == null ? a : (a.b64 !== undefined ? a : {type:a.constructor.name, b64:b64(a)});
function dec(o){ if (o == null || ArrayBuffer.isView(o)) return o;
 const s = atob(o.b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new TA[o.type](u.buffer); }

/* ---------- contrat JSON terrain-gtia (voir CONTRAT-JSON.md) : lecture unique, export v3 ---------- */
const VERSION_TERRAIN = 3;
// identifiant d'un fichier sans « id » (version 2) : empreinte du nom, de la date et de l'emprise (même fichier = même identifiant)
function idFichier(o){
 const f = o.faits || {}, sig = [o.nom, o.date, f.bbox && f.bbox.w, f.bbox && f.bbox.s, f.n, f.maille_m].join("|");
 let h = 0; for (let i = 0; i < sig.length; i++) h = (h*31 + sig.charCodeAt(i)) | 0;
 return "f" + (h >>> 0).toString(36);
}
// Lecture de tout ce qui décrit un terrain : fichier terrain-gtia v2 ou v3, zone enregistrée v3 (même contenu que le fichier),
// zone enregistrée ancienne (avant v3 : faits en tableaux binaires, clés courtes). Renvoie les faits décodés et les saisies ;
// les résultats éventuellement présents sont ignorés : ils sont toujours recalculés (un seul chemin de calcul).
function lireTerrain(o){
 if (!o || typeof o !== "object") throw new Error("terrain illisible");
 if (o.format === "terrain-gtia") {
  const v = +o.version || 0;
  if (v > VERSION_TERRAIN) throw new Error(`fichier terrain de version ${v}, plus récente que cet outil (version ${VERSION_TERRAIN}) : mettez l'outil à jour`);
  if (v < 2) throw new Error("fichier terrain trop ancien (version " + (o.version || "?") + ") : réanalysez la zone");
  const f = o.faits, gr = f && f.grilles;
  if (!gr || !f.obstacles_fins) throw new Error("fichier terrain sans faits (grilles, obstacles) : réexportez-le depuis l'outil terrain");
  const L = {}; for (const k of LAYERS) if (gr["fraction_" + k]) L[k] = dec(gr["fraction_" + k]);
  return {id:o.id || idFichier(o), t:o.t || null, nom:o.nom, date:o.date, version:v, parametres:o.parametres,
   faits:{b:f.bbox, n:f.n, cell:f.maille_m, W:f.W, sl:dec(gr.pente_pct), el:dec(gr.altitude_m), gx:dec(gr.gradient_est), gy:dec(gr.gradient_sud),
    L:ensureLayers(L, f.n), M:dec(f.obstacles_fins.donnees), ways:f.voies || [], pnodes:f.points || [], rivs:f.cours_eau || null, rus:f.ruisseaux || null},
   couloirs:o.couloirs || [], obs:o.obs || [], vus:o.vus || [], coupures:o.coupures || [], journal:o.journal_coupures || o.journal || []};
 }
 const f = o.faits;
 if (f && f.b && f.sl) {   // zone enregistrée avant la version 3 (tableaux binaires, ou encodés base64 par les outils ennemi)
  const L = {}; for (const k in f.L || {}) L[k] = dec(f.L[k]);
  return {id:o.id, t:o.t || null, nom:o.nom, date:o.date, version:0, parametres:o.parametres,
   faits:{b:f.b, n:f.n, cell:f.cell, W:f.W, sl:dec(f.sl), el:dec(f.el), gx:dec(f.gx), gy:dec(f.gy), L:ensureLayers(L, f.n), M:dec(f.M),
    ways:f.ways || [], pnodes:f.pnodes || [], rivs:f.rivs || null, rus:f.rus || null},
   couloirs:o.couloirs || [], obs:o.obs || [], vus:o.vus || [], coupures:o.coupures || [], journal:o.journal || []};
 }
 throw new Error("ce n'est pas un fichier terrain-gtia (exporté par l'outil terrain)");
}
// Pose G (faits, saisies) et P (paramètres complétés par DEF_TERRAIN), puis obstacles fins (par bandes de lignes), réseau routier, ouvrages et coupures.
// params : jeu de paramètres à utiliser à la place de celui du terrain (facultatif).
function* preparerTerrainEtapes(o, params){
 const z = lireTerrain(o), f = z.faits;
 G = {id:z.id, t:z.t, nom:z.nom, date:z.date, versionSource:z.version, b:f.b, n:f.n, cell:f.cell, W:f.W, sl:f.sl, el:f.el, gx:f.gx, gy:f.gy,
  L:f.L, M:f.M, ways:f.ways, pnodes:f.pnodes, rivs:f.rivs, rus:f.rus,
  couloirs:z.couloirs, obs:z.obs, vus:z.vus, coupures:z.coupures, journal:z.journal};
 P = withDefaultsTerrain(params !== undefined ? params : z.parametres);
 G.F = yield* barriersEtapes(G.M, G.n, G.W, 0, 0.02);
 yield ["Réseau routier et ouvrages", 0.02];
 buildNetwork(); appliquerCoupures();
 return G;
}
function preparerTerrain(o, params){ return finir(preparerTerrainEtapes(o, params)); }
function finirTerrain(){ G.hpExp = G.hp.map(h => ({lonlat:cellLL(h.c)})); G.sol = P.sol_humide ? "humide" : "sec"; G._pret = true; return G; }
// chemin unique d'ouverture d'un terrain, découpé en étapes [texte, avancement]
function* ouvrirTerrainEtapes(o, params){
 yield* preparerTerrainEtapes(o, params);
 yield* computeEtapes();
 finirTerrain();
}
function ouvrirTerrain(o, params){ for (const _ of ouvrirTerrainEtapes(o, params)); return G; }
// Fichier exporté (v2 ou v3) : même calcul qu'une zone enregistrée. Les paramètres du fichier sont complétés sur place
// (o.parametres devient P) : les pages qui reprennent ensuite terr.parametres obtiennent des paramètres complets.
function chargerTerrain(o){
 ouvrirTerrain(o);
 if (o && typeof o === "object") o.parametres = P;
 return G;
}
// taille d'une zone enregistrée (pour les listes), quel que soit son format
function infoZone(z){ const f = z.faits || {}, n = f.n, cell = f.maille_m || f.cell; return {n, cell, km:n*cell/1000}; }

// Document terrain-gtia version 3 : contenu du fichier exporté ET de la zone enregistrée dans le navigateur (IndexedDB).
const ENC_CACHE = new WeakMap();   // encodages déjà faits (les tableaux ne sont jamais modifiés en place : un recalcul crée de nouveaux tableaux)
const encC = a => { if (a == null) return a; let e = ENC_CACHE.get(a); if (!e) { e = enc(a); ENC_CACHE.set(a, e); } return e; };
function documentTerrain(){
 const N = G.n*G.n, zinfo = z => ({surface_km2:z.area, orientation:z.axe, longueur_km:z.len, largeur_moy_km:z.wid, centre:[z.lon, z.lat]});
 let eau = 0; for (let c = 0; c < N; c++) if (G.cls.chenille[c] === 0) eau++;
 const land = Math.max(1, N - eau), pct = (cl, v) => { let s = 0; for (let c = 0; c < N; c++) if (cl[c] === v) s++; return s/land*100; };
 const etat = i => G.coupeIdx && G.coupeIdx[i] >= 0 ? G.coupures[G.coupeIdx[i]].etat : "intact";
 return {
  format:"terrain-gtia", version:VERSION_TERRAIN, id:G.id, t:G.t || null, nom:G.nom, date:G.date,
  note:"Contrat : CONTRAT-JSON.md. Grilles de n×n mailles, ligne 0 au nord, colonne 0 à l'ouest. Tableaux binaires {type, b64} encodés en base64 (petit-boutiste). Seuils fictifs ou de seconde main (voir parametres._sources). Les résultats sont recalculés à l'ouverture.",
  parametres:P,
  faits:{
   bbox:G.b, n:G.n, maille_m:G.cell, sur_echantillonnage:S, W:G.W,
   grilles:{altitude_m:encC(G.el), pente_pct:encC(G.sl), gradient_est:encC(G.gx), gradient_sud:encC(G.gy),
    ...Object.fromEntries(LAYERS.map(k => ["fraction_" + k, encC(G.L[k])]))},
   obstacles_fins:{bits:BIT, donnees:encC(G.M)},
   voies:G.ways, points:G.pnodes, cours_eau:G.rivs || null, ruisseaux:G.rus || null
  },
  resultats:{
   sol:P.sol_humide ? "humide" : "sec",
   legende_classes:{0:"eau", 1:"NO-GO", 2:"SLOW-GO", 3:"GO"},
   par_arme:Object.fromEntries(ARMS.map(k => [k, {
    classes:encC(G.cls[k]), vitesse_kmh:encC(G.v[k]), couloirs_mobilite:encC(G.corr[k]), couvert:encC(G.cov[k]),
    pourcentages_hors_eau:{GO:pct(G.cls[k], 3), SLOW_GO:pct(G.cls[k], 2), NO_GO:pct(G.cls[k], 1)},
    couloirs:G.zs[k].map(zinfo),
    axes_approche:G.axes[k].map(x => Object.assign(zinfo(x), {nb_couloirs:x.nb, couloirs:x.couloirs})),
    goulets:G.gou[k].map(g => ({ouvrage:g.f, id_ouvrage:G.feats[g.f].id, isole_pct:g.pct})),
    zones_coupees:{pct:G.isoPct[k], masque:encC(G.iso[k])}}])),
   ouvrages:G.feats.map((f, i) => ({id:i, id_ouvrage:f.id, type:f.type, precision:f.subs, nom:f.nm, lon:f.lon, lat:f.lat, longueur_m:Math.round(f.len), cours_eau_important:!!f.maj, etat:etat(i)})),
   intervisibilite:{
    points_hauts:G.hp.map(h => ({lonlat:cellLL(h.c), altitude_m:h.el, domine_m:h.prom, vue_pct:h.pct})),
    nb_points_hauts_voyant:encC(G.vueCnt),
    points_observation:(G.obs || []).map((o, i) => ({lonlat:cellLL(o), vue_pct:G.obsPct[i]})),
    qui_voit:(G.vus || []).map((o, i) => ({lonlat:cellLL(o), visible_depuis_pct:G.vusInfo[i].pct, points_hauts:G.vusInfo[i].hp})),
    zones_voyant_mes_points:encC(G.vusV)
   },
   couloirs_AB:(G.couloirs || []).map((c, i) => { const r = G.cl && G.cl[i]; return {arme:c.k, depart:cellLL(c.a), arrivee:cellLL(c.b), meilleur_temps_h:r && r.ok ? r.best : null, masque:r && r.ok ? encC(r.m) : null}; })
  },
  couloirs:G.couloirs || [], obs:G.obs || [], vus:G.vus || [],
  coupures:(G.coupures || []).map(x => ({ouvrage:x.ouvrage != null ? x.ouvrage : null, type:x.type, lon:x.lon, lat:x.lat, nm:x.nm, etat:x.etat, t:x.t})),
  journal_coupures:G.journal || []
 };
}

/* ---------- calcul en séquences : un générateur « yield [texte, avancement 0-1] » rend la main à la page entre deux étapes ---------- */
// rend la main par message de tâche (MessageChannel) : pas ralenti quand l'onglet passe en arrière-plan, contrairement aux minuteries
// et à requestAnimationFrame (suspendu en arrière-plan) ; repli sur setTimeout hors navigateur
const rendreLaMain = (() => { let ch = null; const att = [];
 return () => new Promise(r => { if (typeof MessageChannel !== "function") return setTimeout(r, 0);
  if (!ch) { ch = new MessageChannel(); ch.port1.onmessage = () => att.shift()(); } att.push(r); ch.port2.postMessage(0); }); })();
// laisse la page se redessiner (progression visible) sans dépendre de requestAnimationFrame seul ; onglet caché : pas d'image à attendre
const uneImage = () => new Promise(res => { let fait = false; const ok = () => { if (!fait) { fait = true; res(); } };
 if (typeof document !== "undefined" && document.hidden || typeof requestAnimationFrame !== "function") return rendreLaMain().then(ok);
 requestAnimationFrame(ok); rendreLaMain().then(() => setTimeout(ok, 30)); });
// exécute le générateur en rendant la main toutes les ~tranche ms ; onStep(texte, avancement) ; s'arrête au bouton « Arrêter » (arretSi, si la page en a un) ;
// renvoie la valeur de retour du générateur. finir() exécute le même générateur d'un trait : mêmes résultats.
async function enSequences(gen, onStep, tranche){
 tranche = tranche || 40; let t0 = performance.now(), im = t0, r;
 while (!(r = gen.next()).done) {
  const t = performance.now();
  if (t - t0 > tranche) {
   if (onStep && r.value) onStep(r.value[0], r.value[1]);
   if (t - im > 250) { await uneImage(); im = performance.now(); } else await rendreLaMain();
   if (typeof arretSi === "function") arretSi();
   t0 = performance.now();
  }
 }
 return r.value;
}
function finir(gen){ let r; while (!(r = gen.next()).done); return r.value; }
// calcul d'une zone (outil terrain, outils ennemi) : même mécanisme
function enEtapes(gen, onStep){ return enSequences(gen, onStep); }
/* ---------- calcul complet d'une zone enregistrée par l'outil terrain (copie de index.html) ---------- */
const COVERS = ["foret","bati","marais","vigne","prairie"];
const COV_LBL = {foret:"forêt", bati:"bâti", marais:"marais", vigne:"vigne/verger", prairie:"prairie", eau:"eau"};
const covFactor = (k, p, wet) => k === "prairie" ? (wet ? P.facteur_prairie_humide : 1) : p["facteur_" + k];
function cellSpeed(L, c, p, wet){
 const v0 = p.vitesse_tout_terrain_kmh*(wet ? p.facteur_sol_humide : 1);
 const fr = {eau: Math.min(1, L.eau[c])}; let tot = fr.eau;
 for (const k of COVERS) { fr[k] = Math.min(1, L[k][c]); tot += fr[k]; }
 if (tot > 1) for (const k in fr) fr[k] /= tot;            // couverts superposés : on normalise
 const open = Math.max(0, 1 - Math.min(1, tot));
 let blocked = fr.eau, wsum = open, tsum = open/v0;           // temps par km pondéré (moyenne harmonique)
 for (const k of COVERS) {
  const f = covFactor(k, p, wet);
  if (f > 0) { wsum += fr[k]; tsum += fr[k]/(v0*f); } else blocked += fr[k];
 }
 if (blocked >= 0.5 || wsum <= 0) return 0;
 return wsum/tsum * (1 - blocked);                            // détour imposé par la part infranchissable
}
// calcul complet découpé en étapes : chaque « yield » [texte, avancement 0-1] rend la main à la page (barre de progression)
function* computeEtapes(){
 const {n, cell, L, sl} = G, N = n*n, wet = !!P.sol_humide;
 G.v = {}; G.rel = {}; G.cr = {}; G.cls = {}; G.corr = {}; G.cov = {}; G.gou = {}; G.zs = {}; G.axes = {}; G.axm = {};
 appliquerCoupures();
 const roadSeed = new Uint8Array(N); for (let c = 0; c < N; c++) roadSeed[c] = L.route[c] > 0;
 const Droad = chamfer(roadSeed, n);
 for (const k of ARMS) {
  yield ["Mobilité : " + ARM_LBL[k].toLowerCase(), 0.05 + 0.1*ARMS.indexOf(k)];
  const p = P[k], v = new Float32Array(N), cr = new Float32Array(N), rel = new Float32Array(N), cl = new Uint8Array(N), cov = new Uint8Array(N);
  for (let c = 0; c < N; c++) {
   v[c] = cellSpeed(L, c, p, wet);
   cr[c] = v[c]/p.vitesse_tout_terrain_kmh;                    // facteur de couvert (et de sol), référence sol sec
   rel[c] = cr[c]*slopeIso(sl[c], p);
   cl[c] = L.eau[c] >= 0.5 ? 0 : Math.min(covClass(cr[c]), slopeClass(sl[c], p));
   cov[c] = L.foret[c] >= P.seuil_couvert_foret && L.eau[c] < 0.5 && (v[c] > 0 || Droad[c]*cell <= p.couvert_acces_route_m);
  }
  G.v[k] = v; G.cr[k] = cr; G.rel[k] = rel; G.cls[k] = cl; G.cov[k] = cov;
  // couloirs de mobilité : GO sans eau, d'au moins largeur_couloir_m (ouverture morphologique par un disque)
  const go = new Uint8Array(N), notGo = new Uint8Array(N);
  for (let c = 0; c < N; c++) { go[c] = cl[c] === 3 && L.eau[c] < 0.02; notGo[c] = !go[c]; }
  const r = P.largeur_couloir_m/2/cell, D = chamfer(notGo, n);
  const ctr = new Uint8Array(N); for (let c = 0; c < N; c++) ctr[c] = D[c] >= r;
  const D2 = chamfer(ctr, n), corr = new Uint8Array(N);
  for (let c = 0; c < N; c++) corr[c] = go[c] && D2[c] <= r;
  const ca = couloirsEtAxes(corr);
  G.corr[k] = new Uint8Array(N); ca.zs.forEach(z => z.cells.forEach(c => G.corr[k][c] = 1));
  G.zs[k] = ca.zs; G.axes[k] = ca.axes; G.axm[k] = ca.mask;
 }
 yield* reseauEtapes(0.45, 0.85);
 yield ["Intervisibilité", 0.9];
 computeVue(); computeObs(); computeVus();
}
function compute(){ for (const _ of computeEtapes()); }
function computeVue(){
 const {n, cell, L, el} = G, N = n*n, V = P.vue, H = surfaceHeights();
 // points hauts : mailles découvertes qui dominent le plus leur voisinage (1 km), espacées
 const I = new Float64Array((n+1)*(n+1));
 for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < n; i++) { s += el[j*n + i]; I[(j+1)*(n+1) + i+1] = I[j*(n+1) + i+1] + s; } }
 const r = Math.max(2, Math.round(1000/cell)), cand = [];
 for (let c = 0; c < N; c++) {
  if (L.foret[c] >= 0.5 || L.eau[c] >= 0.5 || L.bati[c] >= 0.5) continue;
  const i = c % n, j = (c/n) | 0, x0 = Math.max(0, i-r), y0 = Math.max(0, j-r), x1 = Math.min(n, i+r+1), y1 = Math.min(n, j+r+1);
  const m = (I[y1*(n+1)+x1] - I[y0*(n+1)+x1] - I[y1*(n+1)+x0] + I[y0*(n+1)+x0])/((x1-x0)*(y1-y0));
  cand.push([c, el[c] - m]);
 }
 cand.sort((a, b) => b[1] - a[1]);
 const hp = [];
 for (const [c, prom] of cand) {
  if (hp.length >= V.nb_points_hauts || prom <= 0) break;
  if (hp.some(h => distM(cellLL(h.c), cellLL(c)) < V.ecart_points_hauts_m)) continue;
  hp.push({c, prom, el:el[c]});
 }
 const cnt = new Uint8Array(N);
 for (const h of hp) { const vs = viewshed(h.c, H); let s = 0; for (let c = 0; c < N; c++) if (vs[c]) { cnt[c]++; s++; } h.pct = s/N*100; }
 G.hp = hp; G.vueCnt = cnt;
}
// qui voit ce point : mailles d'où un observateur (hauteur_observateur_m) voit le point (hauteur_cible_m)
function computeVus(){
 const N = G.n*G.n, H = surfaceHeights(), u = new Uint8Array(N), V = P.vue;
 G.vusInfo = (G.vus || []).map(o => { const vs = viewshed(o, H, V.hauteur_cible_m, V.hauteur_observateur_m); let s = 0;
  for (let c = 0; c < N; c++) if (vs[c]) { u[c] = 1; s++; }
  return {pct:s/N*100, hp:G.hp.map((h, i) => vs[h.c] ? i : -1).filter(i => i >= 0)}; });
 G.vusV = u;
}
function computeObs(){
 const N = G.n*G.n, H = surfaceHeights(), u = new Uint8Array(N);
 G.obsPct = G.obs.map(o => { const vs = viewshed(o, H); let s = 0; for (let c = 0; c < N; c++) if (vs[c]) { u[c] = 1; s++; } return s/N*100; });
 G.obsV = u;
}
// goulets uniques : ouvrages dont la suppression isole au moins seuil_goulet_pct % des mailles
function goulets(k){
 const X = ctxOf(k), N = X.N, M = N + X.R.lon.length;
 const par = new Int32Array(M); for (let i = 0; i < M; i++) par[i] = i;
 const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
 const fe = G.feats.map(() => []);
 for (let u = 0; u < M; u++) forEachEdge(u, X, (w, dt, len, c1, c2, f) => {
  if (f >= 0) { fe[f].push(u, w); return; }
  const a = find(u), b2 = find(w); if (a !== b2) par[a] = b2;
 });
 const size = new Map(); for (let c = 0; c < N; c++) { const r = find(c); size.set(r, (size.get(r) || 0) + 1); }
 // graphe réduit : composantes connexes reliées seulement par des ouvrages
 const fr = fe.map(list => { const s = new Set(); for (const x of list) s.add(find(x)); return [...s]; });
 const adj = new Map();
 fr.forEach((rs, f) => { if (rs.length < 2) return; for (const r of rs) { if (!adj.has(r)) adj.set(r, []); adj.get(r).push(f); } });
 const piece = (start, skip, seen) => {
  let tot = 0; const st = [start];
  while (st.length) { const r = st.pop(); tot += size.get(r) || 0;
   for (const f of adj.get(r) || []) { if (f === skip) continue; for (const r2 of fr[f]) if (!seen.has(r2)) { seen.add(r2); st.push(r2); } } }
  return tot;
 };
 const res = [], lim = P.seuil_goulet_pct/100*N;
 fr.forEach((rs, f) => {
  if (rs.length < 2) return;
  const whole = piece(rs[0], -1, new Set([rs[0]]));
  const seen = new Set(); let max = 0;
  for (const r of rs) if (!seen.has(r)) { seen.add(r); max = Math.max(max, piece(r, f, seen)); }
  if (whole - max >= lim) res.push({f, pct:(whole - max)/N*100});
 });
 return res;
}
function couloirMask(cl){
 const N = G.n*G.n, fa = search([cl.a], cl.k), fb = search([cl.b], cl.k), best = fa[cl.b];
 if (!isFinite(best)) return {ok:false};
 const lim = best*(1 + P.tolerance_couloir), m = new Uint8Array(N); let cnt = 0;
 for (let c = 0; c < N; c++) if (fa[c] + fb[c] <= lim) { m[c] = 1; cnt++; }
 return {ok:true, m, best, cnt};
}
// Zone enregistrée dans le navigateur (base « terrain-gtia ») : même chemin que le fichier (ouvrirTerrainEtapes).
// version découpée en étapes (outils ennemi : message d'avancement pendant l'ouverture)
async function calculerZoneEtapes(z, params, onStep){
 await enEtapes(ouvrirTerrainEtapes(z, params), onStep);
 return G;
}
function calculerZone(z, params){ return ouvrirTerrain(z, params); }

// paramètres par défaut de l'outil terrain (copie), pour compléter les zones anciennes
const DEF_TERRAIN = {
 "_sources": {
  "pente_chenille_30_50": "Seuils OTAN GO < 30 %, NO-GO > 50 %, cités par Rybanský (ICC 2003) : citation de seconde main, à vérifier.",
  "tobler": "Fantassin : Tobler (1993), v = 6·exp(−3,5·|pente + 0,05|) km/h.",
  "couloirs_axes": "Couloir de compagnie ≥ 500 m ; axe = couloirs à ≤ 2 km : Wikipédia « Mobility (military) », à vérifier dans l'ATP 2-01.3.",
  "autres": "Toutes les autres valeurs sont fictives, à calibrer sur un terrain connu.",
  "eau": "Cours d'eau sans pont (eau.* et eau_*/franchissement_eau_min par classe) : valeurs inventées, À VALIDER. Une classe passe à gué si largeur ≤ eau_largeur_max_m ET profondeur ≤ eau_profondeur_max_m. Largeur ou profondeur absente d'OSM : valeur supposée eau.*_supposee_* (prudente : bloque toutes les classes). Plan d'eau, mer, maille à moitié en eau : infranchissable. Berges, courant et fond non modélisés."
 },
 "seuil_GO": 0.5,
 "seuil_SLOWGO": 0.15,
 "sol_humide": false,
 "facteur_prairie_humide": 0.7,
 "largeur_couloir_m": 500,
 "surface_min_couloir_km2": 0.25,
 "ecart_max_axe_m": 2000,
 "tolerance_couloir": 0.25,
 "seuil_goulet_pct": 5,
 "seuil_couvert_foret": 0.6,
 "regroupement_ouvrages_m": 80,
 "facteur_temps_ouvrage_degrade": 3,
 "eau": {"largeur_supposee_riviere_m":30, "largeur_supposee_canal_m":15, "profondeur_supposee_riviere_m":1.5, "profondeur_supposee_canal_m":2.5, "canal_infranchissable":true},
 "vue": {"hauteur_observateur_m":2, "hauteur_cible_m":2.5, "hauteur_foret_m":15, "hauteur_bati_m":8, "portee_m":5000, "nb_points_hauts":8, "ecart_points_hauts_m":2000},
 "chenille":   {"vitesse_tout_terrain_kmh":30, "facteur_foret":0.15, "facteur_bati":0.3, "facteur_marais":0.05, "facteur_vigne":0.5, "facteur_sol_humide":0.8,
                "modele_pente":"seuils", "pente_GO_max_pct":30, "pente_NOGO_pct":50, "devers_max":30,
                "franchissement_ruisseau_min":2, "franchissement_autoroute_min":3, "franchissement_voie_ferree_min":2, "franchissement_haie_min":1, "franchissement_gue_min":2,
                "eau_largeur_max_m":40, "eau_profondeur_max_m":1.0, "franchissement_eau_min":10,
                "autoroute_kmh":60, "route_principale_kmh":50, "route_secondaire_kmh":40, "piste_kmh":30, "couvert_acces_route_m":0},
 "roue":       {"vitesse_tout_terrain_kmh":25, "facteur_foret":0.05, "facteur_bati":0.4, "facteur_marais":0, "facteur_vigne":0.4, "facteur_sol_humide":0.6,
                "modele_pente":"seuils", "pente_GO_max_pct":20, "pente_NOGO_pct":40, "devers_max":25,
                "franchissement_ruisseau_min":3, "franchissement_autoroute_min":-1, "franchissement_voie_ferree_min":3, "franchissement_haie_min":3, "franchissement_gue_min":3,
                "eau_largeur_max_m":25, "eau_profondeur_max_m":0.8, "franchissement_eau_min":10,
                "autoroute_kmh":90, "route_principale_kmh":70, "route_secondaire_kmh":50, "piste_kmh":30, "couvert_acces_route_m":150},
 "logistique": {"vitesse_tout_terrain_kmh":15, "facteur_foret":0, "facteur_bati":0.4, "facteur_marais":0, "facteur_vigne":0.2, "facteur_sol_humide":0.5,
                "modele_pente":"seuils", "pente_GO_max_pct":10, "pente_NOGO_pct":25, "devers_max":15,
                "franchissement_ruisseau_min":-1, "franchissement_autoroute_min":-1, "franchissement_voie_ferree_min":-1, "franchissement_haie_min":-1, "franchissement_gue_min":5,
                "eau_largeur_max_m":15, "eau_profondeur_max_m":0.5, "franchissement_eau_min":20,
                "autoroute_kmh":80, "route_principale_kmh":60, "route_secondaire_kmh":40, "piste_kmh":15, "couvert_acces_route_m":100},
 "fantassin":  {"vitesse_tout_terrain_kmh":4.5, "facteur_foret":0.7, "facteur_bati":0.8, "facteur_marais":0.4, "facteur_vigne":0.8, "facteur_sol_humide":0.85,
                "modele_pente":"tobler", "pente_GO_max_pct":40, "pente_NOGO_pct":100, "devers_max":60,
                "franchissement_ruisseau_min":1, "franchissement_autoroute_min":2, "franchissement_voie_ferree_min":1, "franchissement_haie_min":0.5, "franchissement_gue_min":2,
                "eau_largeur_max_m":20, "eau_profondeur_max_m":0.8, "franchissement_eau_min":15,
                "autoroute_kmh":0, "route_principale_kmh":5, "route_secondaire_kmh":5, "piste_kmh":5, "couvert_acces_route_m":0}
};
function withDefaultsTerrain(p){ // complète un jeu de paramètres ancien ou partiel (clés inconnues ignorées, sous-objets complétés clé par clé)
 const r = JSON.parse(JSON.stringify(DEF_TERRAIN));
 const fusion = (r, p) => { for (const k in p || {}) {
  if (k === "_sources" || !(k in r)) continue;
  if (r[k] && typeof r[k] === "object" && p[k] && typeof p[k] === "object") fusion(r[k], p[k]);
  else if (typeof p[k] === typeof r[k]) r[k] = p[k];
 } };
 fusion(r, p);
 return r;
}
