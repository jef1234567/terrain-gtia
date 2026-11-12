/* moteur-ennemi.js – calculs de l'outil Ennemi (ennemi.html, modes Planification et Conduite). LOT A.
   Pas d'accès au DOM ni à la carte : chargeable sous Node (tests/ennemi.js) comme dans la page.
   Dépend, à l'appel seulement, de moteur-terrain.js (G, P, ARMS, search avec options, cheminVers, cellAt, cellLL,
   distM, chamfer, viewshed, surfaceHeights, withDefaultsTerrain) et de doctrine.js (DOCTRINE, completerDoctrine).
   L'outil Ennemi NE COUPE RIEN : il subit les coupures et saisies du terrain chargé (G.coupe, P).
   Tout est rangé dans l'objet ME. Format d'échange : CONTRAT-JSON.md, « Export ennemi-gtia v3 ».

   ÉTAT AU 12/11/2026 (étape 0) : signatures posées. Implémentés : ME.classes, ME.uniteType, ME.uniteDepuisType,
   ME.vitesseFrac, ME.niveau, ME.empreinteTerrain, ME.referenceTerrain. Les autres renvoient un résultat vide
   marqué {a_faire:true} ou [] (à écrire par le lot A).

   Conventions
   - lonlat : [lon, lat] WGS84 (stockage) ; affichage en MGRS seul (CG.mgrs, côté page).
   - heures : minutes depuis minuit (nombre ; « hh:mm » seulement à l'affichage et dans le fichier).
   - classe : une des ARMS = DOCTRINE_CLASSES (chenille, roue, logistique, fantassin).
   - mode : un des DOCTRINE_MODES (attaque, reco, repli, marche).
   - doctrine : objet complet (completerDoctrine(surcharge)) ; paramètre facultatif, défaut = DOCTRINE.
   - unite : {id, nom, unite_type (id dans doctrine.unites_types), classe, echelon, elements, front_km, prof_km, dispersion_min}
     (voir ME.uniteDepuisType) ; en planification + {depart:lonlat, objectifs:[lonlat], heure_depart_min, mode} ;
     en conduite + {en_mouvement:bool, mode}.
   - contact : {id, unite:id d'unité, lonlat, heure_min, elements_vus}. Une même unité peut avoir plusieurs contacts
     à des heures différentes : le plus récent compte le plus, les plus anciens restent des contraintes.
   - ouvrage : désigné par son id_ouvrage (G.feats[f].id, ex. « pont:n123 »), jamais par son indice.

   SIGNATURES (lot A)
   ME.axes(unite, opts) → [axe]
     opts : {doctrine, mode, amis:[lonlat], nb_max:3}. Départ unite.depart, objectifs unite.objectifs.
     axe : {genre:"rapide"|"sur"|"variante", nom, plausibilite:"forte"|"moyenne"|"faible", noeuds:[nœud moteur],
            coords:[lonlat], dn:[km cumulés], tn:[min cumulées à vitesse tactique], longueur_km, temps_min,
            ouvrages:[id_ouvrage], goulets:[id_ouvrage], part_exposee (0-1), part_couvert (0-1)}
     Utilise search(sources, classe, {mult, cible}) et cheminVers (moteur-terrain.js) : plus de Dijkstra recopié.
   ME.horaires(axe, unite, opts) → {jalons:[jalon], troncons:[troncon]}
     opts : {doctrine, heure_depart_min}.
     jalon : {nom, id_ouvrage|null, lonlat, distance_km, t_min (depuis le départ), heure_min, incertitude_min, expose, goulet}
     troncon : {de (nom du jalon), a, longueur_km, duree_min, heure_entree_min, heure_sortie_min, ouvrages:[id_ouvrage]}
   ME.positionSurAxe(axe, unite, t_min) → {tete:lonlat, queue:lonlat, d_tete_km, d_queue_km, trace:[lonlat]} | null
   ME.isochrones(contacts, unites, t_min, opts) → {arrivee_min: Float32Array (N, heure d'arrivée au plus tôt, Infinity
     si inatteignable), atteint: Uint8Array (N, 1 si atteignable à t_min), delais:[min], par_unite:{id: Float32Array}}
     opts : {doctrine, delais (défaut doctrine.isochrones_min.conduite)}. Multi-contacts : search(cellules, classe, {t0})
     avec t0 = heures des contacts (départs décalés), par unité puis minimum.
   ME.presence(unites, contacts, t_min, opts) → {Q: Float32Array (N), total, par_unite:{id:{Q, total}}, zones:[zone]}
     opts : {doctrine, axes_prevus:{id_unite:[axe]}, amis:[lonlat], observations:[{lonlat, heure_min}]}
     zone (à survoler) : {rang, lonlat, rayon_m, niveau, part_pct, elements_attendus, distance_contact_km, delai_min, pourquoi:[texte]}
   ME.zonesRegroupement(unite, opts) → [zoneR]
     opts : {doctrine, mode, objectif:lonlat (défaut unite.objectifs[0]), amis:[lonlat], nb_max:5}
     zoneR : {centre:lonlat, mailles:[indice], surface_km2, couvert (0-1), distance_objectif_km, vue (bool), duree_min, niveau}
   ME.exporter(etat, opts) → objet « ennemi-gtia » v3 (CONTRAT-JSON.md). etat : {nom, planification, conduite,
     nos_positions, doctrine_surcharge} ; opts : {resultats:bool}. Référence terrain = ME.referenceTerrain().
   ME.importer(o) → {etat, reference, avertissements:[texte]} ; accepte ennemi-gtia v3 et, via ME.migrer,
     ennemi-prepa-gtia v1 et ennemi-conduite-gtia v1.
   ME.migrer(o) → objet ennemi-gtia v3 (meca/moto/pied → chenille/roue/fantassin ; terrain inclus → référence,
     le terrain inclus est rendu à part : {document, terrain} pour que l'interface puisse l'enregistrer).

   IMPLÉMENTÉS
   ME.classes() → DOCTRINE_CLASSES
   ME.uniteType(id, doctrine) → unité type | null
   ME.uniteDepuisType(id, doctrine, extra) → unite (copie de l'unité type, champs extra ajoutés)
   ME.vitesseFrac(classe, mode, doctrine) → fraction (0,05 à 1) de la vitesse du moteur terrain
   ME.niveau(part_pct, doctrine) → "forte" | "moyenne" | "faible"
   ME.empreinteTerrain(source) → texte « e » + 8 chiffres hexadécimaux ; source = G (terrain ouvert, avec P) ou
     document terrain-gtia v3. Couvre emprise, grille, paramètres complets, coupures et saisies d'eau.
   ME.referenceTerrain() → {id, nom, date, empreinte, bbox, n, maille_m} du terrain ouvert (G). */
"use strict";
const ME = {};
const _doc = d => d || (typeof DOCTRINE !== "undefined" ? DOCTRINE : null);

/* ---------- implémentés ---------- */
ME.classes = () => DOCTRINE_CLASSES.slice();
ME.uniteType = (id, doctrine) => (_doc(doctrine).unites_types || []).find(u => u.id === id) || null;
ME.uniteDepuisType = (id, doctrine, extra) => { const t = ME.uniteType(id, doctrine); if (!t) return null;
 const u = JSON.parse(JSON.stringify(t)); u.unite_type = t.id; delete u.id; return Object.assign(u, extra || {}); };
ME.vitesseFrac = (classe, mode, doctrine) => { const v = ((_doc(doctrine).vitesses_pct || {})[classe] || {})[mode || "attaque"];
 return Math.min(1, Math.max(0.05, (+v || 50)/100)); };
ME.niveau = (part_pct, doctrine) => { const s = _doc(doctrine).seuils; return part_pct >= s.forte_pct ? "forte" : part_pct >= s.moyenne_pct ? "moyenne" : "faible"; };

// FNV-1a 32 bits
const _fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, "0"); };
ME.empreinteTerrain = src => {
 const doc = src && src.format === "terrain-gtia";
 const b = doc ? src.faits.bbox : src.b, n = doc ? src.faits.n : src.n, cell = doc ? src.faits.maille_m : src.cell;
 const par = doc ? withDefaultsTerrain(src.parametres) : P;
 const coup = (src.coupures || []).map(x => [x.ouvrage == null ? null : String(x.ouvrage), x.etat]).sort((a, c) => String(a).localeCompare(String(c)));
 const eau = ((doc ? src.saisies_eau : src.saisiesEau) || []).map(x => [x.troncon, +x.largeur_m > 0 ? +x.largeur_m : null, +x.profondeur_m > 0 ? +x.profondeur_m : null])
  .sort((a, c) => String(a).localeCompare(String(c)));
 const r6 = v => Math.round(v*1e6)/1e6;
 return "e" + _fnv(JSON.stringify([[r6(b.w), r6(b.s), r6(b.e), r6(b.n)], n, cell, par, coup, eau]));
};
ME.referenceTerrain = () => ({id:G.id, nom:G.nom, date:G.date, empreinte:ME.empreinteTerrain(G),
 bbox:{w:G.b.w, e:G.b.e, s:G.b.s, n:G.b.n}, n:G.n, maille_m:G.cell});

/* ---------- à écrire (lot A) : corps minimal ---------- */
ME.axes = (unite, opts) => [];
ME.horaires = (axe, unite, opts) => ({jalons:[], troncons:[]});
ME.positionSurAxe = (axe, unite, t_min) => null;
ME.isochrones = (contacts, unites, t_min, opts) => ({a_faire:true, arrivee_min:null, atteint:null, delais:(opts && opts.delais) || _doc(opts && opts.doctrine).isochrones_min.conduite.slice(), par_unite:{}});
ME.presence = (unites, contacts, t_min, opts) => ({a_faire:true, Q:null, total:0, par_unite:{}, zones:[]});
ME.zonesRegroupement = (unite, opts) => [];
ME.exporter = (etat, opts) => ({format:"ennemi-gtia", version:3, a_faire:true, terrain:ME.referenceTerrain()});
ME.importer = o => ({a_faire:true, etat:null, reference:o && o.terrain || null, avertissements:["import non encore écrit (lot A)"]});
ME.migrer = o => ({a_faire:true, document:null, terrain:null});

if (typeof module !== "undefined" && module.exports) module.exports = {ME};
