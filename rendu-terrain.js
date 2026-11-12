"use strict";
/* Rendu carte de l'outil Terrain (index.html) : couleurs et styles, légende, couches d'analyse, cours d'eau en lignes, rendu lissé.
   Script classique chargé avant le script principal d'index.html : même portée globale. */
/* ---------- qui passe où ---------- */
const QPO = [
 {m:15, c:[20,120,50],  t:"Chenillé, roue, logistique et fantassin"},
 {m:11, c:[130,200,70], t:"Chenillé, roue et fantassin"},
 {m:9,  c:[240,210,40], t:"Chenillé et fantassin"},
 {m:8,  c:[240,130,30], t:"Fantassin seul"},
 {m:-1, c:[150,140,190],t:"Autre combinaison (voir la maille)"}
];
const COL = {eau:[30,90,200], no:[200,40,45], slow:[235,140,30], go:[46,160,67]};
/* Hiérarchie : le GO (souvent la plus grande part de la zone) est plus transparent, pour laisser lire le fond de carte ;
   SLOW-GO, NO-GO et eau gardent toute l'opacité réglée par le curseur. Valeurs = alpha de l'image (0-255). */
const ALPHA_GO = 140, ALPHA_PLEIN = 255;
// couches raster de l'analyse : sous les cours d'eau en lignes, les contours et les routes
const SOUS = () => map.getLayer("rusv") ? "rusv" : "roads-casing";
const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;

function legend(){
 const m = $("mode").value, sw = (c, t) => `<span><span class="sw" style="background:${c}"></span>${t}</span>`;
 let h;
 if (m === "arme") h = sw(rgb(COL.go), "GO") + sw(rgb(COL.slow), "SLOW-GO") + sw(rgb(COL.no), "NO-GO");
 else if (m === "qpo") h = QPO.map(q => sw(rgb(q.c), q.t)).join("") + `<span>Sans couleur : personne en GO</span>`;
 else h = `<span><span class="sw" style="width:40px;background:linear-gradient(90deg,rgb(200,40,45),rgb(200,210,45),rgb(46,160,67))"></span>lent → rapide</span>`;
 $("leg").innerHTML = h + sw(rgb(COL.eau), "Eau");
}

/* ---------- rendu ---------- */
function setImage(id, canvas, opacity, before){
 const b = G.b, coords = [[b.w,b.n],[b.e,b.n],[b.e,b.s],[b.w,b.s]], url = canvas.toDataURL();
 const src = map.getSource(id);
 if (src) src.updateImage({url, coordinates:coords});
 else { map.addSource(id, {type:"image", url, coordinates:coords});
  map.addLayer({id, type:"raster", source:id, paint:{"raster-opacity":opacity, "raster-resampling":"nearest", "raster-fade-duration":0}}, before === "roads-casing" ? SOUS() : before); }
 map.setPaintProperty(id, "raster-resampling", lisse() ? "linear" : "nearest");
}
function canvasImg(w){ const c = document.createElement("canvas"); c.width = c.height = w; const g = c.getContext("2d"); return {c, g, im:g.createImageData(w, w)}; }
const qpoMask = c => ARMS.reduce((m, k) => m | (G.cls[k][c] === 3 ? ARM_BIT[k] : 0), 0);
const qpoEntry = m => QPO.find(q => q.m === m) || QPO[QPO.length-1];

/* ---------- rendu lissé ----------
   Purement visuel : le calcul reste à la maille. Chaque classe devient un champ 0/1, adouci (1-4-1),
   puis rééchantillonné en bilinéaire sur une image plus fine ; chaque pixel prend la classe la plus forte.
   Une ligne d'une seule maille de large reste continue (son centre garde la valeur la plus forte). */
const lisse = () => $("lay-liss").checked;
const tailleLisse = n => n * Math.max(2, Math.min(8, Math.floor(2400 / n)));   // 10 km → 800 px, 50 km → 2000 px
function adoucir(a, n){
 const t = new Float32Array(n*n), o = new Float32Array(n*n);
 for (let j = 0; j < n; j++) { const r = j*n; for (let i = 0; i < n; i++) t[r+i] = (a[r + (i ? i-1 : 0)] + 4*a[r+i] + a[r + (i < n-1 ? i+1 : i)]) / 6; }
 for (let j = 0; j < n; j++) { const r = j*n, u = (j ? j-1 : 0)*n, d = (j < n-1 ? j+1 : j)*n; for (let i = 0; i < n; i++) o[r+i] = (t[u+i] + 4*t[r+i] + t[d+i]) / 6; }
 return o;
}
// indices et poids bilinéaires d'une grille n×n vue sur C pixels
function poids(n, C){
 const ix = new Int32Array(C), tx = new Float32Array(C), F = C / n;
 for (let p = 0; p < C; p++) { let f = (p + 0.5) / F - 0.5; if (f < 0) f = 0; else if (f > n - 1) f = n - 1; const i = Math.min(n - 2, Math.floor(f)); ix[p] = i; tx[p] = f - i; }
 return {ix, tx};
}
// champs[k] (n×n) → étiquette du champ le plus fort par pixel (255 si aucun ne dépasse `mini`) ; `debut` = premier champ candidat
function plusFort(champs, n, C, mini, debut){
 const {ix, tx} = poids(n, C), out = new Uint8Array(C*C), K = champs.length;
 for (let y = 0; y < C; y++) { const j = ix[y]*n, v = tx[y], v1 = 1 - v;
  for (let x = 0; x < C; x++) { const k0 = j + ix[x], u = tx[x], u1 = 1 - u; let b = 255, bv = mini;
   for (let k = debut; k < K; k++) { const a = champs[k], s = (a[k0]*u1 + a[k0+1]*u)*v1 + (a[k0+n]*u1 + a[k0+n+1]*u)*v; if (s > bv) { bv = s; b = k; } }
   out[y*C + x] = b; } }
 return out;
}
const champsDe = (lab, n, K, doux) => Array.from({length:K}, (_, k) => { const a = new Float32Array(n*n); for (let c = 0; c < n*n; c++) if (lab[c] === k) a[c] = 1; return doux ? adoucir(a, n) : a; });
const masqueLisse = (mask, n, C) => { const a = new Float32Array(n*n); for (let c = 0; c < n*n; c++) if (mask[c]) a[c] = 1; return plusFort([adoucir(a, n)], n, C, 0.5, 0); };   // 0 = dedans, 255 = dehors
let EAUV_ID = null;
function majEauV(){   // cours d'eau en vraies lignes : rivières et canaux (largeur OSM ou 30 / 15 m), ruisseaux et fossés
 if (!G || !map.getSource("eauv") || EAUV_ID === G.id) return;
 EAUV_ID = G.id;
 const f = [];
 const b = G.b, dans = p => p[0] >= b.w && p[0] <= b.e && p[1] >= b.s && p[1] <= b.n;
 const ajoute = (g, properties) => {   // seulement les tronçons qui touchent la zone (les tracés OSM débordent du cadre)
  let run = [];
  const fin = () => { if (run.length > 1) f.push({type:"Feature", properties, geometry:{type:"LineString", coordinates:run}}); run = []; };
  for (let q = 1; q < g.length; q++) { if (dans(g[q-1]) || dans(g[q])) { if (!run.length) run.push(g[q-1]); run.push(g[q]); } else fin(); }
  fin(); };
 for (const r of G.rivs || []) ajoute(r.g, {k:r.k, w:r.w || (r.k === "r" ? 30 : 15)});
 for (const g of G.rus || []) ajoute(g, {k:"s"});
 map.getSource("eauv").setData(FC(f));
 const mpp = z => 156543.03*Math.cos((G.b.n + G.b.s)/2*Math.PI/180)/2**z;   // mètres par pixel écran
 map.setPaintProperty("rivv", "line-width", ["interpolate", ["exponential", 2], ["zoom"], 11, 2, 13, ["max", 2.5, ["/", ["get","w"], mpp(13)]], 19, ["max", 2.5, ["/", ["get","w"], mpp(19)]]]);
}
/* légende toujours visible sur la carte (ordinateur) : vue affichée, puis seulement les couches cochées et présentes dans la zone */
let OBS_PRESENTS = null;   // [id de zone, bits d'obstacles présents]
/* Eau en trame qui n'est que le tracé d'une rivière déjà dessinée en ligne (bande étroite le long de la ligne) :
   retirée de la trame, sinon la bande crénelée de la trame déborde de la ligne. Les nappes et rivières larges (surfaces) restent. */
function eauDeRiviere(){
 if (!G.rivs || !G.rivs.length) return null;
 const {b, W, M} = G, px = G.cell/S, X = lon => (lon - b.w)/(b.e - b.w)*W, Y = lat => (b.n - lat)/(b.n - b.s)*W;
 const pres = new Uint8Array(W*W), out = new Uint8Array(W*W); let any = false;
 for (const r of G.rivs) { const R = Math.ceil((r.w || (r.k === "r" ? 30 : 15))/2/px + 1);
  for (let q = 1; q < r.g.length; q++) { const x0 = X(r.g[q-1][0]), y0 = Y(r.g[q-1][1]), x1 = X(r.g[q][0]), y1 = Y(r.g[q][1]), st = Math.max(1, Math.ceil(Math.hypot(x1-x0, y1-y0)*2));
   for (let t = 0; t <= st; t++) { const cx = Math.floor(x0 + (x1-x0)*t/st), cy = Math.floor(y0 + (y1-y0)*t/st);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < W && y < W && dx*dx + dy*dy <= R*R) pres[y*W + x] = 1; } } } }
 for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const p = y*W + x; if (!pres[p] || !(M[p] & 1)) continue;
  let e = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const a = x + dx, c = y + dy; if (a >= 0 && c >= 0 && a < W && c < W && (M[c*W + a] & 1)) e++; }
  if (e < 18) { out[p] = 1; any = true; } }   // 5 × 5 pixels : moins de 18 en eau = bande étroite, pas une surface
 return any ? out : null;
}
function majLegCarte(){
 let d = $("mapLeg"); if (!d) { d = document.createElement("div"); d.id = "mapLeg"; document.body.appendChild(d); }
 if (!G) { d.innerHTML = ""; return; }
 const sol = `sol ${P.sol_humide ? "humide" : "sec"}`, mode = $("mode").value, coche = id => $(id) && $(id).checked;
 const sw = (st, t) => `<span><span class="sw" style="${st}"></span>${t}</span>`, trait = (c, t, tir) => sw(`height:0;border-top:3px ${tir ? "dashed" : "solid"} ${c};vertical-align:3px;border-radius:0`, t);
 let h = (mode === "qpo" ? `<b>Qui passe où (GO)</b> – ${sol}` : `<b>${ARM_LBL[cls]}</b> – ${sol}`) + `<div class="leg">${$("leg").innerHTML}</div>`;
 const lig = [];
 if (coche("lay-obs")) {
  if (!OBS_PRESENTS || OBS_PRESENTS[0] !== G.id) { let m = 0; for (let p = 0; p < G.M.length; p++) m |= G.M[p]; OBS_PRESENTS = [G.id, m]; }
  const m = OBS_PRESENTS[1];
  [[2, "#3caae6", "Ruisseau"], [4, "#141414", "Autoroute"], [8, "#7a4f1e", "Voie ferrée"], [32, "#2d8a2d", "Haie"]].forEach(([b, c, t]) => { if (m & b) lig.push(trait(c, t)); });
 }
 if (coche("lay-corr") && G.corr[cls].some(v => v)) lig.push(trait("#1e5adc", "Couloir de mobilité"));
 if (coche("lay-axe") && G.axm[cls].some(v => v)) lig.push(trait("#e07800", "Axe d'approche", true));
 if (coche("lay-cov") && G.cov[cls].some(v => v)) lig.push(sw("background:repeating-linear-gradient(45deg,#005a46 0 2px,transparent 2px 4px)", "Couvert accessible"));
 if (coche("lay-iso") && G.isoPct && G.isoPct[cls] > 0) lig.push(sw("background:repeating-linear-gradient(-45deg,#d50000 0 2px,transparent 2px 4px);border:1px solid #d50000", "Zone coupée"));
 if (coche("lay-cl") && G.cl && G.cl.some(c => c.ok)) lig.push(sw("background:rgba(106,27,154,.45);border:1px solid #6a1b9a", "Couloir A→B"));
 if (coche("lay-vue")) lig.push(sw("background:rgba(255,215,0,.6)", "Vu des points hauts"));
 if (coche("lay-vop") && G.obs.length) lig.push(sw("background:rgba(255,120,0,.6)", "Vu de mes observateurs"));
 if (coche("lay-vus") && G.vus.length) lig.push(sw("background:rgba(200,0,120,.55)", "D'où l'on voit mes points"));
 if (lig.length) h += `<div class="leg">${lig.join("")}</div>`;
 const pts = [...document.querySelectorAll(".ptt")].filter(c => c.checked).map(c => c.value).filter(k => G.feats && G.feats.some(f => f.type === k))
  .map(k => `<span><img class="ic" src="${iconeURL(k)}" alt="">${PT[k].court || PT[k].t}</span>`);
 if (coche("lay-gou") && G.gou && G.gou[cls].length) pts.push(`<span><span class="dot" style="background:none;box-shadow:0 0 0 2px #d50000;border-color:transparent"></span>Goulet unique</span>`);
 if (pts.length) h += `<div class="leg">${pts.join("")}</div>`;
 d.innerHTML = h;
}
/* ---------- symboles des points de franchissement ----------
   Un pictogramme par type (forme et dessin différents, pas seulement la couleur), dessiné sur canevas :
   utilisable par la carte (addImage, sans serveur de polices) et dans le panneau (<img>). */
const ICO_PX = 22;   // taille à l'écran, en pixels CSS
function iconePT(type, ech){
 const r = ech || 2, D = ICO_PX, c = document.createElement("canvas"); c.width = c.height = D*r;
 const g = c.getContext("2d"); g.scale(r, r); g.translate(D/2, D/2);
 const coul = (typeof PT !== "undefined" && PT[type]) ? PT[type].c : "#333", R = D/2 - 1.5;
 g.lineJoin = g.lineCap = "round";
 // fond : rond (ouvrages sur l'eau), carré (route / voie ferrée), losange (échangeur)
 g.beginPath();
 if (type === "echangeur") { g.moveTo(0, -R - 0.5); g.lineTo(R + 0.5, 0); g.lineTo(0, R + 0.5); g.lineTo(-R - 0.5, 0); g.closePath(); }
 else if (type === "pont" || type === "gue") g.arc(0, 0, R, 0, 2*Math.PI);
 else { const q = R - 1.2; g.moveTo(-q + 3, -q); g.arcTo(q, -q, q, q, 3); g.arcTo(q, q, -q, q, 3); g.arcTo(-q, q, -q, -q, 3); g.arcTo(-q, -q, q, -q, 3); g.closePath(); }
 g.fillStyle = coul; g.fill(); g.lineWidth = 1.6; g.strokeStyle = "#fff"; g.stroke();
 g.strokeStyle = "#fff"; g.fillStyle = "#fff"; g.lineWidth = 1.8; g.beginPath();
 if (type === "pont") {          // deux traits aux extrémités évasées : signe conventionnel du pont
  g.moveTo(-6.5, -5.5); g.lineTo(-4, -3); g.lineTo(4, -3); g.lineTo(6.5, -5.5);
  g.moveTo(-6.5, 5.5); g.lineTo(-4, 3); g.lineTo(4, 3); g.lineTo(6.5, 5.5);
 } else if (type === "gue") {    // deux vagues
  for (const y of [-2.5, 3]) { g.moveTo(-6, y); g.bezierCurveTo(-3.5, y - 3, -1.5, y + 3, 0, y); g.bezierCurveTo(1.5, y - 3, 3.5, y + 3, 6, y); }
 } else if (type === "deniv") {  // une voie passe au-dessus d'une autre (trait coupé)
  g.moveTo(-6.5, 0); g.lineTo(6.5, 0); g.moveTo(0, -6.5); g.lineTo(0, -3); g.moveTo(0, 3); g.lineTo(0, 6.5);
 } else if (type === "tunnel") { // entrée de tunnel : arche
  g.moveTo(-5.5, 5.5); g.lineTo(-5.5, 0); g.arc(0, 0, 5.5, Math.PI, 0); g.lineTo(5.5, 5.5); g.moveTo(-7, 5.5); g.lineTo(7, 5.5);
 } else if (type === "echangeur") { // trèfle : croisement et bretelles
  g.moveTo(-6.5, 0); g.lineTo(6.5, 0); g.moveTo(0, -6.5); g.lineTo(0, 6.5); g.stroke(); g.beginPath(); g.lineWidth = 1.5;
  g.moveTo(3.6, 0); g.arc(0, 0, 3.6, 0, 2*Math.PI);
 } else {                         // voie ferrée : rail et traverses
  g.moveTo(-7, 0); g.lineTo(7, 0); for (const x of [-4.5, 0, 4.5]) { g.moveTo(x, -3.5); g.lineTo(x, 3.5); }
 }
 g.stroke();
 return c;
}
const ICO_URL = {};
const iconeURL = type => ICO_URL[type] || (ICO_URL[type] = iconePT(type, 2).toDataURL());
function ajouterIcones(){   // à appeler quand le style de la carte est prêt
 for (const k in PT) { const id = "pt-" + k; if (map.hasImage(id)) continue; const c = iconePT(k, 2);
  map.addImage(id, c.getContext("2d").getImageData(0, 0, c.width, c.height), {pixelRatio:2}); }
}
/* ---------- contours en lignes vectorielles (rendu lissé) ----------
   Le masque de mailles est adouci, puis l'isoligne 0,5 est tracée (carrés marchants) : trait net à tous les zooms,
   et pas de faux contour le long du cadre de la zone (la ligne s'arrête au bord). */
function contours(mask, n, b){
 const a = new Float32Array(n*n); let any = false; for (let c = 0; c < n*n; c++) if (mask[c]) { a[c] = 1; any = true; }
 if (!any) return [];
 const f = adoucir(a, n), T = 0.5, segs = [], pts = new Map();
 const X = i => b.w + (i + 0.5)/n*(b.e - b.w), Y = j => b.n - (j + 0.5)/n*(b.n - b.s);
 // point sur l'arête : « h i j » entre (i,j) et (i+1,j), « v i j » entre (i,j) et (i,j+1)
 const pt = (k, i0, j0, i1, j1) => { if (!pts.has(k)) { const v0 = f[j0*n + i0], v1 = f[j1*n + i1], t = (T - v0)/(v1 - v0); pts.set(k, [X(i0 + (i1 - i0)*t), Y(j0 + (j1 - j0)*t)]); } return k; };
 for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
  const v00 = f[j*n + i] >= T, v10 = f[j*n + i + 1] >= T, v11 = f[(j + 1)*n + i + 1] >= T, v01 = f[(j + 1)*n + i] >= T;
  const cas = v00 | v10 << 1 | v11 << 2 | v01 << 3; if (cas === 0 || cas === 15) continue;
  const H = () => pt("h" + i + "," + j, i, j, i + 1, j), B = () => pt("h" + i + "," + (j + 1), i, j + 1, i + 1, j + 1),
        G_ = () => pt("v" + i + "," + j, i, j, i, j + 1), D_ = () => pt("v" + (i + 1) + "," + j, i + 1, j, i + 1, j + 1);
  const S2 = (p, q) => segs.push([p(), q()]);
  switch (cas) {
   case 1: case 14: S2(G_, H); break;  case 2: case 13: S2(H, D_); break;  case 3: case 12: S2(G_, D_); break;
   case 4: case 11: S2(D_, B); break;  case 6: case 9: S2(H, B); break;   case 7: case 8: S2(G_, B); break;
   case 5: S2(G_, H); S2(D_, B); break; case 10: S2(H, D_); S2(G_, B); break;
  }
 }
 // segments chaînés en lignes (un point d'arête sert à deux segments au plus)
 const par = new Map(); segs.forEach((s, k) => { for (const e of s) { if (!par.has(e)) par.set(e, []); par.get(e).push(k); } });
 const vu = new Uint8Array(segs.length), lignes = [];
 const suivre = (k, e) => { const l = []; while (true) { const s = segs[k]; vu[k] = 1; const nx = s[0] === e ? s[1] : s[0]; l.push(nx);
  const k2 = (par.get(nx) || []).find(x => !vu[x]); if (k2 === undefined) return l; k = k2; e = nx; } };
 for (let k = 0; k < segs.length; k++) { if (vu[k]) continue;
  // partir d'une extrémité libre si la ligne est ouverte (bord de la zone)
  let k0 = k, e0 = segs[k][0], garde = 0;
  while (garde++ < segs.length) { const autre = (par.get(e0) || []).find(x => x !== k0 && !vu[x]); if (autre === undefined) break;
   const s = segs[autre]; e0 = s[0] === e0 ? s[1] : s[0]; k0 = autre; if (k0 === k) break; }
  lignes.push([e0, ...suivre(k0, e0)]); }
 // adoucissement léger (Chaikin) pour arrondir les angles des carrés marchants
 const lisser = l => { const ferme = l[0] === l[l.length - 1]; let q = l.map(e => pts.get(e));
  for (let it = 0; it < 2; it++) { const o = ferme ? [] : [q[0]];
   for (let m = 0; m < q.length - 1; m++) { const [x0, y0] = q[m], [x1, y1] = q[m + 1]; o.push([x0*0.75 + x1*0.25, y0*0.75 + y1*0.25], [x0*0.25 + x1*0.75, y0*0.25 + y1*0.75]); }
   if (ferme) o.push(o[0]); else o.push(q[q.length - 1]); q = o; }
  return q; };
 return lignes.filter(l => l.length > 1).map(lisser);
}
function renderOv(){
 if (!G || !mapReady || BUSY) return;
 const n = G.n, mode = $("mode").value, cl = G.cls[cls], rel = G.rel[cls];
 majLegCarte();
 if (!lisse()) {
  const A = canvasImg(n), d = A.im.data;
  for (let c = 0; c < n*n; c++) {
   let col = null;
   if (cl[c] === 0) col = COL.eau;
   else if (mode === "arme") col = cl[c] === 3 ? COL.go : cl[c] === 2 ? COL.slow : COL.no;
   else if (mode === "qpo") { const m = qpoMask(c); if (m) col = qpoEntry(m).c; }
   else { const v = Math.min(1, rel[c]); col = v < 0.5 ? [200, 40 + 340*v, 45] : [200 - 300*(v-0.5), 210, 45 + 40*(v-0.5)]; }
   if (col) { d[c*4] = col[0]; d[c*4+1] = col[1]; d[c*4+2] = col[2]; d[c*4+3] = (col === COL.go || col === QPO[0].c) ? ALPHA_GO : ALPHA_PLEIN; }
  }
  A.g.putImageData(A.im, 0, 0); setImage("ov", A.c, +$("op").value, "roads-casing");
  visibility(); return;
 }
 const C = tailleLisse(n), A = canvasImg(C), d = A.im.data, lab = new Uint8Array(n*n);
 let pal;   // étiquette 0 = eau ; en vue « qui passe où », 1 = personne en GO (sans couleur)
 if (mode === "qpo") { pal = [COL.eau, null, ...QPO.map(q => q.c)]; for (let c = 0; c < n*n; c++) { if (cl[c] === 0) continue; const m = qpoMask(c); lab[c] = m ? 2 + QPO.indexOf(qpoEntry(m)) : 1; } }
 else { pal = [COL.eau, COL.no, COL.slow, COL.go]; for (let c = 0; c < n*n; c++) lab[c] = cl[c] === 0 ? 0 : cl[c] === 3 ? 3 : cl[c] === 2 ? 2 : 1; }
 const up = plusFort(champsDe(lab, n, pal.length, true), n, C, 0, 0);
 let sc = null;
 if (mode === "score") { const {ix, tx} = poids(n, C), r = Float32Array.from(rel, v => Math.min(1, v));
  sc = (x, y) => { const k0 = ix[y]*n + ix[x], u = tx[x], v = tx[y]; return (r[k0]*(1-u) + r[k0+1]*u)*(1-v) + (r[k0+n]*(1-u) + r[k0+n+1]*u)*v; }; }
 for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) { const p = y*C + x, k = up[p]; let col = pal[k];
  if (sc && k !== 0) { const v = sc(x, y); col = v < 0.5 ? [200, 40 + 340*v, 45] : [200 - 300*(v-0.5), 210, 45 + 40*(v-0.5)]; }
  if (col) { d[p*4] = col[0]; d[p*4+1] = col[1]; d[p*4+2] = col[2]; d[p*4+3] = (!sc && (col === COL.go || col === QPO[0].c)) ? ALPHA_GO : ALPHA_PLEIN; } }
 A.g.putImageData(A.im, 0, 0); setImage("ov", A.c, +$("op").value, "roads-casing");
 visibility();
}
const OBS_COL = [null, [20,60,160], [20,20,20], [122,79,30], [60,170,230], [45,138,45]];   // eau, autoroute, voie ferrée, ruisseau, haie
function renderObs(){
 if (!G || !mapReady) return;
 const {W, M} = G;
 if (!lisse()) {
  const A = canvasImg(W), d = A.im.data;
  for (let p = 0; p < W*W; p++) { const m = M[p]; if (!(m & BARRIER_BITS)) continue;
   const c = m & 1 ? OBS_COL[1] : m & 4 ? OBS_COL[2] : m & 8 ? OBS_COL[3] : m & 2 ? OBS_COL[4] : OBS_COL[5];
   d[p*4] = c[0]; d[p*4+1] = c[1]; d[p*4+2] = c[2]; d[p*4+3] = 255; }
  A.g.putImageData(A.im, 0, 0); setImage("obs", A.c, 0.9, "roads-casing"); return;
 }
 majEauV();
 // rivières et ruisseaux dont le tracé est connu : en vraies lignes ; il reste en trame les nappes d'eau et les autres obstacles
 const rus = !G.rus, f = Math.max(1, Math.min(6, Math.floor(2400 / W))), C = W*f;   // jusqu’à 2400 px : bords des traits moins crénelés
 const lab = new Uint8Array(W*W), seuleLigne = eauDeRiviere();
 for (let p = 0; p < W*W; p++) { const m = seuleLigne && seuleLigne[p] ? M[p] & ~1 : M[p]; lab[p] = m & 1 ? 1 : m & 4 ? 2 : m & 8 ? 3 : (m & 2 && rus) ? 4 : m & 32 ? 5 : 0; }
 const A = canvasImg(C), d = A.im.data;
 // un trait fin reste dessiné dès que sa classe dépasse 0,3 (sinon les diagonales se couperaient) ;
 // l'eau est adoucie pour arrondir les berges : les traits de rivière qui s'y perdent sont redessinés en vraies lignes
 let up = lab;
 if (f > 1) { const ch = champsDe(lab, W, OBS_COL.length, false); if (G.rivs) { ch[1] = adoucir(ch[1], W); for (let p = 0; p < W*W; p++) ch[1][p] *= 0.62; }   // 0,62 : seuil de 0,3 ramené à environ 0,48 pour l'eau
  for (let k = 2; k < ch.length; k++) ch[k] = adoucir(ch[k], W);   // traits fins (autoroute, voie ferrée, ruisseau, haie) adoucis : plus de « perles » en diagonale
  up = plusFort(ch, W, C, 0.3, 1); }
 for (let p = 0; p < C*C; p++) { const c = OBS_COL[up[p]]; if (c) { d[p*4] = c[0]; d[p*4+1] = c[1]; d[p*4+2] = c[2]; d[p*4+3] = 255; } }
 A.g.putImageData(A.im, 0, 0); setImage("obs", A.c, 0.9, "roads-casing");
}
function renderCtr(){
 if (!G || !mapReady || BUSY) return;
 const {n, W} = G, L = lisse(), C = L ? tailleLisse(n) : W, B = canvasImg(C), e = B.im.data;
 const put = (x, y, c) => { const p = (y*C + x)*4; e[p] = c[0]; e[p+1] = c[1]; e[p+2] = c[2]; e[p+3] = c[3]; };
 const carre = (mask, line, fill, pat) => {
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j*n + i; if (!mask[k]) continue;
   if (fill) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (!pat || pat(i*S + x, j*S + y)) put(i*S+x, j*S+y, fill);
   if (!line) continue;
   const nb = (di, dj) => { const a = i+di, b = j+dj; return a >= 0 && b >= 0 && a < n && b < n && mask[b*n + a]; };
   for (let s = 0; s < S; s++) {
    if (!line.dash || s % 2 === 0) {
     if (!nb(0,-1)) put(i*S+s, j*S, line.c); if (!nb(0,1)) put(i*S+s, j*S+S-1, line.c);
     if (!nb(-1,0)) put(i*S, j*S+s, line.c); if (!nb(1,0)) put(i*S+S-1, j*S+s, line.c);
    }
   } }
 };
 const lw = Math.max(2, Math.round(C / 400)), h = 3*lw;   // épaisseur du contour et pas des hachures, en pixels de l'image
 const rond = (mask, line, fill, pat) => {
  if (!mask) return;
  const up = masqueLisse(mask, n, C), hors = (x, y) => x < 0 || y < 0 || x >= C || y >= C || up[y*C + x];
  for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) { if (up[y*C + x]) continue; let c = null;
   if (fill && (!pat || pat(x, y))) c = fill;
   if (line && (hors(x-lw, y) || hors(x+lw, y) || hors(x, y-lw) || hors(x, y+lw)) && (!line.dash || ((x + y) / (4*lw) | 0) % 2 === 0)) c = line.c;
   if (c) put(x, y, c); }
 };
 // rendu lissé : les contours sont des lignes vectorielles (couche « ctrv »), seul le remplissage reste dans l'image
 const lignes = [], vect = L && !!map.getSource("ctrv");
 const rondV = (mask, line, fill, pat) => { if (vect && line && mask) { for (const l of contours(mask, n, G.b)) lignes.push({type:"Feature", properties:{k:line.k}, geometry:{type:"LineString", coordinates:l}}); line = null; } rond(mask, line, fill, pat); };
 const draw = L ? rondV : carre, p1 = L ? (x, y) => (x + y) % (2*h) < h : (x, y) => (x + y) % 4 < 2, p2 = L ? (x, y) => (x + C - y) % (2*h) < h : (x, y) => (x + W - y) % 4 < 2;
 if ($("lay-vue").checked) draw(G.vueCnt, null, [255,215,0,95]);
 if ($("lay-vop").checked) draw(G.obsV, null, [255,120,0,110]);
 if ($("lay-vus").checked) draw(G.vusV, null, [200,0,120,105]);
 if ($("lay-cov").checked) draw(G.cov[cls], null, [0,90,70,210], p1);
 if ($("lay-iso").checked && G.iso && G.isoPct[cls] > 0) draw(G.iso[cls], {c:[213,0,0,255], k:"iso"}, [213,0,0,150], p2);
 if ($("lay-cl").checked) for (const c of G.cl) if (c.ok) draw(c.m, {c:[106,27,154,255], k:"cl"}, [106,27,154,70]);
 if ($("lay-axe").checked) draw(G.axm[cls], {c:[224,120,0,255], dash:true, k:"axe"});
 if ($("lay-corr").checked) draw(G.corr[cls], {c:[30,90,220,255], k:"corr"});
 B.g.putImageData(B.im, 0, 0); setImage("ctr", B.c, 1, "roads-casing");
 if (map.getSource("ctrv")) map.getSource("ctrv").setData(FC(lignes));
 majLegCarte();
}
function updateFeats(){
 if (!G || !map.getSource("feats") || BUSY) return;
 const types = [...document.querySelectorAll(".ptt")].filter(c => c.checked).map(c => c.value);
 map.getSource("feats").setData(FC(G.feats.map((f, i) => ptFeat([f.lon, f.lat],
  Object.assign({i, type:f.type, maj:f.maj ? 1 : 0, cut:G.coupe ? G.coupe[i] : 0}, ...ARMS.map(k => ({["g_" + k]: f.g[k] != null ? 1 : 0})))))));
 map.setFilter("feats", ["in", ["get","type"], ["literal", types]]);
 if (map.getLayer("cuts")) map.setFilter("cuts", ["all", ["!=", ["get","cut"], 0], ["in", ["get","type"], ["literal", types]]]);   // un type masqué l'est entièrement
 map.setFilter("goulets", $("lay-gou").checked ? ["==", ["get","g_" + cls], 1] : ["boolean", false]);
 for (const k in PT) $("cnt-" + k).textContent = "(" + G.feats.filter(f => f.type === k).length + ")";
 const g = G.gou[cls];
 $("ptInfo").textContent = g.length ? `${g.length} goulet(s) unique(s) pour l'arme ${ARM_LBL[cls].toLowerCase()} (cercle rouge).` : `Aucun goulet unique pour l'arme ${ARM_LBL[cls].toLowerCase()} au seuil de ${P.seuil_goulet_pct} %.`;
 map.getSource("hp").setData(FC(G.hp.map((h, i) => ptFeat(cellLL(h.c), {i}))));
 majLegCarte();
}
function updateObsPts(){
 if (map.getSource("op")) map.getSource("op").setData(FC(G ? G.obs.map((o, i) => ptFeat(cellLL(o), {i})) : []));
 if (map.getSource("vp")) map.getSource("vp").setData(FC(G ? G.vus.map((o, i) => ptFeat(cellLL(o), {i})) : []));
}
function visibility(){
 const vis = (id, on) => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); };
 vis("ov", $("lay-ov").checked); vis("obs", $("lay-obs").checked); vis("hp", $("lay-vue").checked);
 const ev = $("lay-obs").checked && lisse() && !!G; vis("rivv", ev && !!G.rivs); vis("rusv", ev && !!G.rus);
 ["roads-casing","roads","roads-tunnel"].forEach(l => vis(l, $("lay-roads").checked));
 vis("ctrv", lisse() && !!G); vis("ctrv-axe", lisse() && !!G);
 if (G) majLegCarte();
}
function renderAll(){
 if (!G || !mapReady) return;
 map.getSource("roads").setData(G.roadsFC);
 renderOv(); renderObs(); renderCtr(); updateFeats(); updateObsPts(); visibility();
}
