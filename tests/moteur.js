/* Tests de calcul du moteur (Node pur, sans navigateur) :  node tests/moteur.js
   Grilles synthétiques (pente, eau, pont, coupure, sol sec / humide, les 4 classes), non-régression sur la démonstration v2 (tests/fixtures/terrain-demo-v2.json),
   aller-retour export v3 → chargement, lecture d'un fichier version 2, identité fichier / zone enregistrée. */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.resolve(__dirname, "..");
const ctx = vm.createContext({console, atob, btoa, performance, setTimeout, requestAnimationFrame:f => setTimeout(f, 0)});
vm.runInContext("var G = null, P = null;", ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, "moteur-terrain.js"), "utf8"), ctx, {filename:"moteur-terrain.js"});
const M = new Proxy({}, {get:(_, k) => vm.runInContext(k, ctx), set:(_, k, v) => { ctx.__v = v; vm.runInContext(k + " = __v", ctx); return true; }});

let nb = 0, ko = 0;
const ok = (c, msg) => { nb++; if (!c) { ko++; console.log("  ÉCHEC : " + msg); } else if (process.env.VERBEUX) console.log("  ok : " + msg); };
const section = t => console.log("- " + t);
const proche = (a, b, e = 1e-9) => Math.abs(a - b) <= e*Math.max(1, Math.abs(b));
const ARMS = M.ARMS, S = M.S, BIT = M.BIT;

/* ---------- terrain synthétique : 20 × 20 mailles de 100 m, plat, découvert ---------- */
function synth(o){
 o = Object.assign({n:20, cell:100}, o || {});
 const n = o.n, W = n*S, N = n*n, b = M.bboxFrom({lng:0, lat:45}, n*o.cell);
 const L = {}; for (const k of M.LAYERS) L[k] = new Float32Array(N);
 const f = {b, n, cell:o.cell, W, sl:new Float32Array(N).fill(o.pente || 0), el:new Float32Array(N).fill(100), gx:new Float32Array(N), gy:new Float32Array(N),
  L, M:new Uint8Array(W*W), ways:[], pnodes:[], rivs:[], rus:null};
 const lon = x => b.w + x/W*(b.e - b.w), lat = y => b.n - y/W*(b.n - b.s);
 if (o.riviere) { // bande d'eau verticale de 2 pixels (x = 39 et 40) au milieu de la zone, sur toute la hauteur
  for (let y = 0; y < W; y++) for (const x of [39, 40]) f.M[y*W + x] |= BIT.eau;
  for (let j = 0; j < n; j++) { L.eau[j*n + 9] = 0.25; L.eau[j*n + 10] = 0.25; }
  if (o.riviere !== "plan") f.rivs.push(Object.assign({w:10, p:0.6, k:"r", nm:"Rivière test"}, o.riviere === true ? {} : o.riviere, {g:[[lon(40), lat(0)], [lon(40), lat(W)]]}));
 }
 if (o.pont) { // route est-ouest sur la ligne 5, pont sur la rivière (nœuds OSM 2 et 3)
  const y = 5.5*S;
  f.ways.push({hw:"secondary", br:0, tu:0, fd:0, nm:"D1", nd:[1, 2], g:[[lon(0.5), lat(y)], [lon(32), lat(y)]]});
  f.ways.push({hw:"secondary", br:1, tu:0, fd:0, nm:"Pont test", nd:[2, 3], g:[[lon(32), lat(y)], [lon(48), lat(y)]]});
  f.ways.push({hw:"secondary", br:0, tu:0, fd:0, nm:"D1", nd:[3, 4], g:[[lon(48), lat(y)], [lon(W - 0.5), lat(y)]]});
  for (let i = 0; i < n; i++) L.route[5*n + i] = 0.1;
 }
 return {id:"synth", nom:"synthétique", date:"test", parametres:o.parametres, faits:f, coupures:o.coupures || []};
}
const ouvrir = z => { M.calculerZone(z, z.parametres); return M.G; };
const cell = (i, j) => j*M.G.n + i;
const temps = (k, a, b) => M.search([a], k)[b];   // heures
const params = mod => { const p = M.withDefaultsTerrain({}); if (mod) mod(p); return p; };

/* ---------- 1. les 4 classes sur terrain plat découvert, sol sec puis humide ---------- */
section("plat découvert : vitesses et classes des 4 classes, sol sec / humide");
{
 const G = ouvrir(synth()), P = M.P;
 for (const k of ARMS) {
  ok(G.cls[k].every(v => v === 3), k + " : tout en GO");
  ok(proche(G.v[k][0], P[k].vitesse_tout_terrain_kmh, 1e-6), `${k} : vitesse ${G.v[k][0]} = ${P[k].vitesse_tout_terrain_kmh} km/h`);
  ok(proche(temps(k, cell(2, 10), cell(12, 10)), 1/P[k].vitesse_tout_terrain_kmh, 1e-6), `${k} : 1 km en ${1/P[k].vitesse_tout_terrain_kmh} h`);
 }
 const z = synth({parametres:params(p => p.sol_humide = true)});
 for (let c = 0; c < 20; c++) z.faits.L.prairie[c] = 1;   // première ligne en prairie
 const H = ouvrir(z);
 for (const k of ARMS) {
  const p = M.P[k], v0 = p.vitesse_tout_terrain_kmh*p.facteur_sol_humide;
  ok(proche(H.v[k][cell(5, 10)], v0, 1e-6), `${k} humide : ${v0} km/h (×${p.facteur_sol_humide})`);
  ok(proche(H.v[k][cell(5, 0)], v0*M.P.facteur_prairie_humide, 1e-6), `${k} humide en prairie : ×${M.P.facteur_prairie_humide} de plus`);
 }
 ok(H.sol === "humide" && G.sol === "sec", "état du sol noté dans le terrain");
}

/* ---------- 2. pente : seuils GO / NO-GO par classe ---------- */
section("pente : classes selon les seuils de chaque classe");
for (const [pente, att] of [[35, {chenille:2, roue:2, logistique:1, fantassin:3}], [55, {chenille:1, roue:1, logistique:1, fantassin:2}], [5, {chenille:3, roue:3, logistique:3, fantassin:3}]]) {
 const G = ouvrir(synth({pente}));
 for (const k of ARMS) ok(G.cls[k][cell(5, 5)] === att[k], `pente ${pente} % : ${k} classe ${G.cls[k][cell(5, 5)]} (attendu ${att[k]})`);
}
{ // pente réelle (altitude) : une montée de 60 % arrête la logistique, pas le fantassin
 const z = synth(); const f = z.faits;
 for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++) { f.el[j*20 + i] = 100 + Math.max(0, i - 9)*60; if (i >= 9) { f.sl[j*20 + i] = 60; f.gx[j*20 + i] = 0.6; } }
 const G = ouvrir(z);
 ok(!isFinite(temps("logistique", cell(2, 10), cell(15, 10))), "montée de 60 % : logistique bloquée");
 ok(isFinite(temps("fantassin", cell(2, 10), cell(15, 10))), "montée de 60 % : fantassin passe (Tobler)");
}

/* ---------- 3. cours d'eau sans pont : largeur, profondeur, classe ---------- */
section("cours d'eau sans pont : règle largeur / profondeur / classe");
const passe = (z, k) => { ouvrir(z); return isFinite(temps(k, cell(3, 10), cell(16, 10))); };
const cas = [
 ["rivière 10 m, profondeur 0,6 m", {w:10, p:0.6}, {chenille:true, roue:true, logistique:false, fantassin:true}],
 ["rivière 10 m, profondeur inconnue", {w:10, p:0}, {chenille:false, roue:false, logistique:false, fantassin:false}],
 ["rivière largeur inconnue (30 m supposés), profondeur 0,6 m", {w:0, p:0.6}, {chenille:true, roue:false, logistique:false, fantassin:false}],
 ["rivière 10 m, profondeur 0,9 m", {w:10, p:0.9}, {chenille:true, roue:false, logistique:false, fantassin:false}],
 ["canal 10 m, profondeur 0,6 m", {w:10, p:0.6, k:"c"}, {chenille:false, roue:false, logistique:false, fantassin:false}],
 ["plan d'eau (aucun cours d'eau OSM)", "plan", {chenille:false, roue:false, logistique:false, fantassin:false}]];
for (const [nom, r, att] of cas) for (const k of ARMS) ok(passe(synth({riviere:r}), k) === att[k], `${nom} : ${k} ${att[k] ? "passe" : "ne passe pas"}`);
{
 const z0 = synth({riviere:{w:10, p:0.6}, parametres:params(p => p.chenille.franchissement_eau_min = 0)}); ouvrir(z0); const t0 = temps("chenille", cell(3, 10), cell(16, 10));
 const z1 = synth({riviere:{w:10, p:0.6}}); ouvrir(z1); const t1 = temps("chenille", cell(3, 10), cell(16, 10));
 ok(proche(t1 - t0, M.P.chenille.franchissement_eau_min/60, 1e-6), `délai de franchissement : +${M.P.chenille.franchissement_eau_min} min`);
 const zp = synth({riviere:{w:10, p:0}, parametres:params(p => p.eau.profondeur_supposee_riviere_m = 0.6)});
 ok(passe(zp, "chenille") && !passe(zp, "logistique"), "profondeur supposée réglable (0,6 m) : chenillé passe, logistique non");
 const v = M.verdictEau({w:10, p:0, k:"r"}, "chenille", params());
 ok(!v.ok && v.supposees.includes("profondeur") && /supposée/.test(v.raison), "verdict expliqué : " + v.raison);
 const zm = synth({riviere:{w:10, p:0.6}}); for (let j = 0; j < 20; j++) zm.faits.L.eau[j*20 + 9] = zm.faits.L.eau[j*20 + 10] = 0.6;
 const Gm = ouvrir(zm); ok(ARMS.every(k => Gm.cls[k][cell(9, 4)] === 0 && Gm.v[k][cell(9, 4)] === 0), "maille à plus de moitié en eau : eau, vitesse nulle");
}
/* ---------- 3 bis. lecture prudente des largeurs et profondeurs OSM ---------- */
section("valeurs OSM de largeur / profondeur : inconnue plutôt que minorée");
{
 const att = [[undefined, 0], [null, 0], ["", 0], ["   ", 0], ["10", 10], [12, 12], ["10 m", 10], ["10m", 10], [" 2.5 m ", 2.5], ["0,6", 0.6], ["0.6", 0.6], ["2,5 m", 2.5],
  ["5-10", 10], ["5 - 10 m", 10], ["10-5", 10], ["5–10", 10], ["50cm-1m", 1], ["5 m-10", 0], ["5;8", 8], ["8;12", 12], ["5;abc", 0],
  ["50 cm", 0.5], ["50cm", 0.5], ["300 mm", 0.3], ["6 feet", 1.83], ["6 ft", 1.83], ["1 foot", 0.3], ["6'", 1.83], ["24 in", 0.61], ['24"', 0.61], [`6'2"`, 1.88],
  ["1e3", 0], ["1E3", 0], ["1e-3", 0], ["-5", 0], [-5, 0], ["0", 0], [0, 0], ["0 m", 0], ["0.001", 0], ["abc", 0], ["~3", 0], ["<1", 0], [">2", 0], ["3 km", 0],
  ["environ 3", 0], ["3 m environ", 0], ["5--10", 0], ["5-", 0], [".5", 0], ["5.", 0], [NaN, 0], [Infinity, 0], [true, 0], [{}, 0]];
 for (const [v, x] of att) { const r = M.metresOSM(v); ok(r === x, `metresOSM(${typeof v === "string" ? JSON.stringify(v) : String(v)}) = ${r}, attendu ${x}`); }
 // une profondeur ambiguë est inconnue : la profondeur supposée (1,5 m) s'applique et bloque toutes les classes
 for (const p of ["0-2", "1e3", "~0.3", "<0.5"]) ok(!passe(synth({riviere:{w:10, p:M.metresOSM(p)}}), "chenille"), `profondeur OSM « ${p} » : chenillé ne passe pas`);
 ok(passe(synth({riviere:{w:10, p:M.metresOSM("50 cm")}}), "chenille"), "profondeur OSM « 50 cm » (0,5 m) : chenillé passe");
}
/* ---------- 3 ter. rattachement des pixels d'eau : suit la largeur supposée des paramètres ---------- */
section("rattachement des pixels d'eau à une rivière sans largeur OSM : suit P.eau");
{
 // maille de 25 m (0,16 pixel par mètre), rivière au pixel x = 40, nappe d'eau tracée sur 10 pixels (x = 35 à 44, 62,5 m)
 const large = (sup) => { const z = synth({n:20, cell:25, parametres:params(p => { if (sup) p.eau.largeur_supposee_riviere_m = sup; })});
  const f = z.faits, W = f.W, b = f.b; for (let y = 0; y < W; y++) for (let x = 35; x <= 44; x++) f.M[y*W + x] |= BIT.eau;
  for (let j = 0; j < 20; j++) for (const i of [8, 9, 10, 11]) f.L.eau[j*20 + i] = 0.4;
  f.rivs.push({w:0, p:0.6, k:"r", nm:"Rivière large", g:[[b.w + 40/W*(b.e - b.w), b.n], [b.w + 40/W*(b.e - b.w), b.s]]});
  return z; };
 ok(!passe(large(), "chenille"), "largeur supposée 30 m : les berges tracées plus larges restent un plan d'eau, chenillé bloqué");
 ok(passe(large(40), "chenille"), "largeur supposée portée à 40 m : pixels rattachés à la rivière, verdict 40 m ≤ 40 m, chenillé passe");
 ok(!passe(large(40), "roue"), "largeur supposée 40 m : roue (25 m max) bloquée");
 // même terrain, paramètres changés sans rouvrir : le rattachement est recalculé
 ouvrir(large()); const g = M.G; ok(!isFinite(temps("chenille", cell(3, 10), cell(16, 10))), "avant changement : bloqué");
 vm.runInContext("P.eau.largeur_supposee_riviere_m = 40", ctx);
 const av = g._arcsEau; ok(M.arcsEau() !== av && [...M.arcsEau().values()].every(l => !l.includes(-1)), "après changement de P.eau : plus aucun pixel d'eau en plan d'eau");
}

/* ---------- 3 quater. largeur mesurée sur le tracé, saisies, priorité et origine des valeurs ---------- */
section("largeur mesurée sur une rivière en surface, saisie > mesure > étiquette, inconnue bloquante");
{
 // polygone synthétique près de Naples : rivière est-ouest de 50 m de large, avec un élargissement à 80 m sur 100 m
 const lat0 = 40.9, lon0 = 14.2, kx = 111320*Math.cos(lat0*Math.PI/180), ky = 110574;
 const ll = (x, y) => [lon0 + x/kx, lat0 + y/ky];
 const rect = [ll(0, -25), ll(400, -25), ll(400, 25), ll(250, 25), ll(250, 55), ll(150, 55), ll(150, 25), ll(0, 25), ll(0, -25)];
 const ligne = [ll(20, 0), ll(380, 0)];
 const w = M.mesureLargeurEau(ligne, [[rect]]);
 ok(w >= 80 && w <= 81, `largeur mesurée = plus grande largeur locale (élargissement 80 m) : ${w} m`);
 const ligneCourte = [ll(20, 0), ll(120, 0)];
 const w2 = M.mesureLargeurEau(ligneCourte, [[rect]]);
 ok(w2 >= 50 && w2 <= 51, `tronçon hors élargissement : ${w2} m (50 m attendus)`);
 ok(M.mesureLargeurEau([ll(20, 300), ll(380, 300)], [[rect]]) === 0, "ligne hors de toute surface : non mesurée (0)");
 ok(M.mesureLargeurEau(ligne, []) === 0, "aucune surface d'eau de rivière : non mesurée");
 // ligne oblique dans une bande oblique de 30 m
 const ob = (t, d) => ll(t*0.8 - d*0.6, t*0.6 + d*0.8), bande = [ob(0, -15), ob(500, -15), ob(500, 15), ob(0, 15), ob(0, -15)];
 const w3 = M.mesureLargeurEau([ob(50, 0), ob(450, 0)], [[bande]]);
 ok(w3 >= 30 && w3 <= 31, `bande oblique de 30 m : ${w3} m`);
 // deux surfaces superposées (riverbank + natural=water) : la plus grande largeur
 const large = [ll(0, -40), ll(400, -40), ll(400, 40), ll(0, 40), ll(0, -40)];
 const w4 = M.mesureLargeurEau(ligneCourte, [[rect], [large]]);
 ok(w4 >= 80 && w4 <= 81, `surfaces superposées : plus grande largeur retenue (${w4} m)`);

 // priorité et origine des valeurs
 const p0 = params();
 vm.runInContext("G = {_saisieEau:new Map()}", ctx);
 let V = M.valeursEau({w:12, p:0, wm:0, k:"r"}, p0);
 ok(V.largeur.v === 12 && V.largeur.o === "osm" && V.profondeur.o === "inconnue" && V.profondeur.v === 1.5, "étiquette OSM seule : largeur OSM, profondeur inconnue (supposée 1,5 m)");
 V = M.valeursEau({w:12, p:0, wm:35, k:"r"}, p0);
 ok(V.largeur.v === 35 && V.largeur.o === "mesuree", "mesure sur le tracé > étiquette width");
 V = M.valeursEau({w:0, p:0, wm:0, k:"r"}, p0);
 ok(V.largeur.o === "inconnue" && V.largeur.v === 30, "rien : largeur inconnue (supposée 30 m)");
 vm.runInContext(`G = {_saisieEau:new Map([["eau:w5", {largeur_m:8, profondeur_m:0.7, source:"reco génie"}]])}`, ctx);
 V = M.valeursEau({id:"eau:w5", w:12, p:2, wm:35, k:"r"}, p0);
 ok(V.largeur.v === 8 && V.largeur.o === "saisie" && V.profondeur.v === 0.7 && V.profondeur.o === "saisie" && V.source === "reco génie", "saisie > mesure > étiquette (largeur et profondeur)");
 vm.runInContext(`G = {_saisieEau:new Map([["eau:w5", {largeur_m:0, profondeur_m:0.7}]])}`, ctx);
 V = M.valeursEau({id:"eau:w5", w:12, p:0, wm:35, k:"r"}, p0);
 ok(V.largeur.o === "mesuree" && V.profondeur.o === "saisie", "saisie de la seule profondeur : la largeur reste mesurée");
 let v = M.verdictEau({w:10, p:0, wm:0, k:"r"}, "chenille", p0);
 ok(!v.ok && v.origine.profondeur === "inconnue" && /bloquant par prudence/.test(v.raison) && /étiquette OSM/.test(v.raison), "verdict : profondeur inconnue bloquante, origines citées (" + v.raison + ")");
 vm.runInContext(`G = {_saisieEau:new Map([["eau:w5", {largeur_m:0, profondeur_m:0.6}]])}`, ctx);
 v = M.verdictEau({id:"eau:w5", w:10, p:0, wm:0, k:"r"}, "chenille", p0);
 ok(v.ok && v.origine.profondeur === "saisie" && /saisie/.test(v.raison), "verdict : profondeur saisie 0,6 m → chenillé passe (" + v.raison + ")");
 ok(!M.verdictEau({id:"eau:w5", w:10, p:0, wm:0, k:"r"}, "logistique", p0).ok, "même saisie : logistique (0,5 m max) ne passe pas");
 ok(!M.verdictEau({id:"eau:w5", w:10, p:0, wm:45, k:"r"}, "chenille", p0).ok, "largeur mesurée 45 m > 40 m : chenillé bloqué malgré l'étiquette 10 m");

 // de bout en bout dans le moteur : saisie rattachée par identifiant, recalcul, export / rechargement
 const z = synth({riviere:{id:"eau:w77", w:10, p:0}});
 let g = ouvrir(z); const A = cell(3, 12), B = cell(16, 12);
 ok(!isFinite(temps("chenille", A, B)), "sans saisie : profondeur inconnue, chenillé bloqué");
 g.saisiesEau = [{troncon:"eau:w77", largeur_m:null, profondeur_m:0.6, source:"reco", t:1}];
 M.recalcReseau();
 ok(isFinite(temps("chenille", A, B)) && !isFinite(temps("logistique", A, B)), "saisie profondeur 0,6 m : chenillé passe, logistique non (recalcul du réseau)");
 const doc = JSON.parse(JSON.stringify(M.documentTerrain()));
 ok(doc.saisies_eau.length === 1 && doc.saisies_eau[0].troncon === "eau:w77" && doc.saisies_eau[0].profondeur_m === 0.6 && doc.faits.cours_eau[0].id === "eau:w77", "export : champ saisies_eau et identifiant du tronçon");
 g = M.chargerTerrain(doc);
 ok(g.saisiesEau.length === 1 && g.saisiesEau[0].i === 0 && isFinite(temps("chenille", A, B)), "rechargement : saisie conservée et appliquée");
 const sansChamp = JSON.parse(JSON.stringify(doc)); delete sansChamp.saisies_eau;
 M.chargerTerrain(sansChamp); ok(M.G.saisiesEau.length === 0 && !isFinite(temps("chenille", A, B)), "document v3 sans saisies_eau (antérieur) : lu, aucune saisie");
 // repli par position : identifiant inconnu, point à moins de 100 m du tracé
 const z2 = synth({riviere:{w:10, p:0}}); const r0 = z2.faits.rivs[0], [mx, my] = M.midLen(r0.g);
 z2.saisies_eau = [{troncon:"eau:w999", profondeur_m:0.6, lon:mx + 0.0003, lat:my}];
 M.calculerZone(z2); const gid = M.G.rivs[0].id;
 ok(/^eau:@/.test(gid) && M.G.saisiesEau[0].troncon === gid && isFinite(temps("chenille", A, B)), "repli : saisie rattachée au tronçon le plus proche (" + gid + ")");
 ok(M.G.rivs[0].id === gid && (M.calculerZone(synth({riviere:{w:10, p:0}})), M.G.rivs[0].id === gid), "identifiant de tronçon sans OSM stable d'une ouverture à l'autre");
 // rattachement des pixels d'eau : suit la largeur mesurée (rivière de 62,5 m en surface, mesurée 63 m)
 const zl = synth({n:20, cell:25}); const fl = zl.faits, Wl = fl.W, bl = fl.b;
 for (let y = 0; y < Wl; y++) for (let x = 35; x <= 44; x++) fl.M[y*Wl + x] |= BIT.eau;
 for (let j = 0; j < 20; j++) for (const i of [8, 9, 10, 11]) fl.L.eau[j*20 + i] = 0.4;
 fl.rivs.push({id:"eau:w1", w:0, p:0.6, wm:63, k:"r", nm:"Rivière mesurée", g:[[bl.w + 40/Wl*(bl.e - bl.w), bl.n], [bl.w + 40/Wl*(bl.e - bl.w), bl.s]]});
 ouvrir(zl);
 ok([...M.arcsEau().values()].every(l => !l.includes(-1)), "largeur mesurée 63 m : tous les pixels d'eau rattachés à la rivière");
 ok(!isFinite(temps("chenille", cell(3, 10), cell(16, 10))), "63 m mesurés > 40 m : chenillé bloqué");
 M.G.saisiesEau = [{troncon:"eau:w1", largeur_m:35}]; M.recalcReseau();
 ok(isFinite(temps("chenille", cell(3, 10), cell(16, 10))) && !isFinite(temps("roue", cell(3, 10), cell(16, 10))), "saisie largeur 35 m : chenillé passe, roue (25 m) non — la saisie ne change pas le rattachement");
}

/* ---------- 4. pont et coupures (identifiant stable, repli par position) ---------- */
section("pont, coupures par identifiant stable, repli des anciens fichiers");
{
 const base = {riviere:{w:10, p:0}, pont:true};
 let G = ouvrir(synth(base)); const pont = G.feats.find(f => f.type === "pont");
 ok(pont && pont.id === "pont:n2", "identifiant stable du pont : " + (pont && pont.id));
 for (const k of ARMS) ok(isFinite(temps(k, cell(3, 12), cell(16, 12))), k + " : passe par le pont");
 const tAvant = temps("roue", cell(3, 12), cell(16, 12));
 const loin = {ouvrage:"pont:n2", type:"pont", lon:pont.lon + 0.01, lat:pont.lat, etat:"detruit"};   // position fausse de ~800 m : l'identifiant prime
 G = ouvrir(synth(Object.assign({coupures:[loin]}, base)));
 ok(loin.i >= 0 && loin.par === "id", "coupure rattachée par identifiant malgré une position à 800 m");
 for (const k of ARMS) ok(!isFinite(temps(k, cell(3, 12), cell(16, 12))), k + " : pont détruit, rivière de profondeur inconnue : ne passe plus");
 ok(ARMS.every(k => M.G.isoPct[k] > 40), "zones coupées calculées (" + ARMS.map(k => Math.round(M.G.isoPct[k])).join(" / ") + " %)");
 const deg = {ouvrage:"pont:n2", type:"pont", lon:0, lat:0, etat:"degrade"};
 ouvrir(synth(Object.assign({coupures:[deg]}, base))); const tDeg = temps("roue", cell(3, 12), cell(16, 12));
 ok(tDeg > tAvant, `pont dégradé : trajet plus long (${(tAvant*60).toFixed(2)} → ${(tDeg*60).toFixed(2)} min)`);
 const ancien = {type:"pont", lon:pont.lon + 0.0005, lat:pont.lat, etat:"detruit"};   // ancien fichier : pas d'identifiant, ~40 m
 ouvrir(synth(Object.assign({coupures:[ancien]}, base)));
 ok(ancien.i >= 0 && ancien.ouvrage === "pont:n2" && !isFinite(temps("roue", cell(3, 12), cell(16, 12))), "ancien fichier : rattachement par type et position, identifiant ajouté");
 const perdu = {type:"pont", lon:pont.lon + 0.006, lat:pont.lat, etat:"detruit"};     // ~470 m : aucun ouvrage
 ouvrir(synth(Object.assign({coupures:[perdu]}, base)));
 ok(perdu.i === -1 && isFinite(temps("roue", cell(3, 12), cell(16, 12))), "coupure sans ouvrage à moins de 100 m : ignorée");
 const gue = synth(Object.assign({coupures:[{ouvrage:"pont:n2", type:"pont", etat:"detruit"}]}, base, {riviere:{w:10, p:0.6}}));
 ouvrir(gue); ok(isFinite(temps("chenille", cell(3, 12), cell(16, 12))) && !isFinite(temps("logistique", cell(3, 12), cell(16, 12))), "pont détruit sur rivière guéable (0,6 m) : chenillé passe à gué, logistique non");
}

/* ---------- 5. non-régression sur la démonstration v2 d'origine ---------- */
section("non-régression : tests/fixtures/terrain-demo-v2.json (démonstration d'origine, version 2)");
// fichier de démonstration version 2 d'origine (figé ; terrain-demo.json est désormais en v3, fabriqué par tests/fabriquer-demo.js)
const DEMO = () => JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "terrain-demo-v2.json"), "utf8"));
// sommes des temps (h) depuis la maille centrale, mesurées avec le moteur avant le lot A (commit 748540e)
const REF = {chenille:{f:9902, s:1577.941935, gou:[]}, roue:{f:9818, s:2118.507916, gou:[[1, 10]]}, logistique:{f:8022, s:1683.649659, gou:[[1, 10]]}, fantassin:{f:9902, s:10083.014047, gou:[]}};
{
 const o = DEMO(), stored = o.resultats.par_arme, G = M.chargerTerrain(o), dec = M.dec;
 for (const k of ARMS) {
  for (const [g, s] of [["cls", "classes"], ["v", "vitesse_kmh"], ["corr", "couloirs_mobilite"], ["cov", "couvert"]]) {
   const a = G[g][k], b = dec(stored[k][s]); let d = 0; for (let c = 0; c < a.length; c++) if (a[c] !== b[c]) d++;
   ok(d === 0 && a.length === b.length, `${k} : ${s} identiques aux résultats du fichier (${d} écart(s))`);
  }
  ok(JSON.stringify(G.gou[k].map(g => [g.f, +g.pct.toFixed(4)])) === JSON.stringify(REF[k].gou), k + " : goulets inchangés");
  const T = M.search([(G.n*G.n/2 + G.n/2) | 0], k); let s = 0, f = 0; for (let c = 0; c < G.n*G.n; c++) if (isFinite(T[c])) { s += T[c]; f++; }
  ok(f === REF[k].f && Math.abs(s - REF[k].s) < 1e-4, `${k} : temps de trajet inchangés (${f} mailles atteintes, somme ${s.toFixed(6)} h)`);
 }
}

/* ---------- 5b. search avec options (outil Ennemi) : prédécesseurs, pondération, cible, départs décalés ---------- */
section("search avec options : prédécesseurs, pondération, cible, départs décalés");
{
 const G = M.chargerTerrain(DEMO()), N = G.n*G.n, src = (N/2 + G.n/2) | 0;
 // copie de référence du Dijkstra des anciennes pages ennemi (ennemi-prepa.html, « chemin »), que search(…, opts) remplace
 vm.runInContext(`function cheminRef(sources, cible, k, mult){
  const X = ctxOf(k), N = X.N, M = N + X.R.lon.length;
  const T = new Float64Array(M).fill(Infinity), raw = new Float64Array(M), pred = new Int32Array(M).fill(-1), pf = new Int32Array(M).fill(-1), done = new Uint8Array(M);
  const hk = [], hv = [];
  const push = (key, val) => { hk.push(key); hv.push(val); let i = hk.length-1;
   while (i > 0) { const q = (i-1) >> 1; if (hk[q] <= hk[i]) break; [hk[q],hk[i]] = [hk[i],hk[q]]; [hv[q],hv[i]] = [hv[i],hv[q]]; i = q; } };
  const pop = () => { const top = hv[0], lk = hk.pop(), lv = hv.pop();
   if (hk.length) { hk[0] = lk; hv[0] = lv; let i = 0;
    for (;;) { const l = 2*i+1, r = l+1; let m = i; if (l < hk.length && hk[l] < hk[m]) m = l; if (r < hk.length && hk[r] < hk[m]) m = r;
     if (m === i) break; [hk[m],hk[i]] = [hk[i],hk[m]]; [hv[m],hv[i]] = [hv[i],hv[m]]; i = m; } }
   return top; };
  for (const s of sources) { T[s] = 0; push(0, s); }
  let u, end = -1;
  const relax = (w, dt, len, c1, c2, f) => { if (done[w]) return; const nt = T[u] + dt*(c2 >= 0 ? mult[c2] : 1);
   if (nt < T[w]) { T[w] = nt; raw[w] = raw[u] + dt; pred[w] = u; pf[w] = f; push(nt, w); } };
  while (hk.length) { u = pop(); if (done[u]) continue; done[u] = 1; if (u < N && cible[u]) { end = u; break; } forEachEdge(u, X, relax); }
  if (end < 0) return null;
  const nodes = []; for (let x = end; x >= 0; x = pred[x]) nodes.push(x); nodes.reverse();
  return {nodes, tN:nodes.map(x => raw[x]), pfn:nodes.map(x => pf[x]), temps_h:raw[end]};
 }`, ctx);
 for (const k of ARMS) {
  const T0 = M.search([src], k), r = M.search([src], k, {});
  ok(T0.constructor.name === "Float64Array" && r.T.length === T0.length && r.T.every((v, i) => v === T0[i]) && r.brut.every((v, i) => v === T0[i]), k + " : avec options vides, mêmes temps que search par défaut");
  let bad = 0, nb = 0; for (let w = 0; w < r.T.length; w++) { const p = r.pred[w]; if (p < 0) continue; nb++; if (!(r.T[p] <= r.T[w]) || !isFinite(r.T[p])) bad++; }
  ok(nb > 0 && bad === 0 && r.pred[src] === -1, `${k} : prédécesseurs cohérents (${nb} nœuds, prédécesseur toujours plus tôt)`);
  const far = (() => { let b = -1; for (let c = 0; c < N; c++) if (isFinite(T0[c]) && (b < 0 || T0[c] > T0[b])) b = c; return b; })();
  const ch = M.cheminVers(r, far); ok(ch[0] === src && ch[ch.length - 1] === far, k + " : cheminVers va de la source à la maille la plus lointaine");
 }
 // équivalence avec l'ancien « chemin » des pages ennemi : axe rapide puis axe pondéré (exposition fictive), avec cible
 const cible = new Uint8Array(N); for (let j = 85; j < 95; j++) for (let i = 85; i < 95; i++) cible[j*G.n + i] = 1;
 const s0 = 10*G.n + 10, poids = new Float32Array(N); for (let c = 0; c < N; c++) poids[c] = 1 + 4*((c*7919) % 13)/12;
 for (const k of ["chenille", "roue", "fantassin"]) for (const mult of [new Float32Array(N).fill(1), poids]) {
  const ref = vm.runInContext("cheminRef", ctx)([s0], cible, k, mult), r = M.search([s0], k, {mult, cible});
  const ch = M.cheminVers(r, r.fin);
  ok(ref && r.fin === ref.nodes[ref.nodes.length - 1] && JSON.stringify(ch) === JSON.stringify(ref.nodes)
   && ch.every((x, q) => r.brut[x] === ref.tN[q] && (q === 0 ? true : r.ouvrage[x] === ref.pfn[q])), `${k}${mult === poids ? " pondéré" : ""} : même chemin, mêmes temps et ouvrages que l'ancien Dijkstra des pages ennemi (${ch.length} nœuds)`);
 }
 const rp = M.search([s0], "roue", {mult:poids}), r1 = M.search([s0], "roue", {});
 ok(rp.T.some((v, i) => isFinite(v) && v > r1.T[i] + 1e-9) && rp.brut.every((v, i) => !isFinite(v) || v >= r1.T[i] - 1e-9), "pondération : coût pondéré plus élevé, temps réel jamais plus court que le plus rapide");
 // départs décalés (plusieurs contacts à des heures différentes) = minimum des recherches séparées décalées
 const a = 20*G.n + 20, b = 70*G.n + 60, ra = M.search([a], "chenille"), rb = M.search([b], "chenille"), rab = M.search([a, b], "chenille", {t0:[0, 0.25]});
 ok(rab.T.every((v, i) => (isFinite(v) || !isFinite(Math.min(ra[i], rb[i] + 0.25))) && (!isFinite(v) || Math.abs(v - Math.min(ra[i], rb[i] + 0.25)) < 1e-9)), "départs décalés (t0) : temps = min des recherches séparées décalées");
 ok(M.search([a], "chenille", {cible:new Uint8Array(N)}).fin === -1, "cible vide : fin = -1");
}

/* ---------- 6. lecture d'un fichier version 2 : paramètres complétés ---------- */
section("lecture version 2 : paramètres complétés par DEF_TERRAIN");
{
 const o = DEMO(); ok(o.version === 2 && o.parametres.facteur_temps_ouvrage_degrade === undefined && o.parametres.eau === undefined, "le fichier de démonstration est un v2 incomplet");
 M.chargerTerrain(o); const P = M.P;
 ok(P.facteur_temps_ouvrage_degrade === 3 && P.eau && P.eau.profondeur_supposee_riviere_m === 1.5, "paramètres globaux manquants complétés");
 ok(ARMS.every(k => typeof P[k].eau_profondeur_max_m === "number" && typeof P[k].franchissement_eau_min === "number"), "paramètres de classe manquants complétés");
 ok(o.parametres === P, "terr.parametres remplacé par les paramètres complets (pages qui font P = terr.parametres)");
 ok(P.seuil_GO === 0.5 && P.chenille.pente_NOGO_pct === 50, "valeurs du fichier conservées");
 const part = M.withDefaultsTerrain({chenille:{pente_NOGO_pct:45}, vue:{portee_m:3000}, inconnu:1});
 ok(part.chenille.pente_NOGO_pct === 45 && part.chenille.pente_GO_max_pct === 30 && part.vue.portee_m === 3000 && part.vue.hauteur_foret_m === 15 && !("inconnu" in part), "complément clé par clé des sous-objets");
 let e1 = "", e2 = ""; try { M.chargerTerrain(Object.assign(DEMO(), {version:4})); } catch(e) { e1 = e.message; }
 try { M.chargerTerrain({format:"autre"}); } catch(e) { e2 = e.message; }
 ok(/plus récente/.test(e1) && /pas un fichier terrain-gtia/.test(e2), "versions futures et fichiers étrangers refusés clairement");
}

/* ---------- 7. contrat v3 : aller-retour export → chargement, fichier = zone enregistrée ---------- */
section("contrat v3 : aller-retour, un seul chemin de chargement");
const empreinte = G => JSON.stringify({cls:ARMS.map(k => [...G.cls[k]]), v:ARMS.map(k => [...G.v[k]]), corr:ARMS.map(k => [...G.corr[k]]), cov:ARMS.map(k => [...G.cov[k]]),
 gou:ARMS.map(k => G.gou[k]), iso:ARMS.map(k => [...G.iso[k]]), axes:ARMS.map(k => G.axes[k].map(a => [a.area, a.nb])), hp:G.hp, vue:[...G.vueCnt],
 feats:G.feats.map(f => [f.id, f.type, f.lon, f.lat]), coupe:[...G.coupe], cl:(G.cl || []).map(c => c.ok ? [c.best, c.cnt] : null), obs:G.obsPct, sol:G.sol});
{
 const o = DEMO(); M.chargerTerrain(o);
 const G0 = M.G; G0.couloirs = [{k:"roue", a:cell(5, 50), b:cell(90, 60)}]; G0.obs = [cell(30, 30)]; G0.vus = [cell(70, 70)];
 G0.coupures = [{ouvrage:G0.feats[1].id, type:G0.feats[1].type, lon:G0.feats[1].lon, lat:G0.feats[1].lat, nm:"", etat:"detruit", t:1}]; G0.journal = [{t:1, txt:"test"}];
 M.recalcReseau(); M.computeObs(); M.computeVus();
 const doc = JSON.parse(JSON.stringify(M.documentTerrain())), ref = empreinte(M.G);
 const champs = ["format", "version", "id", "nom", "date", "parametres", "faits", "resultats", "coupures", "journal_coupures"];
 ok(doc.format === "terrain-gtia" && doc.version === 3 && champs.every(c => c in doc), "document v3 : champs obligatoires présents");
 ok(["grilles", "voies", "points", "cours_eau", "ruisseaux", "obstacles_fins"].every(c => c in doc.faits) && ARMS.every(k => doc.resultats.par_arme[k] && doc.resultats.par_arme[k].classes.b64), "faits et résultats par classe présents");
 ok(doc.coupures[0].ouvrage === G0.feats[1].id && doc.resultats.ouvrages.every(f => typeof f.id_ouvrage === "string"), "coupures et ouvrages avec identifiant stable");
 ok(JSON.stringify(doc.parametres) === JSON.stringify(M.withDefaultsTerrain(doc.parametres)), "paramètres complets dans le document");
 // chemin 1 : fichier exporté, rouvert
 const f1 = JSON.parse(JSON.stringify(doc)); M.chargerTerrain(f1); const e1 = empreinte(M.G);
 ok(e1 === ref, "fichier v3 rouvert : résultats identiques à ceux de l'export");
 ok(JSON.stringify(M.documentTerrain()) === JSON.stringify(doc), "fichier v3 rouvert puis réexporté : document identique octet pour octet");
 // chemin 2 : zone enregistrée dans le navigateur (même document, lu par calculerZoneEtapes comme les outils ennemi)
 const z = JSON.parse(JSON.stringify(doc));
 M.calculerZoneEtapes(z, z.parametres).then(() => {
  ok(empreinte(M.G) === ref, "zone enregistrée (IndexedDB) : résultats identiques au fichier");
  // chemin 3 : zone enregistrée avant la v3 (faits en tableaux binaires)
  const g = M.G, legacy = {id:g.id, nom:g.nom, date:g.date, parametres:doc.parametres, couloirs:g.couloirs, obs:g.obs, vus:g.vus, journal:g.journal,
   coupures:doc.coupures.map(x => ({type:x.type, lon:x.lon, lat:x.lat, nm:x.nm, etat:x.etat, t:x.t})),
   faits:{b:g.b, n:g.n, cell:g.cell, W:g.W, sl:g.sl, el:g.el, gx:g.gx, gy:g.gy, L:g.L, M:g.M, ways:g.ways, pnodes:g.pnodes, rivs:g.rivs, rus:g.rus}};
  M.calculerZone(legacy, legacy.parametres);
  ok(empreinte(M.G) === ref, "zone enregistrée ancienne (avant v3, coupure sans identifiant) : résultats identiques");
  // chemin 4 : export « terrain-gtia-zone » des outils ennemi (encZone sur une zone v3 : encodeur tolérant)
  const ez = Object.assign({}, doc.faits, {L:{}}); for (const k of ["sl", "el", "gx", "gy", "M"]) ez[k] = M.enc(doc.faits[k]);
  M.calculerZone(JSON.parse(JSON.stringify(Object.assign({}, doc, {faits:ez}))), doc.parametres);
  ok(empreinte(M.G) === ref, "zone v3 réexportée par un outil ennemi puis rouverte : résultats identiques");
  // v2 de démonstration : fichier et zone enregistrée donnent la même chose
  const a = DEMO(); M.chargerTerrain(a); const ea = empreinte(M.G), docA = JSON.parse(JSON.stringify(M.documentTerrain()));
  M.calculerZone(docA, docA.parametres); ok(empreinte(M.G) === ea, "démonstration v2 : fichier v2 et zone enregistrée v3 identiques");
  ok(M.infoZone(docA).km === 10 && M.infoZone(legacy).km === 10, "taille de zone lisible dans les deux formats");
  return sequences();
 }).then(fin).catch(e => { ok(false, "exception : " + e.stack); fin(); });
}
/* ---------- 8. séquences : obstacles par bandes de lignes identiques, arrêt pris en compte ---------- */
async function sequences(){
 section("séquences : obstacles par bandes de lignes, arrêt");
 const g = M.G, F1 = M.barriers(g.M, g.n, g.W), F2 = await M.enSequences(M.barriersEtapes(g.M, g.n, g.W));
 ok(F1.length === F2.length && F1.every((v, i) => v === F2[i]) && F1.every((v, i) => v === g.F[i]), "obstacles en séquences = d'un trait = ouverture du terrain");
 vm.runInContext("var STOP = false; function arretSi(){ if (STOP) throw new Error('analyse arrêtée'); }", ctx);
 let pas = 0; const gen = (function*(){ for (; pas < 200; pas++) { const t = performance.now(); while (performance.now() - t < 3); if (pas === 30) vm.runInContext("STOP = true", ctx); yield ["test", pas/200]; } })();
 let err = null; try { await M.enEtapes(gen); } catch(e) { err = e; }
 vm.runInContext("STOP = false", ctx);
 ok(err && /arrêtée/.test(err.message) && pas < 60, "enEtapes respecte arretSi (arrêt après " + pas + " étapes sur 200)");
}
function fin(){
 console.log(`${nb} vérifications, ${ko} échec(s)`);
 process.exit(ko ? 1 : 0);
}
