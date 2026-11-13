/* Tests de calcul de l'outil Radars (Node pur, sans navigateur) :  node tests/radars.js
   moteur-radar.js sur des grilles synthétiques : bibliothèque (sources, fiabilité, complément, contrôle), horizon radar en terrain plat
   (courbure à 4/3, hauteur d'antenne et de cible), portée minimale et maximale, secteur orienté, masque du relief et plancher de
   détection derrière une crête, forêt à hauteur forfaitaire (masque et cible cachée sous le couvert), réseau (couverture cumulée,
   trous), recherche des meilleurs emplacements (sommet d'une colline, plan à 2 radars, complément d'un réseau) ; mode Ennemi (lot 2) : enveloppe
   pessimiste d'une position incertaine, zones de défilement derrière une colline, itinéraires défilés (mobilité simplifiée : contournement de
   la zone vue, plus long que le plus rapide, pénalité nulle = chemins identiques ; moteur terrain sur terrain-demo.json : pont détruit évité). */
"use strict";
const path = require("path");
const {MR} = require(path.join(__dirname, "..", "moteur-radar.js"));
let nb = 0, ko = 0;
const ok = (c, msg) => { nb++; if (!c) { ko++; console.log("  ÉCHEC : " + msg); } else if (process.env.VERBEUX) console.log("  ok : " + msg); };
const section = t => console.log("- " + t);

// grille n × n de maille cell, altitude par fonction (i, j) ; forêt facultative
function grille(n, cell, f, foret){ const el = new Float32Array(n*n), H = new Float32Array(n*n), couv = new Float32Array(n*n);
 for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const c = j*n + i; el[c] = f(i, j); const fo = foret ? foret(i, j) : 0; H[c] = el[c] + fo; couv[c] = fo; }
 const dl = n*cell/111320/Math.cos(47*Math.PI/180), dp = n*cell/110574;
 return {n, cell, el, H, couv, ok:c => el[c] > 1, b:{w:0, e:dl, s:47, n:47 + dp}}; }
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

section("mode Ennemi : position incertaine (enveloppe pessimiste), zones de défilement");
{
 // plaine à 100 m, colline de 400 m (σ = 1,6 km) ; radar ennemi au nord, cible véhicule (2,5 m)
 const n = 161, cell = 200, Z = grille(n, cell, (i, j) => 100 + 400*Math.exp(-((i - 80)**2 + (j - 45)**2)/(2*8*8)));
 const s = {c:5*n + 80, min_m:0, max_m:30000, secteur_deg:360, orient_deg:0, antenne_m:4};
 const pl = MR.boucher(MR.balayage(Z, s, {k:4/3}), n), R = MR.reseau(Z, [pl], 2.5), D = MR.defilement(Z, R);
 const derriere = 75*n + 80, devant = 25*n + 40;
 ok(R.cnt[derriere] === 0 && R.env[derriere] === 1 && R.cnt[devant] === 1, "derrière la colline : dans la portée mais non vu (défilé) ; devant : vu");
 ok(D.defileKm2 > 5 && Math.abs(D.vuKm2 + D.defileKm2 + D.horsKm2 - D.zoneKm2) < 1e-6 && Math.abs(D.nonVuKm2 - D.defileKm2 - D.horsKm2) < 1e-6, "surfaces : vu + défilé + hors portée = zone (défilé " + Math.round(D.defileKm2) + " km²)");
 const T = MR.trous(Z, R, 2), zd = T.liste[0];
 ok(zd && T.lab[derriere] === zd.id && zd.plancher_min_m > 2.5 && zd.plancher_min_m <= zd.plancher_max_m, "plus grande zone défilée : derrière la colline, plancher (hauteur sous laquelle on passe sans être vu) " + (zd ? Math.round(zd.plancher_min_m) + " à " + Math.round(zd.plancher_max_m) : "?") + " m");
 // position incertaine : rayon 1 km, enveloppe pessimiste (vu depuis au moins un point du cercle)
 const pts = MR.pointsIncertitude(Z, s.c, 1000);
 ok(pts[0] === s.c && pts.length >= 9 && pts.every(c => dist(Z, s.c, c) <= 1000 + cell), "cercle d'incertitude : centre et " + (pts.length - 1) + " points à 1 km au plus");
 const E = MR.enveloppe(Z, s, 1000, {k:4/3}); let sup = true, plus = 0;
 for (let c = 0; c < n*n; c++) { if (E.pl[c] > pl[c]) sup = false; if (E.pl[c] <= 2.5 && !(pl[c] <= 2.5)) plus++; }
 ok(sup && plus > 0, "enveloppe pessimiste : plancher jamais plus haut que depuis le centre, " + plus + " mailles vues en plus");
 const P1 = MR.pointsIncertitude(Z, s.c, 2000); ok(P1.length > pts.length, "grand rayon : second cercle à mi-rayon (" + P1.length + " points)");
}

section("itinéraires défilés (grande zone : mobilité simplifiée, relief seul)");
{
 // plaine à 100 m ; crête est-ouest de 300 m (infranchissable) percée d'une brèche ; radar ennemi au nord (portée 20 km, mât de 40 m) :
 // au sud de la crête, seule une bande vue par la brèche, qui s'arrête à la portée du radar. A et B de part et d'autre de la bande.
 const n = 161, cell = 200, Z = grille(n, cell, (i, j) => 100 + ((j === 40 || j === 41) && (i < 75 || i > 85) ? 300 : 0));
 const s = {c:5*n + 80, min_m:0, max_m:20000, secteur_deg:360, orient_deg:0, antenne_m:40};
 const R = MR.reseau(Z, [MR.boucher(MR.balayage(Z, s, {k:4/3}), n)], 2.5), vu = R.cnt;
 const g = MR.grapheGrille(Z, MR.MOBILITE_SIMPLE.roue), A = 90*n + 40, B = 90*n + 120;
 ok(!vu[A] && !vu[B] && vu[90*n + 80] && !vu[110*n + 80], "A et B défilés derrière la crête, bande vue par la brèche entre les deux, hors portée plus au sud");
 const r = MR.itineraires(g, A, B, vu, {penalite:20, n});
 ok(r.rapide && r.defile && !r.manque, "deux itinéraires calculés");
 const Rp = r.rapide, Df = r.defile;
 ok(Rp.vu_km > 2 && Df.vu_km < 0.2*Rp.vu_km, "le plus défilé contourne la zone vue : " + Df.vu_km.toFixed(1) + " km sous vue contre " + Rp.vu_km.toFixed(1) + " km");
 ok(Df.longueur_km > Rp.longueur_km && Df.temps_min >= Rp.temps_min - 1e-9, "le plus défilé est plus long (" + Df.longueur_km.toFixed(1) + " km contre " + Rp.longueur_km.toFixed(1) + " km) et pas plus rapide");
 ok(Math.max(...Df.noeuds.map(c => (c/n) | 0)) > 104, "le plus défilé passe au sud de la bande vue, hors de portée du radar");
 ok(Rp.troncons.length >= 1 && Math.abs(Rp.troncons.reduce((a, t) => a + t.longueur_km, 0) - Rp.vu_km) < 1e-6 && Rp.troncons.every(t => t.de && t.a), "tronçons exposés : somme = distance sous vue, extrémités données");
 ok(Rp.coords[0][0] < Rp.coords[Rp.coords.length - 1][0] && Rp.noeuds[0] === A && Rp.noeuds[Rp.noeuds.length - 1] === B, "itinéraire de A à B");
 const r1 = MR.itineraires(g, A, B, vu, {penalite:1, n});
 ok(r1.identiques && r1.defile.longueur_km === r1.rapide.longueur_km && r1.defile.vu_km === r1.rapide.vu_km, "pénalité nulle (× 1) : chemins identiques");
 const gF = MR.grapheGrille(Z, MR.MOBILITE_SIMPLE.fantassin), rf = MR.itineraires(gF, A, B, vu, {penalite:20, n});
 ok(rf.rapide.temps_min > 5*Rp.temps_min, "fantassin : plus lent que la roue (" + Math.round(rf.rapide.temps_min) + " min contre " + Math.round(Rp.temps_min) + ")");
 const Zm = Object.assign({}, Z, {ok:c => (c % n) !== 100}), rm = MR.itineraires(MR.grapheGrille(Zm, MR.MOBILITE_SIMPLE.roue), A, B, vu, {penalite:20, n});
 ok(/Aucun passage/.test(rm.manque || ""), "colonne infranchissable (mer) : aucun passage, expliqué");
 const gen = MR.itinerairesEtapes(g, A, B, vu, {penalite:20, n}); let x, last = -1, okp = true; while (!(x = gen.next()).done) { if (!(x.value[1] >= last)) okp = false; last = x.value[1]; }
 ok(okp, "itinéraires par étapes : avancement croissant");
}

section("itinéraires défilés (zone terrain : mobilité par arme du moteur terrain, coupures d'ouvrages)");
{
 const fs = require("fs"), vm = require("vm"), ROOT = path.join(__dirname, "..");
 const ctx = vm.createContext({console, atob, btoa, performance, setTimeout});
 vm.runInContext("var G = null, P = null;", ctx);
 for (const f of ["moteur-terrain.js", "moteur-radar.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, {filename:f});
 ctx.demo = JSON.parse(fs.readFileSync(path.join(ROOT, "terrain-demo.json"), "utf8")); vm.runInContext("chargerTerrain(demo)", ctx);
 const X = k => vm.runInContext(k, ctx), G = X("G"), M = X("MR"), n = G.n;
 // grille radar de la zone : forêts 15 m, bâti 8 m (comme la page)
 const H = new Float32Array(n*n), couv = new Float32Array(n*n); for (let c = 0; c < n*n; c++) { couv[c] = G.L.foret[c] >= 0.5 ? 15 : G.L.bati[c] >= 0.5 ? 8 : 0; H[c] = G.el[c] + couv[c]; }
 const Z = {n, cell:G.cell, b:G.b, el:G.el, H, couv};
 const s = {c:30*n + 30, min_m:0, max_m:10000, secteur_deg:360, orient_deg:0, antenne_m:2};   // radar ennemi au nord-ouest
 const R = M.reseau(Z, [M.boucher(M.balayage(Z, s, {k:4/3, couvert:true}), n)], 2.5);
 const A = 50*n + 20, B = 50*n + 85, g = M.grapheTerrain("roue");
 ok(!g.simplifie && g.M > g.N && g.praticable(A), "graphe du moteur terrain (mailles et nœuds routiers) pour la roue");
 const r = M.itineraires(g, A, B, R.cnt, {penalite:20, n});
 ok(r.rapide && r.defile && r.rapide.vu_min > 1 && r.defile.vu_min < r.rapide.vu_min && r.defile.temps_min >= r.rapide.temps_min - 1e-9, "terrain de démonstration : le plus défilé moins vu (" + r.defile.vu_min.toFixed(1) + " min contre " + r.rapide.vu_min.toFixed(1) + "), pas plus rapide");
 const r1 = M.itineraires(g, A, B, R.cnt, {penalite:1, n}); ok(r1.identiques, "pénalité nulle : chemins identiques (moteur terrain)");
 const pont = r.rapide.ouvrages.find(o => o.type === "pont");
 ok(!!pont, "le plus rapide franchit la rivière sur un pont (" + (pont ? pont.nom : "aucun") + ")");
 if (pont) { ctx.idp = pont.id; X("G.coupures = [{ouvrage:idp, type:'pont', etat:'detruit'}]; appliquerCoupures();");
  const r2 = M.itineraires(M.grapheTerrain("roue"), A, B, R.cnt, {penalite:20, n});
  ok(!r2.manque && !r2.rapide.ouvrages.some(o => o.id === pont.id) && !r2.defile.ouvrages.some(o => o.id === pont.id) && r2.rapide.temps_min > r.rapide.temps_min, "pont détruit (coupure de la zone) : plus aucun itinéraire ne l'emprunte, le plus rapide s'allonge (" + Math.round(r.rapide.temps_min) + " → " + Math.round(r2.rapide.temps_min) + " min)");
  X("G.coupures = []; appliquerCoupures();"); }
}

console.log(nb + " vérifications, " + ko + " échec(s)");
process.exit(ko ? 1 : 0);
