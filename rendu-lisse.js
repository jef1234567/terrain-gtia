"use strict";
/* rendu-lisse.js – noyau du RENDU LISSÉ commun aux outils Terrain (index.html, par rendu-terrain.js) et Ennemi (ennemi.html,
   par rendu-ennemi.js). Purement visuel : le calcul reste à la maille. Une seule globale : RT (aucun autre nom ajouté à la page),
   ce qui permet de le charger par un simple <script> dans n'importe quelle page, sans conflit de noms ni fetch.
   RT.COL (couleurs des classes), RT.ALPHA_GO, RT.ALPHA_PLEIN, RT.tailleLisse(n), RT.adoucir(a, n), RT.poids(n, C),
   RT.plusFort(champs, n, C, mini, debut), RT.champsDe(lab, n, K, doux), RT.contours(mask, n, b).
   rendu-terrain.js reprend ces fonctions sous leurs noms habituels (globales de index.html, inchangées). */
const RT = (() => {
// couleurs : NO-GO rouge, SLOW-GO orange, GO vert, eau bleue
const COL = {eau:[30,90,200], no:[200,40,45], slow:[235,140,30], go:[46,160,67]};
/* Hiérarchie : le GO (souvent la plus grande part de la zone) est plus transparent, pour laisser lire le fond de carte ;
   SLOW-GO, NO-GO et eau gardent toute l'opacité réglée par le curseur. Valeurs = alpha de l'image (0-255). */
const ALPHA_GO = 140, ALPHA_PLEIN = 255;
/* Rendu lissé : chaque classe devient un champ 0/1, adouci (1-4-1), puis rééchantillonné en bilinéaire sur une image plus fine ;
   chaque pixel prend la classe la plus forte. Une ligne d'une seule maille de large reste continue. */
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
return {COL, ALPHA_GO, ALPHA_PLEIN, tailleLisse, adoucir, poids, plusFort, champsDe, contours};
})();
if (typeof module !== "undefined" && module.exports) module.exports = {RT};
