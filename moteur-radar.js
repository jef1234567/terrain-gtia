/* moteur-radar.js – calculs de l'outil Radars (radars.html). Lot 1 du 13/11/2026 ; lot 2 (mode Ennemi : position incertaine,
   défilement, itinéraires défilés) du 13/11/2026 ; lot 3 (mode Contre-batterie : trajectoires vues, positions de tir repérables ;
   export / import au contrat « radars-gtia » v1, voir CONTRAT-JSON.md) du 13/11/2026.
   Pas d'accès au DOM ni à la carte : chargeable sous Node (tests/radars.js) comme dans la page. Tout est rangé dans l'objet MR.

   Conventions
   - Grille Z (ce que voit le radar) : {n, cell (m), el (altitude du sol, Float32Array n×n, ligne 0 au nord), H (sol + forêts et bâti
     à hauteur forfaitaire ; = el en « grande zone »), couv (hauteur du couvert au-dessus du sol, ou null), ok(c) : emplacement possible}.
     Construite par la page à partir de la zone de l'outil terrain (maille fine, forêts et bâti) ou du relief seul (grande zone).
   - Valeur sourcée : {v: nombre ou null (inconnu), fiab: "forte" | "moyenne" | "faible" | "estimé" | "inconnu" | "saisie", src: URL, note}.
     forte = source officielle (ministère, constructeur ou exportateur) ; moyenne = presse spécialisée ou encyclopédie ;
     faible = source unique, ancienne ou dont les chiffres divergent ; estimé = aucune source, valeur de l'outil ; saisie = modifiée par l'utilisateur.
   - Fiche radar (bibliothèque) : {id, nom, role (sol | cb | air | dsa), camp (ami | ennemi), niveau, note, portee_min_km, portee_max_km,
     secteur_deg, antenne_m (valeurs sourcées), cibles: {<id de cible>: valeur sourcée = portée de détection en km (v null = inconnue :
     la portée maximale est alors utilisée, ce qui est optimiste)}}. Une cible absente de « cibles » n'est pas vue par ce radar.
   - Radar posé (réutilisable par les modes Ennemi et Contre-batterie, lots 2 et 3) : {id, type (id de fiche), camp, ll: [lon, lat],
     orient_deg (azimut du milieu du secteur, depuis le nord, sens horaire), antenne_m (null = valeur de la fiche), nom}
     + en mode Ennemi (lot 2) : statut (repere | suppose), incert_m (rayon d'incertitude de position, 0 = position sûre).
   - Plancher de détection : par maille, altitude minimale au-dessus du sol à partir de laquelle une cible est vue (m) ; Infinity = hors
     portée, hors secteur ou plus près que la portée minimale. Une cible de hauteur h est vue là où plancher <= h.
   - Calculs longs : générateurs « yield [texte, avancement] » à passer à enSequences (moteur-terrain.js), comme l'outil Ennemi. */
"use strict";
const MR = (() => {
const MR = {};
const V = (v, fiab, src, note) => { const o = {v, fiab}; if (src) o.src = src; if (note) o.note = note; return o; };
MR.V = V;
MR.val = x => x == null ? null : typeof x === "number" ? x : (x.v == null ? null : +x.v);

MR.ROLES = {sol:"surveillance du sol", cb:"contre-batterie", air:"surveillance aérienne", dsa:"défense sol-air basse couche"};
MR.CAMPS = {ami:"ami", ennemi:"ennemi"};
MR.FIAB = {forte:"forte (source officielle)", moyenne:"moyenne (presse spécialisée, encyclopédie)", faible:"faible (source unique, ancienne ou divergente)", "estimé":"estimé (aucune source)", inconnu:"inconnu", saisie:"saisie (modifiée par l'utilisateur)"};
/* modes de l'outil : « ami » (lot 1), « ennemi » (lot 2), « cb » contre-batterie (lot 3) */
MR.MODES = {
 ami:{nom:"Ami", actif:true, texte:"Notre réseau de radars : couverture, trous, meilleurs emplacements."},
 ennemi:{nom:"Ennemi", actif:true, texte:"Radars ennemis repérés ou supposés : zones de défilement et itinéraires défilés (hors de leur vue)."},
 cb:{nom:"Contre-batterie", actif:true, texte:"Radars de contre-batterie : d'où nos tirs sont repérés par l'ennemi, ou d'où un tir ennemi est localisé par notre COBRA (trajectoires vues)."}
};

/* ---------- sources ouvertes (consultées le 13/11/2026) ---------- */
const S = {
 lpm:"https://archives.defense.gouv.fr/content/download/556578/9648087/fiche_lpm_radar_murin.pdf",
 go12:"https://spartanat.com/en/ground-observation-radar-go12",
 cobraDA:"https://www.defenseadvancement.com/projects/cobra-counter-battery-radar",
 cobraH:"https://hensoldt.net/products/radar-iff-and-datalink/cobra-counter-battery-radar",
 cobraW:"https://en.wikipedia.org/wiki/COBRA_(radar)",
 girDGA:"https://www.defense.gouv.fr/dga/actualites/dga-commande-16-vehicules-equipes-dun-radar-bande-x",
 girAT:"https://www.army-technology.com/projects/giraffe-1x-surface-radar-sweden/",
 gmEDR:"https://www.edrmagazine.eu/ground-master-400-alpha-taking-long-range-air-surveillance-to-the-next-level",
 gmW:"https://en.wikipedia.org/wiki/Ground_Master_400",
 fara:"https://roe.ru/eng/catalog/land-forces/ground-surveillance-radars/fara-vr",
 kredo:"https://en.strategypage.com/htmw/htecm/articles/20011123.aspx",
 kredo1e:"https://roe.ru/en/production/land-forces/reconnaissance-and-electronic-warfare-means/reconnaissance-assets/kredo-1e-/",
 aist:"https://en.wikipedia.org/wiki/Aistyonok",
 zooW:"https://en.wikipedia.org/wiki/Zoopark-1",
 zooAR:"https://armyrecognition.com/military-products/army/radars/counter-battery-radars/zoopark-1-1l-219-counter-battery-radar-system-russia-data",
 tor:"https://missilethreat.csis.org/defsys/tor/",
 pantsir:"https://missilethreat.csis.org/defsys/pantsir-s-1/",
 l122:"https://www.indrastra.com/2018/07/Russia-Unveils-New-1L122-Series-Air-Defense-Radars-004-07-2018-0012.html",
 kasta:"https://en.wikipedia.org/wiki/Kasta_2E",
 nebo:"https://cmano-db.com/facility/1849/",
 /* systèmes de tir (lot 3) */
 mo120:"https://en.wikipedia.org/wiki/Mortier_120_mm_Ray%C3%A9_Tract%C3%A9_Mod%C3%A8le_F1",
 caesar:"https://knds.com/fileadmin/user_upload/content/Newsroom/PressAreas/2024_Eurosatory/ceasar_6x6/CAESAR_6X6_EN.pdf",
 lru:"https://www.defense.gouv.fr/terre/nos-materiels/nos-equipements-terre/vehicules-larmee-terre/vehicules-dartillerie/lru-lance-roquette-unitaire",
 msta:"https://en.wikipedia.org/wiki/2S19_Msta-S",
 grad:"https://www.wikipedia.org/wiki/9M22",
 sani:"https://en.wikipedia.org/wiki/2B11"
};
MR.SOURCES = S;
const EST = (v, note) => V(v, "estimé", null, note), INC = note => V(null, "inconnu", null, note);

/* ---------- bibliothèque par défaut ---------- */
MR.BIB = {
 "_avertissement":"Valeurs de sources ouvertes (lien « src » de chaque valeur) ou ESTIMÉES. Fiabilité : forte = source officielle ; moyenne = presse spécialisée, encyclopédie ; faible = source unique, ancienne ou divergente ; estimé = aucune source ; inconnu. Portée de détection inconnue pour une cible : la portée maximale est utilisée (optimiste).",
 "cibles":[
  {"id":"pieton", "nom":"Piéton", "h_m":1.8, "note":"hauteur approximative"},
  {"id":"vehicule", "nom":"Véhicule", "h_m":2.5, "note":"hauteur approximative"},
  {"id":"drone50", "nom":"Drone bas", "h_m":50, "note":"vol à 50 m au-dessus du sol"},
  {"id":"drone150", "nom":"Drone", "h_m":150, "note":"vol à 150 m au-dessus du sol"},
  {"id":"aeronef", "nom":"Aéronef", "h_m":500, "note":"hélicoptère ou avion à 500 m au-dessus du sol (estimé)"},
  {"id":"obus", "nom":"Obus (contre-batterie)", "h_m":300, "note":"obus d'artillerie ; modes Ami et Ennemi : hauteur forfaitaire au-dessus du sol (estimé) ; mode Contre-batterie : la trajectoire est calculée"},
  {"id":"mortier", "nom":"Obus de mortier", "h_m":300, "note":"modes Ami et Ennemi : hauteur forfaitaire (estimé) ; mode Contre-batterie : trajectoire calculée"},
  {"id":"roquette", "nom":"Roquette", "h_m":300, "note":"modes Ami et Ennemi : hauteur forfaitaire (estimé) ; mode Contre-batterie : trajectoire calculée"}
 ],
 "radars":[
  {"id":"murin", "nom":"MURIN (Thales GO12)", "role":"sol", "camp":"ami", "niveau":"GTIA",
   "note":"Radar portable (40 kg, à dos d'homme) : cibles mobiles, renseignement, aide aux tirs d'artillerie, protection d'emprises. 13 livrés (fiche LPM).",
   "portee_min_km":V(0.3, "forte", S.lpm), "portee_max_km":V(25, "forte", S.lpm, "portée instrumentée"), "secteur_deg":V(360, "forte", S.lpm),
   "antenne_m":EST(1.5, "trépied"),
   "cibles":{"pieton":V(16, "moyenne", S.go12, "« infanterie jusqu'à 16 km » (GO12)"), "vehicule":V(25, "moyenne", S.go12, "« véhicules jusqu'à 26 km » (GO12), limité à la portée instrumentée"),
    "drone50":INC("aéronefs surveillés selon la fiche LPM, portée non publiée"), "drone150":INC("portée non publiée"), "aeronef":INC("portée non publiée")}},
  {"id":"cobra", "nom":"COBRA (contre-batterie)", "role":"cb", "camp":"ami", "niveau":"GTIA et au-dessus",
   "note":"Radar 3D à antenne active (Thales, Airbus, Lockheed Martin ; modernisé par Hensoldt). 10 achetés par la France (Wikipédia). Option portée étendue jusqu'à 100 km (Hensoldt).",
   "portee_min_km":INC("non publiée"), "portee_max_km":V(40, "moyenne", S.cobraDA, "départs d'artillerie et de roquettes jusqu'à 40 km ; 100 km avec l'option portée étendue (" + S.cobraH + ")"),
   "secteur_deg":EST(90, "secteur non publié"), "antenne_m":EST(4, "sur camion"),
   "cibles":{"obus":V(40, "moyenne", S.cobraDA, "artillerie et roquettes ; mortiers à plus courte distance (non chiffrée)"), "roquette":V(40, "moyenne", S.cobraDA, "artillerie et roquettes jusqu'à 40 km"),
    "mortier":INC("« à plus courte distance », non chiffrée (" + S.cobraDA + ")")}},
  {"id":"giraffe1x", "nom":"Giraffe 1X (défense sol-air basse couche)", "role":"dsa", "camp":"ami", "niveau":"GTIA et au-dessus",
   "note":"Saab, bande X, sur véhicule Scania ; 16 commandés par la DGA (8 en déc. 2025, 8 en avr. 2026) pour la défense sol-air d'accompagnement de l'armée de Terre ; détecte « de la micro-drone à l'avion de combat », mode contre-roquettes et obus (C-RAM).",
   "portee_min_km":INC("non publiée"), "portee_max_km":V(75, "moyenne", S.girAT, "portée instrumentée"), "secteur_deg":V(360, "forte", S.girDGA),
   "antenne_m":EST(4, "sur véhicule, hauteur non publiée"),
   "cibles":{"drone50":INC("portée non publiée (" + S.girDGA + ")"), "drone150":INC("portée non publiée"), "aeronef":INC("portée non publiée"), "obus":INC("mode C-RAM, portée non publiée"),
    "mortier":INC("mode C-RAM, portée non publiée"), "roquette":INC("mode C-RAM, portée non publiée")}},
  {"id":"gm400a", "nom":"GM400α (surveillance aérienne longue portée)", "role":"air", "camp":"ami", "niveau":"armée de l'Air et de l'Espace : PAS un radar de niveau GTIA",
   "note":"Thales. Plafond 30 500 m (Wikipédia) ; GM400 de base 470 km. La France a 15 GM400 (Wikipédia). Donné pour comparaison : ce n'est pas un moyen du GTIA.",
   "portee_min_km":INC("non publiée"), "portee_max_km":V(515, "moyenne", S.gmEDR, "portée instrumentée du GM400α"), "secteur_deg":EST(360, "antenne tournante"),
   "antenne_m":EST(6, "hauteur non publiée"),
   "cibles":{"drone50":INC("drones tactiques à basse altitude suivis, portée non publiée"), "drone150":INC("portée non publiée"), "aeronef":INC("portée non publiée")}},
  {"id":"generique", "nom":"Générique (paramétrable)", "role":"sol", "camp":"ami", "niveau":"à régler",
   "note":"Radar fictif dont toutes les valeurs sont à régler : point de départ pour un radar absent de la bibliothèque.",
   "portee_min_km":EST(0.1), "portee_max_km":EST(20), "secteur_deg":EST(360), "antenne_m":EST(5),
   "cibles":{"pieton":EST(8), "vehicule":EST(15), "drone50":EST(10), "drone150":EST(20), "aeronef":EST(20), "obus":EST(15), "mortier":EST(10), "roquette":EST(20)}},
  /* ennemis (mode Ennemi, lot 2) */
  {"id":"fara", "nom":"Fara-VR (famille Fara-1)", "role":"sol", "camp":"ennemi", "niveau":"section, compagnie",
   "note":"Radar portable russe de surveillance du sol (12 kg), bande J. Valeurs de l'exportateur pour la version Fara-VR ; Fara-PV : soldat 3 km, voiture 6 km.",
   "portee_min_km":V(0.01, "forte", S.fara), "portee_max_km":V(10, "forte", S.fara, "camion"), "secteur_deg":V(180, "forte", S.fara, "balayage automatique de 24 à 180°"),
   "antenne_m":EST(1.5, "trépied"),
   "cibles":{"pieton":V(4, "forte", S.fara, "soldat seul en mouvement"), "vehicule":V(10, "forte", S.fara, "camion 10 km, char 8 km")}},
  {"id":"kredom1", "nom":"Kredo-M1", "role":"sol", "camp":"ennemi", "niveau":"bataillon, artillerie",
   "note":"Radar russe de surveillance du sol (≈ 60 kg, 2 à 3 porteurs), désignation pour l'artillerie jusqu'à 13 km. Source ancienne (2001). Version export Credo-1E : homme 15 km, char 40 km, portée minimale 0,2 km (" + S.kredo1e + ").",
   "portee_min_km":INC("non publiée pour le M1"), "portee_max_km":V(40, "faible", S.kredo, "véhicules jusqu'à 40 km"), "secteur_deg":EST(360, "Credo-1E : secteur de 30 à 180° orientable sur 360°"),
   "antenne_m":EST(2, "trépied"),
   "cibles":{"pieton":V(8, "faible", S.kredo, "soldat seul en mouvement : 5 à 8 km"), "vehicule":V(16, "faible", S.kredo, "chars en mouvement 12 à 16 km ; véhicules jusqu'à 40 km")}},
  {"id":"aistyonok", "nom":"Aistyonok (1L271)", "role":"sol", "camp":"ennemi", "niveau":"bataillon, artillerie",
   "note":"Radar portable russe : cibles terrestres mobiles et positions de mortiers (valeurs annoncées par le constructeur, selon Wikipédia).",
   "portee_min_km":INC("non publiée"), "portee_max_km":V(20, "moyenne", S.aist, "cibles terrestres mobiles"), "secteur_deg":INC("non publié"),
   "antenne_m":EST(2, "trépied"),
   "cibles":{"pieton":V(20, "moyenne", S.aist, "« cibles terrestres mobiles » : pas de valeur séparée pour le piéton"), "vehicule":V(20, "moyenne", S.aist), "mortier":V(5, "moyenne", S.aist, "positions de mortiers jusqu'à 5 km")}},
  {"id":"zoopark", "nom":"Zoopark-1 / 1M (1L219 / 1L260)", "role":"cb", "camp":"ennemi", "niveau":"brigade, artillerie",
   "note":"Contre-batterie russe sur châssis chenillé. Chiffres du Zoopark-1 ; ceux du 1M ne sont pas publiés. Les sources divergent : Wikipédia (mortier 20, artillerie 30, roquettes 50, cibles terrestres 40 km) et Army Recognition (mortier 13 à 17, artillerie 12, roquettes 22 km).",
   "portee_min_km":INC("non publiée"), "portee_max_km":V(50, "faible", S.zooW, "roquettes ; 22 km selon Army Recognition"), "secteur_deg":V(60, "moyenne", S.zooAR, "40 à 60°"),
   "antenne_m":EST(4, "antenne levée sur le toit"),
   "cibles":{"obus":V(30, "faible", S.zooW, "obus d'artillerie ; 12 km selon " + S.zooAR), "mortier":V(20, "faible", S.zooW, "mortiers ; 13 à 17 km selon " + S.zooAR),
    "roquette":V(50, "faible", S.zooW, "roquettes ; 22 km selon " + S.zooAR), "vehicule":V(40, "faible", S.zooW, "cibles terrestres mobiles")}},
  {"id":"tor", "nom":"Tor-M2 (radar de veille)", "role":"dsa", "camp":"ennemi", "niveau":"défense sol-air de division",
   "note":"Système sol-air courte portée : détection 32 km (famille M2), interception jusqu'à 16 km et 10 km d'altitude (CSIS).",
   "portee_min_km":INC("non publiée"), "portee_max_km":V(32, "moyenne", S.tor), "secteur_deg":EST(360, "antenne tournante"), "antenne_m":EST(5, "sur le véhicule"),
   "cibles":{"drone50":V(32, "moyenne", S.tor, "valeur du système, sans précision de cible"), "drone150":V(32, "moyenne", S.tor), "aeronef":V(32, "moyenne", S.tor)}},
  {"id":"pantsir", "nom":"Pantsir-S1 (radar de veille)", "role":"dsa", "camp":"ennemi", "niveau":"défense sol-air",
   "note":"Système canons-missiles : radar de veille 32 à 36 km (cible de la taille d'un avion tactique), missiles jusqu'à 10 km d'altitude (CSIS). Pantsir-SM : 75 km.",
   "portee_min_km":INC("non publiée"), "portee_max_km":V(36, "moyenne", S.pantsir, "32 à 36 km"), "secteur_deg":EST(360, "antenne tournante"), "antenne_m":EST(5, "sur le véhicule"),
   "cibles":{"drone50":INC("valeur donnée pour un avion tactique"), "drone150":INC("valeur donnée pour un avion tactique"), "aeronef":V(36, "moyenne", S.pantsir, "avion tactique")}},
  {"id":"l122", "nom":"1L122-1E (famille Garmon)", "role":"dsa", "camp":"ennemi", "niveau":"défense sol-air basse couche",
   "note":"Radar russe bande L sur véhicule : avions, hélicoptères, missiles de croisière et drones. Le 1L122-2E (UHF, mât) porte à 80 km.",
   "portee_min_km":V(1, "faible", S.l122), "portee_max_km":V(40, "faible", S.l122), "secteur_deg":EST(360), "antenne_m":EST(4, "sur véhicule"),
   "cibles":{"drone50":INC("portée par cible non publiée"), "drone150":INC("portée par cible non publiée"), "aeronef":INC("portée par cible non publiée")}},
  {"id":"kasta", "nom":"Kasta-2E2 (39N6E)", "role":"air", "camp":"ennemi", "niveau":"veille basse altitude, au-dessus du GTIA",
   "note":"Veille aérienne basse altitude : cible à 100 m vue à 41 km (antenne normale) ou 55 km (pylône de 50 m) selon Wikipédia. Portée maximale du 2E2 non publiée : 150 km est la valeur du Kasta 2E1.",
   "portee_min_km":INC("non publiée"), "portee_max_km":V(150, "faible", S.kasta, "valeur du Kasta 2E1"), "secteur_deg":EST(360, "antenne tournante"), "antenne_m":EST(6, "pylône de 50 m en option"),
   "cibles":{"drone150":INC("cible à 100 m : 41 km (" + S.kasta + ")"), "aeronef":INC("non publiée")}},
  {"id":"nebo", "nom":"1L119 Nebo-SVU (veille aérienne)", "role":"air", "camp":"ennemi", "niveau":"au-dessus du GTIA",
   "note":"Radar de veille bande VHF. Cible de 2,5 m² : 25 km à 100 m d'altitude, 60 km à 500 m, 270 km à 10 000 m, 360 km à 20 000 m (base de données de jeu, à recouper).",
   "portee_min_km":INC("non publiée"), "portee_max_km":V(360, "faible", S.nebo), "secteur_deg":EST(360, "antenne tournante"), "antenne_m":EST(8, "hauteur non publiée"),
   "cibles":{"aeronef":V(60, "faible", S.nebo, "cible à 500 m d'altitude"), "drone150":INC("à 100 m d'altitude : 25 km")}}
 ]
};

/* ---------- bibliothèque : complément et contrôle ---------- */
const clone = o => JSON.parse(JSON.stringify(o));
const CHAMPS = ["portee_min_km", "portee_max_km", "secteur_deg", "antenne_m"];
// complète une bibliothèque saisie (JSON) : fiches et cibles manquantes reprises de la bibliothèque par défaut, champs absents estimés
MR.completerBib = (b) => {
 const d = clone(MR.BIB), r = {_avertissement:d._avertissement, cibles:[], radars:[]};
 b = b && typeof b === "object" ? b : {};
 const cib = Array.isArray(b.cibles) ? b.cibles : d.cibles;
 for (const c of cib) if (c && c.id && !r.cibles.some(x => x.id === c.id)) r.cibles.push({id:String(c.id), nom:String(c.nom || c.id), h_m:Math.max(0, +c.h_m || 0), note:c.note || ""});
 for (const c of d.cibles) if (!r.cibles.some(x => x.id === c.id)) r.cibles.push(c);
 const gen = d.radars.find(x => x.id === "generique");
 const rad = Array.isArray(b.radars) ? b.radars : d.radars;
 for (const f0 of rad) { if (!f0 || !f0.id || r.radars.some(x => x.id === f0.id)) continue;
  const f = Object.assign({}, f0); f.id = String(f.id); f.nom = String(f.nom || f.id); if (!MR.ROLES[f.role]) f.role = "sol"; if (!MR.CAMPS[f.camp]) f.camp = "ami";
  for (const k of CHAMPS) { const x = f[k]; f[k] = x == null ? clone(gen[k]) : typeof x === "number" ? V(x, "saisie") : Object.assign({fiab:x.v == null ? "inconnu" : "saisie"}, x); }
  f.cibles = Object.assign({}, f.cibles || {}); for (const k in f.cibles) { const x = f.cibles[k]; f.cibles[k] = typeof x === "number" ? V(x, "saisie") : Object.assign({fiab:x && x.v != null ? "saisie" : "inconnu"}, x || {v:null}); }
  r.radars.push(f); }
 if (!Array.isArray(b.radars)) return r;
 for (const f of d.radars) if (!r.radars.some(x => x.id === f.id) && !(b.retirees || []).includes(f.id)) r.radars.push(f);
 return r;
};
// erreurs bloquantes (texte en clair) ; liste vide = bibliothèque utilisable
MR.verifierBib = (b) => { const e = [];
 if (!b || !Array.isArray(b.radars) || !Array.isArray(b.cibles)) return ["la bibliothèque doit contenir « radars » et « cibles »"];
 for (const f of b.radars) { const mx = MR.val(f.portee_max_km), mn = MR.val(f.portee_min_km) || 0, s = MR.val(f.secteur_deg), a = MR.val(f.antenne_m);
  if (!(mx > 0)) e.push(f.nom + " : portée maximale manquante ou nulle");
  if (mn < 0 || (mx > 0 && mn >= mx)) e.push(f.nom + " : portée minimale incohérente");
  if (s != null && !(s > 0 && s <= 360)) e.push(f.nom + " : secteur entre 1 et 360°");
  if (a != null && !(a >= 0 && a < 200)) e.push(f.nom + " : hauteur d'antenne entre 0 et 200 m");
  for (const k in f.cibles || {}) { const v = MR.val(f.cibles[k]); if (v != null && !(v > 0)) e.push(f.nom + " : portée de détection « " + k + " » doit être positive"); if (!b.cibles.some(c => c.id === k)) e.push(f.nom + " : cible « " + k + " » absente de la liste des cibles"); } }
 for (const c of b.cibles) if (!(c.h_m >= 0)) e.push("cible " + c.nom + " : hauteur au-dessus du sol invalide");
 return e; };
MR.fiche = (b, id) => b.radars.find(f => f.id === id) || null;
MR.cible = (b, id) => b.cibles.find(c => c.id === id) || null;

// portées d'un radar pour une cible : null si le radar ne voit pas cette cible ; sinon {min_m, max_m, connue, val (valeur sourcée)}
MR.portees = (f, cibleId) => {
 if (!f || !f.cibles || !(cibleId in f.cibles)) return null;
 const mx = MR.val(f.portee_max_km), pc = MR.val(f.cibles[cibleId]), mn = MR.val(f.portee_min_km) || 0;
 const max = pc == null ? mx : Math.min(pc, mx);
 return {min_m:mn*1000, max_m:max*1000, connue:pc != null, val:f.cibles[cibleId]};
};
// paramètres d'un radar posé (valeurs de la fiche sauf réglage du radar posé)
MR.site = (f, poste, cibleId, c) => { const p = MR.portees(f, cibleId); if (!p) return null;
 const sec = MR.val(f.secteur_deg); return {c, min_m:p.min_m, max_m:p.max_m, connue:p.connue, secteur_deg:sec == null ? 360 : sec,
  orient_deg:+(poste && poste.orient_deg) || 0, antenne_m:poste && poste.antenne_m != null ? +poste.antenne_m : (MR.val(f.antenne_m) || 0)}; };
// surface du secteur idéal (m²) : ce qu'un radar verrait en terrain plat et dégagé, cible comprise
MR.surfaceIdeale = s => Math.PI*(s.max_m*s.max_m - s.min_m*s.min_m)*Math.min(360, s.secteur_deg)/360;
// horizon radar en terrain plat (km), terre à k fois son rayon
MR.horizonKm = (h1, h2, k) => Math.sqrt(2*k*6371000)*(Math.sqrt(Math.max(0, h1)) + Math.sqrt(Math.max(0, h2)))/1000;

/* ---------- balayage : plancher de détection depuis une maille ---------- */
// Rayons tracés depuis le radar (azimut 0 = nord) ; pour chaque point, la cible doit dépasser l'angle maximal des masques déjà
// rencontrés (relief, et forêts et bâti à hauteur forfaitaire dans H). Courbure de la terre à k fois son rayon (4/3 par défaut).
// o : {k, couvert (la cible sous une forêt ou dans du bâti est cachée tant qu'elle ne dépasse pas sa hauteur), grossier, out}
MR.balayage = (Z, s, o) => {
 o = o || {}; const n = Z.n, cell = Z.cell, el = Z.el, H = Z.H || el, C = o.couvert && Z.couv ? Z.couv : null, k = o.k || 4/3;
 const pl = o.out || new Float32Array(n*n); if (o.out) pl.fill(Infinity); else pl.fill(Infinity);
 if (s.c < 0 || s.c >= n*n) return pl;
 const i0 = s.c % n, j0 = (s.c/n) | 0, zr = el[s.c] + s.antenne_m, Rlim = Math.min(s.max_m, cell*n*1.5);
 const nRay = o.nRay || Math.min(o.grossier ? 720 : 1440, Math.max(180, Math.ceil(2*Math.PI*Rlim/cell)));
 const step = o.grossier ? cell : cell*0.7, nd = Math.floor(Rlim/step), kc = 1/(2*k*6371000), sec = Math.min(360, s.secteur_deg || 360), half = sec/2;
 for (let r = 0; r < nRay; r++) {
  const az = r*360/nRay; if (sec < 360) { const d = ((az - s.orient_deg)%360 + 540)%360 - 180; if (Math.abs(d) > half) continue; }
  const t = az*Math.PI/180, sx = Math.sin(t)/cell, sy = -Math.cos(t)/cell; let maxA = -Infinity;
  for (let q = 1; q <= nd; q++) {
   const d = q*step, i = Math.floor(i0 + 0.5 + d*sx), j = Math.floor(j0 + 0.5 + d*sy);
   if (i < 0 || j < 0 || i >= n || j >= n) break;
   const cc = j*n + i; if (cc === s.c) continue;
   const dr = kc*d*d, z = el[cc] - dr - zr; let hm = maxA*d - z;
   if (C && C[cc] > hm) hm = C[cc];
   if (d >= s.min_m) { const h = hm > 0 ? hm : 0; if (h < pl[cc]) pl[cc] = h; }
   const a = (H[cc] - dr - zr)/d; if (a > maxA) maxA = a;
  }
 }
 if (s.min_m <= 0) pl[s.c] = 0;
 return pl;
};
// comble les mailles laissées entre deux rayons (au moins 5 voisines calculées : on prend la plus haute, prudent)
MR.boucher = (pl, n) => { const add = [];
 for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) { const c = j*n + i; if (pl[c] !== Infinity) continue; let m = 0, x = -1;
  for (const v of [pl[c-1], pl[c+1], pl[c-n], pl[c+n], pl[c-n-1], pl[c-n+1], pl[c+n-1], pl[c+n+1]]) if (v !== Infinity) { m++; if (v > x) x = v; }
  if (m >= 5) add.push(c, x); }
 for (let a = 0; a < add.length; a += 2) pl[add[a]] = add[a + 1];
 return pl; };

/* ---------- réseau : couverture cumulée, plancher, trous ---------- */
// planchers : liste de Float32Array (un par radar qui voit la cible) ; h : hauteur de la cible ; ajout : planchers d'emplacements proposés
MR.reseau = (Z, planchers, h, ajout) => {
 const N = Z.n*Z.n, cnt = new Uint8Array(N), plan = new Float32Array(N).fill(Infinity), env = new Uint8Array(N), neuf = new Uint8Array(N);
 for (const p of planchers) for (let c = 0; c < N; c++) { const v = p[c]; if (v === Infinity) continue; env[c] = 1; if (v < plan[c]) plan[c] = v; if (v <= h && cnt[c] < 255) cnt[c]++; }
 for (const p of ajout || []) for (let c = 0; c < N; c++) { const v = p[c]; if (v === Infinity) continue; env[c] = 1; if (v < plan[c]) plan[c] = v; if (v <= h && !cnt[c]) neuf[c] = 1; }
 const a = Z.cell*Z.cell/1e6; let vu = 0, plus = 0, trou = 0, envS = 0;
 for (let c = 0; c < N; c++) { if (cnt[c]) vu++; if (neuf[c]) plus++; if (env[c]) { envS++; if (!cnt[c] && !neuf[c]) trou++; } }
 return {cnt, plancher:plan, env, neuf, vuKm2:vu*a, ajoutKm2:plus*a, trousKm2:trou*a, envKm2:envS*a, zoneKm2:N*a, vuPct:vu/N*100};
};
// trous du réseau : mailles dans la portée d'au moins un radar mais vues par aucun, groupées (8 voisines), les plus grandes d'abord ;
// en mode Ennemi ce sont les zones défilées (plancher_min_m : hauteur sous laquelle une cible passe sans être vue partout dans la zone)
MR.trous = (Z, R, minMailles) => {
 const n = Z.n, N = n*n, lab = new Int32Array(N), out = [], a = Z.cell*Z.cell/1e6, m0 = minMailles || 2;
 for (let s = 0; s < N; s++) { if (!R.env[s] || R.cnt[s] || R.neuf[s] || lab[s]) continue;
  const id = out.length + 1, st = [s]; let nb = 0, si = 0, sj = 0, best = s, bh = -1, bl = Infinity; lab[s] = id;
  while (st.length) { const c = st.pop(), i = c % n, j = (c/n) | 0; nb++; si += i; sj += j; if (R.plancher[c] !== Infinity && R.plancher[c] > bh) { bh = R.plancher[c]; best = c; } if (R.plancher[c] < bl) bl = R.plancher[c];
   for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = i + dx, y = j + dy; if ((dx || dy) && x >= 0 && y >= 0 && x < n && y < n) { const w = y*n + x; if (R.env[w] && !R.cnt[w] && !R.neuf[w] && !lab[w]) { lab[w] = id; st.push(w); } } } }
  out.push({id, mailles:nb, km2:nb*a, centre:Math.round(sj/nb)*n + Math.round(si/nb), pire:best, plancher_max_m:bh, plancher_min_m:bl}); }
 const gros = out.filter(t => t.mailles >= m0).sort((x, y) => y.mailles - x.mailles);
 return {liste:gros, lab, petits:out.length - gros.length};
};

/* ---------- recherche des meilleurs emplacements (algorithme de l'outil Implantation) ---------- */
const pop = x => { x = x - ((x >>> 1) & 0x55555555); x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0F0F0F0F)*0x01010101) >>> 24; };
MR.pop = pop;
MR.bits = (pl, h, n, out) => { const b = out || new Uint32Array((n*n + 31) >> 5); if (out) b.fill(0); for (let c = 0; c < n*n; c++) if (pl[c] <= h) b[c >> 5] |= 1 << (c & 31); return b; };
// emplacements candidats : environ N carrés réguliers ; dans chacun, la maille possible la plus haute (un radar se pose sur un point haut ;
// l'outil Implantation prenait le centre du carré et manquait les sommets étroits). Z.ok : pas en mer, ni en forêt ou dans le bâti.
MR.candidats = (Z, N) => { const n = Z.n, sp = Math.max(2, Math.round(Math.sqrt(n*n/(N || 800)))), out = [];
 for (let j0 = 0; j0 < n; j0 += sp) for (let i0 = 0; i0 < n; i0 += sp) { let b = -1, bz = -Infinity;
  for (let j = j0; j < Math.min(n, j0 + sp); j++) for (let i = i0; i < Math.min(n, i0 + sp); i++) { const c = j*n + i; if ((!Z.ok || Z.ok(c)) && Z.el[c] > bz) { bz = Z.el[c]; b = c; } }
  if (b >= 0) out.push(b); }
 return {cands:Int32Array.from(out), sp}; };
// gabarit : MR.site(...) sans c ; h : hauteur de la cible ; o : {k, couvert, nb (radars à placer), deja (Uint32Array : déjà vu par le réseau), N}
// renvoie {cands, sp, totKm2, gainKm2 (par candidat), tops (5 au plus, affinés : c, gainKm2, totKm2, porteeKm2 = dans la portée et la zone, pct = part vue),
// plan (nb radars, chacun là où il ajoute le plus)}
MR.rechercheEtapes = function* (Z, gabarit, h, o){
 o = o || {}; const n = Z.n, W = (n*n + 31) >> 5, a = Z.cell*Z.cell/1e6, deja = o.deja || new Uint32Array(W);
 const {cands, sp} = MR.candidats(Z, o.N); if (!cands.length) return {cands, sp, totKm2:new Float32Array(0), gainKm2:new Float32Array(0), tops:[], plan:[]};
 const buf = new Float32Array(n*n), bits = new Array(cands.length), tot = new Float32Array(cands.length), gain = new Float32Array(cands.length), opt = {k:o.k, couvert:o.couvert, grossier:true, out:buf};
 let porC = 0;   // mailles de la zone dans la portée et le secteur du dernier emplacement balayé
 const scan = c => { MR.balayage(Z, Object.assign({}, gabarit, {c}), opt); porC = 0; for (let x = 0; x < buf.length; x++) if (buf[x] !== Infinity) porC++; return MR.bits(buf, h, n); };
 const compte = b => { let t = 0, g = 0; for (let w = 0; w < W; w++) { t += pop(b[w]); g += pop(b[w] & ~deja[w]); } return [t*a, g*a]; };
 const por = new Float32Array(cands.length);
 for (let q = 0; q < cands.length; q++) { const b = scan(cands[q]); bits[q] = b; const [t, g] = compte(b); tot[q] = t; gain[q] = g; por[q] = porC*a;
  if ((q & 7) === 7) yield ["évaluation des emplacements (" + (q + 1) + " / " + cands.length + ")", 0.8*(q + 1)/cands.length]; }
 // classement par surface nouvelle, emplacements écartés d'au moins 10 % de la portée, puis affinage autour des 5 meilleurs
 const idx = Array.from(cands.keys()).sort((x, y) => gain[y] - gain[x] || tot[y] - tot[x]), sep = Math.max(2*sp, Math.ceil(0.1*gabarit.max_m/Z.cell)), tops = [];
 for (const q of idx) { if (tops.length >= 5 || gain[q] <= 0) break; const c = cands[q], ci = c % n, cj = (c/n) | 0;
  if (tops.every(t => Math.hypot(t.i - ci, t.j - cj) >= sep)) tops.push({c, i:ci, j:cj, q, gainKm2:gain[q], totKm2:tot[q], porteeKm2:por[q]}); }
 const w = Math.min(4, Math.max(1, Math.ceil(sp/2)));
 for (let t = 0; t < tops.length; t++) { const o1 = tops[t];
  for (let j = Math.max(0, o1.j - w); j <= Math.min(n - 1, o1.j + w); j++) for (let i = Math.max(0, o1.i - w); i <= Math.min(n - 1, o1.i + w); i++) { const c = j*n + i;
   if (c === o1.c || (Z.ok && !Z.ok(c))) continue; const [tt, g] = compte(scan(c)); if (g > o1.gainKm2 || (g === o1.gainKm2 && tt > o1.totKm2)) { o1.c = c; o1.gainKm2 = g; o1.totKm2 = tt; o1.porteeKm2 = porC*a; } }
  yield ["affinage des meilleurs emplacements (" + (t + 1) + " / " + tops.length + ")", 0.8 + 0.15*(t + 1)/tops.length]; }
 // part vue de ce qui est dans la portée et le secteur, à l'intérieur de la zone (la portée peut dépasser la zone)
 for (const t of tops) { t.pct = t.porteeKm2 > 0 ? t.totKm2/t.porteeKm2*100 : 0; delete t.i; delete t.j; delete t.q; }
 tops.sort((x, y) => y.gainKm2 - x.gainKm2 || y.totKm2 - x.totKm2);
 // plan à nb radars : chacun là où il ajoute le plus de surface nouvelle (masques binaires)
 const used = Uint32Array.from(deja), plan = []; let cum = 0;
 for (let s = 0; s < (o.nb || 1); s++) { let bk = -1, bg = 0;
  for (let q = 0; q < bits.length; q++) { let g = 0; const b = bits[q]; for (let x = 0; x < W; x++) g += pop(b[x] & ~used[x]); if (g > bg) { bg = g; bk = q; } }
  if (bk < 0) break; const b = bits[bk]; for (let x = 0; x < W; x++) used[x] |= b[x]; cum += bg*a;
  plan.push({c:cands[bk], gainKm2:bg*a, cumKm2:cum}); yield ["plan à " + (o.nb || 1) + " radars", 0.95 + 0.05*(s + 1)/(o.nb || 1)]; }
 return {cands, sp, totKm2:tot, gainKm2:gain, tops, plan};
};
MR.recherche = (Z, gabarit, h, o) => { const g = MR.rechercheEtapes(Z, gabarit, h, o); let r; while (!(r = g.next()).done); return r.value; };

/* ---------- mode Ennemi (lot 2) : radars ennemis à position incertaine, zones de défilement, itinéraires défilés ---------- */
MR.STATUTS = {repere:"repéré", suppose:"supposé"};
// mailles échantillonnées dans le cercle d'incertitude (rayon r_m autour de la maille c) : le centre, le cercle de rayon r
// (8 à 24 points, environ un toutes les 2 mailles) et, si r ≥ 3 mailles, le cercle de rayon r/2 ; mailles hors zone écartées
MR.pointsIncertitude = (Z, c, r_m) => {
 const n = Z.n, i0 = c % n, j0 = (c/n) | 0, out = [c], vu = new Set([c]);
 if (!(r_m > 0)) return out;
 const anneau = (r, nb) => { for (let q = 0; q < nb; q++) { const a = 2*Math.PI*q/nb, i = Math.round(i0 + r*Math.sin(a)/Z.cell), j = Math.round(j0 - r*Math.cos(a)/Z.cell);
  if (i < 0 || j < 0 || i >= n || j >= n) continue; const w = j*n + i; if (!vu.has(w)) { vu.add(w); out.push(w); } } };
 const nb = Math.max(8, Math.min(24, Math.round(2*Math.PI*r_m/(2*Z.cell))));
 anneau(r_m, nb); if (r_m >= 3*Z.cell) anneau(r_m/2, Math.max(8, nb >> 1));
 return out;
};
// enveloppe PESSIMISTE d'un radar à position incertaine : une maille est vue si elle l'est depuis au moins un des points
// échantillonnés (plancher = le plus bas de tous) ; générateur « yield [texte, avancement] » ; renvoie {pl, pts}
MR.enveloppeEtapes = function* (Z, s, r_m, o){
 const pts = MR.pointsIncertitude(Z, s.c, r_m), out = new Float32Array(Z.n*Z.n).fill(Infinity), buf = new Float32Array(Z.n*Z.n);
 for (let q = 0; q < pts.length; q++) { const pl = MR.boucher(MR.balayage(Z, Object.assign({}, s, {c:pts[q]}), Object.assign({}, o, {out:buf})), Z.n);
  for (let c = 0; c < out.length; c++) if (pl[c] < out[c]) out[c] = pl[c];
  yield ["position incertaine : point " + (q + 1) + " / " + pts.length, (q + 1)/pts.length]; }
 return {pl:out, pts};
};
MR.enveloppe = (Z, s, r_m, o) => { const g = MR.enveloppeEtapes(Z, s, r_m, o); let r; while (!(r = g.next()).done); return r.value; };
// zones de défilement pour la cible choisie, d'après le réseau ennemi R (MR.reseau) : vu, défilé (dans la portée d'au moins
// un radar mais caché par les masques), hors de portée (dans la zone, hors portée ou hors secteur de tous les radars)
MR.defilement = (Z, R) => { const N = Z.n*Z.n, a = Z.cell*Z.cell/1e6; let vu = 0, def = 0, hors = 0;
 for (let c = 0; c < N; c++) { if (R.cnt[c]) vu++; else if (R.env[c]) def++; else hors++; }
 return {vuKm2:vu*a, defileKm2:def*a, horsKm2:hors*a, nonVuKm2:(def + hors)*a, zoneKm2:N*a, nonVuPct:(def + hors)/N*100}; };

/* ---------- itinéraires défilés ---------- */
// Un « graphe » de déplacement : {N (mailles), M (nœuds), voisins(u, cb(w, dt_h, longueur_km, maille_arrivée, ouvrage)), maille(u), ll(u),
// praticable(c), recherche* (sources, cible, mult) → {T, brut, pred, fin}, ouvrage(f) → {id, nom, type} | null, simplifie (bool)}.
// - zone terrain : graphe du moteur terrain (moteur-terrain.js, appelé à l'exécution : G, P, ctxOf, forEachEdge, searchEtapes) : mobilité
//   par arme, routes, cours d'eau, pente, et COUPURES d'ouvrages de la zone (G.coupe) ;
// - grande zone : mobilité SIMPLIFIÉE, relief seul (pente entre mailles voisines, mer exclue) : vitesses et pentes FICTIVES ci-dessous.
MR.MOBILITE_SIMPLE = {
 "_avertissement":"Mobilité simplifiée de la grande zone (relief seul, sans routes, forêts, cours d'eau ni ouvrages) : valeurs FICTIVES, modifiables.",
 "chenille":{"kmh":20, "pente_max_pct":60}, "roue":{"kmh":30, "pente_max_pct":35}, "logistique":{"kmh":25, "pente_max_pct":20}, "fantassin":{"kmh":3, "pente_max_pct":100}
};
// tas binaire (clé, valeur) commun aux recherches de chemin de la grille
function tas(){ const hk = [], hv = [];
 return {get n(){ return hk.length; },
  push(key, val){ hk.push(key); hv.push(val); let i = hk.length - 1; while (i > 0) { const q = (i - 1) >> 1; if (hk[q] <= hk[i]) break; [hk[q], hk[i]] = [hk[i], hk[q]]; [hv[q], hv[i]] = [hv[i], hv[q]]; i = q; } },
  pop(){ const top = hv[0], lk = hk.pop(), lv = hv.pop();
   if (hk.length) { hk[0] = lk; hv[0] = lv; let i = 0; for (;;) { const l = 2*i + 1, r = l + 1; let m = i; if (l < hk.length && hk[l] < hk[m]) m = l; if (r < hk.length && hk[r] < hk[m]) m = r; if (m === i) break; [hk[m], hk[i]] = [hk[i], hk[m]]; [hv[m], hv[i]] = [hv[i], hv[m]]; i = m; } }
   return top; }}; }
// Dijkstra (mêmes conventions que search du moteur terrain avec options : T = coût pondéré par mult[maille d'arrivée], brut = temps réel)
MR.dijkstraEtapes = function* (g, sources, cible, mult, texte){
 const M = g.M, T = new Float64Array(M).fill(Infinity), brut = new Float64Array(M).fill(Infinity), pred = new Int32Array(M).fill(-1), ouv = new Int32Array(M).fill(-1), done = new Uint8Array(M), h = tas();
 for (const s of sources) { T[s] = 0; brut[s] = 0; h.push(0, s); }
 let u, fin = -1, nb = 0;
 const relax = (w, dt, len, c2, f) => { if (done[w]) return; const nt = T[u] + (mult && c2 >= 0 ? dt*mult[c2] : dt); if (nt < T[w]) { T[w] = nt; brut[w] = brut[u] + dt; pred[w] = u; ouv[w] = f; h.push(nt, w); } };
 while (h.n) { u = h.pop(); if (done[u]) continue; done[u] = 1; if (cible && u < g.N && cible[u]) { fin = u; break; } g.voisins(u, relax);
  if (++nb % 4096 === 0) yield [texte || "recherche du chemin", Math.min(1, nb/M)]; }
 return {T, brut, pred, ouvrage:ouv, fin};
};
const NB8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
// grande zone : mobilité simplifiée de l'arme (p = {kmh, pente_max_pct}) ; vitesse pleine jusqu'au tiers de la pente maximale, puis
// décroissance linéaire jusqu'à 0 à la pente maximale ; mailles interdites : !Z.ok (mer)
MR.grapheGrille = (Z, p) => { const n = Z.n, N = n*n, kmh = Math.max(0.1, +p.kmh || 1), pm = Math.max(1, +p.pente_max_pct || 1), p0 = pm/3, ok = Z.ok || (() => true);
 const pas = c => ok(c);
 return {N, M:N, simplifie:true, maille:u => u, praticable:pas,
  ll:u => [Z.b.w + ((u % n) + 0.5)/n*(Z.b.e - Z.b.w), Z.b.n - (((u/n) | 0) + 0.5)/n*(Z.b.n - Z.b.s)],
  voisins(u, cb){ if (!pas(u)) return; const i0 = u % n, j0 = (u/n) | 0;
   for (const [dx, dy] of NB8) { const i = i0 + dx, j = j0 + dy; if (i < 0 || j < 0 || i >= n || j >= n) continue; const w = j*n + i; if (!pas(w)) continue;
    const len = Math.hypot(dx, dy)*Z.cell/1000, s = Math.abs(Z.el[w] - Z.el[u])/(len*1000)*100, f = s <= p0 ? 1 : s >= pm ? 0 : 1 - (s - p0)/(pm - p0);
    if (f < 0.02) continue; cb(w, len/(kmh*f), len, w, -1); } },
  recherche(sources, cible, mult, texte){ return MR.dijkstraEtapes(this, sources, cible, mult, texte); },
  ouvrage:() => null}; };
// zone terrain : graphe du moteur terrain pour l'arme k (globales de moteur-terrain.js, lues à l'appel)
MR.grapheTerrain = k => { const X = ctxOf(k), N = X.N, R = G.R;
 return {N, M:N + R.lon.length, simplifie:false, arme:k,
  maille:u => u < N ? u : R.cell[u - N], ll:u => u < N ? cellLL(u) : [R.lon[u - N], R.lat[u - N]], praticable:c => G.v[k][c] > 0,
  voisins(u, cb){ forEachEdge(u, X, (w, dt, len, c1, c2, f) => cb(w, dt, len, c2, f)); },
  *recherche(sources, cible, mult, texte){ const it = searchEtapes(sources, k, {cible, mult}, texte); let r; while (!(r = it.next()).done) yield r.value; return r.value; },
  ouvrage:f => { const o = f >= 0 && G.feats[f]; return o ? {id:o.id, nom:o.nm || null, type:o.type, etat:G.coupe && G.coupe[f] === 2 ? "dégradé" : null} : null; }}; };
// maille praticable la plus proche (anneaux, au plus rmax mailles) ; -1 sinon
MR.praticableProche = (g, n, c, rmax) => { if (c < 0) return -1; if (g.praticable(c)) return c; const i0 = c % n, j0 = (c/n) | 0;
 for (let r = 1; r <= (rmax || 10); r++) { let best = -1, bd = Infinity;
  for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) { if (i < 0 || j < 0 || i >= n || j >= n || Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== r) continue;
   const d = (i - i0)**2 + (j - j0)**2, w = j*n + i; if (g.praticable(w) && d < bd) { bd = d; best = w; } }
  if (best >= 0) return best; }
 return -1; };
// profil d'un chemin (nœuds du graphe) : longueur, durée, distance et temps sous vue radar (arc vu = maille d'arrivée vue, comme le coût),
// tronçons exposés (arcs vus consécutifs), ouvrages franchis
MR.profilChemin = (g, nodes, vu) => {
 const coords = nodes.map(u => g.ll(u)), vu_n = [0], ouvrages = [], tr = []; let L = 0, T = 0, Lv = 0, Tv = 0, cur = null;
 for (let q = 1; q < nodes.length; q++) { const u = nodes[q - 1], w = nodes[q]; let best = null;
  g.voisins(u, (w2, dt, len, c2, f) => { if (w2 === w && (!best || dt < best.dt)) best = {dt, len, c2, f}; });
  if (!best) throw new Error("chemin incohérent avec le graphe (nœud " + u + " → " + w + ")");
  const v = best.c2 >= 0 && vu && vu[best.c2] ? 1 : 0; L += best.len; T += best.dt*60; vu_n.push(v);
  if (best.f >= 0) { const o = g.ouvrage(best.f); if (o && !ouvrages.some(x => x.id === o.id)) ouvrages.push(o); }
  if (v) { Lv += best.len; Tv += best.dt*60; if (!cur) { cur = {q0:q - 1, q1:q, longueur_km:0, duree_min:0}; tr.push(cur); } cur.q1 = q; cur.longueur_km += best.len; cur.duree_min += best.dt*60; }
  else cur = null; }
 tr.forEach(t => { t.de = coords[t.q0]; t.a = coords[t.q1]; });
 return {coords, vu_n, longueur_km:L, temps_min:T, vu_km:Lv, vu_min:Tv, part_vue:L > 0 ? Lv/L : 0, troncons:tr, ouvrages};
};
// itinéraire le plus rapide (temps seul) et le plus défilé (une minute sous vue radar compte pour « penalite » minutes ; 1 = pénalité nulle)
// entre les mailles a et b ; vu : Uint8Array (N) des mailles vues ; o : {penalite, n (côté de la grille), rmax}. Générateur ; renvoie
// {rapide, defile, identiques, a, b, deplaceA, deplaceB} ou {manque: texte}.
MR.itinerairesEtapes = function* (g, a, b, vu, o){
 o = o || {}; const n = o.n || Math.round(Math.sqrt(g.N)), pen = Math.max(1, +o.penalite || 1);
 const a1 = MR.praticableProche(g, n, a, o.rmax), b1 = MR.praticableProche(g, n, b, o.rmax);
 if (a < 0 || b < 0) return {manque:"Départ ou arrivée hors de la zone."};
 if (a1 < 0) return {manque:"Départ sur un terrain impraticable pour cette arme (rien de praticable à proximité)."};
 if (b1 < 0) return {manque:"Arrivée sur un terrain impraticable pour cette arme (rien de praticable à proximité)."};
 const cible = new Uint8Array(g.N); cible[b1] = 1;
 const sous = function* (gen, a0, da, t){ let r; while (!(r = gen.next()).done) yield [t, a0 + da*r.value[1]]; return r.value; };
 yield ["itinéraire le plus rapide", 0];
 const rr = yield* sous(g.recherche([a1], cible, null, "itinéraire le plus rapide"), 0, 0.45, "itinéraire le plus rapide");
 if (rr.fin < 0) return {manque:"Aucun passage praticable entre le départ et l'arrivée pour cette arme (coupures, cours d'eau, pente)."};
 const mult = new Float32Array(g.N); for (let c = 0; c < g.N; c++) mult[c] = vu && vu[c] ? pen : 1;
 yield ["itinéraire le plus défilé", 0.5];
 const rd = yield* sous(g.recherche([a1], cible, mult, "itinéraire le plus défilé"), 0.5, 0.45, "itinéraire le plus défilé");
 const chemin = r => { const out = []; for (let x = r.fin; x >= 0; x = r.pred[x]) out.push(x); return out.reverse(); };
 const nr = chemin(rr), nd = chemin(rd);
 const it = (nodes, genre) => Object.assign({genre, nom:genre === "rapide" ? "Le plus rapide" : "Le plus défilé", noeuds:nodes}, MR.profilChemin(g, nodes, vu));
 const R = it(nr, "rapide"), D = it(nd, "defile");
 return {rapide:R, defile:D, identiques:nr.length === nd.length && nr.every((x, i) => x === nd[i]), penalite:pen, a:a1, b:b1, deplaceA:a1 !== a, deplaceB:b1 !== b, simplifie:!!g.simplifie};
};
MR.itineraires = (g, a, b, vu, o) => { const it = MR.itinerairesEtapes(g, a, b, vu, o); let r; while (!(r = it.next()).done); return r.value; };
MR.PENALITES = [1, 2, 3, 5, 10, 20, 50, 100];   // curseur « rapidité ↔ discrétion » : une minute sous vue radar compte pour N minutes

/* ---------- mode Contre-batterie (lot 3) : trajectoires vues, positions de tir repérables ---------- */
// Principe : un radar de contre-batterie ne voit pas la pièce ; il voit le projectile en vol au-dessus de son horizon radar et
// remonte la trajectoire. Une trajectoire est vue en un point si la hauteur du projectile au-dessus du sol y dépasse le plancher
// de détection du radar (calculé par MR.balayage pour le type de projectile : portée, secteur, masques). Seule la BRANCHE MONTANTE
// (du départ au sommet) compte : c'est elle qui permet de remonter à la position de tir (la branche descendante donne l'impact).
// Modèle balistique SIMPLIFIÉ : parabole dans le vide (pas de traînée, de vent ni de météo), vitesse initiale « équivalente »
// v0 = √(g × portée maximale) (la parabole sans traînée qui atteint la portée maximale réelle du système : valeur ESTIMÉE),
// altitude de la cible supposée égale à celle de la pièce ; courbure de la terre comptée (le sol « descend » de d²/2R sous la
// trajectoire). Roquettes : même parabole (la phase propulsée n'est pas modélisée).
MR.G = 9.81;
MR.RT = 6371000;
MR.PROJECTILES = {mortier:"obus de mortier", obus:"obus d'artillerie", roquette:"roquette"};
const VS = (v, fiab, src, note) => V(v, fiab, src, note);
MR.SYSTEMES = {
 "_avertissement":"Systèmes de tir : portées de sources ouvertes (lien « src ») ou ESTIMÉES. La trajectoire est une parabole sans traînée dont la vitesse initiale équivalente est calculée pour atteindre la portée maximale : sommet et durée de vol APPROXIMATIFS.",
 "mo120":{"nom":"Mortier 120 mm (MO 120 RT)", "camp":"ami", "projectile":"mortier", "angle":"haut",
  "portee_min_km":EST(1, "portée minimale non relue ; valeur de l'outil"), "portee_max_km":VS(8.1, "moyenne", S.mo120, "obus standard 8 140 m ; 12 850 m avec l'obus à propulsion additionnelle ; site 30 à 85°")},
 "caesar":{"nom":"Obusier 155 mm CAESAR", "camp":"ami", "projectile":"obus", "angle":"bas",
  "portee_min_km":VS(4.5, "forte", S.caesar, "fiche du constructeur"), "portee_max_km":VS(40, "forte", S.caesar, "obus ERFB-BB « plus de 40 km » ; 38,6 à 55 km selon la munition")},
 "lru":{"nom":"Lance-roquettes unitaire (LRU)", "camp":"ami", "projectile":"roquette", "angle":"bas",
  "portee_min_km":VS(15, "forte", S.lru, "« de 15 km à plus de 70 km »"), "portee_max_km":VS(70, "forte", S.lru, "« plus de 70 km »")},
 "sani":{"nom":"Mortier 120 mm 2B11 / 2S12 Sani", "camp":"ennemi", "projectile":"mortier", "angle":"haut",
  "portee_min_km":EST(0.5, "valeur de l'outil"), "portee_max_km":VS(7.1, "faible", S.sani, "valeur couramment citée, page non relue le 13/11/2026 : à vérifier")},
 "msta":{"nom":"Obusier 152 mm 2S19 Msta-S", "camp":"ennemi", "projectile":"obus", "angle":"bas",
  "portee_min_km":EST(4, "valeur de l'outil"), "portee_max_km":VS(24.7, "faible", S.msta, "obus explosif standard ; ≈ 29 km à culot creux (base bleed) ; page non relue le 13/11/2026 : à vérifier")},
 "grad":{"nom":"Lance-roquettes 122 mm BM-21 Grad", "camp":"ennemi", "projectile":"roquette", "angle":"bas",
  "portee_min_km":EST(5, "valeur de l'outil"), "portee_max_km":VS(20.4, "faible", S.grad, "roquette 9M22 ; page non relue le 13/11/2026 : à vérifier")}
};
MR.ANGLES = {bas:"tir tendu (angle bas, < 45°)", haut:"tir courbe (angle haut, > 45°)"};
// vitesse initiale équivalente sans traînée (m/s) pour une portée maximale en km
MR.v0Equivalente = km => Math.sqrt(MR.G*km*1000);
// trajectoire vers une portée R (m) : {theta (rad), vx, vz (m/s), tSommet (s), sommet_m, dSommet_m} ou null si R dépasse v0²/g
MR.trajectoire = (v0, R, angle) => { const s = MR.G*R/(v0*v0); if (!(R > 0) || s > 1) return null;
 let th = Math.asin(s)/2; if (angle === "haut") th = Math.PI/2 - th;
 const vx = v0*Math.cos(th), vz = v0*Math.sin(th), tS = vz/MR.G;
 return {theta:th, site_deg:th*180/Math.PI, vx, vz, tSommet:tS, sommet_m:vz*vz/(2*MR.G), dSommet_m:vx*tS, duree_s:2*tS}; };
MR.CB = {SANS:0, NON:1, PEU:2, VU:3, HORS:4};
// trajectoire depuis la maille c (grille Z) vers l'azimut az (rad) : branche montante échantillonnée tous les dt = maille / v0 (s),
// donc au plus une maille de trajet entre deux points. radars : [{pl (plancher de détection pour le projectile, Float32Array)}].
// Renvoie {tVu (s vus), marge (m : plus petit écart plancher − hauteur là où un radar a le point dans sa portée ; Infinity = jamais
// dans la portée d'un radar ; < 0 = vu), t1, h1, d1 (premier point vu : temps, hauteur au-dessus du sol, distance), qui (indice du
// radar qui voit le premier), sort (points hors de la grille)} ; o.trace = true ajoute pts [{i, j, h, vu, t}].
MR.evaluerTir = (Z, radars, c, traj, az, o) => {
 o = o || {}; const n = Z.n, cell = Z.cell, el = Z.el, i0 = c % n + 0.5, j0 = ((c/n) | 0) + 0.5, sx = Math.sin(az)/cell, sy = -Math.cos(az)/cell, z0 = el[c], k2 = 1/(2*MR.RT);
 const dt = o.dt || cell/Math.hypot(traj.vx, traj.vz), nb = Math.max(1, Math.ceil(traj.tSommet/dt)), nr = radars.length, pts = o.trace ? [] : null;
 let tVu = 0, marge = Infinity, t1 = NaN, h1 = NaN, d1 = NaN, qui = -1, sort = 0;
 for (let q = 1; q <= nb; q++) { const t = Math.min(q*dt, traj.tSommet), d = traj.vx*t, z = traj.vz*t - 0.5*MR.G*t*t;
  const i = Math.floor(i0 + d*sx), j = Math.floor(j0 + d*sy);
  if (i < 0 || j < 0 || i >= n || j >= n) { sort++; if (pts) pts.push({i:i0 + d*sx, j:j0 + d*sy, h:NaN, vu:0, t}); continue; }
  const cc = j*n + i, h = z0 + z + d*d*k2 - el[cc]; let vu = -1;
  for (let r = 0; r < nr; r++) { const p = radars[r].pl[cc]; if (p === Infinity) continue; const m = p - h; if (m < marge) marge = m; if (p <= h && h > 0 && vu < 0) vu = r; }
  if (vu >= 0) { tVu += dt; if (qui < 0) { qui = vu; t1 = t; h1 = h; d1 = d; } }
  if (pts) pts.push({i:i0 + d*sx, j:j0 + d*sy, h, vu:vu >= 0 ? 1 : 0, t}); }
 return {tVu, marge, t1, h1, d1, qui, sort, nb, dt, pts};
};
// Positions de tir candidates = chaque maille (ou une maille sur « pas » si le calcul est trop lourd : le dire). o :
// {v0, angle, portee_min_m, portee_max_m, visee: {type:"point", fi, fj (coordonnées de maille, décimales, hors grille possible)} |
//  {type:"azimut", az_deg, portee_m}, duree_min_s (temps vu minimal pour « repérable »), tir(c) (emplacement possible), budget}
// Classes : 0 sans objet (eau, hors zone), 1 non repérable (jamais vue), 2 peu repérable (vue moins de duree_min_s),
// 3 repérable, 4 objectif hors de portée du système depuis cette position. Générateur « yield [texte, avancement] ».
MR.contreBatterieEtapes = function* (Z, radars, o){
 const n = Z.n, N = n*n, a = Z.cell*Z.cell/1e6, tir = o.tir || (() => true), dmin = o.duree_min_s > 0 ? o.duree_min_s : 0;
 const cls = new Uint8Array(N), tVu = new Float32Array(N).fill(NaN), marge = new Float32Array(N).fill(NaN), qui = new Int8Array(N).fill(-1);
 // charge : positions × points de la branche montante × radars ; au-delà du budget, une maille sur « pas »
 const Rtyp = o.visee.type === "azimut" ? o.visee.portee_m : Math.min(o.portee_max_m, Math.max(Z.cell, n*Z.cell*0.75));
 const tt = MR.trajectoire(o.v0, Math.min(Rtyp, o.v0*o.v0/MR.G), o.angle), pts = tt ? Math.ceil(tt.tSommet*o.v0/Z.cell) : 1;
 const charge = N*pts*Math.max(1, radars.length), budget = o.budget || 4e7, pas = Math.max(1, Math.ceil(Math.sqrt(charge/budget)));
 let tAz = null, azF = 0;
 if (o.visee.type === "azimut") { azF = o.visee.az_deg*Math.PI/180; const R = o.visee.portee_m;
  tAz = R < o.portee_min_m || R > o.portee_max_m ? null : MR.trajectoire(o.v0, R, o.angle); }
 const nbB = Math.ceil(n/pas)**2; let q = 0, eval_ = 0;
 const ev = []; // positions évaluées : [c, classe, tVu, marge, distance à l'objectif]
 for (let jb = 0; jb < n; jb += pas) for (let ib = 0; ib < n; ib += pas) {
  const i = Math.min(n - 1, ib + (pas >> 1)), j = Math.min(n - 1, jb + (pas >> 1)), c = j*n + i; let k = 0, tv = NaN, mg = NaN, w = -1, R = 0;
  if (!tir(c)) k = MR.CB.SANS;
  else { let traj = tAz, az = azF;
   if (o.visee.type === "point") { const dx = (o.visee.fi - (i + 0.5))*Z.cell, dy = (o.visee.fj - (j + 0.5))*Z.cell; R = Math.hypot(dx, dy); az = Math.atan2(dx, -dy);
    traj = R < o.portee_min_m || R > o.portee_max_m ? null : MR.trajectoire(o.v0, R, o.angle); }
   if (!traj) k = MR.CB.HORS;
   else { const r = MR.evaluerTir(Z, radars, c, traj, az); tv = r.tVu; mg = r.marge; w = r.qui; eval_++;
    k = tv <= 0 ? MR.CB.NON : tv < dmin ? MR.CB.PEU : MR.CB.VU; ev.push([c, k, tv, mg, R]); } }
  for (let y = jb; y < Math.min(n, jb + pas); y++) for (let x = ib; x < Math.min(n, ib + pas); x++) { const cc = y*n + x; cls[cc] = k; tVu[cc] = tv; marge[cc] = mg; qui[cc] = w; }
  if ((++q & 1023) === 0) yield ["trajectoires (" + q + " / " + nbB + " positions)", q/nbB]; }
 const km2 = [0, 0, 0, 0, 0]; for (let c = 0; c < N; c++) km2[cls[c]] += a;
 // meilleures positions : jamais vues d'abord, la plus grande marge sous le plancher (au-delà de 1 000 m, équivalentes),
 // puis la plus courte distance à l'objectif ; à défaut, les moins vues. Écartées d'au moins max(1 km, 5 positions).
 const cap = m => isNaN(m) ? -Infinity : Math.min(m, 1000);
 ev.sort((x, y) => (x[1] === MR.CB.NON ? 0 : 1) - (y[1] === MR.CB.NON ? 0 : 1) || (x[1] === MR.CB.NON ? cap(y[3]) - cap(x[3]) : x[2] - y[2] || cap(y[3]) - cap(x[3])) || x[4] - y[4]);
 const sep = Math.max(1000/Z.cell, 5*pas), tops = [];
 for (const e of ev) { if (tops.length >= (o.nbTops || 5)) break; const i = e[0] % n, j = (e[0]/n) | 0;
  if (tops.every(t => Math.hypot(t.c % n - i, ((t.c/n) | 0) - j) >= sep)) tops.push({c:e[0], classe:e[1], tVu:e[2], marge:e[3], distance_m:e[4]}); }
 return {classe:cls, tVu, marge, qui, pas, evaluees:eval_, km2:{sans:km2[0], non:km2[1], peu:km2[2], vu:km2[3], hors:km2[4]}, tops, pointsParTrajectoire:pts};
};
MR.contreBatterie = (Z, radars, o) => { const g = MR.contreBatterieEtapes(Z, radars, o); let r; while (!(r = g.next()).done); return r.value; };
// cible (au sens de la bibliothèque) d'un radar pour un type de projectile : la sienne, à défaut celle des obus d'artillerie
// (signalé), sinon null (ce radar ne voit pas ce projectile)
MR.cibleProjectile = (f, proj) => !f || !f.cibles ? null : proj in f.cibles ? {id:proj, repli:false} : "obus" in f.cibles ? {id:"obus", repli:proj !== "obus"} : null;
// système de tir : valeurs de MR.SYSTEMES, complétées par les saisies (s : {<id>: {portee_min_km, portee_max_km}} → fiabilité « saisie »)
MR.systeme = (id, saisies) => { const b = MR.SYSTEMES[id]; if (!b || id[0] === "_") return null; const f = clone(b); f.id = id; const s = saisies && saisies[id];
 if (s) for (const k of ["portee_min_km", "portee_max_km"]) if (s[k] != null && +s[k] >= 0) f[k] = {v:+s[k], fiab:"saisie", src:b[k].src, note:"saisie (avant : " + b[k].v + " km, " + b[k].fiab + ")"};
 return f; };

/* ---------- empreinte du terrain (même calcul que ME.empreinteTerrain de moteur-ennemi.js) ---------- */
// "e" + FNV-1a 32 bits du JSON de [emprise arrondie à 1e-6°, n, maille_m, paramètres complets, coupures triées, saisies d'eau triées] ;
// src = G (terrain ouvert ; paramètres = P global) ou document « terrain-gtia » v3. withDefaultsTerrain et P : moteur-terrain.js (lus à l'appel).
const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, "0"); };
MR.empreinteTerrain = src => {
 const doc = src && src.format === "terrain-gtia";
 const b = doc ? src.faits.bbox : src.b, n = doc ? src.faits.n : src.n, cell = doc ? src.faits.maille_m : src.cell;
 const par = doc ? withDefaultsTerrain(src.parametres) : P;
 const coup = (src.coupures || []).map(x => [x.ouvrage == null ? null : String(x.ouvrage), x.etat]).sort((a, c) => String(a).localeCompare(String(c)));
 const eau = ((doc ? src.saisies_eau : src.saisiesEau) || []).map(x => [x.troncon, +x.largeur_m > 0 ? +x.largeur_m : null, +x.profondeur_m > 0 ? +x.profondeur_m : null]).sort((a, c) => String(a).localeCompare(String(c)));
 const r6 = v => Math.round(v*1e6)/1e6;
 return "e" + fnv(JSON.stringify([[r6(b.w), r6(b.s), r6(b.e), r6(b.n)], n, cell, par, coup, eau]));
};

/* ---------- export / import au contrat « radars-gtia » v1 (CONTRAT-JSON.md) ---------- */
// tableaux binaires : {type, b64} (octets bruts petit-boutistes en base64, comme le contrat terrain)
const TYPES = {Float32Array, Uint8Array, Int8Array, Int16Array, Uint16Array, Int32Array, Float64Array};
MR.enc = a => { if (a == null) return null; const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = "";
 for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return {type:a.constructor.name, b64:btoa(s)}; };
MR.dec = o => { if (o == null || ArrayBuffer.isView(o)) return o || null; const T = TYPES[o.type]; if (!T) throw new Error("type de tableau inconnu : " + o.type);
 const s = atob(o.b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new T(u.buffer); };
// plancher (m, Float32 avec Infinity) → Uint16 au mètre (65535 = hors portée), et retour
MR.plancherCompact = pl => { const u = new Uint16Array(pl.length); for (let c = 0; c < pl.length; c++) { const v = pl[c]; u[c] = v === Infinity || !(v >= 0) ? 65535 : Math.min(65534, Math.round(v)); } return u; };
MR.plancherLu = u => { const p = new Float32Array(u.length); for (let c = 0; c < u.length; c++) p[c] = u[c] === 65535 ? Infinity : u[c]; return p; };
MR.FORMAT = "radars-gtia"; MR.VERSION = 1;
const ll6 = x => Array.isArray(x) ? [+x[0], +x[1]] : null;
const radarDoc = (r, mg) => { const o = {id:String(r.id), nom:r.nom || "", type:r.type, camp:r.camp === "ennemi" ? "ennemi" : "ami", lonlat:ll6(r.ll), orient_deg:+r.orient_deg || 0, antenne_m:r.antenne_m == null ? null : +r.antenne_m};
 if (mg) o.mgrs = mg(r.ll); if (o.camp === "ennemi") { o.statut = r.statut === "suppose" ? "suppose" : "repere"; o.incertitude_m = Math.max(0, +r.incert_m || 0); } return o; };
const radarLu = (x, camp) => { if (!x || !Array.isArray(x.lonlat) || !x.type) return null;
 const r = {id:String(x.id || ""), type:String(x.type), camp:x.camp === "ennemi" || camp === "ennemi" ? "ennemi" : "ami", ll:[+x.lonlat[0], +x.lonlat[1]], orient_deg:+x.orient_deg || 0, antenne_m:x.antenne_m == null ? null : +x.antenne_m, nom:String(x.nom || "")};
 if (r.camp === "ennemi") { r.statut = x.statut === "suppose" ? "suppose" : "repere"; r.incert_m = Math.max(0, +(x.incertitude_m != null ? x.incertitude_m : x.incert_m) || 0); } return r; };
MR.etatVide = () => ({ami:{radars:[]}, ennemi:{radars:[], itin:{A:null, B:null}}, cb:{vue:"ennemi", ennemi:{radars:[], obj:null}, ami:{radars:[], obj:null}}});
// etat : {nom, date, t, bib, reglages, zone, mode, cible, et, resultats} ; zone = {type:"terrain", terrain:{id, nom, date, empreinte, bbox, n, maille_m}}
// ou {type:"grande", grande:{centre, taille_km, b, n, cell, date, el (Float32Array)}} ; mg (facultatif) : lonlat → MGRS (lecture humaine)
MR.exporter = (etat, mg) => {
 const E = etat.et || MR.etatVide(), z = etat.zone, R = (L, camp) => (L || []).map(r => radarDoc(Object.assign({camp}, r), mg)), pt = x => x ? (mg ? {lonlat:ll6(x), mgrs:mg(x)} : {lonlat:ll6(x)}) : null;
 const doc = {format:MR.FORMAT, version:MR.VERSION, outil:"radars.html", nom:etat.nom || "Radars", date:etat.date || "", t:etat.t || null,
  note:"Travail de l'outil Radars (valeurs de sources ouvertes ou estimées, voir la bibliothèque). Les résultats servent aux autres outils et à la traçabilité : ils sont recalculés à l'ouverture.",
  zone:z.type === "terrain" ? {type:"terrain", terrain:Object.assign({}, z.terrain)}
   : {type:"grande", grande:{centre:ll6(z.grande.centre), taille_km:+z.grande.taille_km, bbox:Object.assign({}, z.grande.b), n:z.grande.n, maille_m:z.grande.cell, date:z.grande.date || "",
     source:"relief mondial (tuiles Terrarium, environ 30 m), altitude par maille", relief_m:MR.enc(Float32Array.from(z.grande.el))}},
  masques:{type:z.type === "terrain" ? "relief, forêts et bâti à hauteur forfaitaire" : "relief seul", refraction_k:etat.reglages.refraction_k,
   hauteur_foret_m:z.type === "terrain" ? etat.reglages.hauteur_foret_m : null, hauteur_bati_m:z.type === "terrain" ? etat.reglages.hauteur_bati_m : null, cible_sous_couvert:z.type === "terrain" ? !!etat.reglages.couvert : null},
  mode:etat.mode || "ami", cible:etat.cible || null,
  bibliotheque:etat.bib, reglages:etat.reglages,
  reseaux:{ami:{radars:R(E.ami.radars, "ami")},
   ennemi:{radars:R(E.ennemi.radars, "ennemi"), itineraire:{depart:pt(E.ennemi.itin && E.ennemi.itin.A), arrivee:pt(E.ennemi.itin && E.ennemi.itin.B)}},
   contre_batterie:{vue:E.cb.vue === "ami" ? "ami" : "ennemi", ennemi:{radars:R(E.cb.ennemi.radars, "ennemi"), objectif:pt(E.cb.ennemi.obj)}, ami:{radars:R(E.cb.ami.radars, "ami"), objectif:pt(E.cb.ami.obj)}}},
  resultats:etat.resultats || null};
 return doc;
};
// lit un document « radars-gtia » v1, ou un ancien export « implantation-gtia » v1 (mode radar : outil Radars des lots 1 et 2, ou
// ancien mode Radars d'Implantation) migré. Renvoie {etat:{nom, bib, reglages, zone, mode, cible, et}, avert:[texte], migre}.
MR.importer = doc => {
 if (!doc || typeof doc !== "object") throw new Error("fichier illisible");
 if (doc.format === "implantation-gtia") return MR.migrerImplantation(doc);
 if (doc.format !== MR.FORMAT) throw new Error("ce n'est pas un fichier de l'outil Radars (format « " + (doc.format || "?") + " »)");
 if (!(doc.version <= MR.VERSION)) throw new Error("fichier de version " + doc.version + " : version " + MR.VERSION + " au plus");
 const avert = [], z = doc.zone || {}; let zone;
 if (z.type === "terrain" && z.terrain) zone = {type:"terrain", terrain:Object.assign({}, z.terrain)};
 else if (z.type === "grande" && z.grande) { const g = z.grande, el16 = MR.dec(g.relief_m);   // Float32 (Int16 au mètre accepté)
  if (!g.bbox || !(g.n > 0) || !el16 || el16.length !== g.n*g.n) throw new Error("grande zone : relief absent ou incomplet");
  zone = {type:"grande", grande:{centre:ll6(g.centre), taille_km:+g.taille_km, b:Object.assign({}, g.bbox), n:g.n, cell:+g.maille_m, date:g.date || "", el:Float32Array.from(el16)}}; }
 else throw new Error("zone absente ou inconnue");
 const et = MR.etatVide(), rs = doc.reseaux || {}, lis = (L, camp) => (L || []).map(x => radarLu(x, camp)).filter(Boolean), pt = x => x && Array.isArray(x.lonlat) ? [+x.lonlat[0], +x.lonlat[1]] : null;
 et.ami.radars = lis(rs.ami && rs.ami.radars, "ami");
 et.ennemi.radars = lis(rs.ennemi && rs.ennemi.radars, "ennemi");
 const it = rs.ennemi && rs.ennemi.itineraire; et.ennemi.itin = {A:pt(it && it.depart), B:pt(it && it.arrivee)};
 const cb = rs.contre_batterie || {}; et.cb.vue = cb.vue === "ami" ? "ami" : "ennemi";
 for (const v of ["ennemi", "ami"]) { et.cb[v].radars = lis(cb[v] && cb[v].radars, v); et.cb[v].obj = pt(cb[v] && cb[v].objectif); }
 const bib = MR.completerBib(doc.bibliotheque || null), eb = MR.verifierBib(bib);
 if (eb.length) { avert.push("bibliothèque du fichier refusée (" + eb.join(" ; ") + ") : bibliothèque d'origine utilisée"); }
 return {etat:{nom:doc.nom || "", date:doc.date || "", bib:eb.length ? MR.completerBib(null) : bib, reglages:doc.reglages || {}, zone, mode:MR.MODES[doc.mode] ? doc.mode : "ami", cible:doc.cible || null, et},
  avert, migre:false, resultats:doc.resultats || null};
};
// migration des anciens exports « implantation-gtia » v1 (mode radar) :
// - outil Radars des lots 1 et 2 (outil = "radars.html", mode radar ou radar-ennemi) : réseau posé (type, position, orientation, antenne,
//   statut, incertitude), cible, réglages, départ et arrivée d'itinéraire ; zone : terrain désigné par son NOM seulement (pas d'identifiant),
//   grande zone sans relief (recentrée sur les radars : à recharger) ;
// - ancien mode Radars d'Implantation (mode radar, sans réseau posé) : centre et taille de la grande zone ; le meilleur emplacement de chaque
//   radar comparé devient un radar « générique » posé (à régler), le relief est à recharger.
MR.migrerImplantation = doc => {
 if (doc.version !== 1) throw new Error("implantation-gtia version " + doc.version + " inconnue");
 if (!/^radar/.test(doc.mode || "")) throw new Error("fichier Implantation du mode « " + (doc.mode || "?") + " » : seuls les fichiers radars se rouvrent ici");
 const et = MR.etatVide(), avert = [], reg = doc.reglages || {};
 if (doc.outil === "radars.html") {
  const enn = doc.mode === "radar-ennemi", L = (doc.reseau || []).map(x => radarLu({type:x.type, lonlat:x.lonlat, orient_deg:x.orient_deg, antenne_m:x.antenne_m, statut:x.statut, incertitude_m:x.incertitude_m, nom:""}, enn ? "ennemi" : "ami")).filter(Boolean);
  L.forEach((r, i) => r.id = "r" + (i + 1));
  if (enn) { et.ennemi.radars = L; const it = doc.itineraires; et.ennemi.itin = {A:it && it.depart ? ll6(it.depart.lonlat) : null, B:it && it.arrivee ? ll6(it.arrivee.lonlat) : null}; }
  else et.ami.radars = L;
  const zt = doc.zone || {}; let zone;
  if (zt.type === "terrain") { zone = {type:"terrain", terrain:{id:null, nom:zt.nom || "", maille_m:zt.maille_m || null}}; avert.push("ancien fichier : la zone terrain n'est désignée que par son nom (« " + (zt.nom || "?") + " »), sans empreinte"); }
  else { const xs = L.map(r => r.ll[0]), ys = L.map(r => r.ll[1]), c = L.length ? [xs.reduce((a, b) => a + b)/L.length, ys.reduce((a, b) => a + b)/L.length] : null;
   zone = {type:"grande", grande:{centre:c, taille_km:+reg.taille_km || 200, b:null, n:200, cell:null, date:"", el:null}};
   avert.push("ancien fichier : relief de la grande zone non inclus, à recharger (centré sur les radars du fichier, " + (+reg.taille_km || 200) + " km)"); }
  return {etat:{nom:"Ancien fichier Radars (" + (doc.date || "") + ")", date:doc.date || "", bib:MR.completerBib(null), reglages:reg, zone, mode:enn ? "ennemi" : "ami", cible:doc.cible && doc.cible.id || reg.cible || null, et}, avert, migre:true, resultats:null};
 }
 // ancien mode Radars d'Implantation
 const rel = doc.relief || {}, L = [];
 (doc.radars || []).forEach((x, q) => { const a0 = (x.altitudes || [])[0], e = a0 && (a0.emplacements || [])[0]; if (!e || !Array.isArray(e.lonlat)) return;
  L.push({id:"r" + (L.length + 1), type:"generique", camp:"ami", ll:ll6(e.lonlat), orient_deg:0, antenne_m:reg.antenne_m != null ? +reg.antenne_m : null, nom:String(x.radar || "radar " + (q + 1)) + " (ancien fichier)"}); });
 et.ami.radars = L;
 avert.push("ancien fichier Implantation : le meilleur emplacement de chaque radar comparé est posé comme radar « Générique » (portées à régler dans la bibliothèque) ; relief à recharger");
 return {etat:{nom:"Ancien fichier Implantation (" + (doc.date || "") + ")", date:doc.date || "", bib:MR.completerBib(null), reglages:{taille_km:+rel.taille_km || 200},
  zone:{type:"grande", grande:{centre:ll6(rel.centre), taille_km:+rel.taille_km || 200, b:null, n:200, cell:null, date:"", el:null}}, mode:"ami", cible:null, et}, avert, migre:true, resultats:null};
};

/* ---------- plancher : classes de la légende (m) ---------- */
MR.CLASSES_PLANCHER = [10, 30, 100, 300, 1000, 3000];
MR.classePlancher = v => { const B = MR.CLASSES_PLANCHER; for (let i = 0; i < B.length; i++) if (v <= B[i]) return i; return B.length; };
return MR;
})();
if (typeof module !== "undefined" && module.exports) module.exports = {MR};
