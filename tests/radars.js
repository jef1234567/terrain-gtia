/* Tests de calcul de l'outil Radars (Node pur, sans navigateur) :  node tests/radars.js
   moteur-radar.js sur des grilles synthétiques : bibliothèque (sources, fiabilité, complément, contrôle), horizon radar en terrain plat
   (courbure à 4/3, hauteur d'antenne et de cible), portée minimale et maximale, secteur orienté, masque du relief et plancher de
   détection derrière une crête, forêt à hauteur forfaitaire (masque et cible cachée sous le couvert), réseau (couverture cumulée,
   trous), recherche des meilleurs emplacements (sommet d'une colline, plan à 2 radars, complément d'un réseau). */
"use strict";
const path = require("path");
const {MR} = require(path.join(__dirname, "..", "moteur-radar.js"));
let nb = 0, ko = 0;
const ok = (c, msg) => { nb++; if (!c) { ko++; console.log("  ÉCHEC : " + msg); } else if (process.env.VERBEUX) console.log("  ok : " + msg); };
const section = t => console.log("- " + t);

// grille n × n de maille cell, altitude par fonction (i, j) ; forêt facultative
function grille(n, cell, f, foret){ const el = new Float32Array(n*n), H = new Float32Array(n*n), couv = new Float32Array(n*n);
 for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const c = j*n + i; el[c] = f(i, j); const fo = foret ? foret(i, j) : 0; H[c] = el[c] + fo; couv[c] = fo; }
 return {n, cell, el, H, couv, ok:c => el[c] > 1}; }
const dist = (Z, c0, c) => Math.hypot((c % Z.n) - (c0 % Z.n), ((c/Z.n) | 0) - ((c0/Z.n) | 0))*Z.cell;
const vusA = (Z, pl, h) => { const r = []; for (let c = 0; c < Z.n*Z.n; c++) if (pl[c] <= h) r.push(c); return r; };
const maxi = a => a.reduce((m, x) => x > m ? x : m, -Infinity), mini = a => a.reduce((m, x) => x < m ? x : m, Infinity);

section("bibliothèque : sources, fiabilité, complément, contrôle");
{
 const B = MR.completerBib(null);
 ok(MR.verifierBib(B).length === 0, "bibliothèque par défaut sans erreur (" + MR.verifierBib(B).join(" ; ") + ")");
 const ids = B.radars.map(f => f.id);
 ok(["murin", "cobra", "giraffe1x", "gm400a", "generique"].every(x => ids.includes(x)), "amis : MURIN, COBRA, Giraffe 1X, GM400α, générique");
 ok(B.radars.filter(f => f.camp === "ennemi").length >= 5, "au moins 5 radars ennemis");
 let sans = [];
 for (const f of B.radars) for (const k of ["portee_min_km", "portee_max_km", "secteur_deg", "antenne_m"].concat(Object.keys(f.cibles).map(x => "c:" + x))) {
  const v = k.startsWith("c:") ? f.cibles[k.slice(2)] : f[k];
  if (!MR.FIAB[v.fiab]) sans.push(f.id + "." + k + " (fiabilité)");
  if (["forte", "moyenne", "faible"].includes(v.fiab) && !/^https:\/\//.test(v.src || "")) sans.push(f.id + "." + k + " (source)");
  if (v.v == null && v.fiab !== "inconnu") sans.push(f.id + "." + k + " (valeur nulle non marquée inconnue)"); }
 ok(!sans.length, "chaque valeur a sa fiabilité, et sa source si elle n'est pas estimée ou inconnue (" + sans.join(", ") + ")");
 const m = MR.fiche(B, "murin");
 ok(MR.val(m.portee_min_km) === 0.3 && MR.val(m.portee_max_km) === 25 && MR.val(m.secteur_deg) === 360 && m.portee_max_km.fiab === "forte" && /defense\.gouv\.fr/.test(m.portee_max_km.src), "MURIN : 300 m – 25 km, 360°, source fiche LPM (forte)");
 ok(/PAS un radar de niveau GTIA/.test(MR.fiche(B, "gm400a").niveau) && MR.val(MR.fiche(B, "gm400a").portee_max_km) === 515, "GM400α : 515 km, signalé hors niveau GTIA");
 ok(/16 commandés/.test(MR.fiche(B, "giraffe1x").note) && /defense\.gouv\.fr/.test(MR.fiche(B, "giraffe1x").secteur_deg.src), "Giraffe 1X : 16 commandés par la DGA (source defense.gouv.fr)");
 ok(MR.fiche(B, "generique").portee_max_km.fiab === "estimé", "générique : valeurs estimées");
 // portée par cible : connue, inconnue (portée max), absente (non vue)
 const pm = MR.portees(m, "pieton"), pd = MR.portees(m, "drone50"), po = MR.portees(m, "obus");
 ok(pm.max_m === 16000 && pm.connue && pd.max_m === 25000 && !pd.connue && po === null, "portées par cible : piéton 16 km, drone inconnu → 25 km signalé, obus non vu");
 // complément d'une saisie partielle : nombre seul → valeur « saisie », fiches par défaut gardées, fiche retirée
 const C = MR.completerBib({cibles:B.cibles, radars:[{id:"perso", nom:"Mon radar", portee_max_km:12, cibles:{pieton:5}}], retirees:["nebo"]});
 const p = MR.fiche(C, "perso");
 ok(p && p.portee_max_km.fiab === "saisie" && p.cibles.pieton.v === 5 && p.secteur_deg.fiab === "estimé" && MR.fiche(C, "murin") && !MR.fiche(C, "nebo"), "complément : saisie marquée, champs manquants estimés, fiches par défaut reprises, fiche retirée absente");
 ok(MR.verifierBib(MR.completerBib({radars:[{id:"x", portee_max_km:5, portee_min_km:8}]})).some(e => /minimale/.test(e)), "contrôle : portée minimale ≥ maximale refusée");
}

section("terrain plat : horizon radar, courbure, portées, secteur");
{
 const Z = grille(401, 250, () => 100), c0 = 200*401 + 200, B = MR.completerBib(null), g = MR.fiche(B, "generique");
 const s = {c:c0, min_m:0, max_m:60000, secteur_deg:360, orient_deg:0, antenne_m:10};
 const pl = MR.balayage(Z, s, {k:4/3}); MR.boucher(pl, Z.n);
 const dmax = h => maxi(vusA(Z, pl, h).map(c => dist(Z, c0, c)));
 const hz = MR.horizonKm(10, 50, 4/3)*1000;
 ok(Math.abs(dmax(50) - hz) < 600, "cible à 50 m vue jusqu'à l'horizon radar (" + Math.round(dmax(50)) + " m pour " + Math.round(hz) + " m)");
 ok(dmax(1.8) < dmax(50) && dmax(500) > dmax(50), "plus la cible est haute, plus elle est vue loin");
 const pl2 = MR.balayage(Z, Object.assign({}, s, {antenne_m:30}), {k:4/3}); ok(maxi(vusA(Z, pl2, 50).map(c => dist(Z, c0, c))) > dmax(50) + 2000, "antenne plus haute : horizon plus lointain");
 const pl3 = MR.balayage(Z, s, {k:1}); ok(maxi(vusA(Z, pl3, 50).map(c => dist(Z, c0, c))) < dmax(50) - 1000, "sans réfraction (k = 1) l'horizon est plus proche qu'à 4/3");
 // plancher en terrain plat : croît avec la distance (courbure)
 const at = km => pl[200*401 + 200 + Math.round(km*1000/250)];
 const theo = km => { const d1 = Math.sqrt(2*4/3*6371000*10), d = km*1000; return d <= d1 ? 0 : (d - d1)**2/(2*4/3*6371000); };   // terre à 4/3 : h = (d − d_antenne)² / 2kR
 ok(at(5) === 0 && at(20) < at(40) && Math.abs(at(20) - theo(20)) < 2 && Math.abs(at(40) - theo(40)) < 3, "plancher croissant avec la distance, conforme à la courbure (20 km " + Math.round(at(20)) + " m pour " + Math.round(theo(20)) + ", 40 km " + Math.round(at(40)) + " m pour " + Math.round(theo(40)) + ")");
 // portée minimale et maximale
 const pm = MR.balayage(Z, Object.assign({}, s, {min_m:3000, max_m:20000}), {k:4/3}), v = vusA(Z, pm, 5000).map(c => dist(Z, c0, c));
 ok(mini(v) >= 3000 - 1 && maxi(v) <= 20000 + 400, "rien n'est vu en deçà de la portée minimale ni au-delà de la portée maximale");
 // secteur de 90° orienté à l'est
 const ps = MR.balayage(Z, Object.assign({}, s, {secteur_deg:90, orient_deg:90, max_m:20000}), {k:4/3});
 const est = ps[200*401 + 200 + 40], ouest = ps[200*401 + 200 - 40], nord = ps[160*401 + 200], nordEst = ps[180*401 + 220];
 ok(est <= 50 && ouest === Infinity && nord === Infinity && nordEst <= 50, "secteur de 90° vers l'est : l'est et le nord-est vus, l'ouest et le nord hors secteur");
 const site = MR.site(g, {orient_deg:45, antenne_m:7}, "pieton", 5); ok(site.max_m === 8000 && site.antenne_m === 7 && site.orient_deg === 45 && site.secteur_deg === 360, "MR.site : portée de la cible, réglage du radar posé");
}

section("masques : crête, forêt à hauteur forfaitaire, cible sous le couvert");
{
 // plaine à 100 m et un mur de 300 m de haut, large de 2 mailles, à 5 km à l'est du radar
 const n = 161, cell = 100, c0 = 80*n + 40;
 const Z = grille(n, cell, (i, j) => (i === 90 || i === 91) ? 400 : 100);
 const s = {c:c0, min_m:0, max_m:20000, secteur_deg:360, orient_deg:0, antenne_m:5};
 const pl = MR.balayage(Z, s, {k:4/3});
 const derriere = d => pl[80*n + 92 + d], devant = pl[80*n + 70];
 ok(devant <= 2 && derriere(5) > 50, "devant la crête : vu au sol ; juste derrière : plancher élevé (" + Math.round(derriere(5)) + " m)");
 ok(derriere(5) < derriere(40), "le plancher remonte avec la distance derrière la crête (" + Math.round(derriere(5)) + " → " + Math.round(derriere(40)) + " m)");
 const att = (300 + 100 - 105)/(5100)*(9300) - (100 - 105);   // angle de la crête × distance (sans courbure)
 ok(Math.abs(derriere(40) - att) < 0.1*att + 10, "plancher derrière la crête conforme à la géométrie (" + Math.round(derriere(40)) + " m pour ≈ " + Math.round(att) + " m)");
 // forêt de 15 m sur une bande, à 2 km à l'est
 const Zf = grille(n, cell, () => 100, (i) => (i >= 60 && i < 64) ? 15 : 0);
 const pf = MR.balayage(Zf, s, {k:4/3}), pc = MR.balayage(Zf, s, {k:4/3, couvert:true});
 ok(pf[80*n + 75] > 1.8 && pf[80*n + 75] < 50, "derrière la lisière : piéton caché, drone bas vu (" + Math.round(pf[80*n + 75]) + " m)");
 ok(pf[80*n + 60] <= 1.8 && pc[80*n + 60] >= 15, "cible sous le couvert : vue si l'option est décochée, cachée sous ses 15 m sinon");
 // grande zone (relief seul) : la forêt ne compte pas
 const Zr = Object.assign({}, Zf, {H:Zf.el, couv:null}); ok(MR.balayage(Zr, s, {k:4/3})[80*n + 75] <= 1.8, "relief seul : la forêt ne masque pas");
}

section("réseau : couverture cumulée, trous");
{
 const n = 121, cell = 200, Z = grille(n, cell, (i, j) => 100 + (i === 60 && j > 20 && j < 100 ? 600 : 0));   // mur nord-sud au milieu
 const s1 = {c:60*n + 30, min_m:0, max_m:8000, secteur_deg:360, orient_deg:0, antenne_m:5}, s2 = Object.assign({}, s1, {c:60*n + 90});
 const p1 = MR.balayage(Z, s1, {k:4/3}), p2 = MR.balayage(Z, s2, {k:4/3});
 const R1 = MR.reseau(Z, [p1], 2.5), R2 = MR.reseau(Z, [p1, p2], 2.5);
 ok(R2.vuKm2 > R1.vuKm2*1.6, "le 2e radar de l'autre côté du mur double presque la surface vue (" + Math.round(R1.vuKm2) + " → " + Math.round(R2.vuKm2) + " km²)");
 ok(R2.cnt[60*n + 60] === 0 || R2.cnt[60*n + 60] >= 1, "comptage par maille");
 const T1 = MR.trous(Z, R1); ok(T1.liste.length >= 1 && T1.liste[0].km2 > 1, "un radar seul : trou derrière le mur (" + (T1.liste[0] ? Math.round(T1.liste[0].km2) : 0) + " km²)");
 ok(R1.trousKm2 > R2.trousKm2 || R2.trousKm2 < R1.trousKm2 + R1.envKm2, "trous recalculés avec le 2e radar (" + Math.round(R1.trousKm2) + " → " + Math.round(R2.trousKm2) + " km²)");
 const Ra = MR.reseau(Z, [p1], 2.5, [p2]); ok(Ra.ajoutKm2 > 50 && Ra.vuKm2 === R1.vuKm2, "emplacement proposé : surface ajoutée comptée à part (" + Math.round(Ra.ajoutKm2) + " km²)");
}

section("recherche des meilleurs emplacements");
{
 // zone de 60 km, plaine à 100 m et une colline de 400 m au centre (σ = 2,5 km) ; radar de 30 km, piéton (1,8 m) : l'horizon limite en plaine
 const n = 240, cell = 250, Z = grille(n, cell, (i, j) => 100 + 400*Math.exp(-((i - 120)**2 + (j - 120)**2)/(2*10*10)));
 // dôme large (σ = 3 km) : depuis le sommet, l'épaulement proche cache la plaine à une antenne de 5 m (« crête militaire »)
 { const D = grille(120, cell, (i, j) => 100 + 500*Math.exp(-((i - 60)**2 + (j - 60)**2)/(2*12*12))), gb = {min_m:0, max_m:15000, secteur_deg:360, orient_deg:0, antenne_m:5};
  const v = (c, a) => vusA(D, MR.balayage(D, Object.assign({}, gb, {c, antenne_m:a}), {k:4/3}), 50).length;
  ok(v(60*120 + 60, 5) < v(60*120 + 40, 5) && v(60*120 + 60, 60) > 3*v(60*120 + 60, 5), "dôme large : le sommet voit moins qu'un site de pente à antenne de 5 m, beaucoup plus avec un mât de 60 m"); }
 const gab = {min_m:0, max_m:30000, secteur_deg:360, orient_deg:0, antenne_m:5};
 const r = MR.recherche(Z, gab, 1.8, {k:4/3, nb:2});
 const t0 = r.tops[0], i = t0.c % n, j = (t0.c/n) | 0;
 ok(r.tops.length >= 3 && Math.hypot(i - 120, j - 120) < 10 && Z.el[t0.c] > 300, "meilleur emplacement près du sommet (" + i + ", " + j + "), " + r.tops.length + " classés");
 ok(r.tops.every((t, k) => !k || t.gainKm2 <= r.tops[k - 1].gainKm2), "classés par surface nouvelle décroissante");
 ok(t0.pct > 0 && t0.pct <= 100.5 && t0.porteeKm2 >= t0.totKm2 && t0.porteeKm2 <= Math.PI*900 + 30, "part vue de ce qui est dans la portée plausible (" + Math.round(t0.pct) + " % de " + Math.round(t0.porteeKm2) + " km²)");
 ok(r.plan.length === 2 && r.plan[1].cumKm2 > r.plan[0].cumKm2 && r.plan[1].gainKm2 > 0, "plan à 2 radars : le 2e ajoute de la surface");
 // complément : réseau existant au sommet → le meilleur nouvel emplacement s'en écarte
 const deja = MR.bits(MR.balayage(Z, Object.assign({c:120*n + 120}, gab), {k:4/3, grossier:true}), 1.8, n);
 const r2 = MR.recherche(Z, gab, 1.8, {k:4/3, nb:1, N:300, deja}), c2 = r2.tops[0].c;
 ok(Math.hypot((c2 % n) - 120, ((c2/n) | 0) - 120) > 15 && r2.tops[0].gainKm2 < r2.tops[0].totKm2, "en complément d'un radar au sommet : emplacement écarté, gain < surface totale");
 // générateur : avancement croissant entre 0 et 1
 const gen = MR.rechercheEtapes(Z, gab, 1.8, {k:4/3, N:200}); let x, last = -1, okp = true; while (!(x = gen.next()).done) { if (!(x.value[1] >= last && x.value[1] <= 1)) okp = false; last = x.value[1]; }
 ok(okp && last > 0.9, "recherche par étapes : avancement croissant jusqu'à 1");
}

console.log(nb + " vérifications, " + ko + " échec(s)");
process.exit(ko ? 1 : 0);
