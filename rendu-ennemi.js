/* rendu-ennemi.js – affichage sur la carte et export KML de l'outil Ennemi (ennemi.html). LOT B.
   Ne calcule rien de tactique : dessine les résultats de moteur-ennemi.js (ME) sur une carte MapLibre, et les exporte
   en KML (CG.kml). Tout est rangé dans l'objet RE. Aucune coordonnée décimale à l'écran : MGRS seul (CG.mgrs). Pas de GPS.

   DÉPENDANCES
   - commun.js (CG : kml, mgrs, cercle), moteur-terrain.js (G du terrain ouvert : b, n, cls, feats, coupe).
   - rendu-lisse.js pour le RENDU LISSÉ (mêmes fonctions que l'outil Terrain, espace de noms RT : tailleLisse, adoucir,
     poids, plusFort, champsDe, contours ; couleurs COL, ALPHA_GO) : <script src="rendu-lisse.js"> AVANT rendu-ennemi.js
     (une seule globale, RT ; rendu synchrone ; erreur claire s'il manque). RE.pret() → Promise déjà résolue (compatibilité).

   Couleurs imposées (= RT.COL de rendu-lisse.js) : NO-GO rouge, SLOW-GO orange, GO vert (plus transparent), eau bleue.
   Ennemi en rouges / magentas (une teinte par unité, RE.couleurUnite) ; nos positions en bleu (RE.AMI).

   SIGNATURES (étape 0, conservées ; ajouts marqués +)
   RE.init(map) : crée sources et couches (vides) dans l'ordre d'empilement RE.COUCHES. Dans CG.quandPret. Idempotent.
     Chaque groupe de RE.COUCHES a une couche MapLibre de même id, et des couches annexes « <id>-… ».
   RE.terrain(map, G, classe, opts) : fond de mobilité lissé de la classe (G.cls[classe] : 0 eau, 1 NO-GO, 2 SLOW-GO,
     3 GO) + ouvrages coupés (croix rouge) ou dégradés (croix orange) d'après G.coupe. opts {opacite (0,75), visible}.
     Renvoie la durée du rendu en ms (+).
   RE.axes(map, axes, opts) : axes = [axe] (une unité : opts.unite ou axe.unite) ou {<id unité>: [axe]} (plusieurs).
     Trait par plausibilité : forte = épais plein, moyenne = moyen tireté, faible = fin pointillé ; couleur de l'unité.
     opts {unite: id de l'unité sélectionnée, choisi: genre | {<id>: genre}, G}. Axe choisi = liseré blanc, autres
     axes de l'unité sélectionnée estompés. Sur les axes choisis : ouvrages (axe.ouvrages, id_ouvrage → G.feats),
     goulets (anneau rouge), point de décision (axe.point_decision {lonlat} si le moteur le donne, sinon point où l'axe
     choisi quitte les autres axes de la même unité, à plus de 300 m).
   RE.horaires(map, horaires, opts) : horaires = {jalons, troncons} (ME.horaires) ou {<id unité>: {jalons, troncons}}.
     Étiquettes « hh:mm ±x » (+ nom de l'ouvrage) ; goulet = cadre rouge ; masquées par collision aux petits zooms.
     opts {unite}.
   RE.colonne(map, position, opts) : position (ME.positionSurAxe) ou {<id unité>: position} ; null efface.
     Trace tête → queue en trait épais, symbole de l'unité à la tête. opts {unite, unites:[unité] (classe, échelon)}.
   RE.isochrones(map, iso, G, opts) : contours lissés de « arrivee_min ≤ t0 + délai » (ME.isochrones) avec étiquette
     « T+x min (hh:mm) ». opts {delais (défaut iso.delais), t0 (défaut : plus petite heure d'arrivée = heure du
     premier contact ou du départ)}.
   RE.presence(map, presence, G, opts) : présence probable (ME.presence.Q, lissée, dégradé violet) et zones à survoler
     (presence.zones : cercle, numéro = rang, trait d'ordre de survol 1 → 2 → …). opts {opacite, doctrine (rayon si la zone
     n'en donne pas ; défaut DOCTRINE)}.
   RE.regroupements(map, zones, opts) : zones = [zoneR] ou {<id>: [zoneR]} (ME.zonesRegroupement) ; contour lissé des
     mailles, étiquette « Regroupement n – durée » (une seule pour une même zone ; « <nom> : regroupement n – durée » si plusieurs
     unités et opts.noms). opts {G, noms:{<id>: nom}} (+).
   RE.saisies(map, etat, opts) : unités (symbole OTAN simplifié rouge, au départ en planification, au contact le plus
     récent en conduite), objectifs, nos positions (bleu), contacts horodatés (point + « hh:mm », trace dans l'ordre
     des heures). etat = forme de l'export ennemi-gtia v3 (CONTRAT-JSON.md) : {nos_positions, planification:{scenarios},
     conduite:{unites, contacts}} ; heures « hh:mm » ou *_min. opts {mode: "planification"|"conduite"|"tous" (défaut
     "tous"), scenario: id (défaut : tous les scénarios)} (+).
   RE.effacer(map, couches?) : vide les groupes nommés (tous par défaut).
   RE.kml(etat, resultats, opts) → texte KML via CG.kml ; descriptions en MGRS, noms en français, lon,lat.
     resultats {axes:{<id>:[axe]}, choisi:{<id>:genre}, horaires:{<id>:{jalons, troncons}}, isochrones:{arrivee_min,
     delais, t0}, presence:{zones}, regroupements:[zoneR] | {<id>:[zoneR]}} ; opts {titre, note, G, doctrine}. Gués sans pont
     (axe.franchissements, jalon.gue) décrits dans les axes et les jalons.
     Dossiers : Unités ennemies, Axes, Points de décision, Jalons et horaires, Isochrones, Zones de regroupement,
     Zones à survoler, Contacts, Nos positions (vides omis).
   RE.legende(etat, couchesVisibles) → HTML de la légende des seules couches visibles ET non vides (couchesVisibles :
     liste d'ids de RE.COUCHES ; défaut : RE.couchesVisibles(dernière carte)).
   + RE.couchesVisibles(map) → ids des groupes affichés et non vides.
   + RE.afficher(map, groupe, oui) : montre / masque un groupe (toutes ses couches).
   + RE.legendeCarte(map, etat, opts) : légende posée sur la carte (div #reLeg dans le conteneur), mise à jour ; COMPACTE et
     REPLIABLE (bouton « Légende »), placée dans le coin qui cache le moins de résultats, sans couvrir opts.eviter ; repliée par
     défaut si elle recouvre encore un résultat (tête : couleurs du terrain s'il est affiché). opts {gauche, droite, haut, bas (px), eviter:[Element]}.
   + RE.legendeTerrain(couchesVisibles) → HTML des couleurs GO / SLOW-GO / NO-GO / eau si le terrain est affiché, sinon "".
   + RE.etiquettesPlacees(map) → [{source, box}] : étiquettes des saisies et regroupements placées sans chevauchement (décalage).
   + RE.replierLegende(map, oui) : repli forcé (true), dépli forcé (false), placement automatique (null).
   + RE.couleurUnite(id) → couleur (rouge / magenta) stable de l'unité.
   + RE.symboleURL(o) → image (data URL) du symbole {camp:"ennemi"|"ami", classe, echelon, unite_type}.
   + RE.pret() → Promise (rendu lissé disponible). */
"use strict";
const RE = {};
RE.COULEURS = {nogo:"#c8282d", slowgo:"#eb8c1e", go:"#2ea043", eau:"#1e5ac8"};   // = RT.COL (rendu-lisse.js)
RE.COUCHES = ["en-terrain", "en-presence", "en-iso", "en-regroup", "en-axes", "en-colonne", "en-horaires", "en-saisies"];   // ordre d'empilement : étiquettes de jalons au-dessus de la colonne
RE.AMI = "#1565c0";
RE.UNITES_COUL = ["#c62828", "#ad1457", "#8e1b8e", "#d84315", "#6d1b1b", "#e53970"];
RE.ISO_COUL = ["#3d0a5c", "#6a1b9a", "#9c3fc0", "#c47fd8", "#e0b3ea"];
const _FC0 = () => ({type:"FeatureCollection", features:[]});
const _fc = f => ({type:"FeatureCollection", features:f});
const _pt = (ll, p) => ({type:"Feature", properties:p || {}, geometry:{type:"Point", coordinates:ll}});
const _li = (c, p) => ({type:"Feature", properties:p || {}, geometry:{type:"LineString", coordinates:c}});
const _hm = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(m/60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
const _min = h => typeof h === "number" ? h : (h == null ? NaN : (([a, b]) => (+a || 0)*60 + (+b || 0))(String(h).split(":")));
const _esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const _mg = ll => (typeof CG !== "undefined" && ll) ? CG.mgrs(ll[0], ll[1]) : "";
const _G = o => (o && o.G) || (typeof G !== "undefined" ? G : null);
const _num = (x, d = 1) => Number(x).toLocaleString("fr-FR", {maximumFractionDigits:d});
RE.OUV_LBL = {pont:"Pont", gue:"Gué", deniv:"Passage dénivelé", tunnel:"Tunnel", echangeur:"Échangeur", fer:"Passage voie ferrée"};
RE.ECH_LBL = {section:"section", compagnie:"compagnie", bataillon:"bataillon"};
RE.CLS_LBL = {chenille:"chenillé", roue:"roue", logistique:"logistique", fantassin:"à pied"};
RE.PLAUS_LBL = {forte:"plausibilité forte", moyenne:"plausibilité moyenne", faible:"plausibilité faible"};
RE.GENRE_LBL = {rapide:"axe le plus rapide", sur:"axe le plus discret", variante:"variante"};   // même terme que le moteur (« le plus discret »)
// rayon d'une zone à survoler : celui donné par le moteur (zone.rayon_m), sinon la doctrine (opts.doctrine, sinon DOCTRINE) ; jamais en dur
const _rayon = (z, o) => { if (+z.rayon_m > 0) return +z.rayon_m; const D = (o && o.doctrine) || (typeof DOCTRINE !== "undefined" ? DOCTRINE : null);
 return D && D.zones_a_survoler && +D.zones_a_survoler.rayon_m > 0 ? +D.zones_a_survoler.rayon_m : 0; };

/* ---------- rendu lissé : noyau commun rendu-lisse.js (espace de noms RT, chargé par <script> avant ce fichier) ---------- */
// Plus de chargement par fetch + Function (fragile en fichier local et avec une politique de sécurité stricte) : la page charge
// rendu-lisse.js, qui n'ajoute qu'une globale (RT). Sans lui, erreur claire dès le chargement.
if (typeof RT === "undefined" || typeof RT.contours !== "function") throw new Error("rendu-ennemi.js : charger rendu-lisse.js avant ce fichier (<script src=\"rendu-lisse.js\">)");
const _RT = RT;
RE.pret = () => Promise.resolve(_RT);   // compatibilité : le rendu lissé est disponible dès le chargement
const _avecRT = f => f();

/* ---------- images (symboles, étiquettes) dessinées sur canevas : pas de serveur de polices ---------- */
const _PR = 2;
const _canevas = (w, h) => { const c = document.createElement("canvas"); c.width = Math.ceil(w*_PR); c.height = Math.ceil(h*_PR); const g = c.getContext("2d"); g.scale(_PR, _PR); return {c, g}; };
const _TAILLE = new Map();   // image → [largeur, hauteur] en px d'écran (placement des étiquettes sans chevauchement)
const _ajImg = (map, id, c) => { if (!_TAILLE.has(id)) _TAILLE.set(id, [c.width/_PR, c.height/_PR]); if (map.hasImage(id)) return id; map.addImage(id, c.getContext("2d").getImageData(0, 0, c.width, c.height), {pixelRatio:_PR}); return id; };
const _FONT = "600 12px system-ui, Segoe UI, Roboto, sans-serif";
// étiquette : texte sur fond blanc, cadre de couleur
function _etiquette(map, texte, coul, opts){
 const o = opts || {}, id = "re-et:" + (coul || "") + ":" + (o.fond || "") + ":" + texte; if (map.hasImage(id)) return id;
 const m = document.createElement("canvas").getContext("2d"); m.font = o.font || _FONT;
 const w = Math.ceil(m.measureText(texte).width) + 10, h = 18, {c, g} = _canevas(w + 2, h + 2);
 g.font = o.font || _FONT; g.textBaseline = "middle";
 g.beginPath(); g.roundRect ? g.roundRect(1, 1, w, h, 4) : g.rect(1, 1, w, h);
 g.fillStyle = o.fond || "rgba(255,255,255,.93)"; g.fill(); g.lineWidth = o.epais || 1.5; g.strokeStyle = coul || "#1d2430"; g.stroke();
 g.fillStyle = o.texte || "#1d2430"; g.fillText(texte, 6, 1 + h/2 + 0.5);
 return _ajImg(map, id, c);
}
// symbole OTAN simplifié (APP-6) : ennemi = losange rouge, ami = rectangle bleu ; signe de l'arme ; échelon au-dessus
function _symbole(o){
 const ami = o.camp === "ami", W = 40, H = 40, {c, g} = _canevas(W, H), cx = W/2, cy = 23;
 g.lineJoin = g.lineCap = "round";
 g.beginPath();
 if (ami) g.rect(cx - 15, cy - 10, 30, 20); else { g.moveTo(cx, cy - 15); g.lineTo(cx + 15, cy); g.lineTo(cx, cy + 15); g.lineTo(cx - 15, cy); g.closePath(); }
 g.fillStyle = ami ? "#80c8ff" : "#ff8a80"; g.fill(); g.lineWidth = 2; g.strokeStyle = ami ? RE.AMI : (o.couleur || "#c62828"); g.stroke();
 g.save(); g.clip(); g.strokeStyle = "#111"; g.lineWidth = 1.5; g.beginPath();
 const k = o.classe, char = /char/i.test(o.unite_type || "");
 const L = ami ? 15 : 8, Hh = ami ? 10 : 8;
 if (k !== "logistique" && !char) { g.moveTo(cx - L, cy - Hh); g.lineTo(cx + L, cy + Hh); g.moveTo(cx + L, cy - Hh); g.lineTo(cx - L, cy + Hh); }   // infanterie : X
 if (k === "chenille") { g.moveTo(cx + 7, cy); g.ellipse(cx, cy, 7, 4, 0, 0, 2*Math.PI); }                                                    // chenillé : ovale
 if (k === "logistique") { g.moveTo(cx - 15, cy + 5); g.lineTo(cx + 15, cy + 5); }                                                          // soutien : trait bas
 g.stroke(); g.restore();
 if (k === "roue") { g.strokeStyle = "#111"; g.lineWidth = 1.3; for (const dx of [-5, 5]) { g.beginPath(); g.arc(cx + dx, cy + 18, 2.2, 0, 2*Math.PI); g.stroke(); } }   // à roues
 g.fillStyle = "#111"; g.strokeStyle = "#111"; g.lineWidth = 1.6;
 const e = o.echelon; if (e === "section") for (const dx of [-5, 0, 5]) { g.beginPath(); g.arc(cx + dx, 4, 1.6, 0, 2*Math.PI); g.fill(); }
 else if (e === "compagnie") { g.beginPath(); g.moveTo(cx, 1); g.lineTo(cx, 7); g.stroke(); }
 else if (e === "bataillon") { g.beginPath(); g.moveTo(cx - 2.5, 1); g.lineTo(cx - 2.5, 7); g.moveTo(cx + 2.5, 1); g.lineTo(cx + 2.5, 7); g.stroke(); }
 return c;
}
const _symId = o => ["re-sym", o.camp || "ennemi", o.classe || "", o.echelon || "", /char/i.test(o.unite_type || "") ? "char" : "", o.couleur || ""].join(":");
const _symMap = (map, o) => { const id = _symId(o); return map.hasImage(id) ? id : _ajImg(map, id, _symbole(o)); };
const _URL = {};
RE.symboleURL = o => _URL[_symId(o)] || (_URL[_symId(o)] = _symbole(o).toDataURL());
// pictogrammes simples
function _picto(type, coul){
 const {c, g} = _canevas(22, 22); g.lineJoin = g.lineCap = "round";
 if (type === "coupe" || type === "degrade") { g.strokeStyle = "#fff"; g.lineWidth = 6; g.beginPath(); g.moveTo(4, 4); g.lineTo(18, 18); g.moveTo(18, 4); g.lineTo(4, 18); g.stroke();
  g.strokeStyle = coul; g.lineWidth = 3.2; g.stroke(); }
 else if (type === "ouvrage") { g.fillStyle = "#fff"; g.strokeStyle = "#1d2430"; g.lineWidth = 2; g.beginPath(); g.rect(6, 6, 10, 10); g.fill(); g.stroke(); }
 else if (type === "goulet") { g.strokeStyle = "#d50000"; g.lineWidth = 3; g.beginPath(); g.arc(11, 11, 8, 0, 2*Math.PI); g.stroke(); }
 else if (type === "pd") { g.fillStyle = "#ffd600"; g.strokeStyle = "#1d2430"; g.lineWidth = 2; g.beginPath(); g.moveTo(11, 1.5); g.lineTo(20.5, 11); g.lineTo(11, 20.5); g.lineTo(1.5, 11); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = "#1d2430"; g.font = "700 8px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("PD", 11, 11.5); }
 else if (type === "objectif") { g.strokeStyle = coul; g.lineWidth = 2; g.beginPath(); g.moveTo(5, 21); g.lineTo(5, 2); g.stroke(); g.fillStyle = coul; g.beginPath(); g.moveTo(5, 2); g.lineTo(19, 6.5); g.lineTo(5, 11); g.closePath(); g.fill(); }
 else if (type === "contact") { g.fillStyle = coul; g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.arc(11, 11, 6, 0, 2*Math.PI); g.fill(); g.stroke(); }
 else if (type === "jalon") { g.fillStyle = "#fff"; g.strokeStyle = coul; g.lineWidth = 2.5; g.beginPath(); g.arc(11, 11, 4.5, 0, 2*Math.PI); g.fill(); g.stroke(); }
 return c;
}
const _pictoMap = (map, type, coul) => { const id = "re-pi:" + type + ":" + (coul || ""); return map.hasImage(id) ? id : _ajImg(map, id, _picto(type, coul)); };
const _pictoURL = (type, coul) => _URL["p" + type + coul] || (_URL["p" + type + coul] = _picto(type, coul).toDataURL());
function _numero(map, n){
 const id = "re-num:" + n; if (map.hasImage(id)) return id;
 const {c, g} = _canevas(24, 24); g.fillStyle = "#4a148c"; g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.arc(12, 12, 10, 0, 2*Math.PI); g.fill(); g.stroke();
 g.fillStyle = "#fff"; g.font = "700 12px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(n), 12, 12.5);
 return _ajImg(map, id, c);
}

/* ---------- couleurs d'unité ---------- */
const _COUL = new Map();
RE.couleurUnite = id => { const k = String(id == null ? "?" : id); if (!_COUL.has(k)) _COUL.set(k, RE.UNITES_COUL[_COUL.size % RE.UNITES_COUL.length]); return _COUL.get(k); };

/* ---------- couches ---------- */
const _vide1 = () => { const c = document.createElement("canvas"); c.width = c.height = 1; return c; };
const _CV = {};   // groupe raster → canevas de sa source
const _ETAT = {map:null, dessin:{}};   // ce qui est dessiné (légende)
const _sym = (id, src, extra) => Object.assign({id, type:"symbol", source:src, layout:{"icon-image":["get", "ic"], "icon-allow-overlap":true, "icon-ignore-placement":false}}, extra || {});
RE.init = map => {
 _ETAT.map = map;
 if (map.getSource("en-terrain")) return;
 map.on("move", () => _terrainZBouge(map)); map.on("moveend", () => { clearTimeout(_TZ.t); _TZ.t = setTimeout(() => _terrainZ(map), 60); _decaler(map); });
 const coords = [[0, 1], [1, 1], [1, 0], [0, 0]];
 const add = (id, ...couches) => { if (!map.getSource(id)) map.addSource(id, {type:"geojson", data:_FC0()}); couches.forEach(l => map.addLayer(l)); };
 for (const k of ["en-terrain", "en-presence"]) { _CV[k] = _vide1();
  map.addSource(k, {type:"canvas", canvas:_CV[k], coordinates:coords, animate:false});
  map.addLayer({id:k, type:"raster", source:k, layout:{visibility:"none"}, paint:{"raster-opacity":k === "en-terrain" ? 0.75 : 0.85, "raster-resampling":"linear", "raster-fade-duration":0}});
  if (k === "en-terrain") { _CV["en-terrain-z"] = _vide1();
   map.addSource("en-terrain-z", {type:"canvas", canvas:_CV["en-terrain-z"], coordinates:coords, animate:false});
   map.addLayer({id:"en-terrain-z", type:"raster", source:"en-terrain-z", layout:{visibility:"none"}, paint:{"raster-opacity":0.75, "raster-resampling":"linear", "raster-fade-duration":0}});
   add("en-terrain-eau", {id:"en-terrain-eau", type:"line", source:"en-terrain-eau", layout:{"line-cap":"round", "line-join":"round"}, paint:{"line-color":RE.COULEURS.eau, "line-width":2, "line-opacity":0.9}});
   add("en-terrain-coup", _sym("en-terrain-coup", "en-terrain-coup", {layout:{"icon-image":["get", "ic"], "icon-allow-overlap":true}})); }
  else add("en-presence-z", {id:"en-presence-z", type:"fill", source:"en-presence-z", filter:["==", ["geometry-type"], "Polygon"], paint:{"fill-color":"#6a1b9a", "fill-opacity":0.10}},
   {id:"en-presence-zl", type:"line", source:"en-presence-z", paint:{"line-color":"#4a148c", "line-width":2.5}, filter:["==", ["get", "k"], "zone"]},
   {id:"en-presence-zo", type:"line", source:"en-presence-z", paint:{"line-color":"#4a148c", "line-width":1.5, "line-dasharray":[3, 2]}, filter:["==", ["get", "k"], "ordre"]},
   _sym("en-presence-zn", "en-presence-z", {filter:["==", ["geometry-type"], "Point"], layout:{"icon-image":["get", "ic"], "icon-allow-overlap":true, "symbol-sort-key":["get", "rang"]}})); }
 add("en-iso", {id:"en-iso", type:"line", source:"en-iso", layout:{"line-join":"round"}, paint:{"line-color":["get", "couleur"], "line-width":2.2}});
 add("en-iso-et", _sym("en-iso-et", "en-iso-et", {layout:{"icon-image":["get", "ic"], "icon-allow-overlap":true}}));
 add("en-regroup", {id:"en-regroup", type:"fill", source:"en-regroup", filter:["==", ["geometry-type"], "Polygon"], paint:{"fill-color":["get", "couleur"], "fill-opacity":0.22}},
  {id:"en-regroup-l", type:"line", source:"en-regroup", filter:["==", ["geometry-type"], "Polygon"], paint:{"line-color":["get", "couleur"], "line-width":2, "line-dasharray":[2, 1.5]}});
 const aLigne = (id, plaus, w, dash) => ({id, type:"line", source:"en-axes", filter:["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "plaus"], plaus]],
  layout:{"line-join":"round", "line-cap":dash ? "butt" : "round"}, paint:Object.assign({"line-color":["get", "couleur"], "line-width":w, "line-opacity":["case", ["==", ["get", "estompe"], 1], 0.45, 1]}, dash ? {"line-dasharray":dash} : {})});
 add("en-axes", {id:"en-axes-halo", type:"line", source:"en-axes", filter:["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "sel"], 1]], layout:{"line-join":"round", "line-cap":"round"},
   paint:{"line-color":"#fff", "line-width":["match", ["get", "plaus"], "forte", 11, "moyenne", 9, 7], "line-opacity":0.95}},
  aLigne("en-axes-faible", "faible", 2.5, [1, 1.6]), aLigne("en-axes-moyenne", "moyenne", 3.5, [3, 1.5]), aLigne("en-axes", "forte", 5.5, null),
  _sym("en-axes-pts", "en-axes", {filter:["==", ["geometry-type"], "Point"], layout:{"icon-image":["get", "ic"], "icon-allow-overlap":true, "symbol-sort-key":["get", "ordre"]}}));
 add("en-colonne", {id:"en-colonne-bord", type:"line", source:"en-colonne", filter:["==", ["geometry-type"], "LineString"], layout:{"line-cap":"round", "line-join":"round"}, paint:{"line-color":"#fff", "line-width":10}},
  {id:"en-colonne", type:"line", source:"en-colonne", filter:["==", ["geometry-type"], "LineString"], layout:{"line-cap":"round", "line-join":"round"}, paint:{"line-color":"#111", "line-width":6}},
  _sym("en-colonne-tete", "en-colonne", {filter:["==", ["geometry-type"], "Point"], layout:{"icon-image":["get", "ic"], "icon-allow-overlap":true, "icon-anchor":["coalesce", ["get", "ancre"], "center"]}}));
 add("en-horaires", _sym("en-horaires-pt", "en-horaires", {filter:["==", ["get", "k"], "pt"], layout:{"icon-image":["get", "ic"], "icon-allow-overlap":true}}),
  _sym("en-horaires", "en-horaires", {filter:["==", ["get", "k"], "et"], layout:{"icon-image":["get", "ic"], "icon-anchor":"left", "icon-offset":[9, 0], "icon-allow-overlap":false, "icon-optional":false, "symbol-sort-key":["get", "prio"]}}));
 // étiquettes des regroupements : au-dessus des axes et de la colonne (aucun trait ne les barre), sous les saisies ; elles ne masquent
 // pas les étiquettes de jalons (ignore-placement) : c'est _decaler qui les écarte de celles-ci
 map.addLayer(_sym("en-regroup-et", "en-regroup", {filter:["==", ["geometry-type"], "Point"], layout:{"icon-image":["get", "ic"], "icon-allow-overlap":true, "icon-ignore-placement":true, "icon-anchor":["coalesce", ["get", "ancre"], "top"],
  "icon-offset":["coalesce", ["get", "decal"], ["literal", [0, 6]]]}}));
 add("en-saisies", {id:"en-saisies-trace", type:"line", source:"en-saisies", filter:["==", ["geometry-type"], "LineString"], paint:{"line-color":["get", "couleur"], "line-width":1.8, "line-dasharray":[2, 2]}},
  _sym("en-saisies", "en-saisies", {filter:["==", ["geometry-type"], "Point"], layout:{"icon-image":["get", "ic"], "icon-allow-overlap":true, "icon-anchor":["coalesce", ["get", "ancre"], "center"],
   "icon-offset":["coalesce", ["get", "decal"], ["literal", [0, 0]]], "symbol-sort-key":["get", "prio"]}}));
};
// couches MapLibre d'un groupe (id du groupe et annexes « <id>-… »)
const _couchesDe = (map, g) => map.getStyle().layers.map(l => l.id).filter(id => id === g || id.startsWith(g + "-"));
const _SRC = {};   // dernières données de chaque source GeoJSON (placement de la légende)
const _maj = (map, id, fc) => { const s = map.getSource && map.getSource(id); _SRC[id] = fc || null; if (s && s.setData) s.setData(fc || _FC0()); };
RE.afficher = (map, g, oui) => { if (_ETAT.dessin[g]) _ETAT.dessin[g].cache = !oui;
 if (g === "en-terrain") { _TZ.vis = !!oui; _majVisT(map); if (oui) _terrainZ(map); return; }
 for (const id of _couchesDe(map, g)) map.setLayoutProperty(id, "visibility", oui ? "visible" : "none"); };
const _dessine = (g, info) => { if (info) _ETAT.dessin[g] = Object.assign({cache:false}, info); else delete _ETAT.dessin[g]; };
RE.couchesVisibles = map => { map = map || _ETAT.map; if (!map) return [];
 return RE.COUCHES.filter(g => _ETAT.dessin[g] && !_ETAT.dessin[g].cache && _couchesDe(map, g).some(id => map.getLayoutProperty(id, "visibility") !== "none")); };
// image (ImageData) → canevas de la source « id », posé sur l'emprise b ; la source n'est animée que le temps d'un rendu
function _majCanevas(map, id, im, b, garderVis){
 const src = map.getSource(id); if (!src) return;
 const cv = _CV[id]; if (cv.width !== im.width || cv.height !== im.height) { cv.width = im.width; cv.height = im.height; }
 cv.getContext("2d").putImageData(im, 0, 0);
 src.setCoordinates([[b.w, b.n], [b.e, b.n], [b.e, b.s], [b.w, b.s]]);
 src.play(); map.once("render", () => src.pause()); map.triggerRepaint();
 if (!garderVis) map.setLayoutProperty(id, "visibility", "visible");
}

/* ---------- géométrie utile ---------- */
// contours fermés (polygones lissés) d'un ensemble de mailles : fenêtre carrée autour, bordée de vide
function _anneaux(mailles, g){
 const n = g.n, b = g.b; if (!mailles || !mailles.length) return [];
 let i0 = n, i1 = -1, j0 = n, j1 = -1; for (const c of mailles) { const i = c % n, j = (c/n) | 0; if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
 const m = Math.max(i1 - i0, j1 - j0) + 1 + 6, a = i0 - 3, c0 = j0 - 3, mask = new Uint8Array(m*m);
 for (const c of mailles) mask[((c/n | 0) - c0)*m + (c % n) - a] = 1;
 const dx = (b.e - b.w)/n, dy = (b.n - b.s)/n, sb = {w:b.w + a*dx, e:b.w + (a + m)*dx, n:b.n - c0*dy, s:b.n - (c0 + m)*dy};
 return _RT.contours(mask, m, sb).filter(l => l.length > 3).map(l => { const r = l.slice(); const p = r[0], q = r[r.length - 1]; if (p[0] !== q[0] || p[1] !== q[1]) r.push(p); return r; });
}
const _kx = lat => 111320*Math.cos(lat*Math.PI/180);
const _dM = (p, q) => Math.hypot((p[0] - q[0])*_kx((p[1] + q[1])/2), (p[1] - q[1])*110574);
function _distPolyM(p, L){ let best = Infinity; const kx = _kx(p[1]), ky = 110574;
 for (let s = 1; s < L.length; s++) { const ax = (L[s-1][0] - p[0])*kx, ay = (L[s-1][1] - p[1])*ky, bx = (L[s][0] - p[0])*kx, by = (L[s][1] - p[1])*ky;
  const vx = bx - ax, vy = by - ay, l2 = vx*vx + vy*vy, t = l2 ? Math.max(0, Math.min(1, -(ax*vx + ay*vy)/l2)) : 0, d = Math.hypot(ax + t*vx, ay + t*vy); if (d < best) best = d; }
 return L.length === 1 ? _dM(p, L[0]) : best; }
// points de décision de l'axe choisi : dernier point commun avec chaque autre axe de la même unité (à 300 m près)
function _pointsDecision(axe, autres){
 if (axe.point_decision) return [].concat(axe.point_decision).map(x => x.lonlat || x);
 const out = [];
 for (const o of autres) { if (!o.coords || o.coords.length < 2) continue; let k = 0;
  while (k < axe.coords.length && _distPolyM(axe.coords[k], o.coords) <= 300) k++;
  if (k > 1 && k < axe.coords.length) { const p = axe.coords[k - 1]; if (!out.some(q => _dM(q, p) < 500)) out.push(p); } }
 return out;
}
const _feat = (g, id) => g && g.feats ? g.feats.find(f => f.id === id) : null;
const _parUnite = (x, uniteDefaut) => Array.isArray(x) ? {[uniteDefaut != null ? uniteDefaut : (x[0] && x[0].unite) || "u"]: x} : (x || {});

/* ---------- terrain ----------
   Même rendu lissé que l'outil Terrain (rendu-terrain.js, renderOv) : chaque classe devient un champ 0/1 adouci (1-4-1),
   rééchantillonné en bilinéaire sur une image plus fine (tailleLisse), chaque pixel prend la classe la plus forte ;
   GO plus transparent (ALPHA_GO). Au zoom fort (un pixel d'image > 3 pixels d'écran), la partie visible est recalculée
   à la demi-résolution de l'écran par le même calcul (comme vueZ de rendu-terrain.js), couche « en-terrain-z ».
   Cours d'eau connus par leur tracé (G.rivs, G.rus) en lignes bleues, comme l'outil Terrain. */
const _TCACHE = new WeakMap();   // G.cls[classe] → ImageData lissée
const _TZ = {e:null, on:null, vis:true, t:0};   // e : {g, lab, C} du terrain affiché ; on : bornes de la vue recalculée
const _pal = () => { const c = _RT.COL; return [[...c.eau, 255], [...c.no, 255], [...c.slow, 255], [...c.go, _RT.ALPHA_GO]]; };
function _majVisT(map){
 const v = _TZ.vis, set = (id, on) => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); };
 set("en-terrain", v && !!_TZ.e && !_TZ.on); set("en-terrain-z", v && !!_TZ.e && !!_TZ.on); set("en-terrain-eau", v); set("en-terrain-coup", v);
}
const _mercY = lat => Math.log(Math.tan(Math.PI/4 + lat*Math.PI/360));
function _terrainZ(map){
 const e = _TZ.e; if (!e || !_RT || !_TZ.vis || !map.getSource("en-terrain-z")) { _TZ.on = null; _majVisT(map); return false; }
 const g = e.g, b = g.b, n = g.n, z = map.getZoom(), cl = Math.cos((b.n + b.s)/2*Math.PI/180);
 if (!((n*g.cell/e.C)/(78271.517*cl/2**z) > 3)) { _TZ.on = null; _majVisT(map); return false; }
 const vb = map.getBounds(), mx = (vb.getEast() - vb.getWest())*0.2, my = (vb.getNorth() - vb.getSouth())*0.2;
 const w = Math.max(b.w, vb.getWest() - mx), ea = Math.min(b.e, vb.getEast() + mx), s = Math.max(b.s, vb.getSouth() - my), no = Math.min(b.n, vb.getNorth() + my);
 if (!(ea > w && no > s)) { _TZ.on = null; _majVisT(map); return false; }
 const mppE = 2*78271.517*cl/2**z, kx = 111320*cl;
 let cw = (ea - w)*kx/mppE, ch = (_mercY(no) - _mercY(s))*6378137*cl/mppE;
 const r = Math.min(1, Math.sqrt(2e6/(cw*ch))); cw = Math.max(2, Math.round(cw*r)); ch = Math.max(2, Math.round(ch*r));
 const yN = _mercY(b.n), yS = _mercY(b.s), y0 = _mercY(no), y1 = _mercY(s), cl0 = f => f < 0 ? 0 : f > n - 1 ? n - 1 : f;
 const gxs = new Float32Array(cw), gys = new Float32Array(ch);
 for (let p = 0; p < cw; p++) gxs[p] = cl0((w + (p + 0.5)/cw*(ea - w) - b.w)/(b.e - b.w)*n - 0.5);
 for (let q = 0; q < ch; q++) gys[q] = cl0(((y0 + (q + 0.5)/ch*(y1 - y0)) - yN)/(yS - yN)*n - 0.5);
 const m = Math.min(n, Math.max(Math.ceil(gxs[cw-1]) - Math.floor(gxs[0]), Math.ceil(gys[ch-1]) - Math.floor(gys[0])) + 7);
 const i0 = Math.max(0, Math.min(n - m, Math.floor(gxs[0]) - 3)), j0 = Math.max(0, Math.min(n - m, Math.floor(gys[0]) - 3));
 const champs = [null, null, null, null];
 for (let j = 0; j < m; j++) { const rr = (j0 + j)*n + i0; for (let i = 0; i < m; i++) { const k = e.lab[rr + i]; (champs[k] || (champs[k] = new Float32Array(m*m)))[j*m + i] = 1; } }
 for (let k = 0; k < 4; k++) if (champs[k]) champs[k] = _RT.adoucir(champs[k], m);
 const ix = new Int32Array(cw), tx = new Float32Array(cw);
 for (let p = 0; p < cw; p++) { const f = gxs[p] - i0, i = Math.max(0, Math.min(m - 2, Math.floor(f))); ix[p] = i; tx[p] = f - i; }
 const im = new ImageData(cw, ch), d = im.data, pal = _pal();
 for (let q = 0; q < ch; q++) { const fy = gys[q] - j0, jj = Math.max(0, Math.min(m - 2, Math.floor(fy))), v = fy - jj, v1 = 1 - v, rj = jj*m;
  for (let p = 0; p < cw; p++) { const k0 = rj + ix[p], u = tx[p], u1 = 1 - u; let bk = -1, bv = 0;
   for (let k = 0; k < 4; k++) { const a = champs[k]; if (!a) continue; const sv = (a[k0]*u1 + a[k0+1]*u)*v1 + (a[k0+m]*u1 + a[k0+m+1]*u)*v; if (sv > bv) { bv = sv; bk = k; } }
   if (bk < 0) continue; const c = pal[bk], o = (q*cw + p)*4; d[o] = c[0]; d[o+1] = c[1]; d[o+2] = c[2]; d[o+3] = c[3]; } }
 _majCanevas(map, "en-terrain-z", im, {w, e:ea, s, n:no}, true);
 _TZ.on = {w, e:ea, s, n:no, z}; _majVisT(map);
 return true;
}
function _terrainZBouge(map){   // la vue sort de la partie recalculée : l'image de la zone entière reprend la main
 const c = _TZ.on; if (!c || !_TZ.e) return; const vb = map.getBounds(), b = _TZ.e.g.b;
 if (vb.getWest() < c.w - 1e-9 && c.w > b.w || vb.getEast() > c.e + 1e-9 && c.e < b.e || vb.getSouth() < c.s - 1e-9 && c.s > b.s || vb.getNorth() > c.n + 1e-9 && c.n < b.n || map.getZoom() < c.z - 1) { _TZ.on = null; _majVisT(map); }
}
function _eauLignes(g){   // tronçons de cours d'eau qui touchent la zone
 const b = g.b, dans = p => p[0] >= b.w && p[0] <= b.e && p[1] >= b.s && p[1] <= b.n, F = [];
 const ajoute = (gg, w) => { let run = []; const fin = () => { if (run.length > 1) F.push(_li(run, {w})); run = []; };
  for (let q = 1; q < gg.length; q++) { if (dans(gg[q-1]) || dans(gg[q])) { if (!run.length) run.push(gg[q-1]); run.push(gg[q]); } else fin(); } fin(); };
 for (const r of g.rivs || []) if (r.g) ajoute(r.g, r.w || (r.k === "c" ? 15 : 30));
 for (const gg of g.rus || []) ajoute(gg, 2);
 return F;
}
RE.terrain = (map, g, classe, opts) => {
 const o = opts || {}; if (!g || !g.cls || !g.cls[classe]) return 0;
 if (o.opacite != null) for (const id of ["en-terrain", "en-terrain-z"]) if (map.getLayer(id)) map.setPaintProperty(id, "raster-opacity", +o.opacite);
 let ms = 0;
 _avecRT(() => {
  const t0 = performance.now(), n = g.n, cl = g.cls[classe], R = _RT, C = R.tailleLisse(n);
  const lab = new Uint8Array(n*n); for (let c = 0; c < n*n; c++) lab[c] = cl[c] > 3 ? 3 : cl[c];
  let im = _TCACHE.get(cl);
  if (!im) {
   const up = R.plusFort(R.champsDe(lab, n, 4, true), n, C, 0, 0), pal = _pal();
   im = new ImageData(C, C); const d = im.data;
   for (let p = 0, q = 0; p < C*C; p++, q += 4) { const k = up[p]; if (k === 255) continue; const col = pal[k]; d[q] = col[0]; d[q+1] = col[1]; d[q+2] = col[2]; d[q+3] = col[3]; }
   _TCACHE.set(cl, im);
  }
  _majCanevas(map, "en-terrain", im, g.b, true);
  _TZ.e = {g, lab, C}; _TZ.on = null; _TZ.vis = o.visible !== false;
  // ouvrages coupés ou dégradés (l'outil Ennemi les subit, il ne les coupe pas) ; cours d'eau en lignes
  const f = []; (g.feats || []).forEach((x, i) => { const e = g.coupe ? g.coupe[i] : 0; if (e === 1 || e === 2)
   f.push(_pt([x.lon, x.lat], {ic:_pictoMap(map, e === 1 ? "coupe" : "degrade", e === 1 ? "#d50000" : "#ef6c00"), etat:e})); });
  _maj(map, "en-terrain-coup", _fc(f));
  _maj(map, "en-terrain-eau", _fc(_eauLignes(g)));
  const mpp = z => 156543.03*Math.cos((g.b.n + g.b.s)/2*Math.PI/180)/2**z;   // largeur réelle au zoom fort, comme l'outil Terrain
  map.setPaintProperty("en-terrain-eau", "line-width", ["interpolate", ["exponential", 2], ["zoom"], 11, 1.5, 13, ["max", 2, ["/", ["get", "w"], mpp(13)]], 19, ["max", 2, ["/", ["get", "w"], mpp(19)]]]);
  _dessine("en-terrain", {classe, coupes:f.filter(x => x.properties.etat === 1).length, degrades:f.filter(x => x.properties.etat === 2).length, cache:!_TZ.vis, eau:(g.rivs || []).length + (g.rus || []).length});
  _majVisT(map); _terrainZ(map);
  ms = performance.now() - t0;
 });
 return ms;
};

/* ---------- axes ---------- */
RE.axes = (map, axes, opts) => {
 const o = opts || {}, g = _G(o), parU = _parUnite(axes, o.unite), F = [], P = [], plaus = new Set(); let pd = 0, gou = 0, ouv = 0;
 const choisiDe = u => typeof o.choisi === "string" ? o.choisi : (o.choisi && o.choisi[u]);
 for (const u of Object.keys(parU)) { const L = (parU[u] || []).filter(a => a && a.coords && a.coords.length > 1); if (!L.length) continue;
  const coul = RE.couleurUnite(u), ch = choisiDe(u) || (L.find(a => a.plausibilite === "forte") || L[0]).genre, selU = o.unite == null || String(o.unite) === String(u);
  for (const a of L) { const sel = a.genre === ch; plaus.add(a.plausibilite || "faible");
   F.push(_li(a.coords, {u, genre:a.genre, plaus:a.plausibilite || "faible", couleur:coul, sel:sel && selU ? 1 : 0, estompe:selU && !sel ? 1 : 0})); }
  const A = L.find(a => a.genre === ch); if (!A) continue;
  let k = 0;
  for (const id of A.ouvrages || []) { const f = _feat(g, id); if (!f) continue; ouv++; P.push(_pt([f.lon, f.lat], {ic:_pictoMap(map, "ouvrage"), ordre:1, k:"ouvrage", id})); }
  for (const id of A.goulets || []) { const f = _feat(g, id); if (!f) continue; gou++; P.push(_pt([f.lon, f.lat], {ic:_pictoMap(map, "goulet"), ordre:2, k:"goulet", id})); }
  for (const p of _pointsDecision(A, L.filter(a => a !== A))) { pd++; P.push(_pt(p, {ic:_pictoMap(map, "pd"), ordre:3, k:"pd", u, n:++k})); }
 }
 // ordre de dessin : axes estompés d'abord, choisi en dernier
 F.sort((a, b) => a.properties.sel - b.properties.sel || b.properties.estompe - a.properties.estompe);
 _maj(map, "en-axes", _fc(F.concat(P)));
 _dessine("en-axes", F.length ? {unites:Object.keys(parU).filter(u => (parU[u] || []).length), plaus:[...plaus], pd, gou, ouv} : null);
};

/* ---------- horaires ---------- */
RE.horaires = (map, horaires, opts) => {
 const o = opts || {}, parU = horaires && horaires.jalons ? {[o.unite != null ? o.unite : "u"]: horaires} : (horaires || {}), F = []; let n = 0;
 for (const u of Object.keys(parU)) { const h = parU[u]; if (!h || !h.jalons) continue; const coul = RE.couleurUnite(u);
  h.jalons.forEach((j, i) => { if (!j.lonlat) return; n++;
   const inc = j.incertitude_min > 0 ? " ±" + Math.round(j.incertitude_min) : "";
   const nom = j.id_ouvrage || j.gue ? " – " + (j.nom || (j.gue ? "gué" : "ouvrage")) : (i === h.jalons.length - 1 && j.nom ? " – " + j.nom : "");
   const txt = _hm(j.heure_min) + inc + nom;
   F.push(_pt(j.lonlat, {k:"pt", ic:_pictoMap(map, "jalon", coul)}));
   F.push(_pt(j.lonlat, {k:"et", prio:j.goulet ? 0 : j.id_ouvrage || j.gue ? 1 : 2, ic:_etiquette(map, txt, j.goulet ? "#d50000" : coul, j.goulet ? {epais:2.5} : null)})); }); }
 _maj(map, "en-horaires", _fc(F));
 _dessine("en-horaires", n ? {n} : null);
};

/* ---------- colonne ---------- */
RE.colonne = (map, position, opts) => {
 const o = opts || {}, F = [];
 const parU = !position ? {} : (position.tete || position.trace) ? {[o.unite != null ? o.unite : "u"]: position} : position;
 for (const u of Object.keys(parU)) { const p = parU[u]; if (!p) continue;
  const un = (o.unites || []).find(x => String(x.id) === String(u)) || {};
  if (p.trace && p.trace.length > 1) F.push(_li(p.trace, {u}));
  if (p.tete) F.push(_pt(p.tete, {u, ancre:"bottom", ic:_symMap(map, {camp:"ennemi", classe:un.classe, echelon:un.echelon, unite_type:un.unite_type, couleur:RE.couleurUnite(u)})})); }
 _maj(map, "en-colonne", _fc(F)); _decaler(map);
 _dessine("en-colonne", F.length ? {n:Object.keys(parU).length} : null);
};

/* ---------- isochrones ---------- */
RE.isochrones = (map, iso, g, opts) => {
 const o = opts || {};
 if (!iso || !iso.arrivee_min || !g) { _maj(map, "en-iso"); _maj(map, "en-iso-et"); _dessine("en-iso", null); return; }
 _avecRT(() => {
  const A = iso.arrivee_min, N = g.n*g.n, delais = (o.delais || iso.delais || []).slice().sort((a, b) => a - b);
  let t0 = o.t0; if (t0 == null) { t0 = Infinity; for (let c = 0; c < N; c++) if (A[c] < t0) t0 = A[c]; }
  const L = [], E = [], faits = []; let ctr = null;
  delais.forEach((d, k) => { const m = new Uint8Array(N); let any = 0; for (let c = 0; c < N; c++) if (A[c] <= t0 + d) { m[c] = 1; any = 1; }
   if (!any) return;
   const coul = RE.ISO_COUL[Math.min(k, RE.ISO_COUL.length - 1)], lignes = _RT.contours(m, g.n, g.b); if (!lignes.length) return;
   faits.push({d, coul});
   for (const l of lignes) L.push(_li(l, {d, couleur:coul}));
   if (!ctr) ctr = _origineIso(A, N, g, t0);
   // étiquette sur le FRONT de la ligne (point le plus avancé dans une direction propre à chaque délai : nord-ouest, nord, nord-est…),
   // toutes lignes confondues (pas sur un trou intérieur), loin du cadre de la zone, et pas sur une étiquette déjà posée
   const th = (-40 + 50*k)*Math.PI/180, kx = Math.cos(ctr[1]*Math.PI/180), sc = p => (p[0] - ctr[0])*kx*Math.sin(th) + (p[1] - ctr[1])*Math.cos(th);
   const b = g.b, mx = (b.e - b.w)*0.04, my = (b.n - b.s)*0.04, loin = p => p[0] > b.w + mx && p[0] < b.e - mx && p[1] > b.s + my && p[1] < b.n - my;
   const libre = p => E.every(e => Math.abs(e.geometry.coordinates[0] - p[0]) > mx*2 || Math.abs(e.geometry.coordinates[1] - p[1]) > my*0.8);
   const tous = lignes.flat(), cand = tous.filter(p => loin(p) && libre(p)), pool = cand.length ? cand : tous.filter(loin).length ? tous.filter(loin) : tous;
   const p = pool.reduce((a, q) => sc(q) > sc(a) ? q : a);
   E.push(_pt(p, {d, ic:_etiquette(map, `T+${d} min (${_hm(t0 + d)})`, coul)})); });
  _maj(map, "en-iso", _fc(L)); _maj(map, "en-iso-et", _fc(E));
  _dessine("en-iso", faits.length ? {delais:faits, t0} : null);
 });
};

// origine des isochrones : barycentre des mailles atteintes au plus tôt (contacts)
function _origineIso(A, N, g, t0){ let x = 0, y = 0, m = 0, mn = Infinity; for (let c = 0; c < N; c++) if (A[c] < mn) mn = A[c];
 for (let c = 0; c < N; c++) if (A[c] <= mn + 1e-6) { x += c % g.n; y += (c/g.n) | 0; m++; }
 if (!m) return [(g.b.w + g.b.e)/2, (g.b.s + g.b.n)/2];
 return [g.b.w + (x/m + 0.5)/g.n*(g.b.e - g.b.w), g.b.n - (y/m + 0.5)/g.n*(g.b.n - g.b.s)]; }

/* ---------- présence probable et zones à survoler ---------- */
RE.presence = (map, presence, g, opts) => {
 const o = opts || {};
 if (o.opacite != null && map.getLayer("en-presence")) map.setPaintProperty("en-presence", "raster-opacity", +o.opacite);
 const zones = (presence && presence.zones) || [], Z = [];
 zones.slice().sort((a, b) => a.rang - b.rang).forEach(z => { if (!z.lonlat) return;
  const ry = _rayon(z, o); if (ry > 0) Z.push({type:"Feature", properties:{k:"zone", rang:z.rang}, geometry:{type:"Polygon", coordinates:[CG.cercle(z.lonlat[0], z.lonlat[1], ry)]}});
  Z.push(_pt(z.lonlat, {k:"num", rang:z.rang, ic:_numero(map, z.rang)})); });
 const ordre = zones.slice().sort((a, b) => a.rang - b.rang).map(z => z.lonlat).filter(Boolean);
 if (ordre.length > 1) Z.push(_li(ordre, {k:"ordre"}));
 _maj(map, "en-presence-z", _fc(Z));
 const info = {zones:zones.length, carte:false};
 if (!presence || !presence.Q || !g) { if (map.getLayer("en-presence")) map.setLayoutProperty("en-presence", "visibility", "none"); _dessine("en-presence", zones.length ? info : null); return; }
 _avecRT(() => {
  const R = _RT, n = g.n, Q = presence.Q; let mx = 0; for (let c = 0; c < n*n; c++) if (Q[c] > mx) mx = Q[c];
  if (!(mx > 0)) { map.setLayoutProperty("en-presence", "visibility", "none"); _dessine("en-presence", zones.length ? info : null); return; }
  const a = new Float32Array(n*n); for (let c = 0; c < n*n; c++) a[c] = Q[c]/mx;
  const f = R.adoucir(a, n), C = Math.max(n, Math.round(R.tailleLisse(n)/2)), {ix, tx} = R.poids(n, C);
  const im = new ImageData(C, C), d = im.data;
  for (let y = 0; y < C; y++) { const j = ix[y]*n, v = tx[y], v1 = 1 - v;
   for (let x = 0; x < C; x++) { const k0 = j + ix[x], u = tx[x], u1 = 1 - u, s = (f[k0]*u1 + f[k0+1]*u)*v1 + (f[k0+n]*u1 + f[k0+n+1]*u)*v;
    if (s < 0.08) continue; const q = (y*C + x)*4, t = Math.min(1, (s - 0.08)/0.92);
    d[q] = 120 + 80*t; d[q+1] = 30*(1 - t); d[q+2] = 170 - 40*t; d[q+3] = Math.round(25 + 195*Math.pow(t, 0.7)); } }
  _majCanevas(map, "en-presence", im, g.b);
  info.carte = true; _dessine("en-presence", info);
 });
};

/* ---------- zones de regroupement ---------- */
RE.regroupements = (map, zones, opts) => {
 const o = opts || {}, g = _G(o), parU = _parUnite(zones, o.unite);
 _avecRT(() => {
  const F = [], vus = new Set(); let n = 0;
  for (const u of Object.keys(parU)) { const coul = RE.couleurUnite(u);
   (parU[u] || []).forEach((z, i) => { n++;
    let rings = g && z.mailles && z.mailles.length ? _anneaux(z.mailles, g) : [];
    if (!rings.length && z.centre) rings = [CG.cercle(z.centre[0], z.centre[1], Math.sqrt((z.surface_km2 || 0.25)*1e6/Math.PI))];
    for (const r of rings) F.push({type:"Feature", properties:{u, couleur:coul}, geometry:{type:"Polygon", coordinates:[r]}});
    const nom = o.noms && Object.keys(parU).length > 1 && o.noms[u] ? o.noms[u] + " : regroupement " : "Regroupement ";   // plusieurs unités : nom de l'unité
    const txt = `${nom}${i + 1} – ${Math.round(z.duree_min || 0)} min`, cle = z.centre && txt + "@" + z.centre.join(",");   // même zone, même texte (unités voisines) : une seule étiquette
    if (z.centre && !vus.has(cle)) { vus.add(cle); F.push(_pt(z.centre, {u, k:"et", prio:-8, ancre:"top", decal:[0, 6], ic:_etiquette(map, txt, coul)})); } }); }
  _maj(map, "en-regroup", _fc(F)); _decaler(map);
  _dessine("en-regroup", n ? {n} : null);
 });
};

/* ---------- saisies : unités, objectifs, nos positions, contacts ---------- */
function _unitesEtat(etat, opts){
 const o = opts || {}, mode = o.mode || "tous", plan = [], cond = [];
 if (mode !== "conduite") for (const s of ((etat.planification || {}).scenarios || [])) { if (o.scenario != null && String(s.id) !== String(o.scenario)) continue;
  for (const u of s.unites || []) plan.push(Object.assign({scenario:s.id, heure:u.heure_depart || s.heure_depart}, u)); }
 if (mode !== "planification") for (const u of ((etat.conduite || {}).unites || [])) cond.push(u);
 const contacts = mode === "planification" ? [] : ((etat.conduite || {}).contacts || []).map(c => Object.assign({}, c, {h:_min(c.heure_min != null ? c.heure_min : c.heure)}));
 return {plan, cond, contacts};
}
RE.saisies = (map, etat, opts) => {
 const F = []; if (!etat) { _maj(map, "en-saisies"); _dessine("en-saisies", null); return; }
 const {plan, cond, contacts} = _unitesEtat(etat, opts), sym = u => _symMap(map, {camp:"ennemi", classe:u.classe, echelon:u.echelon, unite_type:u.unite_type, couleur:RE.couleurUnite(u.id)});
 for (const u of plan) { const coul = RE.couleurUnite(u.id);
  if (u.depart) { F.push(_pt(u.depart, {k:"unite", prio:1, ancre:"bottom", ic:sym(u)}));
   F.push(_pt(u.depart, {k:"et", prio:5, ancre:"top", decal:[0, 2], ic:_etiquette(map, (u.nom || "Unité") + (u.heure ? " – départ " + _hm(_min(u.heure)) : ""), coul)})); }
  (u.objectifs || []).forEach((ob, i) => { F.push(_pt(ob, {k:"obj", prio:2, ancre:"bottom-left", decal:[-5, 0], ic:_pictoMap(map, "objectif", coul)}));
   F.push(_pt(ob, {k:"et", prio:6, ancre:"left", decal:[14, -12], ic:_etiquette(map, "Objectif" + ((u.objectifs.length > 1) ? " " + (i + 1) : "") + " – " + (u.nom || "unité"), coul)})); }); }
 const parU = new Map(); for (const c of contacts) { if (!c.lonlat) continue; const k = String(c.unite); if (!parU.has(k)) parU.set(k, []); parU.get(k).push(c); }
 for (const [u, L] of parU) { L.sort((a, b) => a.h - b.h); const coul = RE.couleurUnite(u), un = cond.find(x => String(x.id) === u) || {id:u};
  if (L.length > 1) F.push(_li(L.map(c => c.lonlat), {couleur:coul}));
  L.forEach((c, i) => { const der = i === L.length - 1;
   if (der) F.push(_pt(c.lonlat, {k:"unite", prio:1, ancre:"bottom", decal:[0, -6], ic:sym(un)}));
   F.push(_pt(c.lonlat, {k:"contact", prio:3, ic:_pictoMap(map, "contact", coul)}));
   F.push(_pt(c.lonlat, {k:"et", prio:der ? 4 : 7, ancre:"left", decal:[9, 0], ic:_etiquette(map, (der ? (un.nom ? un.nom + " – " : "") : "") + "contact " + (isFinite(c.h) ? _hm(c.h) : "?") + (c.elements_vus ? " (" + c.elements_vus + " vus)" : ""), coul)})); }); }
 for (const p of etat.nos_positions || []) { if (!p.lonlat) continue;
  F.push(_pt(p.lonlat, {k:"ami", prio:1, ic:_symMap(map, {camp:"ami", classe:p.classe || "fantassin", echelon:p.echelon})}));
  F.push(_pt(p.lonlat, {k:"et", prio:5, ancre:"top", decal:[0, 14], ic:_etiquette(map, p.nom || "Nos positions", RE.AMI)})); }
 F.sort((a, b) => (b.properties.prio || 0) - (a.properties.prio || 0));   // symboles dessinés au-dessus des étiquettes
 F.forEach(f => { f.properties.prio = -(f.properties.prio || 0); });
 _maj(map, "en-saisies", _fc(F)); _decaler(map);
 const unites = [...plan, ...cond.filter(u => parU.has(String(u.id)))];
 _dessine("en-saisies", F.length ? {unites, objectifs:plan.some(u => (u.objectifs || []).length), amis:(etat.nos_positions || []).length, contacts:contacts.length} : null);
};

RE.effacer = (map, couches) => { (couches || RE.COUCHES).forEach(g => {
 if (g === "en-terrain") { _TZ.e = null; _TZ.on = null; }
 for (const id of _couchesDe(map, g)) { const l = map.getLayer(id); if (!l) continue; if (l.type === "raster") map.setLayoutProperty(id, "visibility", "none"); else _maj(map, l.source); }
 delete _ETAT.dessin[g]; }); _decaler(map); };

/* ---------- étiquettes sans chevauchement (décalage) ----------
   Les étiquettes des saisies (unités, objectifs, contacts, nos positions) et des regroupements sont des images (pas de serveur de
   polices) : MapLibre ne sait pas déplacer une image en cas de collision. Après chaque dessin et chaque fin de mouvement de la carte,
   on les place une à une (priorité : dernier contact, unités et nos positions, objectifs, anciens contacts, regroupements) à la
   première position libre autour de leur point (place d'origine, droite, gauche, dessous, dessus, puis en escalier), sans couvrir un
   symbole affiché ni une étiquette déjà placée, dans le cadre de la carte. Sans position libre, elle garde sa place d'origine. */
const _BOITE = {left:(x, y, w, h) => [x, y - h/2, x + w, y + h/2], right:(x, y, w, h) => [x - w, y - h/2, x, y + h/2], top:(x, y, w, h) => [x - w/2, y, x + w/2, y + h],
 bottom:(x, y, w, h) => [x - w/2, y - h, x + w/2, y], center:(x, y, w, h) => [x - w/2, y - h/2, x + w/2, y + h/2], "bottom-left":(x, y, w, h) => [x, y - h, x + w, y], "top-left":(x, y, w, h) => [x, y, x + w, y + h]};
const _boite = (q, ancre, decal, t) => { const d = decal || [0, 0]; return (_BOITE[ancre] || _BOITE.center)(q.x + (+d[0] || 0), q.y + (+d[1] || 0), t[0], t[1]); };
// positions candidates, des plus proches aux plus lointaines : à droite, à gauche, dessous, dessus, puis en escalier (pas de 20 px, jusqu'à 120 px)
const _CAND = [["left", [12, 0]], ["right", [-12, 0]], ["top", [0, 12]], ["bottom", [0, -26]]];
for (let k = 1; k <= 6; k++) { const d = 20*k; _CAND.push(["left", [12, -d]], ["left", [12, d]], ["right", [-12, -d]], ["right", [-12, d]]); if (k <= 3) _CAND.push(["top", [0, 12 + d]], ["bottom", [0, -26 - d]]); }
const _coupe = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const _ETQ = {places:[]};
function _decaler(map){
 if (!map || !map.getContainer || !map.getSource || !map.getSource("en-saisies")) return;
 const W = map.getContainer().clientWidth, Hc = map.getContainer().clientHeight, obst = [], etq = [], g0 = (_LEG.o && +_LEG.o.gauche) || 0;   // pas sous le panneau
 const vis = g => _couchesDe(map, g).some(id => map.getLayoutProperty(id, "visibility") !== "none");
 // obstacles : symboles et pictogrammes affichés (saisies, tête de colonne, points des axes, jalons, numéros des zones à survoler)
 const srcs = [["en-saisies", "en-saisies"], ["en-regroup", "en-regroup"], ["en-colonne", "en-colonne"], ["en-axes", "en-axes"], ["en-horaires", "en-horaires"], ["en-presence-z", "en-presence"]];
 for (const [id, g] of srcs) { const fc = _SRC[id]; if (!fc || !vis(g)) continue;
  for (const f of fc.features || []) { const P = f.properties || {}; if (!f.geometry || f.geometry.type !== "Point" || !P.ic) continue;
   const q = map.project(f.geometry.coordinates), t = _TAILLE.get(P.ic) || [22, 22];
   if (id === "en-horaires" && P.k === "et") { obst.push(_boite(q, "left", [9, 0], t)); continue; }   // étiquette de jalon (placée par MapLibre) : on l'évite
   if (P.k === "et") { if (P.a0 == null) { P.a0 = P.ancre || "center"; P.d0 = P.decal || [0, 0]; } etq.push({f, q, t, id, prio:-(P.prio || 0)}); }
   else obst.push(_boite(q, P.ancre || "center", P.decal, [t[0]*0.8, t[1]*0.8])); } }   // symbole : boîte réduite (marges transparentes de l'image)
 etq.sort((a, b) => a.prio - b.prio || a.q.y - b.q.y);
 const pris = obst.slice(), chg = new Set(); _ETQ.places = [];
 for (const e of etq) { const P = e.f.properties; let best = null;
  for (const [a, d] of [[P.a0, P.d0]].concat(_CAND)) { const bx = _boite(e.q, a, d, e.t); if (bx[0] < g0 || bx[1] < 0 || bx[2] > W || bx[3] > Hc) continue; if (!pris.some(o => _coupe(o, bx))) { best = [a, d, bx]; break; } }
  if (!best) best = [P.a0, P.d0, _boite(e.q, P.a0, P.d0, e.t)];
  if (best[0] !== P.ancre || JSON.stringify(best[1]) !== JSON.stringify(P.decal)) { P.ancre = best[0]; P.decal = best[1]; chg.add(e.id); }
  pris.push(best[2]); _ETQ.places.push({source:e.id, box:best[2].map(Math.round)}); }
 for (const id of chg) { const s = map.getSource(id); if (s && s.setData) s.setData(_SRC[id]); }
}
// + étiquettes placées (saisies, regroupements) : [{source, box:[x0, y0, x1, y1]}] en px de la carte (contrôle des chevauchements)
RE.etiquettesPlacees = map => { _decaler(map || _ETAT.map); return _ETQ.places.slice(); };


/* ---------- légende (couches visibles et non vides seulement) ---------- */
// + couleurs du terrain (GO / SLOW-GO / NO-GO / eau) si le fond de mobilité est affiché, sinon "" (tête de la légende repliée)
RE.legendeTerrain = couchesVisibles => { const vis = couchesVisibles || RE.couchesVisibles(); if (!vis.includes("en-terrain") || !_ETAT.dessin["en-terrain"]) return "";
 const sw = (c, t, op) => `<span class="re-l"><span class="re-sw" style="background:${c}${op ? ";opacity:" + op : ""}"></span>${t}</span>`;
 return sw(RE.COULEURS.go, "GO", ".7") + sw(RE.COULEURS.slowgo, "SLOW-GO") + sw(RE.COULEURS.nogo, "NO-GO") + sw(RE.COULEURS.eau, "eau"); };
RE.legende = (etat, couchesVisibles) => {
 const vis = couchesVisibles || RE.couchesVisibles(), D = _ETAT.dessin, h = [];
 const sw = (st, t) => `<span class="re-l"><span class="re-sw" style="${st}"></span>${_esc(t)}</span>`;
 const trait = (c, t, w, dash) => sw(`height:0;width:22px;border-top:${w || 3}px ${dash || "solid"} ${c};vertical-align:3px`, t);
 const img = (u, t) => `<span class="re-l"><img class="re-ic" src="${u}" alt="">${_esc(t)}</span>`;
 const on = g => vis.includes(g) && D[g];
 if (on("en-terrain")) { const d = D["en-terrain"];
  let l = sw(`background:${RE.COULEURS.go};opacity:.7`, "GO") + sw(`background:${RE.COULEURS.slowgo}`, "SLOW-GO") + sw(`background:${RE.COULEURS.nogo}`, "NO-GO") + sw(`background:${RE.COULEURS.eau}`, "Eau");
  if (d.coupes) l += img(_pictoURL("coupe", "#d50000"), "Ouvrage coupé"); if (d.degrades) l += img(_pictoURL("degrade", "#ef6c00"), "Ouvrage dégradé");
  h.push(`<div><b>Terrain – ${_esc(RE.CLS_LBL[d.classe] || d.classe)}</b></div><div class="re-g">${l}</div>`); }
 if (on("en-presence")) { const d = D["en-presence"]; let l = "";
  if (d.carte) l += sw("width:40px;background:linear-gradient(90deg,rgba(124,30,166,.25),rgb(200,0,130))", "Présence probable (faible → forte)");
  if (d.zones) l += img(_URL.num1 || (_URL.num1 = (() => { const {c, g} = _canevas(24, 24); g.fillStyle = "#4a148c"; g.beginPath(); g.arc(12, 12, 10, 0, 7); g.fill(); g.fillStyle = "#fff"; g.font = "700 12px system-ui"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("1", 12, 12.5); return c.toDataURL(); })()), "Zone à survoler (ordre)");
  if (l) h.push(`<div class="re-g">${l}</div>`); }
 if (on("en-iso")) h.push(`<div class="re-g">${D["en-iso"].delais.map(x => trait(x.coul, `T+${x.d} min`, 2)).join("")}</div>`);
 if (on("en-regroup")) h.push(`<div class="re-g">${sw("background:rgba(198,40,40,.25);border:2px dashed #c62828", "Zone de regroupement (durée)")}</div>`);
 if (on("en-axes")) { const d = D["en-axes"], c = "#6d1b1b";
  const l = ["forte", "moyenne", "faible"].filter(p => d.plaus.includes(p)).map(p => trait(c, "Axe, " + RE.PLAUS_LBL[p], p === "forte" ? 5 : p === "moyenne" ? 3 : 2, p === "forte" ? "solid" : p === "moyenne" ? "dashed" : "dotted"));
  l.push(sw("height:6px;width:22px;background:#6d1b1b;box-shadow:0 0 0 3px #fff,0 0 0 4px #bbb;vertical-align:2px", "Axe choisi"));
  if (d.ouv) l.push(img(_pictoURL("ouvrage"), "Ouvrage sur l'axe")); if (d.gou) l.push(img(_pictoURL("goulet"), "Goulet")); if (d.pd) l.push(img(_pictoURL("pd"), "Point de décision"));
  h.push(`<div class="re-g">${l.join("")}</div>`); }
 if (on("en-horaires")) h.push(`<div class="re-g">${img(_pictoURL("jalon", "#c62828"), "Jalon : heure d'arrivée de la tête ± incertitude")}</div>`);
 if (on("en-colonne")) h.push(`<div class="re-g">${trait("#111", "Colonne à l'heure choisie", 6)}</div>`);
 if (on("en-saisies")) { const d = D["en-saisies"], vus = new Set(), l = [];
  for (const u of d.unites) { const k = _symId({camp:"ennemi", classe:u.classe, echelon:u.echelon, unite_type:u.unite_type, couleur:RE.couleurUnite(u.id)}); if (vus.has(k + u.nom)) continue; vus.add(k + u.nom);
   l.push(img(RE.symboleURL({camp:"ennemi", classe:u.classe, echelon:u.echelon, unite_type:u.unite_type, couleur:RE.couleurUnite(u.id)}), (u.nom || "Unité ennemie") + (u.echelon ? ` (${RE.ECH_LBL[u.echelon] || u.echelon}, ${RE.CLS_LBL[u.classe] || u.classe || ""})` : ""))); }
  if (d.objectifs) l.push(img(_pictoURL("objectif", "#c62828"), "Objectif"));
  if (d.contacts) l.push(img(_pictoURL("contact", "#c62828"), "Contact (heure)"));
  if (d.amis) l.push(img(RE.symboleURL({camp:"ami", classe:"fantassin"}), "Nos positions"));
  if (l.length) h.push(`<div class="re-g">${l.join("")}</div>`); }
 return h.length ? `<div class="re-leg">${h.join("")}</div>` : "";
};
/* légende posée sur la carte : COMPACTE et REPLIABLE (bouton « Légende »), placée dans le coin qui cache le moins de résultats
   (objets clés : départs, objectifs, contacts, jalons, zones, points de décision… ; puis traits : axes, isochrones, contours) et
   aucun des éléments d'interface donnés (opts.eviter). Si même ce coin recouvre un résultat, elle est REPLIÉE PAR DÉFAUT (sauf si
   l'utilisateur l'a rouverte ; choix mémorisé dans le navigateur). Repliée, sa tête garde les couleurs GO / SLOW-GO / NO-GO / eau
   quand le terrain est affiché.
   opts : {gauche (px réservés à gauche, ex. panneau), droite (px à droite, ex. boutons de zoom), haut, bas, eviter:[Element]} */
const _LEG = {manuel:null, o:{}};
try { const v = localStorage.getItem("re-legende-repliee"); if (v === "1" || v === "0") _LEG.manuel = v === "1"; } catch(e) {}
// étiquettes : posées à droite du point (saisies, jalons) ou centrées (isochrones) ; on en suit la largeur probable
const _ETIQ = {"en-saisies":[0, 60, 120, 180, 240], "en-horaires":[0, 50, 100], "en-iso-et":[-60, 0, 60], "en-regroup":[-60, 0, 60]};
function _pointsCles(map){
 const P = [], ajoute = (ll, w, dx) => { if (ll && isFinite(ll[0]) && isFinite(ll[1])) { const q = map.project(ll); for (const d of dx || [0]) P.push([q.x + d, q.y, w]); } };
 for (const g of RE.couchesVisibles(map)) for (const id of Object.keys(_SRC)) { if (id !== g && !id.startsWith(g + "-")) continue; const fc = _SRC[id]; if (!fc) continue;
  for (const f of fc.features || []) { const t = f.geometry && f.geometry.type, c = f.geometry && f.geometry.coordinates;
   if (t === "Point") ajoute(c, 3, _ETIQ[id]);
   else if (t === "LineString" || t === "Polygon") { const L = t === "Polygon" ? c[0] || [] : c, pas = Math.max(1, Math.floor(L.length/40)); for (let i = 0; i < L.length; i += pas) ajoute(L[i], 1); } } }
 return P;
}
function _placerLegende(map, d){
 const o = _LEG.o, ct = map.getContainer(), W = ct.clientWidth, H = ct.clientHeight;
 const replie = v => { d.classList.toggle("re-replie", v); d.querySelector(".re-tete").setAttribute("aria-expanded", String(!v)); };
 const g = (o.gauche || 0) + 10, dr = (o.droite || 0) + 10, hb = (o.haut || 0) + 10, bb = (o.bas || 0) + 34;
 const cr = ct.getBoundingClientRect(), evite = (o.eviter || []).filter(e => e && e.offsetParent !== null).map(e => { const r = e.getBoundingClientRect(); return [r.left - cr.left, r.top - cr.top, r.right - cr.left, r.bottom - cr.top]; });
 const pts = _pointsCles(map), M = 14;
 // fond de mobilité affiché : son emprise compte comme un résultat (la légende dépliée en cacherait une partie)
 const T = RE.couchesVisibles(map).includes("en-terrain") && _TZ.e ? (() => { const b = _TZ.e.g.b, p = map.project([b.w, b.n]), q = map.project([b.e, b.s]); return [p.x, p.y, q.x, q.y]; })() : null;
 // meilleur emplacement pour la taille actuelle de la légende : coins, puis milieu des bords
 const meilleur = () => { const w = d.offsetWidth, h = d.offsetHeight;
  const coins = [{nom:"bd", x:W - dr - w, y:H - bb - h, css:{right:dr, bottom:bb}}, {nom:"bg", x:g, y:H - bb - h, css:{left:g, bottom:bb}},
   {nom:"hd", x:W - dr - w, y:hb, css:{right:dr, top:hb}}, {nom:"hg", x:g, y:hb, css:{left:g, top:hb}},
   {nom:"md", x:W - dr - w, y:Math.round((H - h)/2), css:{right:dr, top:Math.round((H - h)/2)}}, {nom:"mg", x:g, y:Math.round((H - h)/2), css:{left:g, top:Math.round((H - h)/2)}}];
  for (const c of coins) { c.cle = 0; c.poids = 0;
   if (c.x < 0 || c.y < 0 || c.x + w > W || c.y + h > H) c.poids += 1e6;
   for (const r of evite) if (c.x < r[2] && c.x + w > r[0] && c.y < r[3] && c.y + h > r[1]) c.poids += 1e5;
   if (T && c.x < T[2] && c.x + w > T[0] && c.y < T[3] && c.y + h > T[1]) c.poids += 1;
   for (const [x, y, wt] of pts) if (x > c.x - M && x < c.x + w + M && y > c.y - M && y < c.y + h + M) { c.poids += wt; if (wt >= 3) c.cle++; } }
  return coins.slice().sort((a, b) => a.cle - b.cle || a.poids - b.poids)[0]; };
 replie(false); const deplie = meilleur();
 const auto = deplie.cle > 0 || deplie.poids > 0;   // même le meilleur emplacement recouvre un résultat (ou l'interface) : repliée par défaut
 const ferme = _LEG.manuel != null ? _LEG.manuel : auto;
 replie(ferme); const best = ferme ? meilleur() : deplie;   // repliée : placée selon sa petite taille (en général en bas à droite)
 for (const k of ["left", "right", "top", "bottom"]) d.style[k] = best.css[k] != null ? best.css[k] + "px" : "auto";
 d.dataset.coin = best.nom; d.dataset.auto = auto ? "1" : "0";
 const t = d.querySelector(".re-tete");
 t.title = ferme ? (auto && _LEG.manuel == null ? "Légende repliée : dépliée, elle cacherait des résultats. Cliquer pour l'ouvrir." : "Afficher la légende") : "Replier la légende";
 return best.nom;
}
RE.legendeCarte = (map, etat, opts) => {
 const ct = map.getContainer(); let d = ct.querySelector("#reLeg");
 if (!d) { d = document.createElement("div"); d.id = "reLeg"; d.innerHTML = `<button type="button" class="re-tete" aria-expanded="true">Légende <span class="re-fl"></span><span class="re-resume"></span></button><div class="re-corps"></div>`; ct.appendChild(d);
  d.querySelector(".re-tete").onclick = () => { _LEG.manuel = !d.classList.contains("re-replie"); try { localStorage.setItem("re-legende-repliee", _LEG.manuel ? "1" : "0"); } catch(e) {}
   _placerLegende(map, d); };   // repliée ou dépliée à la demande, et replacée pour sa nouvelle taille
  if (!_LEG.rs) { _LEG.rs = () => { const x = ct.querySelector("#reLeg"); if (x && x.style.display !== "none") _placerLegende(map, x); }; window.addEventListener("resize", _LEG.rs); }
  if (!document.getElementById("reLegCss")) { const s = document.createElement("style"); s.id = "reLegCss";
   s.textContent = "#reLeg{position:absolute;right:10px;bottom:40px;z-index:2;max-width:270px;max-height:calc(100% - 140px);overflow:auto;background:rgba(255,255,255,.94);border-radius:8px;box-shadow:0 1px 6px rgba(0,0,0,.25);padding:3px 8px 4px;font:11px/1.3 system-ui,Segoe UI,Roboto,sans-serif;color:#1d2430}"
    + "#reLeg .re-tete{display:flex;align-items:center;gap:5px;border:0;background:none;padding:1px 0;font:700 11.5px system-ui,Segoe UI,Roboto,sans-serif;color:#1d2430;cursor:pointer}"
    + "#reLeg .re-fl::after{content:'▾'}#reLeg.re-replie .re-fl::after{content:'▸'}#reLeg.re-replie{padding:2px 8px}#reLeg.re-replie .re-corps{display:none}"
    + "#reLeg.re-replie{max-width:none}#reLeg .re-resume{display:none;gap:6px;font-weight:600;margin-left:4px;white-space:nowrap}#reLeg.re-replie .re-resume:not(:empty){display:inline-flex}#reLeg .re-resume .re-l{gap:3px}"
    + ".re-g{display:flex;flex-wrap:wrap;gap:1px 8px;margin:2px 0}.re-l{display:inline-flex;align-items:center;gap:4px}.re-sw{display:inline-block;width:12px;height:10px;border-radius:2px}.re-ic{width:16px;height:16px;object-fit:contain}"
    + "@media (max-width:760px){#reLeg{display:none!important}}"; document.head.appendChild(s); } }
 if (opts) _LEG.o = opts;
 const html = RE.legende(etat, RE.couchesVisibles(map));
 d.querySelector(".re-corps").innerHTML = html;
 d.querySelector(".re-resume").innerHTML = RE.legendeTerrain(RE.couchesVisibles(map));
 d.style.display = html ? "" : "none";
 if (html) _placerLegende(map, d);
 return d;
};
// replie (true) ou déplie (false) la légende de la carte ; null : revenir au placement automatique
RE.replierLegende = (map, v) => { _LEG.manuel = v; try { if (v == null) localStorage.removeItem("re-legende-repliee"); else localStorage.setItem("re-legende-repliee", v ? "1" : "0"); } catch(e) {}
 const d = map.getContainer().querySelector("#reLeg"); if (d && d.style.display !== "none") _placerLegende(map, d); };

/* ---------- export KML ---------- */
RE.kml = (etat, resultats, opts) => {
 const o = opts || {}, r = resultats || {}, g = _G(o), e = etat || {}, dos = [];
 const {plan, cond, contacts} = _unitesEtat(e, {mode:"tous"}), unites = [...plan, ...cond];
 const nomU = id => { const u = unites.find(x => String(x.id) === String(id)); return u && u.nom ? u.nom : "Unité " + id; };
 const it = (nom, desc, geo, sty) => Object.assign({nom, desc}, geo, sty || {});
 // unités et objectifs
 const U = [];
 for (const u of plan) { const c = RE.couleurUnite(u.id);
  if (u.depart) U.push(it(`${u.nom || "Unité"} – départ`, `${u.nom || "Unité"} (${RE.ECH_LBL[u.echelon] || u.echelon || "échelon ?"}, ${RE.CLS_LBL[u.classe] || u.classe || "classe ?"}), ${u.elements || "?"} éléments. Départ ${u.heure ? _hm(_min(u.heure)) : "?"}. Position ${_mg(u.depart)}.`, {pt:u.depart}, {couleur:c}));
  (u.objectifs || []).forEach((ob, i) => U.push(it(`${u.nom || "Unité"} – objectif${u.objectifs.length > 1 ? " " + (i + 1) : ""}`, `Objectif. Position ${_mg(ob)}.`, {pt:ob}, {couleur:c}))); }
 dos.push({nom:"Unités ennemies", ouvert:true, items:U});
 // axes et points de décision
 const AX = [], PD = [], parA = r.axes || {};
 for (const u of Object.keys(parA)) { const L = (parA[u] || []).filter(a => a && a.coords && a.coords.length > 1); const ch = (r.choisi || {})[u] || ((L.find(a => a.plausibilite === "forte") || L[0] || {}).genre);
  for (const a of L) { const ouv = (a.ouvrages || []).map(id => { const f = _feat(g, id); return f ? `${RE.OUV_LBL[f.type] || "ouvrage"} ${_mg([f.lon, f.lat])}` : id; });
   const gues = (a.franchissements || []).filter(x => x.genre === "gue").map(x => `gué${x.nom ? " « " + x.nom + " »" : ""} sans pont ${_mg(x.lonlat)} (${Math.round(x.duree_min || 0)} min)`);
   AX.push(it(`${nomU(u)} – ${a.nom || RE.GENRE_LBL[a.genre] || a.genre} (${RE.PLAUS_LBL[a.plausibilite] || "plausibilité ?"})${a.genre === ch ? " – choisi" : ""}`,
    `Longueur ${_num(a.longueur_km || 0)} km, durée ${Math.round(a.temps_min || 0)} min. Part exposée ${Math.round((a.part_exposee || 0)*100)} %, à couvert ${Math.round((a.part_couvert || 0)*100)} %. ` +
    `Départ ${_mg(a.coords[0])}, arrivée ${_mg(a.coords[a.coords.length - 1])}.` + (ouv.length ? ` Ouvrages : ${ouv.join(" ; ")}.` : "") + (gues.length ? ` Gués : ${gues.join(" ; ")}.` : "") + ((a.goulets || []).length ? ` Goulets : ${a.goulets.length}.` : ""),
    {ligne:a.coords}, {couleur:RE.couleurUnite(u), epaisseur:a.plausibilite === "forte" ? 5 : a.plausibilite === "moyenne" ? 3 : 2})); }
  const A = L.find(a => a.genre === ch); if (A) _pointsDecision(A, L.filter(a => a !== A)).forEach((p, i) => PD.push(it(`${nomU(u)} – point de décision ${i + 1}`, `Point où l'axe choisi quitte les autres axes. Position ${_mg(p)}.`, {pt:p}, {couleur:"#ffd600"}))); }
 dos.push({nom:"Axes", items:AX}, {nom:"Points de décision", items:PD});
 // jalons et horaires
 const J = [], parH = r.horaires && r.horaires.jalons ? {u: r.horaires} : (r.horaires || {});
 for (const u of Object.keys(parH)) { const h = parH[u]; if (!h || !h.jalons) continue;
  for (const j of h.jalons) { if (!j.lonlat) continue; const inc = j.incertitude_min > 0 ? ` ± ${Math.round(j.incertitude_min)} min` : "";
   J.push(it(`${_hm(j.heure_min)}${inc} – ${j.nom || "jalon"}`, `${nomU(u)} : tête attendue à ${_hm(j.heure_min)}${inc}, à ${_num(j.distance_km || 0)} km du départ (T+${Math.round(j.t_min || 0)} min).` +
    (j.gue ? ` Gué sans pont, franchissement ${Math.round(j.franchissement_min || 0)} min.` : "") + (j.goulet ? " Goulet." : "") + (j.expose ? " Tronçon exposé." : "") + ` Position ${_mg(j.lonlat)}.`, {pt:j.lonlat}, {couleur:j.goulet ? "#d50000" : RE.couleurUnite(u)})); } }
 dos.push({nom:"Jalons et horaires", items:J});
 // isochrones
 const I = [], iso = r.isochrones;
 if (iso && iso.arrivee_min && g && _RT) { const A = iso.arrivee_min, N = g.n*g.n; let t0 = iso.t0;
  if (t0 == null) { t0 = Infinity; for (let c = 0; c < N; c++) if (A[c] < t0) t0 = A[c]; }
  (iso.delais || []).slice().sort((a, b) => a - b).forEach((d, k) => { const m = new Uint8Array(N); for (let c = 0; c < N; c++) if (A[c] <= t0 + d) m[c] = 1;
   _RT.contours(m, g.n, g.b).forEach((l, q) => I.push(it(`T+${d} min (${_hm(t0 + d)})${q ? " – " + (q + 1) : ""}`, `Limite atteinte au plus tôt ${d} min après ${_hm(t0)}.`, {ligne:l}, {couleur:RE.ISO_COUL[Math.min(k, 4)], epaisseur:2}))); }); }
 dos.push({nom:"Isochrones", items:I});
 // regroupements
 const RG = [], parR = _parUnite(r.regroupements, "u");
 for (const u of Object.keys(parR)) (parR[u] || []).forEach((z, i) => {
  let rings = g && z.mailles && z.mailles.length && _RT ? _anneaux(z.mailles, g) : [];
  if (!rings.length && z.centre) rings = [CG.cercle(z.centre[0], z.centre[1], Math.sqrt((z.surface_km2 || 0.25)*1e6/Math.PI))];
  if (rings.length) RG.push(it(`Regroupement ${i + 1} – ${Math.round(z.duree_min || 0)} min` + (u !== "u" ? ` – ${nomU(u)}` : ""),
   `Durée ${Math.round(z.duree_min || 0)} min, surface ${_num(z.surface_km2 || 0, 2)} km², couvert ${Math.round((z.couvert || 0)*100)} %, à ${_num(z.distance_objectif_km || 0)} km de l'objectif${z.vue ? ", vue de nos positions" : ""}. Centre ${_mg(z.centre)}.`,
   {polys:rings}, {couleur:RE.couleurUnite(u === "u" ? (plan[0] || {}).id : u), remplissage:0.25})); });
 dos.push({nom:"Zones de regroupement", items:RG});
 // zones à survoler
 const ZS = ((r.presence || {}).zones || []).slice().sort((a, b) => a.rang - b.rang).filter(z => z.lonlat).map(z => it(`${z.rang} – zone à survoler (${z.niveau || "?"})`,
  `Rang ${z.rang}, niveau ${z.niveau || "?"} (${_num(z.part_pct || 0)} % de la présence), rayon ${Math.round(_rayon(z, o))} m, ${_num(z.elements_attendus || 0)} éléments attendus, à ${_num(z.distance_contact_km || 0)} km du contact (${Math.round(z.delai_min || 0)} min). ` +
  ((z.pourquoi || []).length ? "Pourquoi : " + z.pourquoi.join(" ; ") + ". " : "") + `Centre ${_mg(z.lonlat)}.`, _rayon(z, o) > 0 ? {polys:[CG.cercle(z.lonlat[0], z.lonlat[1], _rayon(z, o))]} : {pt:z.lonlat}, {couleur:"#4a148c", remplissage:0.15}));
 dos.push({nom:"Zones à survoler", items:ZS});
 // contacts
 dos.push({nom:"Contacts", items:contacts.filter(c => c.lonlat).sort((a, b) => a.h - b.h).map(c => it(`Contact ${isFinite(c.h) ? _hm(c.h) : "?"} – ${nomU(c.unite)}`,
  `${c.elements_vus || "?"} éléments vus à ${isFinite(c.h) ? _hm(c.h) : "?"}.` + (c.note ? " " + c.note + "." : "") + ` Position ${_mg(c.lonlat)}.`, {pt:c.lonlat}, {couleur:RE.couleurUnite(c.unite)}))});
 dos.push({nom:"Nos positions", items:(e.nos_positions || []).filter(p => p.lonlat).map(p => it(p.nom || "Nos positions", `Position ${_mg(p.lonlat)}.`, {pt:p.lonlat}, {couleur:RE.AMI}))});
 return CG.kml(o.titre || e.nom || "Ennemi", dos, o.note || "Outil Ennemi GTIA, démonstrateur, doctrine fictive. Positions en MGRS dans les descriptions.");
};
