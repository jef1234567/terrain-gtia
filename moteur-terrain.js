/* moteur-terrain.js – moteur de déplacement partagé par les outils terrain-gtia.
   Copie à l'identique des fonctions de index.html (outil terrain, version du 16/10/2026),
   pour que l'outil ennemi calcule les délais exactement comme l'outil terrain.
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
function barriers(M, n, W){
 const F = new Uint8Array(n*n*4);
 for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) for (let d = 0; d < 4; d++) {
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
function edgeFlags(u, dx, dy){
 const n = G.n;
 if (dy < 0 || (dy === 0 && dx < 0)) { u = u + dy*n + dx; dx = -dx; dy = -dy; }
 const d = dy === 0 ? 0 : dx === 0 ? 1 : dx === 1 ? 2 : 3;
 return G.F[u*4 + d];
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

// coupures d'ouvrages (détruit, bloqué, dégradé), rattachées par type et position : elles survivent à un recalcul du réseau
const ETAT_COUPE = {detruit:1, bloque:1, degrade:2};
function appliquerCoupures(){
 const F = G.feats || [], c = new Uint8Array(F.length), idx = new Int32Array(F.length).fill(-1);
 (G.coupures || []).forEach((x, j) => {
  let best = -1, bd = Math.max(100, P.regroupement_ouvrages_m || 0);
  F.forEach((f, i) => { if (f.type !== x.type) return; const d = distM([f.lon, f.lat], [x.lon, x.lat]); if (d <= bd) { bd = d; best = i; } });
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
/* ---------- intervisibilité ---------- */
function surfaceHeights(){
 const {n, L, el} = G, V = P.vue, H = new Float32Array(n*n);
 for (let c = 0; c < n*n; c++) H[c] = el[c] + (L.foret[c] >= 0.5 ? V.hauteur_foret_m : L.bati[c] >= 0.5 ? V.hauteur_bati_m : 0);
 return H;
}
// mailles vues depuis une maille (rayons vers le pourtour du carré de portée, angle maximal cumulé)
function viewshed(o, H){
 const {n, cell, el} = G, V = P.vue, Rc = Math.ceil(V.portee_m/cell);
 const oi = o % n, oj = (o/n) | 0, z0 = el[o] + V.hauteur_observateur_m, kc = 0.87/(2*6371000);
 const vis = new Uint8Array(n*n); vis[o] = 1;
 const ray = (ti, tj) => {
  const dx = ti - oi, dy = tj - oj, steps = Math.max(Math.abs(dx), Math.abs(dy))*2; let maxA = -Infinity;
  for (let s = 1; s <= steps; s++) {
   const fi = oi + dx*s/steps, fj = oj + dy*s/steps, i = Math.round(fi), j = Math.round(fj);
   if (i < 0 || j < 0 || i >= n || j >= n) break;
   const d = Math.hypot(fi - oi, fj - oj)*cell; if (d > V.portee_m) break;
   const c = j*n + i, drop = kc*d*d;
   if ((el[c] + V.hauteur_cible_m - drop - z0)/d >= maxA) vis[c] = 1;
   const a = (H[c] - drop - z0)/d; if (a > maxA) maxA = a;
  }
 };
 for (let t = -Rc; t <= Rc; t++) { ray(oi+t, oj-Rc); ray(oi+t, oj+Rc); ray(oi-Rc, oj+t); ray(oi+Rc, oj+t); }
 return vis;
}
/* ---------- graphe de déplacement ---------- */
// nœuds 0..N-1 = mailles (tout-terrain), N..N+R-1 = nœuds routiers
function ctxOf(k){ return {n:G.n, N:G.n*G.n, R:G.R, p:P[k], v:G.v[k], dk:G.cell/1000, rs:ROADKEYS.map(x => P[k][x])}; }
// appelle cb(w, temps_h, longueur_km, maille1, maille2, ouvrage) pour chaque arc sortant de u
function forEachEdge(u, X, cb){
 const {n, N, R, p, v, dk, rs} = X;
 if (u < N) {
  if (v[u] <= 0) return;
  const ui = u % n, uj = (u/n) | 0;
  for (const [dx, dy] of NB) {
   const i = ui+dx, j = uj+dy; if (i < 0 || j < 0 || i >= n || j >= n) continue;
   const w = j*n + i; if (v[w] <= 0) continue;
   const fl = edgeFlags(u, dx, dy); if (fl & 1) continue;            // eau : seulement par la route
   let pen = 0;
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
const enc = a => ({type:a.constructor.name, b64:b64(a)});
function dec(o){ const s = atob(o.b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new TA[o.type](u.buffer); }

/* ---------- lecture d'un fichier terrain-gtia (export de l'outil terrain) ---------- */
// Reconstruit G (faits + résultats exportés) et le réseau de déplacement. Renvoie les paramètres terrain.
function chargerTerrain(o){
 if (!o || o.format !== "terrain-gtia") throw new Error("ce n'est pas un fichier terrain-gtia (exporté par l'outil terrain)");
 if (!o.resultats || !o.resultats.par_arme) throw new Error("fichier terrain sans résultats : réexportez-le depuis l'outil terrain");
 const f = o.faits, gr = f.grilles, L = {};
 for (const k of LAYERS) if (gr["fraction_" + k]) L[k] = dec(gr["fraction_" + k]);
 const g = {nom:o.nom, date:o.date, b:f.bbox, n:f.n, cell:f.maille_m, W:f.W,
  sl:dec(gr.pente_pct), el:dec(gr.altitude_m), gx:dec(gr.gradient_est), gy:dec(gr.gradient_sud),
  L:ensureLayers(L, f.n), M:dec(f.obstacles_fins.donnees), ways:f.voies, pnodes:f.points,
  v:{}, cls:{}, corr:{}, cov:{}, zs:{}, axes:{}, gou:{}, coupures:o.coupures || []};
 const R = o.resultats;
 for (const k of ARMS) { const a = R.par_arme[k]; if (!a) continue;
  g.v[k] = dec(a.vitesse_kmh); g.cls[k] = dec(a.classes); g.corr[k] = dec(a.couloirs_mobilite); g.cov[k] = dec(a.couvert);
  g.axesInfo = g.axesInfo || {}; g.axesInfo[k] = a.axes_approche || []; g.gou[k] = (a.goulets || []).map(x => ({f:x.ouvrage, pct:x.isole_pct})); }
 g.sol = R.sol; g.hpExp = (R.intervisibilite && R.intervisibilite.points_hauts) || [];
 return g;
}
// à appeler une fois G et P posés : obstacles fins, réseau routier, ouvrages, axes d'approche (masques)
function preparerReseau(){
 G.F = barriers(G.M, G.n, G.W); buildNetwork(); appliquerCoupures();
 G.axm = {}; G.zsAll = {};
 for (const k of ARMS) { if (!G.corr[k]) continue; const ca = couloirsEtAxes(G.corr[k]); G.axm[k] = ca.mask; G.zsAll[k] = ca.zs; }
}

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
function compute(){
 const {n, cell, L, sl} = G, N = n*n, wet = !!P.sol_humide;
 G.v = {}; G.rel = {}; G.cr = {}; G.cls = {}; G.corr = {}; G.cov = {}; G.gou = {}; G.zs = {}; G.axes = {}; G.axm = {};
 const roadSeed = new Uint8Array(N); for (let c = 0; c < N; c++) roadSeed[c] = L.route[c] > 0;
 const Droad = chamfer(roadSeed, n);
 for (const k of ARMS) {
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
 G.feats.forEach(f => f.g = {});
 for (const k of ARMS) { G.gou[k] = goulets(k); for (const g of G.gou[k]) G.feats[g.f].g[k] = g.pct; }
 G.cl = G.couloirs.map(couloirMask);
 computeVue(); computeObs();
}
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
// Zone enregistrée dans le navigateur par l'outil terrain (base « terrain-gtia ») : recalcule les résultats.
function calculerZone(z, params){
 const f = z.faits;
 G = {id:z.id, nom:z.nom, date:z.date, b:f.b, n:f.n, cell:f.cell, W:f.W, sl:f.sl, el:f.el, gx:f.gx, gy:f.gy,
  L:ensureLayers(f.L, f.n), M:f.M, ways:f.ways, pnodes:f.pnodes, couloirs:[], obs:[], coupures:z.coupures || []};
 P = withDefaultsTerrain(params);
 G.F = barriers(G.M, G.n, G.W); buildNetwork(); appliquerCoupures(); compute();
 G.hpExp = G.hp.map(h => ({lonlat:cellLL(h.c)})); G.sol = P.sol_humide ? "humide" : "sec";
 return G;
}

// paramètres par défaut de l'outil terrain (copie), pour compléter les zones anciennes
const DEF_TERRAIN = {
 "_sources": {
  "pente_chenille_30_50": "Seuils OTAN GO < 30 %, NO-GO > 50 %, cités par Rybanský (ICC 2003) : citation de seconde main, à vérifier.",
  "tobler": "Fantassin : Tobler (1993), v = 6·exp(−3,5·|pente + 0,05|) km/h.",
  "couloirs_axes": "Couloir de compagnie ≥ 500 m ; axe = couloirs à ≤ 2 km : Wikipédia « Mobility (military) », à vérifier dans l'ATP 2-01.3.",
  "autres": "Toutes les autres valeurs sont fictives, à calibrer sur un terrain connu."
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
 "vue": {"hauteur_observateur_m":2, "hauteur_cible_m":2.5, "hauteur_foret_m":15, "hauteur_bati_m":8, "portee_m":5000, "nb_points_hauts":8, "ecart_points_hauts_m":2000},
 "chenille":   {"vitesse_tout_terrain_kmh":30, "facteur_foret":0.15, "facteur_bati":0.3, "facteur_marais":0.05, "facteur_vigne":0.5, "facteur_sol_humide":0.8,
                "modele_pente":"seuils", "pente_GO_max_pct":30, "pente_NOGO_pct":50, "devers_max":30,
                "franchissement_ruisseau_min":2, "franchissement_autoroute_min":3, "franchissement_voie_ferree_min":2, "franchissement_haie_min":1, "franchissement_gue_min":2,
                "autoroute_kmh":60, "route_principale_kmh":50, "route_secondaire_kmh":40, "piste_kmh":30, "couvert_acces_route_m":0},
 "roue":       {"vitesse_tout_terrain_kmh":25, "facteur_foret":0.05, "facteur_bati":0.4, "facteur_marais":0, "facteur_vigne":0.4, "facteur_sol_humide":0.6,
                "modele_pente":"seuils", "pente_GO_max_pct":20, "pente_NOGO_pct":40, "devers_max":25,
                "franchissement_ruisseau_min":3, "franchissement_autoroute_min":-1, "franchissement_voie_ferree_min":3, "franchissement_haie_min":3, "franchissement_gue_min":3,
                "autoroute_kmh":90, "route_principale_kmh":70, "route_secondaire_kmh":50, "piste_kmh":30, "couvert_acces_route_m":150},
 "logistique": {"vitesse_tout_terrain_kmh":15, "facteur_foret":0, "facteur_bati":0.4, "facteur_marais":0, "facteur_vigne":0.2, "facteur_sol_humide":0.5,
                "modele_pente":"seuils", "pente_GO_max_pct":10, "pente_NOGO_pct":25, "devers_max":15,
                "franchissement_ruisseau_min":-1, "franchissement_autoroute_min":-1, "franchissement_voie_ferree_min":-1, "franchissement_haie_min":-1, "franchissement_gue_min":5,
                "autoroute_kmh":80, "route_principale_kmh":60, "route_secondaire_kmh":40, "piste_kmh":15, "couvert_acces_route_m":100},
 "fantassin":  {"vitesse_tout_terrain_kmh":4.5, "facteur_foret":0.7, "facteur_bati":0.8, "facteur_marais":0.4, "facteur_vigne":0.8, "facteur_sol_humide":0.85,
                "modele_pente":"tobler", "pente_GO_max_pct":40, "pente_NOGO_pct":100, "devers_max":60,
                "franchissement_ruisseau_min":1, "franchissement_autoroute_min":2, "franchissement_voie_ferree_min":1, "franchissement_haie_min":0.5, "franchissement_gue_min":2,
                "autoroute_kmh":0, "route_principale_kmh":5, "route_secondaire_kmh":5, "piste_kmh":5, "couvert_acces_route_m":0}
};
function withDefaultsTerrain(p){ // complète un jeu de paramètres ancien ou partiel
 const r = JSON.parse(JSON.stringify(DEF_TERRAIN));
 for (const k in p || {}) {
  if (k === "_sources") continue;
  if (r[k] && typeof r[k] === "object" && typeof p[k] === "object") Object.assign(r[k], p[k]);
  else if (k in r) r[k] = p[k];
 }
 return r;
}
