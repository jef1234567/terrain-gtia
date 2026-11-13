/* moteur-radar.js – calculs de l'outil Radars (radars.html). Lot 1 du 13/11/2026.
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
     orient_deg (azimut du milieu du secteur, depuis le nord, sens horaire), antenne_m (null = valeur de la fiche), nom}.
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
/* modes de l'outil : seul « ami » est actif au lot 1 ; la structure (radars posés par camp) sert aux lots 2 et 3 */
MR.MODES = {
 ami:{nom:"Ami", actif:true, texte:"Notre réseau de radars : couverture, trous, meilleurs emplacements."},
 ennemi:{nom:"Ennemi", actif:false, lot:2, texte:"À venir (lot 2) : radars ennemis posés, zones et itinéraires défilés (hors de leur vue)."},
 cb:{nom:"Contre-batterie", actif:false, lot:3, texte:"À venir (lot 3) : radars de contre-batterie, trajectoires vues, export."}
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
 nebo:"https://cmano-db.com/facility/1849/"
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
  {"id":"obus", "nom":"Obus (contre-batterie)", "h_m":300, "note":"hauteur de la partie de trajectoire à voir au-dessus des masques (estimé, à remplacer au lot 3 par la trajectoire)"}
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
   "cibles":{"obus":V(40, "moyenne", S.cobraDA, "artillerie et roquettes ; mortiers à plus courte distance (non chiffrée)")}},
  {"id":"giraffe1x", "nom":"Giraffe 1X (défense sol-air basse couche)", "role":"dsa", "camp":"ami", "niveau":"GTIA et au-dessus",
   "note":"Saab, bande X, sur véhicule Scania ; 16 commandés par la DGA (8 en déc. 2025, 8 en avr. 2026) pour la défense sol-air d'accompagnement de l'armée de Terre ; détecte « de la micro-drone à l'avion de combat », mode contre-roquettes et obus (C-RAM).",
   "portee_min_km":INC("non publiée"), "portee_max_km":V(75, "moyenne", S.girAT, "portée instrumentée"), "secteur_deg":V(360, "forte", S.girDGA),
   "antenne_m":EST(4, "sur véhicule, hauteur non publiée"),
   "cibles":{"drone50":INC("portée non publiée (" + S.girDGA + ")"), "drone150":INC("portée non publiée"), "aeronef":INC("portée non publiée"), "obus":INC("mode C-RAM, portée non publiée")}},
  {"id":"gm400a", "nom":"GM400α (surveillance aérienne longue portée)", "role":"air", "camp":"ami", "niveau":"armée de l'Air et de l'Espace : PAS un radar de niveau GTIA",
   "note":"Thales. Plafond 30 500 m (Wikipédia) ; GM400 de base 470 km. La France a 15 GM400 (Wikipédia). Donné pour comparaison : ce n'est pas un moyen du GTIA.",
   "portee_min_km":INC("non publiée"), "portee_max_km":V(515, "moyenne", S.gmEDR, "portée instrumentée du GM400α"), "secteur_deg":EST(360, "antenne tournante"),
   "antenne_m":EST(6, "hauteur non publiée"),
   "cibles":{"drone50":INC("drones tactiques à basse altitude suivis, portée non publiée"), "drone150":INC("portée non publiée"), "aeronef":INC("portée non publiée")}},
  {"id":"generique", "nom":"Générique (paramétrable)", "role":"sol", "camp":"ami", "niveau":"à régler",
   "note":"Radar fictif dont toutes les valeurs sont à régler : point de départ pour un radar absent de la bibliothèque.",
   "portee_min_km":EST(0.1), "portee_max_km":EST(20), "secteur_deg":EST(360), "antenne_m":EST(5),
   "cibles":{"pieton":EST(8), "vehicule":EST(15), "drone50":EST(10), "drone150":EST(20), "aeronef":EST(20), "obus":EST(15)}},
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
   "cibles":{"pieton":V(20, "moyenne", S.aist, "« cibles terrestres mobiles » : pas de valeur séparée pour le piéton"), "vehicule":V(20, "moyenne", S.aist), "obus":V(5, "moyenne", S.aist, "positions de mortiers jusqu'à 5 km")}},
  {"id":"zoopark", "nom":"Zoopark-1 / 1M (1L219 / 1L260)", "role":"cb", "camp":"ennemi", "niveau":"brigade, artillerie",
   "note":"Contre-batterie russe sur châssis chenillé. Chiffres du Zoopark-1 ; ceux du 1M ne sont pas publiés. Les sources divergent : Wikipédia (mortier 20, artillerie 30, roquettes 50, cibles terrestres 40 km) et Army Recognition (mortier 13 à 17, artillerie 12, roquettes 22 km).",
   "portee_min_km":INC("non publiée"), "portee_max_km":V(50, "faible", S.zooW, "roquettes ; 22 km selon Army Recognition"), "secteur_deg":V(60, "moyenne", S.zooAR, "40 à 60°"),
   "antenne_m":EST(4, "antenne levée sur le toit"),
   "cibles":{"obus":V(30, "faible", S.zooW, "obus d'artillerie ; 12 km selon " + S.zooAR), "vehicule":V(40, "faible", S.zooW, "cibles terrestres mobiles")}},
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
// trous du réseau : mailles dans la portée d'au moins un radar mais vues par aucun, groupées (8 voisines), les plus grandes d'abord
MR.trous = (Z, R, minMailles) => {
 const n = Z.n, N = n*n, lab = new Int32Array(N), out = [], a = Z.cell*Z.cell/1e6, m0 = minMailles || 2;
 for (let s = 0; s < N; s++) { if (!R.env[s] || R.cnt[s] || R.neuf[s] || lab[s]) continue;
  const id = out.length + 1, st = [s]; let nb = 0, si = 0, sj = 0, best = s, bh = -1; lab[s] = id;
  while (st.length) { const c = st.pop(), i = c % n, j = (c/n) | 0; nb++; si += i; sj += j; if (R.plancher[c] !== Infinity && R.plancher[c] > bh) { bh = R.plancher[c]; best = c; }
   for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = i + dx, y = j + dy; if ((dx || dy) && x >= 0 && y >= 0 && x < n && y < n) { const w = y*n + x; if (R.env[w] && !R.cnt[w] && !R.neuf[w] && !lab[w]) { lab[w] = id; st.push(w); } } } }
  out.push({id, mailles:nb, km2:nb*a, centre:Math.round(sj/nb)*n + Math.round(si/nb), pire:best, plancher_max_m:bh}); }
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

/* ---------- plancher : classes de la légende (m) ---------- */
MR.CLASSES_PLANCHER = [10, 30, 100, 300, 1000, 3000];
MR.classePlancher = v => { const B = MR.CLASSES_PLANCHER; for (let i = 0; i < B.length; i++) if (v <= B[i]) return i; return B.length; };
return MR;
})();
if (typeof module !== "undefined" && module.exports) module.exports = {MR};
