/* rendu-ennemi.js – affichage sur la carte et export KML de l'outil Ennemi (ennemi.html). LOT B.
   Ne calcule rien : dessine les résultats de moteur-ennemi.js (ME) sur une carte MapLibre, et les exporte en KML (CG.kml).
   Tout est rangé dans l'objet RE. Coordonnées affichées en MGRS seul (CG.mgrs). Pas de GPS.

   ÉTAT AU 12/11/2026 (étape 0) : signatures posées, corps minimal (RE.init crée les sources vides, les autres
   fonctions mettent à jour ces sources ou ne font rien). À écrire par le lot B.

   Couleurs imposées (identiques à rendu-terrain.js) : NO-GO rouge, SLOW-GO orange, GO vert, eau bleue (RE.COULEURS).

   SIGNATURES
   RE.init(map) : crée les sources et couches (vides) de l'outil, dans l'ordre d'empilement RE.COUCHES. À appeler
     dans CG.quandPret(map, …). Idempotent.
   RE.terrain(map, G, classe, opts) : fond de mobilité de la classe (G.cls[classe] : 0 eau, 1 NO-GO, 2 SLOW-GO, 3 GO),
     opts {opacite, visible}.
   RE.axes(map, axes, opts) : axes de ME.axes (trait par plausibilité), opts {choisi:genre, unite:id}.
   RE.horaires(map, horaires, opts) : jalons et ouvrages datés (étiquettes « hh:mm ± incertitude »).
   RE.colonne(map, position) : position de la colonne (ME.positionSurAxe) ; null efface.
   RE.isochrones(map, iso, G, opts) : courbes ou aplats des délais (ME.isochrones), opts {delais, unite}.
   RE.presence(map, presence, G, opts) : carte de présence probable (ME.presence.Q) et zones à survoler.
   RE.regroupements(map, zones) : zones de regroupement (ME.zonesRegroupement).
   RE.saisies(map, etat) : départs, objectifs, nos positions, contacts (une couleur par unité, heure en étiquette).
   RE.effacer(map, couches?) : vide les couches nommées (toutes par défaut).
   RE.kml(etat, resultats, opts) → texte KML (dossiers : unités, axes, horaires, isochrones, présence, regroupements,
     contacts, nos positions), via CG.kml ; descriptions en MGRS. opts {titre, note}.
   RE.legende(etat, couchesVisibles) → HTML de la légende (seules les couches visibles). */
"use strict";
const RE = {};
RE.COULEURS = {nogo:"#c8282d", slowgo:"#eb8c1e", go:"#2ea043", eau:"#1e5ac8"};   // = COL de rendu-terrain.js
RE.COUCHES = ["en-terrain", "en-presence", "en-iso", "en-regroup", "en-axes", "en-horaires", "en-colonne", "en-saisies"];
const _FC0 = () => ({type:"FeatureCollection", features:[]});

RE.init = map => {
 for (const id of RE.COUCHES) { if (id === "en-terrain" || id === "en-presence" || map.getSource(id)) continue;
  map.addSource(id, {type:"geojson", data:_FC0()});
  const ligne = id === "en-axes" || id === "en-iso" || id === "en-colonne";
  map.addLayer(ligne ? {id, type:"line", source:id, paint:{"line-color":["coalesce", ["get", "couleur"], "#6a1b9a"], "line-width":3}}
   : id === "en-regroup" ? {id, type:"fill", source:id, paint:{"fill-color":"#6a1b9a", "fill-opacity":0.2}}
   : {id, type:"circle", source:id, paint:{"circle-radius":5, "circle-color":["coalesce", ["get", "couleur"], "#b3261e"], "circle-stroke-color":"#fff", "circle-stroke-width":1.5}}); }
};
const _maj = (map, id, fc) => { const s = map.getSource && map.getSource(id); if (s) s.setData(fc || _FC0()); };
RE.terrain = (map, G, classe, opts) => {};
RE.axes = (map, axes, opts) => _maj(map, "en-axes");
RE.horaires = (map, horaires, opts) => _maj(map, "en-horaires");
RE.colonne = (map, position) => _maj(map, "en-colonne");
RE.isochrones = (map, iso, G, opts) => _maj(map, "en-iso");
RE.presence = (map, presence, G, opts) => {};
RE.regroupements = (map, zones) => _maj(map, "en-regroup");
RE.saisies = (map, etat) => _maj(map, "en-saisies");
RE.effacer = (map, couches) => (couches || RE.COUCHES).forEach(id => _maj(map, id));
RE.kml = (etat, resultats, opts) => CG.kml((opts && opts.titre) || "Ennemi", [], (opts && opts.note) || "Outil Ennemi GTIA, démonstrateur, doctrine fictive.");
RE.legende = (etat, couchesVisibles) => "";
