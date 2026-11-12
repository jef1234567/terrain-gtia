/* Tests de calcul de l'outil Ennemi (Node pur, sans navigateur) :  node tests/ennemi.js
   Étape 0 : chargement de doctrine.js, moteur-ennemi.js et moteur-terrain.js sur terrain-demo.json (v3),
   validation de la doctrine, référence terrain (id + empreinte), signatures du moteur ennemi.
   Le lot A ajoute ici les tests des axes, horaires, isochrones multi-contacts, présence, regroupements, export. */
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
 // signatures posées (corps minimal à l'étape 0)
 const sig = {axes:2, horaires:3, positionSurAxe:3, isochrones:4, presence:4, zonesRegroupement:2, exporter:2, importer:1, migrer:1};
 ok(Object.entries(sig).every(([f, a]) => typeof ME[f] === "function" && ME[f].length === a), "signatures du moteur ennemi : " + Object.keys(sig).join(", "));
 ok(Array.isArray(ME.axes(u, {})) && ME.exporter({}, {}).format === "ennemi-gtia" && ME.exporter({}, {}).terrain.empreinte === ref.empreinte, "corps minimal : appels sans erreur, export avec référence terrain");
 // le moteur ennemi s'appuie sur search avec options (plus de Dijkstra recopié)
 const r = M.search([50*100 + 20], "chenille", {cible:new Uint8Array(100*100).fill(0).map((_, c) => c === 50*100 + 80 ? 1 : 0)});
 ok(r.fin === 50*100 + 80 && M.cheminVers(r, r.fin).length > 2, "search avec cible et cheminVers disponibles");
})().catch(e => ok(false, "exception : " + e.stack)).then(() => { console.log(`${nb} vérifications, ${ko} échec(s)`); process.exit(ko ? 1 : 0); });
