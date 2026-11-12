/* moteur-ennemi.js – calculs de l'outil Ennemi (ennemi.html, modes Planification et Conduite). LOT A.
   Pas d'accès au DOM ni à la carte : chargeable sous Node (tests/ennemi.js) comme dans la page.
   Dépend, à l'appel seulement, de moteur-terrain.js (G, P, ARMS, search avec options, cheminVers, cellAt, cellLL,
   distM, chamfer, viewshed, surfaceHeights, withDefaultsTerrain) et de doctrine.js (DOCTRINE, completerDoctrine).
   L'outil Ennemi NE COUPE RIEN : il subit les coupures et saisies du terrain chargé (G.coupe, P).
   Tout est rangé dans l'objet ME. Format d'échange : CONTRAT-JSON.md, « Export ennemi-gtia v3 ».

   ÉTAT AU 12/11/2026 (lot A) : tout est écrit et testé (tests/ennemi.js). Changements de signature par rapport à
   l'étape 0, tous COMPATIBLES (paramètre facultatif ajouté en fin) : ME.positionSurAxe(axe, unite, t_min, opts),
   ME.importer(o, opts). Ajouts : ME.scenario, ME.unitePlanifiee, ME.resultats, ME.verifierReference et les versions
   par étapes (générateurs « yield [texte, avancement] » à passer à enSequences) ME.axesEtapes, ME.isochronesEtapes,
   ME.presenceEtapes, ME.zonesRegroupementEtapes, ME.scenarioEtapes.
   PERFORMANCE (PERF=1 node tests/ennemi.js, grille synthétique 500 × 500, Node, 12/11/2026) : un search complet du moteur
   ≈ 2,3 s ; axes ≈ 7 s (3 search), isochrones ≈ 2,3 s (1 search), présence ≈ 5,5 s (1 search par contact),
   regroupement ≈ 0,25 s (axe fourni), horaires < 10 ms. Le coût est celui de search (moteur-terrain.js). Les versions
   *Etapes rendent la main ENTRE deux search (pas pendant) : sur grande grille, chaque étape bloque encore ≈ 2 s.
   Pour descendre sous la seconde par étape, il faudrait un search découpé (générateur) ou un Web Worker côté moteur.

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

   SIGNATURES (lot A). Les tableaux d'axes ou de zones vides portent .manque (texte : pourquoi rien n'est proposé).
   ME.axes(unite, opts) → [axe] (au plus doctrine.axes.nb_max, triés forte → faible)
     opts : {doctrine, mode, amis:[lonlat] (nos positions), nb_max}. Départ unite.depart, objectifs unite.objectifs (l'axe
     s'arrête à doctrine.axes.rayon_objectif_m du plus proche ; départ ou objectif impraticable : maille praticable la plus
     proche à moins de doctrine.conduite.rayon_praticable_m). Vitesse tactique doctrine.vitesses_pct[classe][mode] ;
     mode qui suit les routes : hors route pénalisé (surete.facteur_hors_route) pour le CHOIX du chemin seulement.
     axe : {genre:"rapide"|"sur"|"variante", nom, plausibilite:"forte"|"moyenne"|"faible", classe, mode, vitesse_frac,
            noeuds:[nœud moteur], coords:[lonlat], dn:[km cumulés], tn:[min cumulées : déplacement ÷ facteur + franchissement],
            fn:[min de franchissement cumulées], ouvrage_n:[id_ouvrage franchi en arrivant au nœud | null], expose_n:[0|1],
            longueur_km, temps_min, franchissement_min, ouvrages:[id_ouvrage], goulets:[id_ouvrage], part_exposee (0-1),
            part_couvert (0-1), point_decision:{q, lonlat, distance_km, t_min, avec:[genre]} | null}
     Coupures (G.coupe) et verdict des cours d'eau par classe : appliqués par le moteur (search / forEachEdge).
   ME.horaires(axe, unite, opts) → {jalons, troncons, arrets, heure_depart_min, duree_min, arrivee_min, incertitude_min, dispersion_min}
     opts : {doctrine, heure_depart_min (défaut unite.heure_depart_min, sinon 0), mode, regroupement:zoneR (lieu du regroupement)}.
     Haltes : halte_duree_min toutes les halte_intervalle_min de route ; regroupement (mode qui regroupe) : duree_min[mode],
     à la zone donnée, sinon au dernier point à au moins regroupement.distance_objectif_km.min de l'objectif.
     jalon : {nom, id_ouvrage|null, q, lonlat, distance_km, t_min (depuis le départ), heure_min, incertitude_min (dispersion + incertitude_pct
             du temps), expose, goulet, franchissement_min, arret_min}
     troncon : {de, a, longueur_km, duree_min, heure_entree_min, heure_sortie_min, deplacement_min, franchissement_min, arrets_min, ouvrages:[id_ouvrage]}
     arret : {genre:"halte"|"regroupement", q, lonlat, debut_min, heure_min, duree_min}
   ME.positionSurAxe(axe, unite, t_min, opts) → {tete, queue, d_tete_km, d_queue_km, trace, possible, incertitude_min, parti, arrive, a_l_arret} | null
     t_min = HEURE (min depuis minuit) ; départ = opts.heure_depart_min, sinon unite.heure_depart_min, sinon 0 (t_min = temps écoulé).
     queue = tête − unite.prof_km ; possible = portion de l'axe compte tenu de l'incertitude ; arrêts (haltes, regroupement) respectés.
   ME.isochrones(contacts, unites, t_min, opts) → {arrivee_min: Float32Array (N, heure d'arrivée au plus tôt, mêmes minuit que t_min,
     peut être < 0 ou > 1440 ; Infinity si inatteignable), atteint: Uint8Array (1 si arrivee ≤ t_min), bande: Uint8Array (0 = atteint,
     i = atteint avant t_min + delais[i-1], 255 = au-delà), delais:[min], heure_min, par_unite:{id: Float32Array}, contacts_places:[{contact,
     unite, hors_zone, maille, lonlat, deplace_m}]}
     opts : {doctrine, mode, delais (défaut doctrine.isochrones_min.conduite)}. Par unité, un seul search multi-sources : chaque contact
     amorcé à t0 = −(t_min − heure du contact) (heures), à vitesse tactique, franchissements non divisés.
   ME.presence(unites, contacts, t_min, opts) → {Q: Float32Array (N, éléments attendus), total, par_unite:{id:{Q, total, vus, non_vus,
     echelle_min, dernier_contact_min, prevu, classe}}, zones:[zone], heure_min}
     opts : {doctrine, mode, axes_prevus:{id_unite:[axe]}, observations:[{lonlat, heure_min}]}. Q = attrait du terrain (en mouvement :
     vitesse, couloirs, axes d'approche ; à l'arrêt : forêt, bâti) × gaussienne du temps de trajet depuis le dernier contact (échelle
     = gabarit + mobilite_pct du temps écoulé) × bonus des axes prévus ; les contacts plus anciens sont des contraintes (maille
     atteignable depuis chacun dans le temps écoulé) ; observation postérieure au dernier contact : mailles vues réduites ; masse =
     éléments − vus au dernier contact. Unité sans contact mais avec axes prévus et heure de départ : autour de sa position prévue.
     zone (à survoler) : {rang, lonlat, rayon_m, niveau, part_pct, elements_attendus, distance_contact_km, delai_min, pourquoi:[texte],
                          a_chercher (doctrine.a_chercher[classe]), unites:[{id, elements_attendus}]}
   ME.zonesRegroupement(unite, opts) → [zoneR] (classées, au plus regroupement.nb_max)
     opts : {doctrine, mode, objectif:lonlat (défaut unite.objectifs[0]), axe (défaut : l'axe de plausibilité forte, calculé), amis, nb_max}
     zoneR : {centre, mailles:[indice], surface_km2, couvert (0-1), distance_objectif_km, distance_axe_km, vue (bool), duree_min, niveau,
              score, point_axe:{q, lonlat}, axe:genre}
   ME.scenario(scenario, opts) → {par_unite:{id:{unite, axes, manque, axe_choisi, horaires, regroupements}}}
     scenario : {id, nom, mode_action, heure_depart_min (ou heure_depart "hh:mm"), axe_choisi:{id: genre}, unites:[unité planifiée]} ;
     opts : {doctrine, amis}. Unité planifiée complétée par ME.unitePlanifiee(u, scenario) (mode, heure_depart_min).
   ME.exporter(etat, opts) → objet « ennemi-gtia » v3 (CONTRAT-JSON.md), référence terrain = ME.referenceTerrain(), pas de terrain.
     etat (état interne, heures en minutes) : {nom, doctrine_surcharge, nos_positions:[{id, nom, lonlat}],
       planification:{scenarios:[{id, nom, mode_action, heure_depart_min, axe_choisi, unites:[{id, nom, unite_type, classe, echelon,
         elements, front_km, prof_km, dispersion_min, depart, objectifs, heure_depart_min?, mode_action?}]}]},
       conduite:{heure_min, unites:[{… champs d'unité, mode_action, en_mouvement, scenario_ref}], contacts:[{id, unite, lonlat, heure_min,
         elements_vus, note}]}} ; opts : {resultats:true (recalculés, ME.resultats) | objet déjà calculé, date}.
   ME.importer(o, opts) → {etat, document (v3), reference, terrain (terrain inclus d'un ancien fichier, sinon null), avertissements,
     verification (ME.verifierReference), refus:texte|null}. Accepte ennemi-gtia v3 et, via ME.migrer, les v1. REFUS (etat null,
     message clair) si un terrain est ouvert et que l'id ou l'empreinte diffère, sauf opts.forcer (avertissement) ou ancien fichier
     incluant son terrain. Version > 3 : exception.
   ME.verifierReference(ref) → {ok, terrain_ouvert, raison:null|"absente"|"non_ouvert"|"id"|"empreinte", message}
   ME.migrer(o) → {document (ennemi-gtia v3), terrain (inclus, rendu à part), avertissements}. meca/moto/pied → chenille/roue/fantassin ;
     indices d'ouvrage des anciens axes → id_ouvrage (dans document.resultats) si le terrain ouvert a l'id du terrain inclus.

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
 const D = _doc(doctrine), d0 = typeof DOCTRINE !== "undefined" ? DOCTRINE : D, v0 = +v > 0 ? +v : ((d0.vitesses_pct || {})[classe] || {})[mode || "attaque"];
 return Math.min(1, Math.max(D.vitesse_min_pct/100, (+v0 || D.vitesse_min_pct)/100)); };
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

/* ====================================================================================================================
   CALCULS (lot A). Toutes les valeurs de doctrine viennent de l'objet doctrine (opts.doctrine, défaut DOCTRINE) ; les
   seuls nombres écrits ici sont mathématiques (0, 1, 2, 0,5 de la gaussienne et de la sonde, 60 min/h, 1000 m/km,
   1440 min/jour, 720 = demi-journée, 255 = « aucun », codes de classes du moteur). Vérifié par tests/ennemi.js.
   Le Dijkstra est celui du moteur terrain (search, cheminVers, forEachEdge) : rien n'est recopié.

   Vitesse tactique : le moteur terrain donne la vitesse de la classe (G.v[k] hors route, P[k].*_kmh sur route) ;
   pour chercher à la vitesse tactique, on multiplie TEMPORAIREMENT ces vitesses par la fraction tactique (_avecVitesses,
   restauration garantie) : les temps de franchissement (gué, ruisseau, cours d'eau, haie, voie ferrée, autoroute) ne
   sont donc PAS divisés par le facteur de vitesse (défaut de l'ancien ennemi-prepa.html, ligne 510 : tN × 60 / fr).
   Le long d'un chemin, chaque arc est décomposé en déplacement + franchissement par deux évaluations de forEachEdge
   (vitesses × 1 et × 0,5 : dt = m/s + c).
   ==================================================================================================================== */
(() => {   // fonctions internes isolées : aucun nom global ajouté hors de ME (pas de conflit avec les autres scripts de la page)
const _N = () => G.n*G.n;
const _clone = o => JSON.parse(JSON.stringify(o));
const _D = o => (o && o.doctrine) || _doc();
const _ll = a => !a ? null : Array.isArray(a) ? a : a.lonlat || a.ll || (a.lng != null ? [a.lng, a.lat] : null);
const _cell = a => { const ll = _ll(a); return ll && isFinite(ll[0]) && isFinite(ll[1]) ? cellAt({lng:+ll[0], lat:+ll[1]}) : -1; };
const _nLL = u => { const N = _N(); return u < N ? cellLL(u) : [G.R.lon[u - N], G.R.lat[u - N]]; };
const _nCell = u => { const N = _N(); return u < N ? u : G.R.cell[u - N]; };
const _mode = (u, o) => (o && o.mode) || (u && (u.mode || u.mode_action)) || "attaque";
const _hm = m => { if (m == null || !isFinite(m)) return null; m = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(m/60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
const _mins = h => { if (typeof h === "number") return h; if (h == null || h === "") return null; const [a, b] = String(h).split(":").map(Number); return (a || 0)*60 + (b || 0); };
const _hc = c => c.heure_min != null ? +c.heure_min : _mins(c.heure != null ? c.heure : c.h);
// écart (min) entre l'heure t et l'heure h d'un contact, ramené dans ]-720, 720] (passage de minuit) ; positif = contact passé
const _ecart = (t, h) => { let d = (((t - h) % 1440) + 1440) % 1440; if (d > 720) d -= 1440; return d; };
const _disp = (u, D) => +u.dispersion_min >= 0 ? +u.dispersion_min : +((D.echelons[u.echelon] || {}).dispersion_min) || 0;
const _plan = (i, j, a, b) => Math.hypot(i - a, j - b)*G.cell;   // distance plane (m) entre deux mailles (i, j)
const _featParId = () => { if (!G._meFeat || G._meFeat.f !== G.feats) G._meFeat = {f:G.feats, m:new Map(G.feats.map((f, i) => [f.id, i]))}; return G._meFeat.m; };

// maille praticable la plus proche (anneaux successifs) à moins de conduite.rayon_praticable_m ; -1 sinon
function _praticable(c, k, D){
 if (c < 0) return -1;
 const n = G.n, v = G.v[k]; if (v[c] > 0) return c;
 const i0 = c % n, j0 = (c/n) | 0, R = Math.max(1, Math.round(D.conduite.rayon_praticable_m/G.cell));
 for (let r = 1; r <= R; r++) { let best = -1, bd = Infinity;
  for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
   if (i < 0 || j < 0 || i >= n || j >= n || Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== r) continue;
   const d = (i - i0)**2 + (j - j0)**2; if (v[j*n + i] > 0 && d < bd && d <= R*R) { bd = d; best = j*n + i; } }
  if (best >= 0) return best; }
 return -1;
}
// exécute fn avec les vitesses de la classe k multipliées par fTT (hors route) et fRoute (routes), puis les restaure
const _VC = typeof WeakMap === "function" ? new WeakMap() : null;
function _avecVitesses(k, fTT, fRoute, fn){
 const v0 = G.v[k], p0 = P[k];
 let m = _VC.get(v0); if (!m) _VC.set(v0, m = new Map());
 let vs = m.get(fTT); if (!vs) { vs = new Float32Array(v0.length); for (let c = 0; c < v0.length; c++) vs[c] = v0[c]*fTT; m.set(fTT, vs); }
 const p1 = Object.assign({}, p0); for (const key of ROADKEYS) p1[key] = p0[key]*fRoute;
 G.v[k] = vs; P[k] = p1;
 try { return fn(); } finally { G.v[k] = v0; P[k] = p0; }
}
// temps de trajet (heures) à vitesse tactique depuis des mailles, franchissements non divisés ; opts de search facultatives
const _cherche = (k, frac, fHR, sources, sopts) => _avecVitesses(k, frac/fHR, frac, () => search(sources, k, sopts));

// profil d'un chemin (nœuds du moteur) : km cumulés, minutes cumulées à vitesse tactique (déplacement ÷ facteur +
// franchissement non divisé), minutes de franchissement cumulées, ouvrage franchi en arrivant sur chaque nœud
function _profil(nodes, k, frac){
 const pas = s => _avecVitesses(k, s, s, () => { const X = ctxOf(k), out = [];
  for (let q = 1; q < nodes.length; q++) { const w = nodes[q], l = [];
   forEachEdge(nodes[q-1], X, (w2, dt, len, c1, c2, f) => { if (w2 === w) l.push([dt, len, f]); }); out.push(l); }
  return out; });
 const A = pas(1), B = pas(0.5), dn = [0], tn = [0], fn = [0], ouv = [-1];
 for (let q = 1; q < nodes.length; q++) {
  const la = A[q-1], lb = B[q-1]; let best = null;
  for (let i = 0; i < la.length; i++) {   // arcs parallèles éventuels : celui qui coûte le moins à vitesse tactique
   const m = Math.max(0, lb[i][0] - la[i][0]), c0 = 2*la[i][0] - lb[i][0], c = c0 > 1e-12 ? c0 : 0, t = m/frac + c;
   if (!best || t < best.t) best = {t, c, len:la[i][1], f:la[i][2]}; }
  if (!best) throw new Error("chemin incohérent avec le graphe du moteur (nœud " + nodes[q-1] + " → " + nodes[q] + ")");
  dn.push(dn[q-1] + best.len); tn.push(tn[q-1] + best.t*60); fn.push(fn[q-1] + best.c*60); ouv.push(best.f);
 }
 return {dn, tn, fn, ouv};
}

// exposition : vu depuis les points hauts du terrain et nos positions, atténué sous couvert (mise en cache sur G)
function _expo(amis, D){
 const X = D.exposition, pts = (amis || []).map(_ll).filter(Boolean), cle = JSON.stringify([pts, X, P.vue, G.hp.map(h => h.c)]);
 if (G._meExpo && G._meExpo.cle === cle) return G._meExpo.r;
 const N = _N(), H = surfaceHeights(), cnt = new Uint8Array(N), L = G.L;
 const obs = G.hp.map(h => h.c).concat(pts.map(_cell)).filter(c => c >= 0);
 for (const o of obs) { const v = viewshed(o, H); for (let c = 0; c < N; c++) if (v[c] && cnt[c] < 255) cnt[c]++; }
 const E = new Float32Array(N);
 for (let c = 0; c < N; c++) E[c] = Math.min(1, cnt[c]/X.observateurs_pour_plein)*(1 - X.attenuation_foret*Math.min(1, L.foret[c]))*(1 - X.attenuation_bati*Math.min(1, L.bati[c]));
 const r = {E, cnt, nb:obs.length};
 G._meExpo = {cle, r};
 return r;
}
const _couvert = (c, X) => G.L.foret[c] >= X.seuil_couvert || G.L.bati[c] >= X.seuil_couvert;

/* ---------- 1. axes ---------- */
const NOM_AXE = {rapide:"Axe le plus rapide", sur:"Axe le plus discret", variante:"Variante"};
function* _axesGen(unite, opts){
 const o = opts || {}, D = _D(o), mode = _mode(unite, o), MA = D.modes_action[mode], A = D.axes, X = D.exposition, k = unite && unite.classe, res = [];
 if (!MA) throw new Error("mode d'action inconnu « " + mode + " » (" + DOCTRINE_MODES.join(", ") + ")");
 if (!ARMS.includes(k)) { res.manque = "classe inconnue « " + k + " » (" + ARMS.join(", ") + ")"; return res; }
 const n = G.n, N = _N(), cell = G.cell, frac = ME.vitesseFrac(k, mode, D), fHR = MA.suit_routes ? D.surete.facteur_hors_route : 1;
 const c0 = _praticable(_cell(unite.depart), k, D);
 if (c0 < 0) { res.manque = unite.depart ? "Départ hors du terrain ou sur un terrain impraticable pour la classe " + k + " (rien de praticable à proximité)." : "Départ non posé."; return res; }
 const cible = new Uint8Array(N), rc = Math.max(1, Math.round(A.rayon_objectif_m/cell)); let nc = 0;
 for (const ob of unite.objectifs || []) { const c = _cell(ob); if (c < 0) continue; const i0 = c % n, j0 = (c/n) | 0;
  for (let j = j0 - rc; j <= j0 + rc; j++) for (let i = i0 - rc; i <= i0 + rc; i++)
   if (i >= 0 && j >= 0 && i < n && j < n && _plan(i, j, i0, j0) <= A.rayon_objectif_m && G.v[k][j*n + i] > 0) { cible[j*n + i] = 1; nc++; }
  if (!cible.some(x => x)) { const cp = _praticable(c, k, D); if (cp >= 0) { cible[cp] = 1; nc++; } } }   // objectif sur un terrain impraticable : maille praticable la plus proche
 if (!nc) { res.manque = (unite.objectifs || []).length ? "Objectif hors du terrain ou sur un terrain impraticable pour la classe " + k + "." : "Objectif non posé."; return res; }
 yield ["Axes : exposition", 0];
 const E = _expo(o.amis, D).E, gs = new Set((G.gou[k] || []).map(g => G.feats[g.f].id));
 const axe = (nodes, genre) => {
  const p = _profil(nodes, k, frac), coords = nodes.map(_nLL), cells = nodes.map(_nCell), cs = cells.filter(c => c >= 0), m = new Uint8Array(N);
  cs.forEach(c => m[c] = 1);
  const ids = [], ouvrage_n = p.ouv.map(f => f >= 0 ? G.feats[f].id : null);
  ouvrage_n.forEach(id => { if (id && !ids.includes(id)) ids.push(id); });
  const a = {genre, nom:NOM_AXE[genre], plausibilite:null, classe:k, mode, vitesse_frac:frac,
   noeuds:nodes, coords, dn:p.dn, tn:p.tn, fn:p.fn, ouvrage_n, expose_n:cells.map(c => c >= 0 && E[c] >= X.seuil_expose ? 1 : 0),
   longueur_km:p.dn[p.dn.length-1], temps_min:p.tn[p.tn.length-1], franchissement_min:p.fn[p.fn.length-1],
   ouvrages:ids, goulets:ids.filter(id => gs.has(id)),
   part_exposee:cs.filter(c => E[c] >= X.seuil_expose).length/cs.length, part_couvert:cs.filter(c => _couvert(c, X)).length/cs.length, point_decision:null};
  Object.defineProperty(a, "_dist", {value:chamfer(m, n), enumerable:false});
  return a;
 };
 const recouvre = (a, b) => { const cs = a.noeuds.map(_nCell).filter(c => c >= 0); return cs.filter(c => b._dist[c]*cell <= MA.ecart_axes_m).length/cs.length; };
 yield ["Axes : le plus rapide", 1/4];
 const ra = _cherche(k, frac, fHR, [c0], {cible});
 if (ra.fin < 0) { res.manque = "Aucun passage praticable entre le départ et l'objectif pour la classe " + k + " (coupures, cours d'eau, pente, réseau)."; return res; }
 res.push(axe(cheminVers(ra, ra.fin), "rapide"));
 const wS = MA.poids_surete_pct/100*D.surete.poids_max; let surEgal = false;
 if (wS > 0) {
  yield ["Axes : le plus discret", 2/4];
  const ms = new Float32Array(N); for (let c = 0; c < N; c++) ms[c] = 1 + wS*E[c];
  const rs = _cherche(k, frac, fHR, [c0], {cible, mult:ms});
  if (rs.fin >= 0) { const a = axe(cheminVers(rs, rs.fin), "sur"); if (recouvre(a, res[0]) > A.recouvrement_max_sur_pct/100) surEgal = true; else res.push(a); }
 } else surEgal = true;
 yield ["Axes : variante", 3/4];
 const seed = new Uint8Array(N); seed[c0] = 1; for (let c = 0; c < N; c++) if (cible[c]) seed[c] = 1;
 const dSO = chamfer(seed, n), mv = new Float32Array(N).fill(1);
 for (const a of res) for (let c = 0; c < N; c++) if (a._dist[c]*cell <= MA.ecart_axes_m && dSO[c]*cell > A.zone_libre_extremites_m) mv[c] *= MA.penalite_axe_deja_pris;
 const rv = _cherche(k, frac, fHR, [c0], {cible, mult:mv});
 if (rv.fin >= 0) { const a = axe(cheminVers(rv, rv.fin), "variante"); if (res.every(b => recouvre(a, b) <= A.recouvrement_max_variante_pct/100)) res.push(a); }
 // plausibilité : l'axe que le mode d'action privilégie = forte, l'autre axe principal = moyenne, la variante = faible
 const pref = !surEgal && MA.poids_surete_pct >= A.surete_preferee_des_pct ? "sur" : "rapide";
 res.forEach(a => { a.plausibilite = a.genre === pref ? "forte" : a.genre === "variante" ? "faible" : "moyenne";
  if (surEgal && a.genre === "rapide" && wS > 0) a.nom = NOM_AXE.rapide + " (aussi le plus discret)"; });
 // point de décision : dernier point commun avec un autre axe proposé avant qu'ils ne s'écartent de plus de ecart_axes_m
 res.forEach(a => { const autres = res.filter(b => b !== a); if (!autres.length) return;
  const cs = a.noeuds.map(_nCell); let q = 0;
  for (; q < cs.length; q++) { const c = cs[q]; if (c >= 0 && !autres.some(b => b._dist[c]*cell <= MA.ecart_axes_m)) break; }
  if (q > 0 && q < cs.length) { const qd = q - 1;
   a.point_decision = {q:qd, lonlat:a.coords[qd], distance_km:a.dn[qd], t_min:a.tn[qd], avec:autres.filter(b => b._dist[cs[q]]*cell > MA.ecart_axes_m).map(b => b.genre)}; } });
 res.sort((a, b) => ["forte", "moyenne", "faible"].indexOf(a.plausibilite) - ["forte", "moyenne", "faible"].indexOf(b.plausibilite));
 const nb = o.nb_max || A.nb_max; if (res.length > nb) res.length = nb;
 return res;
}
ME.axes = (unite, opts) => finir(_axesGen(unite, opts));
ME.axesEtapes = (unite, opts) => _axesGen(unite, opts);

/* ---------- 2. horaires, délais par tronçon, position sur l'axe ---------- */
// arrêts prévus le long de l'axe : haltes (doctrine.horaires) et regroupement (mode d'action qui regroupe)
function _arrets(axe, unite, D, o){
 const mode = _mode(unite, o), MA = D.modes_action[mode], H = D.horaires, last = axe.tn.length - 1;
 let qR = -1;
 if (MA && MA.regroupe && last > 0) {
  const z = o.regroupement, zc = z && (z.point_axe ? z.point_axe.q : null);
  if (zc != null && zc >= 0 && zc <= last) qR = zc;
  else if (z && z.centre) { let bd = Infinity; axe.coords.forEach((ll, q) => { const d = distM(ll, z.centre); if (d < bd) { bd = d; qR = q; } }); }
  else { const fin = axe.coords[last], obs = (unite.objectifs || []).map(_ll).filter(Boolean);
   const obj = obs.length ? obs.reduce((a, b) => distM(a, fin) <= distM(b, fin) ? a : b) : fin;
   for (let q = 0; q <= last; q++) if (distM(axe.coords[q], obj) >= D.regroupement.distance_objectif_km.min*1000) qR = q; }
  if (qR >= last) qR = last - 1;
 }
 const arr = new Float64Array(last + 1), dep = new Float64Array(last + 1), arrets = [];
 let add = 0, next = H.halte_intervalle_min;
 for (let q = 0; q <= last; q++) {
  arr[q] = axe.tn[q] + add;
  while (q < last && axe.tn[q] >= next) { if (H.halte_duree_min > 0) { arrets.push({genre:"halte", q, debut_min:axe.tn[q] + add, duree_min:H.halte_duree_min}); add += H.halte_duree_min; } next += H.halte_intervalle_min; }
  if (q === qR) { const d = D.regroupement.duree_min[mode]; arrets.push({genre:"regroupement", q, debut_min:axe.tn[q] + add, duree_min:d}); add += d; }
  dep[q] = axe.tn[q] + add;
 }
 return {arr, dep, arrets, qR, last};
}
function* _horairesGen(axe, unite, opts){
 const o = opts || {}, D = _D(o), res = {jalons:[], troncons:[], arrets:[]};
 if (!axe || !axe.tn || axe.tn.length < 2) return res;
 const h0 = o.heure_depart_min != null ? +o.heure_depart_min : unite.heure_depart_min != null ? +unite.heure_depart_min : 0;
 const S = _arrets(axe, unite, D, o), H = D.horaires, disp = _disp(unite, D), fp = _featParId(), k = axe.classe || unite.classe;
 const gs = new Set((G.gou[k] || []).map(g => G.feats[g.f].id));
 const inc = t => Math.round(disp + H.incertitude_pct/100*t), dn = axe.dn, last = S.last;
 const jal = (nom, q, id) => { const f = id != null ? fp.get(id) : undefined;
  res.jalons.push({nom, id_ouvrage:id || null, q, lonlat:f !== undefined ? [G.feats[f].lon, G.feats[f].lat] : axe.coords[q], distance_km:dn[q],
   t_min:S.arr[q], heure_min:h0 + S.arr[q], incertitude_min:inc(S.arr[q]), expose:!!(axe.expose_n && axe.expose_n[q]), goulet:!!id && gs.has(id),
   franchissement_min:q > 0 ? axe.fn[q] - axe.fn[q-1] : 0, arret_min:S.dep[q] - S.arr[q]}); };
 const nomOuv = id => { const f = fp.get(id), x = f !== undefined ? G.feats[f] : null;
  const t = x ? {pont:x.maj ? "pont" : "pont sur ruisseau", gue:"gué", deniv:"pont routier", tunnel:"tunnel", echangeur:"échangeur", fer:"passage de voie ferrée"}[x.type] || x.type : "ouvrage";
  return t + (x && x.nm ? " « " + x.nm + " »" : "") + " (" + id + ")"; };
 jal("Départ", 0, null); let lastD = 0; const vus = new Set();
 for (let q = 1; q < last; q++) { const id = axe.ouvrage_n ? axe.ouvrage_n[q] : null;
  if (id && !vus.has(id)) { vus.add(id); jal(nomOuv(id), q, id); lastD = dn[q]; }
  else if (q === S.qR) { jal("Regroupement", q, null); lastD = dn[q]; }
  else if (dn[q] - lastD >= H.jalon_km && dn[last] - dn[q] > H.jalon_km/2) { jal("Point à " + dn[q].toFixed(1).replace(".", ",") + " km du départ", q, null); lastD = dn[q]; } }
 { const id = axe.ouvrage_n ? axe.ouvrage_n[last] : null; if (id && !vus.has(id)) jal(nomOuv(id), last, id); }
 jal("Objectif", last, null);
 for (let i = 1; i < res.jalons.length; i++) { const a = res.jalons[i-1], b = res.jalons[i], ids = [];
  for (let q = a.q + 1; q <= b.q; q++) { const id = axe.ouvrage_n && axe.ouvrage_n[q]; if (id && !ids.includes(id)) ids.push(id); }
  res.troncons.push({de:a.nom, a:b.nom, longueur_km:dn[b.q] - dn[a.q], duree_min:S.arr[b.q] - S.dep[a.q], heure_entree_min:h0 + S.dep[a.q], heure_sortie_min:h0 + S.arr[b.q],
   deplacement_min:(axe.tn[b.q] - axe.tn[a.q]) - (axe.fn[b.q] - axe.fn[a.q]), franchissement_min:axe.fn[b.q] - axe.fn[a.q],
   arrets_min:(S.arr[b.q] - S.dep[a.q]) - (axe.tn[b.q] - axe.tn[a.q]), ouvrages:ids}); }
 res.arrets = S.arrets.map(x => Object.assign({}, x, {lonlat:axe.coords[x.q], heure_min:h0 + x.debut_min}));
 Object.assign(res, {heure_depart_min:h0, duree_min:S.arr[last], arrivee_min:h0 + S.arr[last], incertitude_min:inc(S.arr[last]), dispersion_min:disp});
 return res;
}
ME.horaires = (axe, unite, opts) => finir(_horairesGen(axe, unite, opts));
// point à la distance d (km) le long de l'axe, et portion de l'axe entre d0 et d1
const _pt = (a, d) => { const dn = a.dn; if (d <= 0) return a.coords[0]; if (d >= dn[dn.length-1]) return a.coords[dn.length-1];
 let lo = 0, hi = dn.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (dn[m] <= d) lo = m; else hi = m; }
 const f = dn[hi] > dn[lo] ? (d - dn[lo])/(dn[hi] - dn[lo]) : 0, A = a.coords[lo], B = a.coords[hi]; return [A[0] + f*(B[0] - A[0]), A[1] + f*(B[1] - A[1])]; };
const _ligne = (a, d0, d1) => { const T = a.dn[a.dn.length-1]; d0 = Math.max(0, d0); d1 = Math.min(T, d1); if (!(d1 > d0)) return null;
 const pts = [_pt(a, d0)]; a.dn.forEach((d, q) => { if (d > d0 && d < d1) pts.push(a.coords[q]); }); pts.push(_pt(a, d1)); return pts; };
ME.positionSurAxe = (axe, unite, t_min, opts) => {
 if (!axe || !axe.dn || axe.dn.length < 2) return null;
 const o = opts || {}, D = _D(o), S = _arrets(axe, unite, D, o), dn = axe.dn, last = S.last;
 const h0 = o.heure_depart_min != null ? +o.heure_depart_min : unite.heure_depart_min != null ? +unite.heure_depart_min : 0, te = t_min - h0;
 const dAt = t => { if (t <= 0) return 0; if (t >= S.arr[last]) return dn[last];
  for (let q = 0; q < last; q++) { if (t < S.dep[q]) return dn[q];
   if (t < S.arr[q+1]) { const f = S.arr[q+1] > S.dep[q] ? (t - S.dep[q])/(S.arr[q+1] - S.dep[q]) : 1; return dn[q] + f*(dn[q+1] - dn[q]); } }
  return dn[last]; };
 const inc = Math.round(_disp(unite, D) + D.horaires.incertitude_pct/100*Math.max(0, te)), prof = +unite.prof_km || 0;
 const tete = dAt(te), queue = Math.max(0, tete - prof);
 const arret = S.arrets.find(x => te >= x.debut_min && te < x.debut_min + x.duree_min) || null;
 return {tete:_pt(axe, tete), queue:_pt(axe, queue), d_tete_km:tete, d_queue_km:queue, trace:_ligne(axe, queue, tete),
  possible:_ligne(axe, dAt(te - inc) - prof, dAt(te + inc)), incertitude_min:inc, parti:te > 0, arrive:te >= S.arr[last],
  a_l_arret:arret ? arret.genre : null};
};

/* ---------- 3. isochrones multi-contacts ---------- */
function* _isoGen(contacts, unites, t_min, opts){
 const o = opts || {}, D = _D(o), N = _N(), delais = (o.delais || D.isochrones_min.conduite).slice();
 const arr = new Float32Array(N).fill(Infinity), par = {}, places = [];
 for (let iu = 0; iu < (unites || []).length; iu++) {
  const u = unites[iu], cs = (contacts || []).filter(c => c.unite === u.id), k = u.classe;
  if (!cs.length || !ARMS.includes(k)) continue;
  const frac = ME.vitesseFrac(k, _mode(u, o), D), src = [], t0 = [];
  for (const c of cs) { const c0 = _cell(c), cp = _praticable(c0, k, D), h = _hc(c);
   places.push({contact:c.id, unite:u.id, hors_zone:c0 < 0, maille:cp, lonlat:cp >= 0 ? cellLL(cp) : null, deplace_m:cp >= 0 && c0 >= 0 ? distM(cellLL(c0), cellLL(cp)) : null});
   if (cp < 0 || h == null) continue;
   src.push(cp); t0.push(-_ecart(t_min, h)/60); }   // contact amorcé à -(T - h_contact) : T devient l'origine des temps
  if (!src.length) continue;
  yield ["Isochrones : " + (u.nom || u.id), iu/unites.length];
  const r = _cherche(k, frac, 1, src, {t0}), A = new Float32Array(N);
  for (let c = 0; c < N; c++) { A[c] = t_min + r.T[c]*60; if (A[c] < arr[c]) arr[c] = A[c]; }
  par[u.id] = A;
 }
 const atteint = new Uint8Array(N), bande = new Uint8Array(N).fill(255);
 for (let c = 0; c < N; c++) { const d = arr[c] - t_min; if (d <= 0) { atteint[c] = 1; bande[c] = 0; continue; }
  for (let i = 0; i < delais.length; i++) if (d <= delais[i]) { bande[c] = i + 1; break; } }
 return {arrivee_min:arr, atteint, bande, delais, heure_min:t_min, par_unite:par, contacts_places:places};
}
ME.isochrones = (contacts, unites, t_min, opts) => finir(_isoGen(contacts, unites, t_min, opts));
ME.isochronesEtapes = (contacts, unites, t_min, opts) => _isoGen(contacts, unites, t_min, opts);

/* ---------- 4. présence probable et zones à survoler ---------- */
function _attrait(k, mouv, D){
 const PR = D.presence, cle = JSON.stringify([k, mouv, PR.mouvement, PR.arret]);
 const C = G._meAtt && G._meAtt.v === G.v ? G._meAtt : (G._meAtt = {v:G.v, m:new Map()});
 if (C.m.has(cle)) return C.m.get(cle);
 const N = _N(), A = new Float32Array(N), p = P[k], L = G.L;
 for (let c = 0; c < N; c++) { const v = G.v[k][c]; if (!(v > 0) || G.cls[k][c] === 0) continue;
  if (mouv) { const rel = Math.min(1, v/p.vitesse_tout_terrain_kmh*slopeIso(G.sl[c], p));
   A[c] = Math.max(PR.mouvement.attrait_min, rel)*(G.corr[k] && G.corr[k][c] ? PR.mouvement.bonus_couloir : 1)*(G.axm[k] && G.axm[k][c] ? PR.mouvement.bonus_axe : 1); }
  else A[c] = 1 + PR.arret.bonus_foret*Math.min(1, L.foret[c]/PR.arret.couvert_plein) + PR.arret.bonus_bati*Math.min(1, L.bati[c]/PR.arret.couvert_plein); }
 C.m.set(cle, A); return A;
}
function _facteurAxes(axes, D){   // 1 partout, plus haut près des axes prévus (selon leur plausibilité)
 const n = G.n, N = _N(), cell = G.cell, F = new Float32Array(N).fill(1), AP = D.presence.axes_prevus;
 for (const a of axes || []) { const tr = a.coords || a.trace; if (!tr || tr.length < 2) continue;
  const m = new Uint8Array(N), w = AP.poids[a.plausibilite] != null ? AP.poids[a.plausibilite] : AP.poids.faible;
  for (let q = 1; q < tr.length; q++) { const A = tr[q-1], B = tr[q], L = Math.max(1, Math.ceil(distM(A, B)/(cell/2)));
   for (let s = 0; s <= L; s++) { const c = _cell([A[0] + (B[0] - A[0])*s/L, A[1] + (B[1] - A[1])*s/L]); if (c >= 0) m[c] = 1; } }
  const d = chamfer(m, n);
  for (let c = 0; c < N; c++) { const f = 1 + AP.bonus*w*Math.exp(-0.5*((d[c]*cell/AP.largeur_m)**2)); if (f > F[c]) F[c] = f; } }
 return F;
}
const _integrale = (a, n) => { const I = new Float64Array((n+1)*(n+1));
 for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < n; i++) { s += a[j*n + i]; I[(j+1)*(n+1) + i+1] = I[j*(n+1) + i+1] + s; } } return I; };
const _boite = (I, n, i, j, r) => { const x0 = Math.max(0, i-r), y0 = Math.max(0, j-r), x1 = Math.min(n, i+r+1), y1 = Math.min(n, j+r+1);
 return I[y1*(n+1)+x1] - I[y0*(n+1)+x1] - I[y1*(n+1)+x0] + I[y0*(n+1)+x0]; };
function* _presGen(unites, contacts, t_min, opts){
 const o = opts || {}, D = _D(o), PR = D.presence, n = G.n, N = _N(), cell = G.cell;
 const Q = new Float32Array(N), par = {}, aux = [];
 for (let iu = 0; iu < (unites || []).length; iu++) {
  const u = unites[iu], k = u.classe; if (!ARMS.includes(k)) continue;
  const mode = _mode(u, o), frac = ME.vitesseFrac(k, mode, D), mouv = u.en_mouvement !== false;
  let cs = (contacts || []).filter(c => c.unite === u.id).map(c => ({c, h:_hc(c), cell:_praticable(_cell(c), k, D)}))
   .filter(x => x.cell >= 0 && x.h != null).map(x => Object.assign(x, {e:_ecart(t_min, x.h)})).filter(x => x.e >= 0);
  const axesP = o.axes_prevus && o.axes_prevus[u.id] || [];
  if (!cs.length && axesP.length && u.heure_depart_min != null) {   // pas de contact : position prévue sur l'axe le plus plausible
   const a = axesP.find(x => x.plausibilite === "forte") || axesP[0], pos = ME.positionSurAxe(a, u, t_min, {doctrine:D});
   const cp = pos ? _praticable(_cell(pos.tete), k, D) : -1;
   if (cp >= 0) cs = [{c:null, h:t_min, cell:cp, e:0, inc:pos.incertitude_min, prevu:true}]; }
  if (!cs.length) continue;
  yield ["Présence : " + (u.nom || u.id), iu/unites.length];
  const T = cs.map(x => { const r = _cherche(k, frac, 1, [x.cell]), t = new Float32Array(N); for (let c = 0; c < N; c++) t[c] = r[c]*60; return t; });
  const iL = cs.reduce((b, x, i) => x.e < cs[b].e ? i : b, 0), L = cs[iL], TL = T[iL];
  const vtt = P[k].vitesse_tout_terrain_kmh*frac, tb = Math.max(1, Math.max(+u.front_km || 0, +u.prof_km || 0)/2/vtt*60);
  const s = tb + (mouv ? PR.mobilite_pct/100*L.e : 0) + (L.inc || 0);
  const A = _attrait(k, mouv, D), axF = axesP.length ? _facteurAxes(axesP, D) : null, lam = new Float32Array(N); let tot = 0;
  for (let c = 0; c < N; c++) { if (!A[c] || !isFinite(TL[c])) continue;
   let ok = true; for (let i = 0; i < cs.length; i++) if (i !== iL && !(T[i][c] <= cs[i].e + tb)) { ok = false; break; }   // les contacts plus anciens restent des contraintes
   if (!ok) continue;
   lam[c] = A[c]*(axF ? axF[c] : 1)*Math.exp(-0.5*(TL[c]/s)**2); }
  for (const ob of o.observations || []) { const oc = _cell(ob), eo = _ecart(t_min, _hc(ob)); if (oc < 0 || !(eo >= 0) || eo > L.e) continue;   // observation postérieure au dernier contact
   const v = viewshed(oc, surfaceHeights()), f = Math.min(1, eo/PR.observation.duree_effet_min); for (let c = 0; c < N; c++) if (v[c]) lam[c] *= f; }
  const recents = cs.filter(x => x.c && x.e === L.e), vus = recents.reduce((a, x) => a + (+x.c.elements_vus || 0), 0);
  for (const x of recents) lam[x.cell] = 0;   // les éléments vus sont au contact
  for (let c = 0; c < N; c++) tot += lam[c];
  const elements = +u.elements || 0, nonVus = Math.max(0, elements - vus), masse = elements ? nonVus : 1, Qu = new Float32Array(N);
  if (tot > 0) for (let c = 0; c < N; c++) { Qu[c] = lam[c]/tot*masse; Q[c] += Qu[c]; }
  par[u.id] = {Q:Qu, total:tot > 0 ? masse : 0, vus, non_vus:nonVus, echelle_min:s, dernier_contact_min:L.h, prevu:!!L.prevu, classe:k};
  aux.push({u, k, TL, axF, cs});
 }
 let total = 0; for (let c = 0; c < N; c++) total += Q[c];
 // zones à survoler : boîtes de rayon zones_a_survoler.rayon_m les plus chargées, espacées
 const Z = D.zones_a_survoler, rn = Math.max(1, Math.round(Z.rayon_m/cell)), I = _integrale(Q, n), used = new Uint8Array(N), zones = [];
 const Iu = aux.map(x => _integrale(par[x.u.id].Q, n)), pts = (contacts || []).map(_ll).filter(Boolean);
 for (let z = 0; z < Z.nb && total > 0; z++) {
  let best = -1, bs = 0;
  for (let c = 0; c < N; c++) { if (used[c]) continue; const sm = _boite(I, n, c % n, (c/n) | 0, rn); if (sm > bs) { bs = sm; best = c; } }
  if (best < 0 || bs < Z.masse_min) break;
  const i0 = best % n, j0 = (best/n) | 0, ll = cellLL(best), why = [];
  const us = aux.map((x, q) => ({id:x.u.id, k:x.k, m:_boite(Iu[q], n, i0, j0, rn), x})).filter(y => y.m > 0).sort((a, b) => b.m - a.m), dom = us[0];
  if (dom && dom.x.axF && dom.x.axF[best] >= Z.seuil_raison_axe) why.push("sur un axe prévu en planification");
  if (dom && G.corr[dom.k] && G.corr[dom.k][best]) why.push("couloir de mobilité");
  if (G.L.foret[best] >= Z.seuil_raison_couvert) why.push("forêt (couvert)");
  if (G.L.bati[best] >= Z.seuil_raison_couvert) why.push("bâti");
  if (G.L.route[best] > 0) why.push("route");
  const delais = aux.map(x => x.TL[best]).filter(isFinite);
  zones.push({rang:zones.length + 1, lonlat:ll, rayon_m:Z.rayon_m, niveau:ME.niveau(bs/total*100, D), part_pct:bs/total*100, elements_attendus:bs,
   distance_contact_km:pts.length ? Math.min(...pts.map(p => distM(p, ll)/1000)) : null, delai_min:delais.length ? Math.min(...delais) : null,
   pourquoi:why, a_chercher:dom ? D.a_chercher[dom.k] : "", unites:us.map(y => ({id:y.id, elements_attendus:y.m}))});
  for (let j = Math.max(0, j0 - Z.espacement_rayons*rn); j <= Math.min(n - 1, j0 + Z.espacement_rayons*rn); j++)
   for (let i = Math.max(0, i0 - Z.espacement_rayons*rn); i <= Math.min(n - 1, i0 + Z.espacement_rayons*rn); i++) used[j*n + i] = 1;
 }
 return {Q, total, par_unite:par, zones, heure_min:t_min};
}
ME.presence = (unites, contacts, t_min, opts) => finir(_presGen(unites, contacts, t_min, opts));
ME.presenceEtapes = (unites, contacts, t_min, opts) => _presGen(unites, contacts, t_min, opts);

/* ---------- 5. zones de regroupement ---------- */
function* _regGen(unite, opts){
 const o = opts || {}, D = _D(o), mode = _mode(unite, o), R = D.regroupement, X = D.exposition, k = unite.classe, res = [];
 const obj = _ll(o.objectif || (unite.objectifs || [])[0]);
 if (!ARMS.includes(k)) { res.manque = "classe inconnue « " + k + " »"; return res; }
 if (!obj || _cell(obj) < 0) { res.manque = "Objectif non posé ou hors du terrain."; return res; }
 let axe = o.axe;
 if (!axe) { const ax = yield* _axesGen(unite, o); axe = ax.find(a => a.plausibilite === "forte") || ax[0];
  if (!axe) { res.manque = ax.manque || "Aucun axe : pas de zone de regroupement le long de l'axe."; return res; } }
 yield ["Regroupement : mailles candidates", 0.5];
 const n = G.n, N = _N(), cell = G.cell, ex = _expo(o.amis, D), am = new Uint8Array(N);
 (axe.noeuds ? axe.noeuds.map(_nCell) : (axe.coords || axe.trace || []).map(_cell)).forEach(c => { if (c >= 0) am[c] = 1; });
 const dA = chamfer(am, n), oc = _cell(obj), io = oc % n, jo = (oc/n) | 0, mask = new Uint8Array(N), L = G.L;
 for (let c = 0; c < N; c++) {
  if (R.hors_vue && ex.cnt[c] > 0) continue;
  if (Math.min(1, L.foret[c] + L.bati[c]) < R.couvert_min) continue;
  if (!(G.v[k][c] > 0) || G.cls[k][c] < 2) continue;   // GO (3) ou SLOW-GO (2) pour la classe
  if (dA[c]*cell > R.distance_axe_max_m) continue;
  const d = _plan(c % n, (c/n) | 0, io, jo)/1000; if (d < R.distance_objectif_km.min || d > R.distance_objectif_km.max) continue;
  mask[c] = 1; }
 const need = Math.ceil((+unite.elements || 1)*R.surface_par_vehicule_m2/(cell*cell)), comps = labelMask(mask).comps.filter(cs => cs.length >= need);
 for (const cs of comps) {
  let mi = 0, mj = 0, cv = 0, dmin = Infinity, vue = false; for (const c of cs) { mi += c % n; mj += (c/n) | 0; cv += Math.min(1, L.foret[c] + L.bati[c]); if (dA[c] < dmin) dmin = dA[c]; if (ex.cnt[c] > 0) vue = true; }
  mi /= cs.length; mj /= cs.length;
  const ctr = cs.reduce((b, c) => _plan(c % n, (c/n) | 0, mi, mj) < _plan(b % n, (b/n) | 0, mi, mj) ? c : b, cs[0]), centre = cellLL(ctr);
  let qa = 0, bd = Infinity; (axe.coords || []).forEach((ll, q) => { const d = distM(ll, centre); if (d < bd) { bd = d; qa = q; } });
  const surface = cs.length*cell*cell/1e6, couvert = cv/cs.length, dax = dmin*cell/1000;
  res.push({centre, mailles:cs, surface_km2:surface, couvert, distance_objectif_km:distM(centre, obj)/1000, distance_axe_km:dax, vue,
   duree_min:R.duree_min[mode], niveau:null, score:surface*couvert/(1 + dax), point_axe:axe.coords ? {q:qa, lonlat:axe.coords[qa]} : null, axe:axe.genre || null}); }
 const tot = res.reduce((a, z) => a + z.score, 0);
 res.forEach(z => z.niveau = ME.niveau(tot > 0 ? z.score/tot*100 : 0, D));
 res.sort((a, b) => b.score - a.score);
 const nb = o.nb_max || R.nb_max; if (res.length > nb) res.length = nb;
 if (!res.length) res.manque = "Aucune zone hors vue, à couvert, praticable, assez grande (" + need + " mailles) entre " + R.distance_objectif_km.min + " et " + R.distance_objectif_km.max + " km de l'objectif et à moins de " + R.distance_axe_max_m + " m de l'axe.";
 return res;
}
ME.zonesRegroupement = (unite, opts) => finir(_regGen(unite, opts));
ME.zonesRegroupementEtapes = (unite, opts) => _regGen(unite, opts);

/* ---------- scénario à plusieurs unités ---------- */
// unité planifiée complétée par le scénario (mode d'action, heure de départ)
ME.unitePlanifiee = (u, scen) => Object.assign({}, u, {mode:u.mode || u.mode_action || (scen && scen.mode_action) || "attaque",
 heure_depart_min:u.heure_depart_min != null ? +u.heure_depart_min : u.heure_depart != null ? _mins(u.heure_depart) : scen ? (scen.heure_depart_min != null ? +scen.heure_depart_min : _mins(scen.heure_depart)) : null});
function* _scenGen(scen, opts){
 const o = opts || {}, D = _D(o), par = {}, us = scen.unites || [];
 for (let i = 0; i < us.length; i++) {
  const u = ME.unitePlanifiee(us[i], scen), uo = Object.assign({}, o, {mode:u.mode});
  yield ["Unité " + (u.nom || u.id), i/us.length];
  const axes = yield* _axesGen(u, uo), g = scen.axe_choisi && scen.axe_choisi[u.id], choisi = axes.find(a => a.genre === g) || axes.find(a => a.plausibilite === "forte") || axes[0] || null;
  const MA = D.modes_action[u.mode], reg = choisi && MA.regroupe ? yield* _regGen(u, Object.assign({}, uo, {axe:choisi})) : [];
  const hor = choisi ? yield* _horairesGen(choisi, u, Object.assign({}, uo, {regroupement:reg[0] || null})) : {jalons:[], troncons:[], arrets:[]};
  par[u.id] = {unite:u, axes, manque:axes.manque || null, axe_choisi:choisi ? choisi.genre : null, horaires:hor, regroupements:reg};
 }
 return {par_unite:par};
}
ME.scenario = (scen, opts) => finir(_scenGen(scen, opts));
ME.scenarioEtapes = (scen, opts) => _scenGen(scen, opts);

/* ---------- 6. export, import, migration ---------- */
const _mg = ll => typeof CG !== "undefined" && CG.mgrs && ll ? CG.mgrs(ll[0], ll[1]) : undefined;
const CHAMPS_UNITE = ["id", "nom", "unite_type", "classe", "echelon", "elements", "front_km", "prof_km", "dispersion_min"];
const _pick = (u, champs) => { const r = {}; for (const f of champs) if (u[f] !== undefined) r[f] = u[f]; return r; };
ME.verifierReference = ref => {
 if (!ref || !ref.id) return {ok:false, terrain_ouvert:!!G, raison:"absente", message:"Référence au terrain absente du fichier."};
 if (!G || !G._pret) return {ok:false, terrain_ouvert:false, raison:"non_ouvert", message:`Aucun terrain ouvert : ouvrez le terrain « ${ref.nom || ref.id} » (${ref.id}) pour vérifier la référence.`};
 if (ref.id !== G.id) return {ok:false, terrain_ouvert:true, raison:"id", message:`Ce travail a été préparé sur le terrain « ${ref.nom || ref.id} » (${ref.id}), le terrain ouvert est « ${G.nom} » (${G.id}) : ouvrez le bon terrain.`};
 const e = ME.empreinteTerrain(G);
 if (ref.empreinte && ref.empreinte !== e) return {ok:false, terrain_ouvert:true, raison:"empreinte",
  message:`Le terrain « ${G.nom} » a changé depuis l'export (coupure d'ouvrage, saisie de cours d'eau ou paramètres) : empreinte du fichier ${ref.empreinte}, du terrain ouvert ${e}. Import refusé : rouvrez le terrain tel qu'il était, ou importez quand même (les résultats seront recalculés sur le terrain actuel).`};
 return {ok:true, terrain_ouvert:true, raison:null, message:""};
};
ME.exporter = (etat, opts) => {
 const o = opts || {}, e = etat || {}, D = e.doctrine_surcharge ? completerDoctrine(e.doctrine_surcharge) : _doc();
 const out = {format:"ennemi-gtia", version:3, nom:e.nom || (G && G.nom) || "Travail ennemi", date:o.date || new Date().toLocaleString("fr-FR"), t:Date.now(),
  terrain:ME.referenceTerrain(), doctrine_version:D.version};
 if (e.doctrine_surcharge && Object.keys(e.doctrine_surcharge).length) out.doctrine_surcharge = _clone(e.doctrine_surcharge);
 out.nos_positions = (e.nos_positions || []).map((a, i) => ({id:a.id || "p" + (i + 1), nom:a.nom || "Nous " + (i + 1), lonlat:_ll(a), mgrs:_mg(_ll(a))}));
 out.planification = {scenarios:((e.planification || {}).scenarios || []).map((s, i) => ({id:s.id || "s" + (i + 1), nom:s.nom || "Scénario " + (i + 1),
  mode_action:s.mode_action || "attaque", heure_depart:_hm(s.heure_depart_min != null ? s.heure_depart_min : _mins(s.heure_depart)),
  unites:(s.unites || []).map(u => { const r = _pick(u, CHAMPS_UNITE); r.depart = _ll(u.depart); r.objectifs = (u.objectifs || []).map(_ll);
   const h = u.heure_depart_min != null ? u.heure_depart_min : _mins(u.heure_depart); if (h != null) r.heure_depart = _hm(h);
   if (u.mode_action) r.mode_action = u.mode_action; return r; }),
  axe_choisi:Object.assign({}, s.axe_choisi || {})}))};
 const C = e.conduite || {};
 out.conduite = {heure:_hm(C.heure_min != null ? C.heure_min : _mins(C.heure)),
  unites:(C.unites || []).map(u => Object.assign(_pick(u, CHAMPS_UNITE), {mode_action:u.mode_action || u.mode || "attaque", en_mouvement:u.en_mouvement !== false, scenario_ref:u.scenario_ref || null})),
  contacts:(C.contacts || []).map((c, i) => ({id:c.id || "c" + (i + 1), unite:c.unite, lonlat:_ll(c), mgrs:_mg(_ll(c)), heure:_hm(_hc(c)), elements_vus:+c.elements_vus || 0, note:c.note || ""}))};
 if (o.resultats) out.resultats = typeof o.resultats === "object" ? _clone(o.resultats) : ME.resultats(e, {doctrine:D});
 return out;
};
// résultats pour la traçabilité (toujours recalculés à l'ouverture)
ME.resultats = (etat, opts) => {
 const o = opts || {}, D = _D(o), amis = (etat.nos_positions || []).map(_ll), dt = new Date();
 const r = {axes:{}, horaires:{}, zones_regroupement:{}, zones_a_survoler:[], heure_calcul:_hm(dt.getHours()*60 + dt.getMinutes())};
 for (const s of (etat.planification || {}).scenarios || []) {
  const x = ME.scenario(s, {doctrine:D, amis}); r.axes[s.id] = {}; r.horaires[s.id] = {}; r.zones_regroupement[s.id] = {};
  for (const id in x.par_unite) { const p = x.par_unite[id];
   r.axes[s.id][id] = p.axes.map(a => ({genre:a.genre, nom:a.nom, plausibilite:a.plausibilite, longueur_km:a.longueur_km, temps_min:a.temps_min, ouvrages:a.ouvrages, goulets:a.goulets, trace:a.coords}));
   r.horaires[s.id][id] = {axe:p.axe_choisi, jalons:p.horaires.jalons.map(j => ({nom:j.nom, id_ouvrage:j.id_ouvrage, lonlat:j.lonlat, distance_km:j.distance_km, heure:_hm(j.heure_min), incertitude_min:j.incertitude_min}))};
   r.zones_regroupement[s.id][id] = p.regroupements.map(z => ({centre:z.centre, surface_km2:z.surface_km2, couvert:z.couvert, distance_objectif_km:z.distance_objectif_km, duree_min:z.duree_min, niveau:z.niveau})); } }
 const C = etat.conduite || {}, h = C.heure_min != null ? C.heure_min : _mins(C.heure);
 if ((C.contacts || []).length && h != null) r.zones_a_survoler = ME.presence(C.unites || [], C.contacts, h, {doctrine:D, amis}).zones.map(z => Object.assign({}, z, {unites:undefined}));
 return r;
};
// document v3 → état interne (heures en minutes : heure_depart_min, heure_min)
function _etatDepuis(doc, av){
 const cl = (u, ou) => { if (ARMS.includes(u.classe)) return u.classe; const c = classeDepuisAncienType(u.classe || u.type); if (!c) av.push(ou + " : classe inconnue « " + (u.classe || u.type) + " », chenille retenue"); return c || "chenille"; };
 const sc = ((doc.planification || {}).scenarios || []).map(s => ({id:s.id, nom:s.nom, mode_action:DOCTRINE_MODES.includes(s.mode_action) ? s.mode_action : "attaque",
  heure_depart_min:_mins(s.heure_depart), axe_choisi:Object.assign({}, s.axe_choisi || {}),
  unites:(s.unites || []).map(u => { const r = Object.assign(_pick(u, CHAMPS_UNITE), {classe:cl(u, "unité « " + (u.nom || u.id) + " »"), depart:u.depart || null, objectifs:(u.objectifs || []).slice()});
   if (u.heure_depart != null) r.heure_depart_min = _mins(u.heure_depart); if (u.mode_action) r.mode_action = u.mode_action; return r; })}));
 const C = doc.conduite || {};
 return {nom:doc.nom, doctrine_surcharge:doc.doctrine_surcharge || null, nos_positions:(doc.nos_positions || []).map(a => ({id:a.id, nom:a.nom, lonlat:a.lonlat})),
  planification:{scenarios:sc},
  conduite:{heure_min:_mins(C.heure), unites:(C.unites || []).map(u => Object.assign(_pick(u, CHAMPS_UNITE), {classe:cl(u, "unité « " + (u.nom || u.id) + " »"), mode_action:u.mode_action || "attaque", en_mouvement:u.en_mouvement !== false, scenario_ref:u.scenario_ref || null})),
   contacts:(C.contacts || []).map(c => ({id:c.id, unite:c.unite, lonlat:c.lonlat, heure_min:_mins(c.heure), elements_vus:+c.elements_vus || 0, note:c.note || ""}))}};
}
ME.importer = (o, opts) => {
 const op = opts || {}, av = [];
 if (!o || typeof o !== "object") throw new Error("fichier illisible");
 let doc = o, terrain = null, migre = false;
 if (o.format === "ennemi-prepa-gtia" || o.format === "ennemi-conduite-gtia") { const m = ME.migrer(o); doc = m.document; terrain = m.terrain; av.push(...m.avertissements); migre = true; }
 else if (o.format !== "ennemi-gtia") throw new Error("ce n'est pas un fichier de l'outil Ennemi (formats lus : ennemi-gtia v3, ennemi-prepa-gtia v1, ennemi-conduite-gtia v1)");
 const v = +doc.version || 0;
 if (v > 3) throw new Error(`fichier ennemi de version ${v}, plus récente que cet outil (version 3) : mettez l'outil à jour`);
 if (v < 3) throw new Error("fichier ennemi-gtia de version " + (doc.version || "?") + " : seule la version 3 est lue (et les anciens ennemi-prepa-gtia / ennemi-conduite-gtia v1)");
 if (doc.doctrine_surcharge) { const d = validerDoctrine(doc.doctrine_surcharge); if (!d.ok) { av.push("doctrine du fichier invalide, doctrine par défaut employée : " + d.erreurs.join(" ; ")); doc.doctrine_surcharge = null; } }
 const ver = ME.verifierReference(doc.terrain);
 // refus clair : terrain ouvert différent (autre zone, ou même zone modifiée) ; un ancien fichier qui inclut son terrain n'est
 // pas refusé (l'interface ouvre le terrain inclus) ; opts.forcer : importer quand même, avec avertissement
 if (!ver.ok && ver.terrain_ouvert && !op.forcer && !terrain) return {etat:null, document:doc, reference:doc.terrain, terrain, avertissements:av, verification:ver, refus:ver.message};
 if (!ver.ok) av.push(ver.message);
 return {etat:_etatDepuis(doc, av), document:doc, reference:doc.terrain, terrain, avertissements:av, verification:ver, refus:null};
};
// référence d'un terrain inclus dans un ancien fichier (document terrain-gtia v2/v3, ou zone enregistrée ancienne)
function _referenceDe(t, av){
 if (!t || typeof t !== "object") return null;
 if (t.format === "terrain-gtia") { const f = t.faits || {};
  return {id:t.id || idFichier(t), nom:t.nom, date:t.date, empreinte:ME.empreinteTerrain(t), bbox:f.bbox, n:f.n, maille_m:f.maille_m, empreinte_reconstituee:true}; }
 const f = t.faits;
 if (f && f.b) { const pseudo = {format:"terrain-gtia", faits:{bbox:f.b, n:f.n, maille_m:f.cell}, parametres:t.parametres, coupures:t.coupures || [], saisies_eau:t.saisies_eau || []};
  av.push("terrain inclus au format de zone ancien : empreinte reconstituée, à recalculer après ouverture du terrain");
  return {id:t.id, nom:t.nom, date:t.date, empreinte:ME.empreinteTerrain(pseudo), bbox:f.b, n:f.n, maille_m:f.cell, empreinte_reconstituee:true}; }
 return null;
}
ME.migrer = o => {
 const av = [], D0 = _doc(), sur = {};
 if (!o || (o.format !== "ennemi-prepa-gtia" && o.format !== "ennemi-conduite-gtia")) throw new Error("migration : format attendu ennemi-prepa-gtia ou ennemi-conduite-gtia (v1)");
 if (+o.version > 1) throw new Error(o.format + " de version " + o.version + " inconnue");
 const ti = o.terrain || null, terrain = ti ? (ti.format === "terrain-gtia-zone" ? ti.zone : ti) : null, ref = _referenceDe(terrain, av);
 if (!ref) av.push("fichier sans terrain inclus lisible : ouvrez le terrain d'origine avant de reprendre ce travail");
 // doctrine v1 : modèles → unités types (fusionnées avec la doctrine par défaut), vitesse tactique → vitesses_pct.<classe>.attaque
 const dv = o.doctrine || {}, types = _clone(D0.unites_types); let typesChanges = false;
 const echelonDe = nb => DOCTRINE_ECHELONS.reduce((a, e) => Math.abs(D0.echelons[e].vehicules - nb) < Math.abs(D0.echelons[a].vehicules - nb) ? e : a, DOCTRINE_ECHELONS[0]);
 for (const m of dv.modeles || []) { const classe = classeDepuisAncienType(m.type); if (!classe) { av.push("modèle « " + m.nom + " » : type inconnu « " + m.type + " », ignoré"); continue; }
  const t = types.find(x => x.nom === m.nom), val = {classe, elements:+m.nb, front_km:+m.front_km, prof_km:+m.prof_km, dispersion_min:+m.dispersion_min};
  if (t) { if (["classe", "elements", "front_km", "prof_km", "dispersion_min"].some(f => t[f] !== val[f])) { Object.assign(t, val); t.composition = [{designation:t.element || "élément", nombre:val.elements, classe}]; typesChanges = true; } }
  else { types.push(Object.assign({id:"v1-" + String(m.nom).toLowerCase().normalize("NFD").replace(/[^\w]+/g, "-"), nom:m.nom, echelon:echelonDe(+m.nb), element:classe === "fantassin" ? "groupe" : "véhicule"}, val,
   {composition:[{designation:m.nom, nombre:val.elements, classe}]})); typesChanges = true; } }
 if (typesChanges) sur.unites_types = types;
 for (const [t, x] of Object.entries(dv.types || {})) { const classe = classeDepuisAncienType(t), v = x && +x.vitesse_tactique_pct;
  if (classe && v > 0 && v !== D0.vitesses_pct[classe].attaque) (sur.vitesses_pct = sur.vitesses_pct || {})[classe] = {attaque:v}; }
 const Dm = completerDoctrine(sur);
 if (!validerDoctrine(sur).ok) { av.push("doctrine de l'ancien fichier incohérente, doctrine par défaut employée"); for (const k in sur) delete sur[k]; }
 const typeDe = (e, classe) => Dm.unites_types.find(x => x.nom === e.nom && x.classe === classe) || ME.uniteType(Dm.unite_par_defaut[classe], Dm);
 const uniteV1 = (e, id) => { const classe = classeDepuisAncienType(e && e.type) || "chenille", t = typeDe(e || {}, classe);
  return {id, nom:(e && e.nom) || t.nom, unite_type:t.id, classe, echelon:t.echelon, elements:e && e.nb != null ? +e.nb : t.elements,
   front_km:e && e.front_km != null ? +e.front_km : t.front_km, prof_km:e && e.prof_km != null ? +e.prof_km : t.prof_km, dispersion_min:e && e.dispersion_min != null ? +e.dispersion_min : t.dispersion_min}; };
 // indices d'ouvrage des anciens axes → id_ouvrage, seulement si le terrain ouvert est celui du fichier (ordre des ouvrages identique)
 const conv = !!(G && G._pret && ref && G.id === ref.id), idOuv = i => i != null && i >= 0 && G.feats[i] ? G.feats[i].id : null, res = {axes:{}};
 let axesV1 = false;
 const scenV1 = (s, i, exp) => { const sid = "s" + (s.id != null ? s.id : i + 1), uid = sid + "-u1", u = uniteV1(s.ennemi, uid);
  u.depart = s.depart || null; u.objectifs = (s.objectifs || []).slice();
  const ax = s.axe != null ? s.axe : s.axe_choisi, sc = {id:sid, nom:s.nom || "Scénario " + (i + 1), mode_action:"attaque", heure_depart:s.h0 || s.heure_depart || null, unites:[u], axe_choisi:ax ? {[uid]:ax} : {}};
  const axes = (exp || s).axes;
  if (Array.isArray(axes) && axes.length) { axesV1 = true;
   if (conv) { res.axes[sid] = {[uid]:axes.map(a => ({genre:a.genre, nom:a.nom, plausibilite:a.plausibilite, longueur_km:a.longueur_km, temps_min:a.temps_min,
    ouvrages:(a.horaires || []).map(h => idOuv(h.ouvrage)).filter(Boolean), goulets:(a.goulets || []).map(idOuv).filter(Boolean), trace:a.trace}))}; } }
  return sc; };
 const doc = {format:"ennemi-gtia", version:3, nom:o.nom || (ref && ref.nom) || "Travail repris", date:o.date || "", t:Date.now(), terrain:ref, migre_de:o.format + " v1",
  nos_positions:[], planification:{scenarios:[]}, conduite:{heure:null, unites:[], contacts:[]}};
 if (Object.keys(sur).length) { doc.doctrine_surcharge = sur; doc.doctrine_version = D0.version; }
 const S = o.saisies || {};
 doc.nos_positions = (S.amis || []).map((a, i) => ({id:"p" + (i + 1), nom:"Nous " + (i + 1), lonlat:_ll(a)}));
 if (o.format === "ennemi-prepa-gtia") {
  const exps = o.scenarios || [], src = Array.isArray(S.scen) && S.scen.length ? S.scen : exps;
  doc.planification.scenarios = src.map((s, i) => scenV1(s, i, exps.find(x => x.id === s.id)));
 } else {
  const SCN = o.scenarios_prepa || [];
  doc.planification.scenarios = SCN.map((s, i) => scenV1(s, i, s));
  const en = S.enemy || {mode:"inconnu", type:(o.ennemi && o.ennemi.type) || "meca", scen:0}, mouv = S.mouv != null ? !!S.mouv : o.en_mouvement !== false;
  let u;
  if (en.mode === "connu" && doc.planification.scenarios[en.scen]) { const sc = doc.planification.scenarios[en.scen], up = sc.unites[0];
   u = Object.assign(_pick(up, CHAMPS_UNITE), {id:"u1", scenario_ref:{scenario:sc.id, unite:up.id}}); }
  else { const classe = classeDepuisAncienType(en.type) || "chenille", t = ME.uniteType(Dm.unite_par_defaut[classe], Dm);
   u = {id:"u1", nom:(o.ennemi && o.ennemi.nom) || "Ennemi inconnu (" + classe + ")", unite_type:t.id, classe, echelon:t.echelon,
    elements:o.ennemi && o.ennemi.nb != null && !o.ennemi.connu ? +o.ennemi.nb : t.elements, front_km:t.front_km, prof_km:t.prof_km, dispersion_min:t.dispersion_min, scenario_ref:null}; }
  Object.assign(u, {mode_action:"attaque", en_mouvement:mouv});
  doc.conduite.unites = [u];
  const cts = S.contacts || o.contacts || [];
  doc.conduite.contacts = cts.map((c, i) => ({id:"c" + (c.id != null ? c.id : i + 1), unite:"u1", lonlat:_ll(c), heure:_hm(_hc(c)), elements_vus:+(c.vus != null ? c.vus : c.elements_vus) || 0, note:""}));
  const hs = cts.map(_hc).filter(h => h != null);
  const ec = h => Math.max(...hs.map(x => (((h - x) % 1440) + 1440) % 1440));   // h dont tous les autres contacts sont les plus proches dans le passé
  const hl = hs.length ? hs.reduce((b, h) => ec(h) < ec(b) ? h : b, hs[0]) : null;   // dernier contact (passage de minuit)
  doc.conduite.heure = _hm(S.heure != null ? (hl != null && _ecart(S.heure, hl) < 0 ? hl : S.heure) : hl);
 }
 if (axesV1) { if (conv) doc.resultats = res; else av.push("indices d'ouvrage des anciens axes non convertis (terrain du fichier non ouvert) : les axes seront recalculés"); }
 return {document:doc, terrain, avertissements:av};
};

})();

if (typeof module !== "undefined" && module.exports) module.exports = {ME};
