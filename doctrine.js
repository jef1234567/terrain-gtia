/* doctrine.js – doctrine ennemie de l'outil Ennemi (ennemi.html), UNIQUE et séparée du fichier terrain.

   TOUTES LES VALEURS SONT FICTIVES, inventées pour le démonstrateur : « à remplacer » par la doctrine réelle
   (non classifiée) dès réception. Pour remplacer : modifier les nombres ci-dessous, ou charger une surcharge
   (objet partiel de même forme) avec completerDoctrine(surcharge) : seules les clés fournies changent.

   Reprend et unifie les réglages des anciens outils (ennemi-prepa.html DEF_R, ennemi-conduite.html DEF_R,
   qui divergeaient) et ajoute la classe « logistique ». Classes de mobilité = ARMS du moteur terrain :
   chenille, roue, logistique, fantassin (jamais « toutes armes »).

   Script classique (pas de module ES) : définit les globales DOCTRINE, DOCTRINE_CLASSES, DOCTRINE_MODES,
   DOCTRINE_ECHELONS, DOCTRINE_ANCIENS_TYPES, doctrineParDefaut(), completerDoctrine(), validerDoctrine(),
   classeDepuisAncienType(). Sous Node : require("./doctrine.js") renvoie les mêmes noms. */
"use strict";

const DOCTRINE_CLASSES = ["chenille", "roue", "logistique", "fantassin"];   // = ARMS de moteur-terrain.js
const DOCTRINE_MODES = ["attaque", "reco", "repli", "marche"];
const DOCTRINE_ECHELONS = ["section", "compagnie", "bataillon"];
// anciens types des outils ennemi-prepa / ennemi-conduite (format v1) → classe de mobilité
const DOCTRINE_ANCIENS_TYPES = {meca:"chenille", moto:"roue", pied:"fantassin"};

const DOCTRINE = {
 version: 1,
 source: "FICTIF – à remplacer",
 note: "Valeurs inventées pour le démonstrateur, à remplacer par la doctrine réelle. Aucune n'est issue d'un document de référence.",

 /* Vitesse tactique, en % de la vitesse calculée par le moteur terrain pour la classe (routes, pente, couvert,
    franchissements déjà pris en compte), par mode d'action. Ancienne « vitesse_tactique_pct » (meca 50, moto 60,
    pied 80) = mode « attaque ». */
 vitesses_pct: {
  chenille:   {attaque:50, reco:40, repli:70, marche:80},
  roue:       {attaque:60, reco:50, repli:75, marche:85},
  logistique: {attaque:60, reco:50, repli:70, marche:80},
  fantassin:  {attaque:80, reco:60, repli:85, marche:90}
 },

 /* Modes d'action et effet sur le choix d'axe.
    poids_surete_pct : part de la recherche de sûreté (0 = l'axe le plus rapide, 100 = le plus discret) ; multiplie surete.poids_max.
    ecart_axes_m : distance minimale entre deux axes proposés (au-delà, c'est une vraie variante).
    penalite_axe_deja_pris : multiplicateur de temps près d'un axe déjà trouvé (recherche de variante).
    suit_routes : l'unité reste sur le réseau routier autant que possible (temps hors route × surete.facteur_hors_route).
    regroupe : l'unité marque un regroupement avant l'objectif (zones de regroupement calculées). */
 modes_action: {
  attaque: {lbl:"attaque",           poids_surete_pct:70, ecart_axes_m:600,  penalite_axe_deja_pris:3, suit_routes:false, regroupe:true},
  reco:    {lbl:"reconnaissance",    poids_surete_pct:90, ecart_axes_m:400,  penalite_axe_deja_pris:3, suit_routes:false, regroupe:false},
  repli:   {lbl:"repli",             poids_surete_pct:30, ecart_axes_m:800,  penalite_axe_deja_pris:2, suit_routes:true,  regroupe:true},
  marche:  {lbl:"marche (déplacement)", poids_surete_pct:0, ecart_axes_m:1000, penalite_axe_deja_pris:2, suit_routes:true, regroupe:false}
 },
 surete: {poids_max:6, facteur_hors_route:1.5},

 /* Échelons : nombre de sous-unités, véhicules (ou groupes à pied), gabarit (front × profondeur) et dispersion
    (minutes d'écart entre la tête et la queue, sert d'incertitude de base sur les horaires). */
 echelons: {
  section:   {lbl:"section",   sous_unite:"groupe",    sous_unites:3, vehicules:4,  front_km:0.6, prof_km:0.4, dispersion_min:5},
  compagnie: {lbl:"compagnie", sous_unite:"section",   sous_unites:3, vehicules:13, front_km:1.5, prof_km:1,   dispersion_min:15},
  bataillon: {lbl:"bataillon", sous_unite:"compagnie", sous_unites:3, vehicules:45, front_km:4,   prof_km:3,   dispersion_min:40}
 },

 /* Unités types (bibliothèque). elements = nombre de véhicules, ou de groupes pour une unité à pied (element = "groupe").
    composition : détail des éléments (la somme des nombres = elements). Les 7 premières reprennent les anciens « modeles ». */
 unites_types: [
  {id:"sec-meca",   nom:"Section mécanisée",    echelon:"section",   classe:"chenille",   element:"véhicule", elements:4,  front_km:0.6, prof_km:0.4, dispersion_min:5,
   composition:[{designation:"véhicule de combat d'infanterie", nombre:4, classe:"chenille"}]},
  {id:"cie-meca",   nom:"Compagnie mécanisée",  echelon:"compagnie", classe:"chenille",   element:"véhicule", elements:13, front_km:1.5, prof_km:1,   dispersion_min:15,
   composition:[{designation:"véhicule de combat d'infanterie", nombre:12, classe:"chenille"}, {designation:"véhicule de commandement", nombre:1, classe:"chenille"}]},
  {id:"esc-chars",  nom:"Escadron de chars",    echelon:"compagnie", classe:"chenille",   element:"véhicule", elements:13, front_km:2,   prof_km:1.5, dispersion_min:15,
   composition:[{designation:"char de combat", nombre:13, classe:"chenille"}]},
  {id:"btn-meca",   nom:"Bataillon mécanisé",   echelon:"bataillon", classe:"chenille",   element:"véhicule", elements:45, front_km:4,   prof_km:3,   dispersion_min:40,
   composition:[{designation:"véhicule de combat d'infanterie", nombre:36, classe:"chenille"}, {designation:"char de combat", nombre:4, classe:"chenille"}, {designation:"véhicule de commandement", nombre:5, classe:"chenille"}]},
  {id:"cie-moto",   nom:"Compagnie motorisée",  echelon:"compagnie", classe:"roue",       element:"véhicule", elements:12, front_km:1.5, prof_km:1,   dispersion_min:15,
   composition:[{designation:"véhicule blindé à roues", nombre:11, classe:"roue"}, {designation:"véhicule de commandement", nombre:1, classe:"roue"}]},
  {id:"sec-pied",   nom:"Section à pied",       echelon:"section",   classe:"fantassin",  element:"groupe",   elements:3,  front_km:0.4, prof_km:0.3, dispersion_min:5,
   composition:[{designation:"groupe de combat", nombre:3, classe:"fantassin"}]},
  {id:"cie-pied",   nom:"Compagnie à pied",     echelon:"compagnie", classe:"fantassin",  element:"groupe",   elements:9,  front_km:1,   prof_km:0.8, dispersion_min:15,
   composition:[{designation:"groupe de combat", nombre:9, classe:"fantassin"}]},
  {id:"cvoi-log",   nom:"Convoi logistique",    echelon:"section",   classe:"logistique", element:"véhicule", elements:10, front_km:0.3, prof_km:2,   dispersion_min:10,
   composition:[{designation:"camion gros porteur", nombre:8, classe:"logistique"}, {designation:"véhicule d'escorte à roues", nombre:2, classe:"roue"}]}
 ],
 // unité type prise quand on ne connaît que la classe (ancien « unite_type » de la conduite)
 unite_par_defaut: {chenille:"cie-meca", roue:"cie-moto", logistique:"cvoi-log", fantassin:"cie-pied"},

 /* Zones de regroupement : surface libre nécessaire par véhicule (ou groupe), couvert minimal (part forêt + bâti
    de la zone, 0 à 1), distance à l'objectif (km), hors vue de nos positions et des points hauts, durée du
    regroupement par mode d'action (minutes). */
 regroupement: {
  surface_par_vehicule_m2:2500,
  couvert_min:0.5,
  distance_objectif_km:{min:2, max:8},
  hors_vue:true,
  duree_min:{attaque:45, reco:15, repli:30, marche:20}
 },

 /* Niveaux forte / moyenne / faible (présence probable, zones à survoler, plausibilité) : part du total, en %. */
 seuils: {forte_pct:30, moyenne_pct:10},

 /* Délais des isochrones (minutes). Planification : depuis le départ ; conduite : depuis chaque contact. */
 isochrones_min: {planification:[15, 30, 60, 120], conduite:[5, 10, 20, 40]},

 /* Horaires (planification) : un jalon tous les jalon_km et à chaque ouvrage ; incertitude = dispersion de
    l'unité + incertitude_pct du temps de route. */
 horaires: {jalon_km:3, incertitude_pct:10},

 /* Présence probable (conduite), reprise de l'ancien outil de conduite : part du temps écoulé passée en mouvement,
    bonus d'attrait du terrain en mouvement ou à l'arrêt, bonus le long des axes prévus. */
 presence: {mobilite_pct:50, mouvement:{bonus_couloir:1.5, bonus_axe:1.3}, arret:{bonus_foret:1.5, bonus_bati:1},
            axes_prevus:{bonus:2, largeur_m:500}},
 zones_a_survoler: {rayon_m:500, nb:5}
};

const _clone = o => JSON.parse(JSON.stringify(o));
function doctrineParDefaut(){ return _clone(DOCTRINE); }
function classeDepuisAncienType(t){ return DOCTRINE_CLASSES.includes(t) ? t : DOCTRINE_ANCIENS_TYPES[t] || null; }

// Complète une surcharge partielle par les valeurs par défaut, clé par clé (sous-objets fusionnés, tableaux
// remplacés en entier, types différents ignorés, clés inconnues ignorées). Renvoie un nouvel objet complet.
function completerDoctrine(surcharge){
 const r = doctrineParDefaut();
 const fusion = (a, b) => { for (const k in b || {}) {
  if (!(k in a) || k === "version") continue;
  if (Array.isArray(a[k])) { if (Array.isArray(b[k])) a[k] = _clone(b[k]); }
  else if (a[k] && typeof a[k] === "object") { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) fusion(a[k], b[k]); }
  else if (typeof b[k] === typeof a[k]) a[k] = b[k];
 } };
 fusion(r, surcharge);
 return r;
}

// Complète puis contrôle une doctrine. Renvoie {doctrine (complète), erreurs:[texte], ok}.
// Une doctrine avec erreurs ne doit pas être employée (l'outil garde alors la précédente).
function validerDoctrine(surcharge){
 const d = completerDoctrine(surcharge), E = [];
 const pos = (v, ou) => { if (!(typeof v === "number" && isFinite(v) && v > 0)) E.push(ou + " : nombre positif attendu (" + v + ")"); };
 const pct = (v, ou) => { if (!(typeof v === "number" && v >= 0 && v <= 100)) E.push(ou + " : pourcentage entre 0 et 100 attendu (" + v + ")"); };
 for (const k of DOCTRINE_CLASSES) for (const m of DOCTRINE_MODES) { const v = d.vitesses_pct[k] && d.vitesses_pct[k][m]; pos(v, `vitesses_pct.${k}.${m}`); if (v > 100) E.push(`vitesses_pct.${k}.${m} : au plus 100 % de la vitesse du terrain`); }
 for (const m of DOCTRINE_MODES) { const a = d.modes_action[m]; pct(a.poids_surete_pct, `modes_action.${m}.poids_surete_pct`); pos(a.ecart_axes_m, `modes_action.${m}.ecart_axes_m`);
  if (!(a.penalite_axe_deja_pris >= 1)) E.push(`modes_action.${m}.penalite_axe_deja_pris : au moins 1`); }
 if (!(d.surete.facteur_hors_route >= 1)) E.push("surete.facteur_hors_route : au moins 1");
 for (const e of DOCTRINE_ECHELONS) { const x = d.echelons[e]; for (const f of ["sous_unites", "vehicules", "front_km", "prof_km", "dispersion_min"]) pos(x[f], `echelons.${e}.${f}`); }
 const ids = new Set();
 d.unites_types.forEach((u, i) => { const ou = `unites_types[${i}] (${u && u.nom})`;
  if (!u || typeof u !== "object") return E.push(ou + " : objet attendu");
  if (!u.id || ids.has(u.id)) E.push(ou + " : identifiant absent ou en double"); ids.add(u.id);
  if (!DOCTRINE_CLASSES.includes(u.classe)) E.push(ou + " : classe inconnue « " + u.classe + " » (" + DOCTRINE_CLASSES.join(", ") + ")");
  if (!DOCTRINE_ECHELONS.includes(u.echelon)) E.push(ou + " : échelon inconnu « " + u.echelon + " »");
  for (const f of ["elements", "front_km", "prof_km", "dispersion_min"]) pos(u[f], ou + "." + f);
  if (Array.isArray(u.composition) && u.composition.length) { const s = u.composition.reduce((a, c) => a + (+c.nombre || 0), 0);
   if (s !== u.elements) E.push(ou + " : la composition compte " + s + " éléments, l'unité " + u.elements);
   u.composition.forEach(c => { if (!DOCTRINE_CLASSES.includes(c.classe)) E.push(ou + " : classe inconnue dans la composition « " + c.classe + " »"); }); } });
 for (const k of DOCTRINE_CLASSES) if (!ids.has(d.unite_par_defaut[k])) E.push(`unite_par_defaut.${k} : unité type « ${d.unite_par_defaut[k]} » introuvable`);
 const g = d.regroupement; pos(g.surface_par_vehicule_m2, "regroupement.surface_par_vehicule_m2");
 if (!(g.couvert_min >= 0 && g.couvert_min <= 1)) E.push("regroupement.couvert_min : entre 0 et 1");
 if (!(g.distance_objectif_km.min >= 0 && g.distance_objectif_km.max > g.distance_objectif_km.min)) E.push("regroupement.distance_objectif_km : 0 ≤ min < max");
 for (const m of DOCTRINE_MODES) pos(g.duree_min[m], `regroupement.duree_min.${m}`);
 pct(d.seuils.forte_pct, "seuils.forte_pct"); pct(d.seuils.moyenne_pct, "seuils.moyenne_pct");
 if (!(d.seuils.forte_pct > d.seuils.moyenne_pct)) E.push("seuils : forte_pct doit dépasser moyenne_pct");
 for (const k of ["planification", "conduite"]) { const a = d.isochrones_min[k];
  if (!Array.isArray(a) || !a.length || a.some((v, i) => !(v > 0) || (i && v <= a[i-1]))) E.push(`isochrones_min.${k} : délais positifs croissants attendus`); }
 pos(d.horaires.jalon_km, "horaires.jalon_km"); pct(d.horaires.incertitude_pct, "horaires.incertitude_pct");
 return {doctrine:d, erreurs:E, ok:!E.length};
}

if (typeof module !== "undefined" && module.exports)
 module.exports = {DOCTRINE, DOCTRINE_CLASSES, DOCTRINE_MODES, DOCTRINE_ECHELONS, DOCTRINE_ANCIENS_TYPES, doctrineParDefaut, completerDoctrine, validerDoctrine, classeDepuisAncienType};
