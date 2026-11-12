/* Tests de calcul de l'outil Ennemi (Node pur, sans navigateur) :  node tests/ennemi.js
   Étape 0 : chargement de doctrine.js, moteur-ennemi.js et moteur-terrain.js sur terrain-demo.json (v3),
   validation de la doctrine, référence terrain (id + empreinte), signatures du moteur ennemi.
   Lot A (fonction calculs) : axes (coupures des ponts, ru par classe), horaires (franchissement non divisé, haltes, regroupement),
   isochrones multi-contacts à heures différentes, plusieurs unités, regroupements hors vue, présence, export / import v3,
   migration des v1, aucune valeur de doctrine en dur. PERF=1 : temps sur une grille synthétique 500 × 500. */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.resolve(__dirname, "..");
const ctx = vm.createContext({console, atob, btoa, performance, setTimeout, requestAnimationFrame:f => setTimeout(f, 0)});
vm.runInContext("var G = null, P = null;", ctx);
for (const f of ["moteur-terrain.js", "doctrine.js", "moteur-ennemi.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, {filename:f});
const M = new Proxy({}, {get:(_, k) => vm.runInContext(k, ctx)});
const ME = M.ME, ARMS = M.ARMS;

let nb = 0, ko = 0;
const ok = (c, msg) => { nb++; if (!c) { ko++; console.log("  ÉCHEC : " + msg); } else if (process.env.VERBEUX) console.log("  ok : " + msg); };
const section = t => console.log("- " + t);
const DEMO = () => JSON.parse(fs.readFileSync(path.join(ROOT, "terrain-demo.json"), "utf8"));

/* ---------- 1. chargement sous Node par require (export conditionnel) ---------- */
section("chargement sous Node (require)");
{
 const d = require(path.join(ROOT, "doctrine.js")), e = require(path.join(ROOT, "moteur-ennemi.js"));
 ok(d.DOCTRINE && typeof d.validerDoctrine === "function" && typeof d.completerDoctrine === "function", "doctrine.js : require renvoie DOCTRINE et les fonctions");
 ok(e.ME && typeof e.ME.axes === "function", "moteur-ennemi.js : require renvoie ME");
}

/* ---------- 2. doctrine : forme, valeurs reprises, validation, surcharge ---------- */
section("doctrine : classes, modes, échelons, validation, surcharge");
{
 const D = M.DOCTRINE;
 ok(D.version === 1 && /FICTIF/.test(D.source) && /remplacer/.test(D.source), "version 1, source « FICTIF – à remplacer »");
 ok(JSON.stringify(M.DOCTRINE_CLASSES) === JSON.stringify([...ARMS]), "classes de la doctrine = ARMS du moteur terrain (" + M.DOCTRINE_CLASSES.join(", ") + ")");
 ok(!JSON.stringify(D).includes("toutes armes"), "jamais « toutes armes »");
 ok(ARMS.every(k => M.DOCTRINE_MODES.every(m => D.vitesses_pct[k][m] > 0)), "vitesse par classe × mode d'action (attaque, reco, repli, marche)");
 ok(D.vitesses_pct.chenille.attaque === 50 && D.vitesses_pct.roue.attaque === 60 && D.vitesses_pct.fantassin.attaque === 80, "anciennes vitesses tactiques reprises (méca 50, moto 60, pied 80 %)");
 ok(D.vitesses_pct.logistique && D.unites_types.some(u => u.classe === "logistique"), "classe logistique ajoutée (vitesses et unité type)");
 ok(M.DOCTRINE_MODES.every(m => ["poids_surete_pct", "ecart_axes_m", "suit_routes", "regroupe"].every(f => f in D.modes_action[m])), "modes d'action : poids sûreté, écart entre axes, suit les routes, regroupe");
 ok(M.DOCTRINE_ECHELONS.every(e => ["sous_unites", "vehicules", "front_km", "prof_km", "dispersion_min"].every(f => D.echelons[e][f] > 0)), "échelons section, compagnie, bataillon complets");
 ok(D.echelons.compagnie.front_km === 1.5 && D.echelons.bataillon.dispersion_min === 40, "valeurs d'échelon reprises des anciens modèles");
 ok(D.unites_types.every(u => u.composition.reduce((a, c) => a + c.nombre, 0) === u.elements), "unités types avec composition cohérente");
 ok(["surface_par_vehicule_m2", "couvert_min", "distance_objectif_km", "hors_vue", "duree_min"].every(f => f in D.regroupement), "règles de regroupement");
 ok(D.seuils.forte_pct === 30 && D.seuils.moyenne_pct === 10, "seuils forte / moyenne / faible (repris de la conduite)");
 ok(JSON.stringify(D.isochrones_min) === JSON.stringify({planification:[15, 30, 60, 120], conduite:[5, 10, 20, 40]}), "délais d'isochrones des deux anciens outils");
 const v = M.validerDoctrine({}); ok(v.ok && v.erreurs.length === 0, "doctrine par défaut valide " + v.erreurs.join(" ; "));
 const s = M.validerDoctrine({vitesses_pct:{roue:{marche:95}}, seuils:{forte_pct:40}, inconnu:1, echelons:{section:{front_km:"x"}}});
 ok(s.ok && s.doctrine.vitesses_pct.roue.marche === 95 && s.doctrine.vitesses_pct.roue.attaque === 60 && s.doctrine.seuils.moyenne_pct === 10 && !("inconnu" in s.doctrine) && s.doctrine.echelons.section.front_km === 0.6,
  "surcharge partielle complétée clé par clé (clé inconnue et type faux ignorés)");
 ok(M.DOCTRINE.vitesses_pct.roue.marche === 85, "la surcharge ne modifie pas DOCTRINE");
 const e = M.validerDoctrine({seuils:{forte_pct:5}, vitesses_pct:{chenille:{reco:150}}, unites_types:[{id:"a", nom:"A", classe:"meca", echelon:"section", elements:2, front_km:1, prof_km:1, dispersion_min:1, composition:[{nombre:3, classe:"roue"}]}]});
 ok(!e.ok && e.erreurs.some(x => /forte_pct/.test(x)) && e.erreurs.some(x => /chenille\.reco/.test(x)) && e.erreurs.some(x => /classe inconnue « meca »/.test(x)) && e.erreurs.some(x => /composition compte 3/.test(x)) && e.erreurs.some(x => /unite_par_defaut/.test(x)),
  "erreurs détectées : seuils, vitesse > 100 %, classe inconnue, composition, unité par défaut absente");
 ok(M.classeDepuisAncienType("meca") === "chenille" && M.classeDepuisAncienType("moto") === "roue" && M.classeDepuisAncienType("pied") === "fantassin" && M.classeDepuisAncienType("logistique") === "logistique" && M.classeDepuisAncienType("x") === null,
  "migration des anciens types meca / moto / pied");
}

/* ---------- 3. moteur ennemi sur terrain-demo.json (v3) ---------- */
section("moteur ennemi sur terrain-demo.json : terrain v3, référence, empreinte, signatures");
(async () => {
 const doc = DEMO();
 ok(doc.format === "terrain-gtia" && doc.version === 3 && !!doc.id, "terrain-demo.json est un document v3 avec identifiant (" + doc.id + ")");
 let etapes = 0; await M.calculerZoneEtapes(doc, undefined, () => etapes++); const G = M.G;
 ok(G && G._pret && etapes > 2, "ouverture par étapes (calculerZoneEtapes, " + etapes + " étapes)");
 // cours d'eau de la démonstration : seul le chenillé passe à gué
 const ru = G.rivs.find(r => r.id === "eau:w900100");
 ok(ru && M.verdictEau(ru, "chenille").ok && ["roue", "logistique", "fantassin"].every(k => !M.verdictEau(ru, k).ok), "démonstration : le ru (18 m, 0,9 m) n'est guéable que par le chenillé");
 ok(G.feats.some(f => f.id === "pont:@-0.11009,47.24560" && f.type === "pont"), "démonstration : pont sur le ru");
 const ref = ME.referenceTerrain();
 ok(ref.id === doc.id && ref.n === 100 && ref.maille_m === 100 && /^e[0-9a-f]{8}$/.test(ref.empreinte), "référence terrain : id, grille, empreinte " + ref.empreinte);
 ok(ME.empreinteTerrain(DEMO()) === ref.empreinte, "empreinte du document = empreinte du terrain ouvert");
 const d2 = DEMO(); d2.coupures = [{ouvrage:"pont:@-0.11009,47.24560", type:"pont", lon:-0.11009, lat:47.2456, nm:"Pont du Ru", etat:"detruit", t:1}];
 ok(ME.empreinteTerrain(d2) !== ref.empreinte, "une coupure (faite dans l'outil Terrain) change l'empreinte");
 const d3 = DEMO(); d3.parametres.roue.eau_profondeur_max_m = 1; ok(ME.empreinteTerrain(d3) !== ref.empreinte, "un seuil de franchissement modifié change l'empreinte");
 // fonctions implémentées
 ok(ME.vitesseFrac("chenille", "attaque") === 0.5 && ME.vitesseFrac("fantassin", "marche") === 0.9, "vitesse tactique par classe et mode");
 ok(ME.niveau(30) === "forte" && ME.niveau(29.9) === "moyenne" && ME.niveau(9) === "faible", "niveaux forte / moyenne / faible");
 const u = ME.uniteDepuisType("cie-meca", undefined, {id:"u1", nom:"1re compagnie"});
 ok(u && u.classe === "chenille" && u.unite_type === "cie-meca" && u.id === "u1" && u.elements === 13, "unité créée depuis une unité type");
 // signatures (positionSurAxe et importer : opts facultatif ajouté par le lot A)
 const sig = {axes:2, horaires:3, positionSurAxe:4, isochrones:4, presence:4, zonesRegroupement:2, exporter:2, importer:2, migrer:1};
 ok(Object.entries(sig).every(([f, a]) => typeof ME[f] === "function" && ME[f].length === a), "signatures du moteur ennemi : " + Object.keys(sig).join(", "));
 ok(Array.isArray(ME.axes(u, {})) && ME.axes(u, {}).manque && ME.exporter({}, {}).format === "ennemi-gtia" && ME.exporter({}, {}).terrain.empreinte === ref.empreinte, "appels sans départ : axes vides avec raison, export avec référence terrain");
 // le moteur ennemi s'appuie sur search avec options (plus de Dijkstra recopié)
 const r = M.search([50*100 + 20], "chenille", {cible:new Uint8Array(100*100).fill(0).map((_, c) => c === 50*100 + 80 ? 1 : 0)});
 ok(r.fin === 50*100 + 80 && M.cheminVers(r, r.fin).length > 2, "search avec cible et cheminVers disponibles");
})().then(() => calculs()).catch(e => ok(false, "exception : " + e.stack)).then(() => { console.log(`${nb} vérifications, ${ko} échec(s)`); process.exit(ko ? 1 : 0); });

/* ====================================================================================================================
   Tests de calcul du lot A : axes, horaires, isochrones multi-contacts, présence, regroupements, export, migration.
   ==================================================================================================================== */
function calculs(){
 const proche = (a, b, e = 1e-6) => Math.abs(a - b) <= e*Math.max(1, Math.abs(b));
 const ouvrir = d => { M.ouvrirTerrain(d); return M.G; };
 const D = M.DOCTRINE, P = () => M.P;
 const LLd = (i, j) => { const b = M.G.b, n = M.G.n; return [b.w + (i + 0.5)/n*(b.e - b.w), b.n - (j + 0.5)/n*(b.n - b.s)]; };
 const unite = (k, dep, obj, extra) => ME.uniteDepuisType(D.unite_par_defaut[k], undefined, Object.assign({id:"u-" + k, nom:k, depart:dep, objectifs:obj ? [obj] : [], heure_depart_min:360}, extra || {}));
 const PONT_RU = "pont:@-0.11009,47.24560", PONT_D1 = "pont:@-0.07733,47.26000", PONT_D2 = "pont:@-0.07700,47.29165";
 const coupe = ids => { const d = DEMO(); d.coupures = ids.map((id, i) => ({ouvrage:id, type:"pont", lon:0, lat:0, nm:"", etat:"detruit", t:i})); return d; };
 // terrain synthétique (même construction que tests/moteur.js) : n × n mailles de 100 m, plat, découvert
 const S = M.S, BIT = M.BIT;
 function synth(o){
  o = Object.assign({n:20, cell:100}, o || {});
  const n = o.n, W = n*S, N = n*n, b = M.bboxFrom({lng:0, lat:45}, n*o.cell), L = {};
  for (const k of M.LAYERS) L[k] = new Float32Array(N);
  const f = {b, n, cell:o.cell, W, sl:new Float32Array(N), el:new Float32Array(N).fill(100), gx:new Float32Array(N), gy:new Float32Array(N), L, M:new Uint8Array(W*W), ways:[], pnodes:[], rivs:[], rus:null};
  const lon = x => b.w + x/W*(b.e - b.w), lat = y => b.n - y/W*(b.n - b.s);
  if (o.riviere) { const x0 = Math.floor(n/2)*S - 1;   // bande d'eau verticale de 2 pixels au milieu
   for (let y = 0; y < W; y++) for (const x of [x0, x0 + 1]) f.M[y*W + x] |= BIT.eau;
   f.rivs.push(Object.assign({w:10, p:0.6, k:"r", nm:"Rivière test"}, o.riviere, {g:[[lon(x0 + 1), lat(0)], [lon(x0 + 1), lat(W)]]})); }
  if (o.mod) o.mod(f, lon, lat);
  return {id:o.id || "synth", nom:"synthétique", date:"test", parametres:o.parametres, faits:f, coupures:[]};
 }
 const LLs = (i, j) => M.cellLL(j*M.G.n + i);

 /* ---------- A. coupures du terrain chargé et cours d'eau par classe (passent par le moteur) ---------- */
 section("axes : coupures des ponts et ru, selon la classe (terrain-demo.json)");
 {
  let G = ouvrir(DEMO());
  const O = LLd(20, 30), E = LLd(85, 30), SUD = LLd(10, 90), NORD = LLd(25, 40);
  for (const k of ARMS) { const a = ME.axes(unite(k, O, E)); ok(a.length >= 1 && !a.manque, `intact : ${k} traverse la rivière (${a.map(x => x.genre).join(", ")})`);
   ok(a.every(x => x.ouvrages.some(id => id === PONT_D1 || id === PONT_D2)), `intact : ${k} passe par un des deux ponts, désigné par id_ouvrage (${a[0] && a[0].ouvrages.join(" ; ")})`); }
  const v0 = G.v.chenille, p0 = M.P.chenille; ME.axes(unite("chenille", O, E));
  ok(G.v.chenille === v0 && M.P.chenille === p0 && G.v.chenille[0] === v0[0], "les vitesses du moteur sont restaurées après le calcul (G.v, P)");
  G = ouvrir(coupe([PONT_D1, PONT_D2]));
  ok(M.G.coupe.filter(x => x === 1).length === 2, "terrain chargé avec les deux ponts détruits (coupures de l'outil Terrain)");
  for (const k of ARMS) { const a = ME.axes(unite(k, O, E)); ok(a.length === 0 && /Aucun passage/.test(a.manque), `2 ponts détruits : ${k} ne traverse plus (${a.manque})`); }
  for (const k of ARMS) ok(ME.axes(unite(k, O, LLd(30, 20))).length >= 1, `2 ponts détruits : ${k} circule encore du même côté`);
  G = ouvrir(DEMO());
  for (const k of ARMS) { const a = ME.axes(unite(k, SUD, NORD)); ok(a.length >= 1, `intact : ${k} franchit le ru (sud → nord)`); }
  const aR = ME.axes(unite("roue", SUD, NORD)); ok(aR.every(a => a.ouvrages.includes(PONT_RU) && a.goulets.includes(PONT_RU)), "roue : passe par le pont du ru, signalé comme goulet (id_ouvrage)");
  G = ouvrir(coupe([PONT_RU]));
  const ch = ME.axes(unite("chenille", SUD, NORD));
  ok(ch.length >= 1 && ch.every(a => !a.ouvrages.includes(PONT_RU)), "pont du ru détruit : le chenillé passe quand même (gué du ru, 18 m × 0,9 m)");
  const fe = M.P.chenille.franchissement_eau_min, sauts = ch[0].fn.slice(1).map((f, q) => f - ch[0].fn[q]).filter(x => x > 0);
  ok(sauts.some(x => proche(x, fe)), `chenillé : franchissement du ru compté ${fe} min (verdictEau), non divisé (sauts ${sauts.map(x => x.toFixed(1)).join(", ")})`);
  for (const k of ["roue", "logistique", "fantassin"]) { const a = ME.axes(unite(k, SUD, NORD)); ok(a.length === 0 && a.manque, `pont du ru détruit : ${k} ne passe pas (ru trop profond pour la classe)`); }
  G = ouvrir(DEMO());
 }

 /* ---------- B. délais : déplacement ÷ facteur, franchissement non divisé, haltes, regroupement ---------- */
 section("horaires : franchissement non divisé par le facteur de vitesse, haltes, regroupement, incertitude");
 {
  const G = ouvrir(synth({riviere:{w:10, p:0.6}}));
  const Dz = M.completerDoctrine({axes:{rayon_objectif_m:50}});   // objectif = la maille exacte (calcul vérifiable à la main)
  const u = unite("chenille", LLs(2, 10), LLs(17, 10), {heure_depart_min:600});
  const ax = ME.axes(u, {mode:"reco", doctrine:Dz}), a = ax[0], frac = ME.vitesseFrac("chenille", "reco", Dz);
  const vtt = M.P.chenille.vitesse_tout_terrain_kmh, fe = M.P.chenille.franchissement_eau_min, km = 1.5;
  const att = km/(vtt*frac)*60 + fe, bug = (km/vtt*60 + fe)/frac;
  ok(a && proche(a.longueur_km, km, 1e-9), "axe en ligne droite de 1,5 km à travers la rivière (" + (a && a.longueur_km) + " km)");
  ok(a && proche(a.temps_min, att, 1e-6), `temps = 1,5 km ÷ (${vtt} km/h × ${frac}) + ${fe} min = ${att.toFixed(2)} min (obtenu ${a && a.temps_min.toFixed(2)}) ; l'ancien calcul donnait ${bug.toFixed(2)}`);
  ok(a && proche(a.franchissement_min, fe), "temps de franchissement isolé : " + fe + " min");
  const h = ME.horaires(a, u, {doctrine:Dz});
  const tr = h.troncons.reduce((s, t) => ({f:s.f + t.franchissement_min, d:s.d + t.deplacement_min}), {f:0, d:0});
  ok(proche(tr.f, fe) && proche(tr.d, km/(vtt*frac)*60), `tronçons : franchissement ${tr.f.toFixed(2)} min + déplacement ${tr.d.toFixed(2)} min`);
  ok(proche(h.arrivee_min, 600 + att) && h.jalons[0].heure_min === 600, "heure d'arrivée = départ + temps (mode reco : pas de regroupement)");
  ok(h.incertitude_min === Math.round(u.dispersion_min + Dz.horaires.incertitude_pct/100*att), "incertitude = dispersion de l'unité + part du temps de route (doctrine)");
  // haltes : intervalle réduit par surcharge → une halte de halte_duree_min
  const Dh = M.completerDoctrine({axes:{rayon_objectif_m:50}, horaires:{halte_intervalle_min:5, halte_duree_min:7}});
  const hh = ME.horaires(a, u, {doctrine:Dh});
  const nbH = hh.arrets.filter(x => x.genre === "halte").length;
  ok(nbH >= 1 && proche(hh.duree_min, att + nbH*7), `haltes de doctrine : ${nbH} × 7 min ajoutées (durée ${hh.duree_min.toFixed(2)} min)`);
  const pa = hh.arrets[0], pos = ME.positionSurAxe(a, u, 600 + pa.debut_min + 3, {doctrine:Dh});
  ok(pos && pos.a_l_arret === "halte" && proche(pos.d_tete_km, a.dn[pa.q]), "position sur l'axe : la tête reste sur place pendant la halte");
  // regroupement : mode attaque (regroupe) → durée de doctrine ajoutée
  const Dr = M.completerDoctrine({axes:{rayon_objectif_m:50}, regroupement:{distance_objectif_km:{min:0.5, max:1}}});
  const ha = ME.horaires(a, Object.assign({}, u, {mode:"attaque"}), {doctrine:Dr});
  const ra = ha.arrets.find(x => x.genre === "regroupement");
  ok(ra && ra.duree_min === Dr.regroupement.duree_min.attaque && ha.jalons.some(j => j.nom === "Regroupement") && proche(ha.duree_min, att + ra.duree_min) && a.dn[ra.q] <= km - 0.5 + 1e-9,
   "attaque : regroupement de " + Dr.regroupement.duree_min.attaque + " min (doctrine) à au moins " + Dr.regroupement.distance_objectif_km.min + " km de l'objectif");
  const p0 = ME.positionSurAxe(a, u, 590), p1 = ME.positionSurAxe(a, u, 600 + att/2), p2 = ME.positionSurAxe(a, u, 700);
  ok(p0.d_tete_km === 0 && !p0.parti && p1.d_tete_km > 0 && p1.d_tete_km < km && p2.arrive && proche(p2.d_tete_km, km), "position sur l'axe avant, pendant et après le déplacement");
  ok(p1.d_queue_km === Math.max(0, p1.d_tete_km - u.prof_km) && p1.trace && p1.possible, "queue = tête − profondeur de l'unité ; traces probable et possible");
 }

 /* ---------- C. isochrones : plusieurs contacts de la même unité à des heures différentes ---------- */
 section("isochrones : contacts à des heures différentes (départs décalés), maille impraticable, minuit");
 {
  const G = ouvrir(synth({n:30, mod:f => { f.L.eau[22*30 + 27] = 1; }}));
  const u = unite("fantassin", null, null, {id:"F"}), T = 640;
  const cA = {id:"a", unite:"F", lonlat:LLs(5, 10), heure_min:600}, cB = {id:"b", unite:"F", lonlat:LLs(27, 22), heure_min:630};   // B posé sur l'eau
  const iso = ME.isochrones([cA, cB], [u], T), iA = ME.isochrones([cA], [u], T), iB = ME.isochrones([cB], [u], T), N = G.n*G.n;
  let max = 0; for (let c = 0; c < N; c++) { const m = Math.min(iA.arrivee_min[c], iB.arrivee_min[c]); max = Math.max(max, isFinite(m) || isFinite(iso.arrivee_min[c]) ? Math.abs(iso.arrivee_min[c] - m) : 0); }
  ok(max < 1e-3, "multi-contacts = minimum des contacts pris seuls, chacun à son heure (écart max " + max.toExponential(1) + " min)");
  const pb = iso.contacts_places.find(x => x.contact === "b");
  ok(pb && pb.deplace_m > 0 && pb.deplace_m <= D.conduite.rayon_praticable_m && M.G.v.fantassin[pb.maille] > 0, `contact sur l'eau : maille praticable la plus proche (${pb && pb.deplace_m.toFixed(0)} m ≤ ${D.conduite.rayon_praticable_m} m)`);
  ok(proche(iso.arrivee_min[10*30 + 5], 600, 1e-4) && proche(iso.arrivee_min[pb.maille], 630, 1e-4), "heure d'arrivée au plus tôt = heure du contact sur sa maille (A 10:00, B 10:30)");
  const same = ME.isochrones([cA, Object.assign({}, cB, {heure_min:600})], [u], T);
  ok(same.arrivee_min[20*30 + 25] < iso.arrivee_min[20*30 + 25] - 1, "l'heure de chaque contact compte (B vu à 10:00 au lieu de 10:30 : arrivée plus tôt près de B)");
  const c = 10*30 + 25, d = iso.arrivee_min[c] - T;
  ok(iso.atteint[pb.maille] === 1 && (d <= 0 ? iso.bande[c] === 0 : iso.bande[c] === 1 + iso.delais.findIndex(x => d <= x) || iso.bande[c] === 255), "bandes des délais de doctrine (" + iso.delais.join(", ") + " min)");
  ok(JSON.stringify(iso.delais) === JSON.stringify(D.isochrones_min.conduite), "délais par défaut = doctrine.isochrones_min.conduite");
  const vit = ME.vitesseFrac("fantassin", "attaque"), t1 = iA.arrivee_min[10*30 + 15] - 600, brut = M.search([10*30 + 5], "fantassin")[10*30 + 15]*60;
  ok(proche(t1, brut/vit, 1e-4), `vitesse tactique : 1 km en ${t1.toFixed(1)} min = temps du moteur ${brut.toFixed(1)} min ÷ ${vit}`);
  const m = ME.isochrones([{id:"x", unite:"F", lonlat:LLs(5, 10), heure_min:1430}], [u], 10);
  ok(proche(m.arrivee_min[10*30 + 5], -10, 1e-4), "passage de minuit : contact à 23:50, situation à 00:10 → arrivée −10 min (veille)");
  const u2 = unite("chenille", null, null, {id:"C"}), deux = ME.isochrones([cA, {id:"z", unite:"C", lonlat:LLs(25, 25), heure_min:620}], [u, u2], T);
  ok(Object.keys(deux.par_unite).length === 2 && deux.arrivee_min[25*30 + 25] === deux.par_unite.C[25*30 + 25], "plusieurs unités : une carte par unité, minimum global");
 }

 /* ---------- D. plusieurs unités par scénario (terrain-demo) ---------- */
 section("scénario à plusieurs unités : axes, horaires et regroupements par unité");
 {
  ouvrir(DEMO());
  const sc = {id:"s1", nom:"Attaque", mode_action:"attaque", heure_depart_min:300, axe_choisi:{u2:"variante"}, unites:[
   unite("chenille", LLd(10, 90), LLd(90, 10), {id:"u1", heure_depart_min:undefined}), unite("roue", LLd(15, 20), LLd(90, 50), {id:"u2", heure_depart_min:330}),
   unite("logistique", LLd(20, 30), LLd(85, 60), {id:"u3", mode_action:"marche"}), unite("fantassin", LLd(30, 40), LLd(40, 60), {id:"u4"})]};
  const r = ME.scenario(sc);
  ok(Object.keys(r.par_unite).length === 4 && Object.values(r.par_unite).every(p => p.axes.length >= 1 && p.horaires.jalons.length >= 2), "4 unités, axes et horaires pour chacune");
  ok(r.par_unite.u2.horaires.heure_depart_min === 330 && r.par_unite.u1.horaires.heure_depart_min === 300, "heure de départ propre à l'unité, sinon celle du scénario");
  ok(r.par_unite.u2.axe_choisi === (r.par_unite.u2.axes.some(a => a.genre === "variante") ? "variante" : r.par_unite.u2.axes[0].genre), "axe choisi par unité");
  ok(r.par_unite.u3.unite.mode === "marche" && !r.par_unite.u3.horaires.arrets.some(a => a.genre === "regroupement") && r.par_unite.u1.horaires.arrets.some(a => a.genre === "regroupement"), "mode d'action par unité : marche sans regroupement, attaque avec");
  const pl = Object.values(r.par_unite).map(p => p.axes.map(a => a.plausibilite));
  ok(pl.every(l => l.filter(x => x === "forte").length === 1), "une seule plausibilité forte par unité");
  const a1 = r.par_unite.u1.axes;
  ok(a1.every(a => a.ouvrages.every(id => /^[a-z]+:/.test(id)) && a.goulets.every(id => a.ouvrages.includes(id))), "ouvrages et goulets désignés par id_ouvrage");
  ok(a1.filter(a => a.point_decision).every(a => a.point_decision.distance_km >= 0 && a.point_decision.distance_km < a.longueur_km), "point de décision sur l'axe (dernier point commun avec un autre axe)");
  ok(a1.every(a => a.part_exposee >= 0 && a.part_exposee <= 1 && a.part_couvert >= 0 && a.part_couvert <= 1), "parts exposée et à couvert entre 0 et 1");
  const s = a1.find(a => a.genre === "sur"), f = a1.find(a => a.genre === "rapide");
  if (s && f) ok(s.part_exposee <= f.part_exposee && s.temps_min >= f.temps_min - 1e-9, `axe discret moins exposé (${s.part_exposee.toFixed(2)} ≤ ${f.part_exposee.toFixed(2)}) et pas plus rapide`);
  const q = s ? s.expose_n.findIndex((x, i) => !x && i > 5 && s.noeuds[i] < M.G.n*M.G.n && M.G.L.foret[s.noeuds[i]] < 0.5 && M.G.L.bati[s.noeuds[i]] < 0.5) : -1;   // maille cachée et découverte
  if (q > 0) { const av = ME.axes(sc.unites[0], {amis:[s.coords[q]]}), sv = av.find(a => a.genre === "sur");
   ok(!sv || JSON.stringify(sv.noeuds) !== JSON.stringify(s.noeuds) || sv.expose_n[q] === 1, "nos positions : une position amie sur l'axe discret le rend exposé, le déplace ou le fait disparaître (" + av.map(a => a.genre).join(", ") + ")"); }
  else ok(false, "axe discret sans maille cachée : test de nos positions impossible");
 }

 /* ---------- E. zones de regroupement hors vue ---------- */
 section("zones de regroupement : hors vue, à couvert, praticables, assez grandes, à bonne distance de l'objectif");
 {
  const G = ouvrir(DEMO()), R = D.regroupement, n = G.n;
  const u = unite("chenille", LLd(10, 90), LLd(90, 10));
  const z = ME.zonesRegroupement(u);
  ok(z.length >= 1, z.length + " zone(s) de regroupement trouvée(s)");
  const H = M.surfaceHeights(), vus = new Uint8Array(n*n); for (const h of G.hp) { const v = M.viewshed(h.c, H); for (let c = 0; c < n*n; c++) if (v[c]) vus[c] = 1; }
  ok(z.every(x => !x.vue && x.mailles.every(c => !vus[c])), "aucune maille vue depuis les points hauts (viewshed du moteur)");
  ok(z.every(x => x.mailles.every(c => Math.min(1, G.L.foret[c] + G.L.bati[c]) >= R.couvert_min && G.v.chenille[c] > 0 && G.cls.chenille[c] >= 2)), "couvert ≥ seuil et sol praticable pour la classe");
  ok(z.every(x => x.mailles.length*G.cell*G.cell >= u.elements*R.surface_par_vehicule_m2), "surface ≥ véhicules × surface par véhicule");
  ok(z.every(x => x.distance_objectif_km >= R.distance_objectif_km.min - 0.2 && x.distance_objectif_km <= R.distance_objectif_km.max + 0.2 && x.distance_axe_km*1000 <= R.distance_axe_max_m), "distance à l'objectif dans l'intervalle de doctrine, proche de l'axe");
  ok(z.every(x => x.duree_min === R.duree_min.attaque) && z.every((x, i) => !i || z[i-1].score >= x.score), "durée selon le mode d'action ; zones classées");
  const c0 = M.cellAt({lng:z[0].centre[0], lat:z[0].centre[1]}), z2 = ME.zonesRegroupement(u, {amis:[z[0].centre]});
  ok(z2.every(x => !x.mailles.includes(c0)), "une position amie posée sur la meilleure zone la rend inutilisable (vue)");
  ok(ME.zonesRegroupement(unite("chenille", LLd(10, 90), null)).manque, "sans objectif : aucune zone, raison donnée");
 }

 /* ---------- F. présence probable et zones à survoler ---------- */
 section("présence probable et zones à survoler");
 {
  const G = ouvrir(DEMO()), N = G.n*G.n;
  const u = Object.assign(unite("roue", null, null, {id:"R"}), {en_mouvement:true});
  const cs = [{id:"1", unite:"R", lonlat:LLd(70, 20), heure_min:600, elements_vus:2}, {id:"2", unite:"R", lonlat:LLd(75, 30), heure_min:620, elements_vus:3}];
  const pr = ME.presence([u], cs, 640);
  ok(proche(pr.total, u.elements - 3, 1e-3), `masse = éléments non vus (${u.elements} − 3 vus au dernier contact) : ${pr.total.toFixed(3)}`);
  ok(pr.zones.length >= 1 && pr.zones.length <= D.zones_a_survoler.nb && pr.zones.every((z, i) => !i || pr.zones[i-1].elements_attendus >= z.elements_attendus - 1e-9), "zones à survoler classées (" + pr.zones.length + ")");
  ok(pr.zones.every(z => z.a_chercher === D.a_chercher.roue && z.rayon_m === D.zones_a_survoler.rayon_m && ["forte", "moyenne", "faible"].includes(z.niveau)), "ce qu'on y cherche (doctrine, classe), rayon, niveau");
  const i1 = ME.isochrones([cs[0]], [u], 640), tb = Math.max(1, Math.max(u.front_km, u.prof_km)/2/(M.P.roue.vitesse_tout_terrain_kmh*ME.vitesseFrac("roue", "attaque"))*60);
  let viol = 0, hors = 0; for (let c = 0; c < N; c++) { if (pr.Q[c] > 0 && i1.arrivee_min[c] > 640 + tb + 1e-3) viol++; if (i1.arrivee_min[c] > 640 + tb) hors++; }
  ok(hors > 0, "des mailles sont hors de portée du premier contact (" + hors + ")");
  ok(viol === 0, "le contact le plus ancien reste une contrainte (aucune présence hors de sa portée)");
  const obs = ME.presence([u], cs, 640, {observations:[{lonlat:LLd(76, 32), heure_min:635}]});
  const vo = M.viewshed(M.cellAt({lng:LLd(76, 32)[0], lat:LLd(76, 32)[1]}), M.surfaceHeights()); let a0 = 0, a1 = 0; for (let c = 0; c < N; c++) if (vo[c]) { a0 += pr.Q[c]; a1 += obs.Q[c]; }
  ok(a1 < a0*0.9, `observation sans contact il y a 5 min : présence dans les mailles vues ${a0.toFixed(2)} → ${a1.toFixed(2)} élément(s)`);
  const ax = ME.axes(unite("roue", LLd(15, 20), LLd(90, 50)));
  const pv = ME.presence([Object.assign({}, u, {heure_depart_min:600})], [], 620, {axes_prevus:{R:ax}});
  ok(pv.total > 0 && pv.par_unite.R.prevu, "sans contact : présence autour de la position prévue sur l'axe planifié");
 }

 /* ---------- G. export / import v3 ---------- */
 section("export ennemi-gtia v3 : référence au terrain, aller-retour, refus si le terrain a changé");
 {
  ouvrir(DEMO());
  const etat = {nom:"Travail test", doctrine_surcharge:{vitesses_pct:{roue:{marche:95}}}, nos_positions:[{id:"p1", nom:"Nous", lonlat:LLd(50, 50)}],
   planification:{scenarios:[{id:"s1", nom:"A", mode_action:"attaque", heure_depart_min:330, axe_choisi:{u1:"sur"}, unites:[
    unite("chenille", LLd(10, 90), LLd(90, 10), {id:"u1", heure_depart_min:undefined}), unite("fantassin", LLd(30, 40), LLd(40, 60), {id:"u2", mode_action:"reco", heure_depart_min:345})]},
    {id:"s2", nom:"B", mode_action:"repli", heure_depart_min:1400, axe_choisi:{}, unites:[unite("logistique", LLd(20, 30), LLd(70, 80), {id:"u3", heure_depart_min:undefined})]}]},
   conduite:{heure_min:615, unites:[{id:"c1", nom:"Inconnu", unite_type:"cie-moto", classe:"roue", echelon:"compagnie", elements:12, front_km:1.5, prof_km:1, dispersion_min:15, mode_action:"attaque", en_mouvement:true, scenario_ref:{scenario:"s1", unite:"u1"}}],
    contacts:[{id:"k1", unite:"c1", lonlat:LLd(70, 20), heure_min:600, elements_vus:2, note:"vu"}, {id:"k2", unite:"c1", lonlat:LLd(75, 30), heure_min:612, elements_vus:1}]}};
  const ex = ME.exporter(etat, {resultats:true}), txt = JSON.stringify(ex);
  ok(ex.format === "ennemi-gtia" && ex.version === 3 && ex.terrain.empreinte === ME.referenceTerrain().empreinte && ex.terrain.id === M.G.id, "export v3 avec référence (id + empreinte)");
  ok(!/"faits"|"grilles"|"obstacles_fins"/.test(txt) && txt.length < 200000, "le terrain n'est pas inclus (" + Math.round(txt.length/1024) + " ko avec résultats)");
  ok(ex.planification.scenarios[0].heure_depart === "05:30" && ex.planification.scenarios[0].unites[1].heure_depart === "05:45" && ex.conduite.contacts[1].heure === "10:12", "heures en « hh:mm »");
  ok(ex.resultats && ex.resultats.axes.s1.u1.length >= 1 && ex.resultats.axes.s1.u1.every(a => a.ouvrages.every(id => /^[a-z]+:/.test(id))) && ex.resultats.zones_a_survoler.length >= 1, "résultats de traçabilité (axes par id_ouvrage, zones à survoler)");
  const im = ME.importer(JSON.parse(txt));
  ok(im.refus === null && im.verification.ok && im.avertissements.length === 0, "import sur le même terrain : accepté sans avertissement");
  const e2 = im.etat, sc = e2.planification.scenarios;
  ok(sc.length === 2 && sc[0].heure_depart_min === 330 && sc[0].unites.length === 2 && sc[0].unites[1].heure_depart_min === 345 && sc[0].unites[1].mode_action === "reco" && sc[1].heure_depart_min === 1400, "aller-retour : scénarios, unités, heures, modes");
  ok(JSON.stringify(sc[0].unites[0].depart) === JSON.stringify(etat.planification.scenarios[0].unites[0].depart) && sc[0].axe_choisi.u1 === "sur", "aller-retour : positions et axe choisi");
  ok(e2.conduite.heure_min === 615 && e2.conduite.contacts.length === 2 && e2.conduite.contacts[0].note === "vu" && e2.conduite.unites[0].scenario_ref.unite === "u1" && e2.nos_positions[0].nom === "Nous", "aller-retour : conduite (heure, contacts, lien au scénario), nos positions");
  ok(e2.doctrine_surcharge.vitesses_pct.roue.marche === 95, "aller-retour : surcharge de doctrine");
  ok(JSON.stringify(ME.exporter(e2).planification) === JSON.stringify(ex.planification) && JSON.stringify(ME.exporter(e2).conduite) === JSON.stringify(ex.conduite), "export → import → export identique");
  ouvrir(coupe([PONT_D1]));
  const ref = ME.importer(JSON.parse(txt));
  ok(ref.etat === null && /a changé/.test(ref.refus) && /empreinte/.test(ref.refus), "terrain modifié (pont détruit) : import refusé, message clair : " + (ref.refus || "").slice(0, 80) + "…");
  const fo = ME.importer(JSON.parse(txt), {forcer:true});
  ok(fo.etat && fo.avertissements.some(x => /a changé/.test(x)), "import forcé : accepté avec avertissement");
  const autre = JSON.parse(txt); autre.terrain.id = "autre-zone";
  ok(/autre-zone/.test(ME.importer(autre).refus || ""), "autre terrain : refus");
  let err = ""; try { ME.importer(Object.assign(JSON.parse(txt), {version:4})); } catch(e) { err = e.message; } ok(/plus récente/.test(err), "version 4 refusée");
  ouvrir(DEMO());
 }

 /* ---------- H. migration des anciens fichiers v1 (fabriqués d'après ennemi-prepa.html et ennemi-conduite.html) ---------- */
 section("migration ennemi-prepa-gtia v1 et ennemi-conduite-gtia v1");
 {
  const G = ouvrir(DEMO()), terrain = DEMO();
  const iRu = G.feats.findIndex(f => f.id === PONT_RU), iD2 = G.feats.findIndex(f => f.id === PONT_D2);
  const DEF_R = {"_avertissement":"Valeurs FICTIVES", modeles:[{nom:"Section mécanisée", type:"meca", nb:4, front_km:0.6, prof_km:0.4, dispersion_min:5},
   {nom:"Compagnie mécanisée", type:"meca", nb:13, front_km:1.5, prof_km:1, dispersion_min:15}, {nom:"Compagnie à pied", type:"pied", nb:9, front_km:1, prof_km:0.8, dispersion_min:15},
   {nom:"Peloton de reco", type:"moto", nb:4, front_km:1, prof_km:0.5, dispersion_min:5}],
   types:{meca:{vitesse_tactique_pct:55}, moto:{vitesse_tactique_pct:60}, pied:{vitesse_tactique_pct:80}},
   offensive:{privilegie:"surete", ecart_axes_m:600, penalite_axe_deja_pris:3}, surete:{poids_max:6, priorite_pct:70}, horaires:{jalon_km:3, incertitude_pct:10}, delais_min:[15, 30, 60, 120]};
  // ST de ennemi-prepa.html (nouveauScenario) et scenariosExport()
  const ST = {scen:[{id:1, nom:"Scénario 1", ennemi:Object.assign({}, DEF_R.modeles[1]), depart:LLd(10, 90), objectifs:[LLd(10, 40)], h0:"06:00", axe:"sur", t:null},
   {id:2, nom:"Scénario 2", ennemi:Object.assign({}, DEF_R.modeles[2]), depart:LLd(30, 40), objectifs:[LLd(40, 60)], h0:"07:15", axe:null, t:null}], cur:1, amis:[{ll:LLd(50, 50)}]};
  const axV1 = {nom:"Axe le plus discret", genre:"sur", plausibilite:"forte", temps_min:40, longueur_km:6, incertitude_min:19, part_exposee_pct:30, part_couvert_pct:20,
   goulets:[iRu], trace:[LLd(10, 90), LLd(10, 40)], horaires:[{lieu:"Départ", ouvrage:null, km:0}, {lieu:"pont", ouvrage:iRu, km:3}, {lieu:"pont", ouvrage:iD2, km:5}]};
  const scenariosExport = ST.scen.map(s => ({id:s.id, nom:s.nom, ennemi:s.ennemi, depart:s.depart, objectifs:s.objectifs, heure_depart:s.h0, axe_choisi:s.axe, axes:s.id === 1 ? [axV1] : [], manque:null}));
  const v1p = {format:"ennemi-prepa-gtia", version:1, nom:G.nom, date:"18/10/2026 10:00", note:"Scénarios…", doctrine:DEF_R, saisies:ST, scenarios:scenariosExport, terrain};
  const m = ME.migrer(JSON.parse(JSON.stringify(v1p))), d = m.document;
  ok(d.format === "ennemi-gtia" && d.version === 3 && d.terrain.id === G.id && d.terrain.empreinte === ME.referenceTerrain().empreinte, "prépa v1 → v3, référence calculée sur le terrain inclus (= terrain ouvert)");
  ok(m.terrain && m.terrain.faits && !JSON.stringify(d).includes('"faits"'), "terrain inclus rendu à part, pas dans le document");
  const s1 = d.planification.scenarios[0], u1 = s1.unites[0], s2 = d.planification.scenarios[1];
  ok(u1.classe === "chenille" && u1.unite_type === "cie-meca" && u1.elements === 13 && s2.unites[0].classe === "fantassin", "meca → chenille, pied → fantassin, unité type retrouvée");
  ok(s1.heure_depart === "06:00" && s2.heure_depart === "07:15" && s1.axe_choisi[u1.id] === "sur" && s1.mode_action === "attaque" && JSON.stringify(u1.depart) === JSON.stringify(ST.scen[0].depart), "heure, axe choisi, mode attaque, positions repris");
  ok(d.nos_positions.length === 1 && JSON.stringify(d.nos_positions[0].lonlat) === JSON.stringify(ST.amis[0].ll), "nos positions reprises");
  ok(d.doctrine_surcharge && d.doctrine_surcharge.vitesses_pct.chenille.attaque === 55 && !d.doctrine_surcharge.vitesses_pct.roue, "vitesse tactique modifiée → doctrine_surcharge.vitesses_pct.chenille.attaque");
  ok(d.doctrine_surcharge.unites_types.some(t => t.nom === "Peloton de reco" && t.classe === "roue") && M.validerDoctrine(d.doctrine_surcharge).ok, "modèle nouveau → unité type ajoutée, doctrine valide");
  const ra = d.resultats.axes[s1.id][u1.id][0];
  ok(ra.goulets.length === 1 && ra.goulets[0] === PONT_RU && JSON.stringify(ra.ouvrages) === JSON.stringify([PONT_RU, PONT_D2]), "indices d'ouvrage → id_ouvrage (" + ra.ouvrages.join(", ") + ")");
  const im = ME.importer(JSON.parse(JSON.stringify(v1p)));
  ok(im.etat && im.refus === null && im.etat.planification.scenarios[0].heure_depart_min === 360, "import direct d'un fichier prépa v1");
  const r = ME.scenario(im.etat.planification.scenarios[0], {doctrine:M.completerDoctrine(im.etat.doctrine_surcharge)});
  ok(Object.values(r.par_unite)[0].axes.length >= 1, "scénario migré recalculé (axes)");
  // conduite v1 (ennemi-conduite.html : ST, export)
  const cST = {contacts:[{id:1, ll:LLd(70, 20), vus:2, h:"23:50"}, {id:2, ll:LLd(75, 30), vus:3, h:"00:15"}], heure:null, enemy:{mode:"inconnu", type:"moto", scen:0}, mouv:false, amis:[]};
  const v1c = {format:"ennemi-conduite-gtia", version:1, nom:G.nom, date:"18/10/2026", note:"Situation…", doctrine:{}, ennemi:{nom:"Ennemi inconnu (véhicules à roues)", type:"moto", nb:12, connu:false},
   en_mouvement:false, saisies:cST, scenarios_prepa:scenariosExport, terrain:{format:"terrain-gtia-zone", zone:terrain}, contacts:cST.contacts, heure_calcul:"00:15", zones_a_survoler:[{rang:1}]};
  const mc = ME.migrer(JSON.parse(JSON.stringify(v1c))), dc = mc.document, uc = dc.conduite.unites[0];
  ok(uc.classe === "roue" && uc.unite_type === "cie-moto" && uc.en_mouvement === false && uc.scenario_ref === null, "ennemi inconnu moto → roue, unité par défaut de la classe, à l'arrêt");
  ok(dc.conduite.contacts.length === 2 && dc.conduite.contacts.every(c => c.unite === uc.id) && dc.conduite.contacts[0].heure === "23:50" && dc.conduite.contacts[1].elements_vus === 3, "contacts horodatés rattachés à l'unité");
  ok(dc.conduite.heure === "00:15", "heure de la situation = dernier contact (passage de minuit)");
  ok(dc.planification.scenarios.length === 2 && dc.planification.scenarios[0].unites[0].classe === "chenille" && mc.terrain === v1c.terrain.zone || mc.terrain.id === terrain.id, "scénarios de prépa migrés, terrain (zone) rendu à part");
  const conn = JSON.parse(JSON.stringify(v1c)); conn.saisies.enemy = {mode:"connu", type:"meca", scen:0};
  const uk = ME.migrer(conn).document.conduite.unites[0];
  ok(uk.classe === "chenille" && uk.scenario_ref && uk.scenario_ref.scenario === "s1", "ennemi connu : unité reliée au scénario de prépa (scenario_ref)");
  const ic = ME.importer(JSON.parse(JSON.stringify(v1c)));
  ok(ic.etat && ic.etat.conduite.contacts[1].heure_min === 15 && ic.etat.conduite.heure_min === 15, "import direct d'un fichier conduite v1");
  ouvrir(synth()); const mo = ME.migrer(JSON.parse(JSON.stringify(v1p)));
  ok(!mo.document.resultats && mo.avertissements.some(x => /non convertis/.test(x)), "terrain ouvert différent : indices non convertis, avertissement");
  ouvrir(DEMO());
 }

 /* ---------- I. aucune valeur de doctrine en dur dans moteur-ennemi.js ---------- */
 section("aucune valeur de doctrine écrite en dur dans moteur-ennemi.js");
 {
  const src = fs.readFileSync(path.join(ROOT, "moteur-ennemi.js"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ").replace(/`(?:\\.|[^`\\])*`/g, "``").replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''")
   .replace(/\/(?:\\.|\[[^\]]*\]|[^\/\n\\])+\/[gimsuy]*/g, "/re/");
  const lits = (code.match(/(?<![\w.$])(0x[0-9a-f]+|\d+\.?\d*(?:e-?\d+)?|\.\d+)(?![\w$])/gi) || []);
  const PERMIS = new Set(["0", "1", "2", "3", "4", "0.5", "8", "16", "60", "100", "255", "720", "1000", "1440", "1e6", "1e-12", "0x811c9dc5", "0x01000193"]);   // 100 = pourcentages, 4 = quarts d'avancement
  const hors = [...new Set(lits)].filter(x => !PERMIS.has(x.toLowerCase()));
  ok(hors.length === 0, "nombres présents : seulement mathématiques (" + [...new Set(lits)].join(" ") + ")" + (hors.length ? " ; HORS LISTE : " + hors.join(" ") : ""));
  const valeurs = new Set(); (function f(o){ for (const k in o) { const v = o[k]; if (typeof v === "number" && ![0, 1, 2, 3].includes(v)) valeurs.add(String(v)); else if (v && typeof v === "object") f(v); } })(M.DOCTRINE);
  ok(lits.every(x => !valeurs.has(x) || PERMIS.has(x)), "aucune valeur de DOCTRINE recopiée (hors nombres mathématiques)");
 }

 /* ---------- J. performance sur une grille de 50 km (500 × 500, synthétique) : PERF=1 ---------- */
 if (process.env.PERF) {
  section("performance : grille synthétique 500 × 500 mailles de 100 m");
  const n = 500, t0 = performance.now();
  const z = synth({n, riviere:{w:10, p:0.6}, mod:(f, lon, lat) => {
   const W = f.W;
   for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const c = j*n + i, x = Math.sin(i/37)*Math.cos(j/23);
    if (x > 0.55) f.L.foret[c] = 1; if (x < -0.8) f.L.bati[c] = 0.7; f.el[c] = 100 + 60*Math.sin(i/50)*Math.sin(j/70); f.sl[c] = Math.abs(3*Math.cos(i/50)); }
   const route = (y, a, b2, id) => f.ways.push({hw:"secondary", br:0, tu:0, fd:0, nm:"R" + id, nd:[id*10, id*10 + 1], g:[[lon(a), lat(y)], [lon(b2), lat(y)]]});
   for (const [q, y] of [[1, 100.5*S], [2, 300.5*S]]) { const xr = Math.floor(n/2)*S;
    route(y, 0.5, xr - 8, q); f.ways.push({hw:"secondary", br:1, tu:0, fd:0, nm:"Pont " + q, nd:[q*10 + 1, q*10 + 2], g:[[lon(xr - 8), lat(y)], [lon(xr + 8), lat(y)]]});
    f.ways.push({hw:"secondary", br:0, tu:0, fd:0, nm:"R" + q, nd:[q*10 + 2, q*10 + 3], g:[[lon(xr + 8), lat(y)], [lon(W - 0.5), lat(y)]]});
    for (let i = 0; i < n; i++) f.L.route[Math.floor(y/S)*n + i] = 0.1; } }});
  ouvrir(z); const tOuv = performance.now() - t0;
  const u = unite("chenille", LLs(20, 450), LLs(480, 40)), mesure = f => { const t = performance.now(); const r = f(); return [performance.now() - t, r]; };
  const [tA, ax] = mesure(() => ME.axes(u));
  const [tH] = mesure(() => ME.horaires(ax[0], u));
  const cts = [{id:"a", unite:"X", lonlat:LLs(100, 100), heure_min:600}, {id:"b", unite:"X", lonlat:LLs(140, 120), heure_min:630}], ux = Object.assign({}, u, {id:"X"});
  const [tI] = mesure(() => ME.isochrones(cts, [ux], 660));
  const [tP] = mesure(() => ME.presence([ux], cts, 660));
  const [tR, zr] = mesure(() => ME.zonesRegroupement(u, {axe:ax[0]}));
  const [tS] = mesure(() => M.search([M.cellAt({lng:LLs(20, 450)[0], lat:LLs(20, 450)[1]})], "chenille"));
  console.log(`  search du moteur seul (toute la grille) ${tS.toFixed(0)} ms ; ouverture du terrain ${(tOuv/1000).toFixed(1)} s ; axes ${tA.toFixed(0)} ms (${ax.length} axes) ; horaires ${tH.toFixed(0)} ms ; isochrones (2 contacts) ${tI.toFixed(0)} ms ; présence ${tP.toFixed(0)} ms ; regroupement ${tR.toFixed(0)} ms (${zr.length} zones)`);
  ok(ax.length >= 1 && zr.length >= 0, "calculs aboutis sur 500 × 500");
  let etapes = 0; const g = ME.axesEtapes(u); let r; while (!(r = g.next()).done) etapes++;
  ok(etapes >= 3 && r.value.length === ax.length, "ME.axesEtapes : " + etapes + " étapes rendant la main, même résultat");
 }
}
