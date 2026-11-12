/* Tests du rendu de l'outil Ennemi (rendu-ennemi.js, lot B), dans Chromium (Playwright).
   Banc d'essai : tests/banc-rendu-ennemi.html (carte MapLibre sur fond uni, terrain-demo.json ouvert par le moteur terrain).
   Les résultats du moteur ennemi (lot A) sont FACTICES, fabriqués ici selon les signatures de moteur-ennemi.js
   (axes par search + cheminVers, horaires, position de colonne, isochrones par search avec départs décalés,
   présence, zones à survoler, zones de regroupement).
   node tests/rendu-ennemi.js   (mêmes variables que run.js : PLAYWRIGHT_MODULE, CHROMIUM)
   Captures et KML dans /tmp/rendu-ennemi/. */
const fs = require("fs"), path = require("path"), {execFileSync} = require("child_process");
const H = require("./helpers.js");
const OUT = "/tmp/rendu-ennemi"; fs.mkdirSync(OUT, {recursive:true});
const echecs = []; let nOk = 0;
const ok = (c, m) => { if (c) { nOk++; if (process.env.VERBEUX) console.log("   ✓ " + m); } else { echecs.push(m); console.log("   ✗ " + m); } };
const T_MAP = {timeout:60000};

/* ---------- résultats factices (exécuté dans la page) ---------- */
function fabriquer(){
 const N = G.n*G.n, ll = w => w < N ? cellLL(w) : [G.R.lon[w - N], G.R.lat[w - N]];
 const cell = (u, v) => Math.floor(v*G.n)*G.n + Math.floor(u*G.n);
 const praticable = (c, k) => { for (let r = 0; r < 8; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const x = c + dj*G.n + di; if (x >= 0 && x < N && G.cls[k][x] >= 2) return x; } return c; };
 const axe = (k, dep, obj, mult, genre, plaus, nom) => {
  const r = search([dep], k, {mult, cible:new Uint8Array(N).map((_, i) => i === obj ? 1 : 0)});
  const nodes = cheminVers(r, obj), coords = nodes.map(ll), frac = ME.vitesseFrac(k, "attaque");
  const dn = [0]; for (let i = 1; i < coords.length; i++) dn.push(dn[i-1] + distM(coords[i-1], coords[i])/1000);
  const tn = nodes.map(w => r.brut[w]*60/frac);
  const ouvrages = [], goulets = [];
  G.feats.forEach(f => { if (coords.some(p => distM(p, [f.lon, f.lat]) < 120)) { ouvrages.push(f.id); if (Object.keys(f.g || {}).length) goulets.push(f.id); } });
  if (!goulets.length && ouvrages.length) goulets.push(ouvrages[0]);
  return {genre, nom, plausibilite:plaus, noeuds:nodes, coords, dn, tn, longueur_km:dn[dn.length-1], temps_min:tn[tn.length-1], ouvrages, goulets, part_exposee:0.3, part_couvert:0.4};
 };
 const penal = (axeRef, f) => { const m = new Float32Array(N).fill(1); for (const p of axeRef.coords) { const c = cellAt({lng:p[0], lat:p[1]}); if (c < 0) continue;
  for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) { const x = c + dj*G.n + di; if (x >= 0 && x < N) m[x] = f; } } return m; };
 const unites = [
  Object.assign(ME.uniteDepuisType("cie-meca"), {id:"u1", nom:"1re Cie méca", depart:cellLL(praticable(cell(0.08, 0.1), "chenille")), objectifs:[cellLL(praticable(cell(0.85, 0.82), "chenille"))], heure_depart_min:6*60, mode:"attaque"}),
  Object.assign(ME.uniteDepuisType("cie-pied"), {id:"u2", nom:"2e Cie à pied", depart:cellLL(praticable(cell(0.9, 0.12), "fantassin")), objectifs:[cellLL(praticable(cell(0.3, 0.85), "fantassin"))], heure_depart_min:6*60 + 30, mode:"attaque"})];
 const axes = {};
 for (const u of unites) { const dep = cellAt({lng:u.depart[0], lat:u.depart[1]}), obj = cellAt({lng:u.objectifs[0][0], lat:u.objectifs[0][1]});
  const a1 = axe(u.classe, dep, obj, null, "rapide", "moyenne", "le plus rapide");
  const sMult = new Float32Array(N); for (let c = 0; c < N; c++) sMult[c] = G.cls[u.classe][c] === 3 ? 1.6 : 1;   // « sûr » : évite le GO découvert (factice)
  const a2 = axe(u.classe, dep, obj, sMult, "sur", "forte", "le plus discret");
  const a3 = axe(u.classe, dep, obj, penal(a2, 4), "variante", "faible", "variante");
  axes[u.id] = [a1, a2, a3]; }
 const horaires = {}, positions = {};
 for (const u of unites) { const A = axes[u.id][1], J = [];
  let prochain = 0; A.coords.forEach((p, i) => { if (A.dn[i] >= prochain || i === A.coords.length - 1) { J.push({nom:i === A.coords.length - 1 ? "objectif" : "km " + Math.round(A.dn[i]), id_ouvrage:null, lonlat:p, distance_km:A.dn[i], t_min:A.tn[i], heure_min:u.heure_depart_min + A.tn[i], incertitude_min:u.dispersion_min + 0.1*A.tn[i], expose:false, goulet:false}); prochain = A.dn[i] + 1.5; } });
  for (const id of A.ouvrages) { const f = G.feats.find(x => x.id === id); let bi = 0, bd = Infinity; A.coords.forEach((p, i) => { const d = distM(p, [f.lon, f.lat]); if (d < bd) { bd = d; bi = i; } });
   J.push({nom:"pont", id_ouvrage:id, lonlat:[f.lon, f.lat], distance_km:A.dn[bi], t_min:A.tn[bi], heure_min:u.heure_depart_min + A.tn[bi], incertitude_min:u.dispersion_min + 0.1*A.tn[bi], expose:true, goulet:A.goulets.includes(id)}); }
  J.sort((a, b) => a.distance_km - b.distance_km); horaires[u.id] = {jalons:J, troncons:[]};
  // colonne à mi-parcours : tête à 55 % du temps, queue = prof_km derrière
  const tt = A.temps_min*0.55; let i = A.tn.findIndex(t => t >= tt); if (i < 1) i = 1;
  let q = i; while (q > 0 && A.dn[i] - A.dn[q] < u.prof_km) q--;
  positions[u.id] = {tete:A.coords[i], queue:A.coords[q], d_tete_km:A.dn[i], d_queue_km:A.dn[q], trace:A.coords.slice(q, i + 1)}; }
 // conduite : deux contacts horodatés pour u1, un pour u3 (roue)
 const c1 = praticable(cell(0.45, 0.4), "chenille"), c2 = praticable(cell(0.55, 0.5), "chenille"), c3 = praticable(cell(0.2, 0.7), "roue");
 const contacts = [{id:"c1", unite:"u1", lonlat:cellLL(c1), heure:"07:05", elements_vus:4}, {id:"c2", unite:"u1", lonlat:cellLL(c2), heure:"07:20", elements_vus:6},
  {id:"c3", unite:"u3", lonlat:cellLL(c3), heure:"07:10", elements_vus:3}];
 const frac = ME.vitesseFrac("chenille", "attaque"), r = search([c1, c2, c3], "chenille", {t0:[0, 15/60*frac, 5/60*frac]});
 const arrivee_min = new Float32Array(N); for (let c = 0; c < N; c++) arrivee_min[c] = isFinite(r.T[c]) ? 7*60 + 5 + r.T[c]*60/frac : Infinity;
 const iso = {arrivee_min, atteint:new Uint8Array(N), delais:[5, 10, 20, 40], par_unite:{}};
 // présence : gaussienne sur l'heure d'arrivée à 07:40, plus d'attrait en forêt / bâti (SLOW-GO) – factice
 const tq = 7*60 + 40, Q = new Float32Array(N); let tot = 0;
 for (let c = 0; c < N; c++) { if (!isFinite(arrivee_min[c])) continue; const d = (arrivee_min[c] - tq)/12; Q[c] = Math.exp(-d*d)*(G.cls.chenille[c] === 2 ? 1.6 : 1); tot += Q[c]; }
 const zones = [], pris = [];
 const ord = Array.from({length:N}, (_, c) => c).sort((a, b) => Q[b] - Q[a]);
 for (const c of ord) { if (zones.length >= 5 || !(Q[c] > 0)) break; const p = cellLL(c); if (pris.some(x => distM(x, p) < 1500)) continue; pris.push(p);
  zones.push({rang:zones.length + 1, lonlat:p, rayon_m:500, niveau:zones.length < 2 ? "forte" : zones.length < 4 ? "moyenne" : "faible", part_pct:30 - 5*zones.length, elements_attendus:3, distance_contact_km:distM(p, cellLL(c2))/1000, delai_min:arrivee_min[c] - 7*60, pourquoi:["lisière", "couvert"]}); }
 // regroupements : mailles praticables à moins de 400 m d'un point à 2 km avant l'objectif
 const ZR = u => { const A = axes[u.id][1]; let i = A.dn.findIndex(d => d >= A.longueur_km - 2.2); if (i < 0) i = 0; const ctr = A.coords[i], m = [];
  for (let c = 0; c < N; c++) if (G.cls[u.classe][c] >= 2 && distM(cellLL(c), ctr) < 400) m.push(c);
  return [{centre:ctr, mailles:m, surface_km2:m.length*G.cell*G.cell/1e6, couvert:0.6, distance_objectif_km:2.2, vue:false, duree_min:45, niveau:"forte"}]; };
 const regroupements = {u1:ZR(unites[0])};
 const etat = {nom:"Banc d'essai", nos_positions:[{id:"a1", nom:"Point d'appui Nord", lonlat:cellLL(cell(0.6, 0.15))}, {id:"a2", nom:"Observatoire", lonlat:cellLL(cell(0.25, 0.45))}],
  planification:{scenarios:[{id:"s1", nom:"Hypothèse 1", mode_action:"attaque", heure_depart:"06:00", unites:unites.map(u => Object.assign({}, u, {heure_depart:u.id === "u2" ? "06:30" : undefined}))}]},
  conduite:{heure:"07:40", unites:[Object.assign(ME.uniteDepuisType("cie-meca"), {id:"u1", nom:"1re Cie méca"}), Object.assign(ME.uniteDepuisType("cie-moto"), {id:"u3", nom:"Cie motorisée inconnue"})], contacts}};
 window.FAUX = {unites, axes, horaires, positions, iso, presence:{Q, total:tot, par_unite:{}, zones}, regroupements, etat};
 return {axes:Object.fromEntries(Object.entries(axes).map(([k, L]) => [k, L.map(a => [a.genre, a.coords.length, a.ouvrages.length, Math.round(a.temps_min)])])), zones:zones.length, zr:regroupements.u1[0].mailles.length};
}
const ouvrirDemo = async p => { await p.waitForFunction(() => mapReady, null, T_MAP);
 await p.evaluate(async () => { const o = await (await fetch("../terrain-demo.json")).json(); await calculerZoneEtapes(o); map.fitBounds([[G.b.w, G.b.s], [G.b.e, G.b.n]], {padding:30, duration:0}); }); };
const idle = p => p.evaluate(() => new Promise(r => { if (map.loaded() && !map.isMoving()) map.once("idle", r), map.triggerRepaint(); else map.once("idle", r); setTimeout(r, 4000); }));
const cap = async (p, nom) => { await idle(p); await p.screenshot({path:path.join(OUT, nom + ".png")}); };
const legendeTexte = p => p.evaluate(() => (document.getElementById("reLeg") || {}).innerText || "");
const DEC = /\d+[.,]\d{4,}/;   // coordonnée décimale (4 décimales ou plus)

(async () => {
 const {server, base} = await H.serveur(), b = await H.navigateur();
 const ctx = await b.newContext({viewport:{width:1400, height:900}});
 await ctx.route(/geopf\.fr|tile\.openstreetmap\.org|arcgisonline|opentopomap|elevation-tiles/, r => r.abort());
 const p = await ctx.newPage(); const erreurs = []; p.on("pageerror", e => erreurs.push(e.message)); p.on("console", m => { if (m.type() === "error") erreurs.push("console : " + m.text()); });

 console.log("• planification : terrain lissé, axes, horaires, colonne, regroupement, saisies, légende");
 await p.goto(base + "tests/banc-rendu-ennemi.html"); await ouvrirDemo(p);
 const fab = await p.evaluate(fabriquer); console.log("   résultats factices : " + JSON.stringify(fab));
 ok(Object.values(fab.axes).every(L => L.every(a => a[1] > 5)), "axes factices fabriqués (search + cheminVers)");
 const msDemo = await p.evaluate(() => {
  const ms = RE.terrain(map, G, "chenille", {opacite:0.7});
  RE.axes(map, FAUX.axes, {unite:"u1", choisi:{u1:"sur", u2:"sur"}}); RE.horaires(map, {u1:FAUX.horaires.u1}); RE.colonne(map, FAUX.positions, {unites:FAUX.unites});
  RE.regroupements(map, FAUX.regroupements); RE.saisies(map, FAUX.etat, {mode:"planification"}); RE.legendeCarte(map, FAUX.etat); return ms; });
 console.log(`   terrain démonstration ${await p.evaluate(() => G.n)}×${await p.evaluate(() => G.n)} : ${msDemo.toFixed(0)} ms`);
 await idle(p);
 const st = await p.evaluate(() => ({vis:RE.couchesVisibles(map), terr:map.getLayoutProperty("en-terrain", "visibility"), feats:map.queryRenderedFeatures().filter(f => f.layer.id.startsWith("en-")).map(f => f.layer.id)}));
 ok(st.terr === "visible", "fond de mobilité affiché");
 ok(["en-terrain", "en-axes", "en-horaires", "en-colonne", "en-regroup", "en-saisies"].every(g => st.vis.includes(g)), "groupes visibles : " + st.vis.join(", "));
 for (const l of ["en-axes", "en-axes-moyenne", "en-axes-faible", "en-axes-halo", "en-axes-pts", "en-horaires", "en-colonne", "en-colonne-tete", "en-regroup", "en-saisies"])
  ok(st.feats.includes(l), "couche dessinée : " + l);
 const pts = await p.evaluate(() => map.querySourceFeatures("en-axes").filter(f => f.geometry.type === "Point").map(f => f.properties.k));
 ok(pts.includes("pd"), "point de décision affiché"); ok(pts.includes("ouvrage"), "ouvrages de l'axe choisi affichés"); ok(pts.includes("goulet"), "goulet affiché");
 let leg = await legendeTexte(p); console.log("   légende : " + leg.replace(/\s+/g, " "));
 ok(/plausibilité forte/.test(leg) && /plausibilité faible/.test(leg) && /Point de décision/.test(leg) && /Regroupement|regroupement/.test(leg), "légende : axes, point de décision, regroupement");
 ok(!/T\+/.test(leg) && !/survoler/.test(leg), "légende : pas d'isochrones ni de zones à survoler (non dessinées)");
 ok(/1re Cie méca \(compagnie, chenillé\)/.test(leg) && /2e Cie à pied \(compagnie, à pied\)/.test(leg), "légende : unités par classe et échelon");
 ok(/Nos positions/.test(leg), "légende : nos positions");
 await cap(p, "1-planification");
 // couche masquée → retirée de la légende
 await p.evaluate(() => { RE.afficher(map, "en-regroup", false); RE.legendeCarte(map, FAUX.etat); });
 leg = await legendeTexte(p); ok(!/regroupement/i.test(leg), "couche masquée → absente de la légende");
 await p.evaluate(() => { RE.afficher(map, "en-regroup", true); RE.legendeCarte(map, FAUX.etat); });
 // aucune coordonnée décimale : légende, étiquettes (images) et texte de la page
 const txt = await p.evaluate(() => document.body.innerText + "\n" + map.listImages().join("\n"));
 ok(!DEC.test(txt), "aucune coordonnée décimale à l'écran (texte et étiquettes)");
 // zoom sur l'axe choisi et la colonne
 await p.evaluate(() => { const t = FAUX.positions.u1.tete; map.jumpTo({center:t, zoom:14}); }); await cap(p, "2-axe-zoom14");
 // zoom fort sur une limite de mobilité : rendu lissé, pas de carrés
 await p.evaluate(() => { map.jumpTo({center:[(G.b.w + G.b.e)/2, (G.b.s + G.b.n)/2], zoom:15.5}); RE.afficher(map, "en-axes", false); RE.afficher(map, "en-horaires", false); RE.afficher(map, "en-saisies", false); RE.afficher(map, "en-colonne", false); RE.afficher(map, "en-regroup", false); });
 await cap(p, "3-terrain-zoom15");
 const zf = await p.evaluate(() => ({z:map.getLayoutProperty("en-terrain-z", "visibility"), base:map.getLayoutProperty("en-terrain", "visibility")}));
 ok(zf.z === "visible" && zf.base === "none", "zoom fort : vue recalculée à la résolution de l'écran (" + JSON.stringify(zf) + ")");
 // sélection d'un autre axe
 await p.evaluate(() => { map.fitBounds([[G.b.w, G.b.s], [G.b.e, G.b.n]], {padding:30, duration:0}); ["en-axes", "en-horaires", "en-saisies", "en-colonne"].forEach(g => RE.afficher(map, g, true));
  RE.axes(map, FAUX.axes, {unite:"u1", choisi:{u1:"variante", u2:"sur"}}); RE.legendeCarte(map, FAUX.etat); });
 await idle(p);
 const sel = await p.evaluate(() => map.querySourceFeatures("en-axes").filter(f => f.properties.sel === 1).map(f => f.properties.u + ":" + f.properties.genre));
 ok(sel.includes("u1:variante") && !sel.includes("u1:sur"), "axe sélectionné changé (" + [...new Set(sel)].join(", ") + ")");
 await cap(p, "4-autre-axe");

 console.log("• conduite : isochrones, présence, zones à survoler, contacts");
 await p.evaluate(() => { RE.effacer(map, ["en-axes", "en-horaires", "en-colonne", "en-regroup"]);
  RE.isochrones(map, FAUX.iso, G, {}); RE.presence(map, FAUX.presence, G, {}); RE.saisies(map, FAUX.etat, {mode:"conduite"}); RE.legendeCarte(map, FAUX.etat); });
 await idle(p);
 const st2 = await p.evaluate(() => ({vis:RE.couchesVisibles(map), iso:map.querySourceFeatures("en-iso").length, et:map.querySourceFeatures("en-iso-et").map(f => f.properties.d),
  z:[...new Set(map.querySourceFeatures("en-presence-z").filter(f => f.properties.k === "num").map(f => f.properties.rang))]}));
 ok(st2.iso > 0 && [5, 10, 20, 40].every(d => st2.et.includes(d)), "isochrones et étiquettes T+5/10/20/40");
 ok(st2.z.length === 5 && [1, 2, 3, 4, 5].every(r => st2.z.includes(r)), "5 zones à survoler numérotées");
 ok(!st2.vis.includes("en-axes") && st2.vis.includes("en-iso") && st2.vis.includes("en-presence"), "groupes visibles : " + st2.vis.join(", "));
 leg = await legendeTexte(p); console.log("   légende : " + leg.replace(/\s+/g, " "));
 ok(/T\+5 min/.test(leg) && /T\+40 min/.test(leg) && /survoler/.test(leg) && /Contact/.test(leg) && /Nos positions/.test(leg), "légende conduite : isochrones, zones, contacts, nos positions");
 ok(!/plausibilité/.test(leg) && !/Jalon/.test(leg), "légende conduite : plus d'axes ni de jalons (effacés)");
 const txt2 = await p.evaluate(() => document.body.innerText + "\n" + map.listImages().join("\n")); ok(!DEC.test(txt2), "aucune coordonnée décimale (conduite)");
 await cap(p, "5-conduite");
 await p.evaluate(() => { RE.afficher(map, "en-terrain", false); RE.legendeCarte(map, FAUX.etat); }); await cap(p, "6-conduite-sans-terrain");
 leg = await legendeTexte(p); ok(!/SLOW-GO/.test(leg), "terrain masqué → absent de la légende");

 console.log("• export KML");
 const kml = await p.evaluate(() => RE.kml(FAUX.etat, {axes:FAUX.axes, choisi:{u1:"sur", u2:"sur"}, horaires:FAUX.horaires, isochrones:FAUX.iso, presence:FAUX.presence, regroupements:FAUX.regroupements}, {titre:"Banc d'essai ennemi"}));
 const bb = await p.evaluate(() => G.b);
 fs.writeFileSync(path.join(OUT, "ennemi.kml"), kml);
 let xmlOk = true; try { execFileSync("xmllint", ["--noout", path.join(OUT, "ennemi.kml")], {stdio:"pipe"}); } catch(e) { xmlOk = false; console.log(String(e.stderr)); }
 ok(xmlOk, "KML : XML bien formé (xmllint)");
 const coords = [...kml.matchAll(/<coordinates>([^<]*)<\/coordinates>/g)].flatMap(m => m[1].trim().split(/\s+/)).map(s => s.split(",").map(Number));
 const marge = 0.02, dedans = coords.filter(([lon, lat]) => lon >= bb.w - marge && lon <= bb.e + marge && lat >= bb.s - marge && lat <= bb.n + marge);
 ok(coords.length > 100 && dedans.length === coords.length, `KML : ${coords.length} coordonnées, toutes en lon,lat dans l'emprise (${dedans.length})`);
 ok(coords.every(c => c.length === 2 && c.every(Number.isFinite)), "KML : coordonnées numériques, deux valeurs");
 const dossiers = [...kml.matchAll(/<Folder><name>([^<]*)<\/name>/g)].map(m => m[1]);
 console.log("   dossiers : " + dossiers.join(" | "));
 ok(["Unités ennemies", "Axes", "Points de décision", "Jalons et horaires", "Isochrones", "Zones de regroupement", "Zones à survoler", "Contacts", "Nos positions"].every(d => dossiers.includes(d.replace(/'/g, "&#39;"))), "KML : tous les dossiers en français");
 const polys = [...kml.matchAll(/<LinearRing><coordinates>([^<]*)<\/coordinates>/g)].map(m => m[1].trim().split(/\s+/));
 ok(polys.length > 0 && polys.every(r => r[0] === r[r.length - 1] && r.length >= 4), "KML : anneaux de polygones fermés");
 ok(/MGRS|30T|31T/.test(kml) && /<name>\d\d:\d\d ± \d+ min/.test(kml) && /T\+10 min/.test(kml), "KML : horaires, isochrones, positions MGRS dans les descriptions");
 ok(!/NaN|undefined|Infinity/.test(kml), "KML : ni NaN, ni undefined, ni Infinity");

 console.log("• performance : grille 500 × 500 (50 km)");
 const perf = await p.evaluate(async () => {
  const n = 500, N = n*n, lat0 = 47.26, lon0 = -0.08, dlat = 50000/110574/2, dlon = 50000/(111320*Math.cos(lat0*Math.PI/180))/2;
  const fab = graine => { const cls = new Uint8Array(N); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
   const v = Math.sin(i/23 + graine) + Math.cos(j/17) + 0.6*Math.sin((i + j)/9 + graine*2) + 0.4*Math.sin(i*j/4000);
   cls[j*n + i] = v > 1.6 ? 1 : v > 0.9 ? 2 : v < -1.9 ? 0 : 3; } return cls; };
  const g = {id:"perf", n, cell:100, b:{w:lon0 - dlon, e:lon0 + dlon, s:lat0 - dlat, n:lat0 + dlat}, cls:{chenille:fab(0), roue:fab(1)}, feats:[], coupe:null};
  const attendre = () => new Promise(r => { map.once("render", r); map.triggerRepaint(); });
  map.fitBounds([[g.b.w, g.b.s], [g.b.e, g.b.n]], {duration:0}); RE.effacer(map);
  const r = {};
  const essais = [];
  for (let e = 0; e < 5; e++) { const gg = Object.assign({}, g, {cls:{chenille:fab(e*0.7)}}); const t1 = performance.now(); const calc = RE.terrain(map, gg, "chenille", {}); await attendre(); essais.push([calc, performance.now() - t1]); }
  r.terrain_calcul_max = Math.max(...essais.map(x => x[0])); r.terrain_affiche_max = Math.max(...essais.map(x => x[1])); r.terrain_affiche_min = Math.min(...essais.map(x => x[1]));
  let t = performance.now(); r.terrain1 = RE.terrain(map, g, "chenille", {}); await attendre(); r.terrain1_affiche = performance.now() - t;
  t = performance.now(); r.terrain2 = RE.terrain(map, g, "roue", {}); await attendre(); r.terrain2_affiche = performance.now() - t;
  t = performance.now(); RE.terrain(map, g, "chenille", {}); await attendre(); r.terrain_cache = performance.now() - t;
  const A = new Float32Array(N); for (let c = 0; c < N; c++) { const i = c % n, j = (c/n) | 0; A[c] = 420 + Math.hypot(i - 250, j - 250)*0.25*(g.cls.chenille[c] === 2 ? 1.5 : 1); }
  t = performance.now(); RE.isochrones(map, {arrivee_min:A, delais:[5, 10, 20, 40]}, g, {}); r.iso = performance.now() - t;
  const Q = new Float32Array(N); for (let c = 0; c < N; c++) { const z = (A[c] - 440)/8; Q[c] = Math.exp(-z*z); }
  t = performance.now(); RE.presence(map, {Q, zones:[]}, g, {}); await attendre(); r.presence = performance.now() - t;
  t = performance.now(); const k = RE.kml({}, {isochrones:{arrivee_min:A, delais:[5, 10, 20, 40]}}, {G:g}); r.kml_iso = performance.now() - t; r.kml_ko = Math.round(k.length/1024);
  window.PERF_G = g; return r; });
 console.log("   " + Object.entries(perf).map(([k, v]) => k + " " + Math.round(v)).join(" ; ") + " (ms, sauf kml_ko)");
 ok(perf.terrain_affiche_max < 1000 && perf.terrain2_affiche < 1000, `terrain 500×500 affiché en moins d'1 s (7 rendus, pire ${Math.round(Math.max(perf.terrain_affiche_max, perf.terrain2_affiche))} ms)`);
 await cap(p, "7-perf-500");
 await p.evaluate(() => { map.jumpTo({center:[-0.08, 47.26], zoom:14}); }); await cap(p, "8-perf-500-zoom14");
 ok(erreurs.length === 0, "aucune erreur de script (banc) " + erreurs.join(" | "));

 console.log("• rendu lissé : rendu-lisse.js par <script> (espace de noms RT), sans fetch ; absent : erreur claire");
 const q = await ctx.newPage(); const err2 = [], req2 = []; q.on("pageerror", e => err2.push(e.message)); q.on("request", r => req2.push(r.url()));
 await q.goto(base + "tests/banc-rendu-ennemi.html"); await ouvrirDemo(q);
 const iso = await q.evaluate(async () => { RE.terrain(map, G, "fantassin", {}); await RE.pret();
  return {RT:typeof RT, plusFort:typeof plusFort, contours:typeof contours, renderOv:typeof renderOv, vis:map.getLayoutProperty("en-terrain", "visibility"), groupes:RE.couchesVisibles(map), memes:RT.COL.go.join() === "46,160,67"}; });
 ok(iso.RT === "object" && iso.plusFort === "undefined" && iso.contours === "undefined" && iso.renderOv === "undefined" && iso.vis === "visible" && iso.groupes.includes("en-terrain") && iso.memes, "rendu lissé par rendu-lisse.js : une seule globale (RT), aucune fonction de l'outil Terrain ajoutée (" + JSON.stringify(iso) + ")");
 ok(!req2.some(u => /rendu-terrain\.js/.test(u)), "rendu-terrain.js jamais demandé (ni script, ni fetch)");
 await cap(q, "9-rendu-lisse-fantassin");
 ok(err2.length === 0, "aucune erreur de script (rendu-lisse) " + err2.join(" | "));
 const q2 = await ctx.newPage(); const err4 = []; q2.on("pageerror", e => err4.push(e.message));
 await q2.route(/rendu-lisse\.js/, r => r.abort()); await q2.goto(base + "tests/banc-rendu-ennemi.html"); await q2.waitForTimeout(500);
 ok(err4.some(e => /charger rendu-lisse\.js avant/.test(e)), "sans rendu-lisse.js : erreur claire au chargement (" + (err4[0] || "aucune") + ")");
 await q2.close();
 // index.html (outil Terrain) : mêmes fonctions qu'avant, reprises de RT sous leurs noms habituels
 const t = await ctx.newPage(); const err5 = []; t.on("pageerror", e => err5.push(e.message));
 await t.goto(base + "index.html"); await t.waitForTimeout(1500);
 ok(await t.evaluate(() => plusFort === RT.plusFort && contours === RT.contours && COL === RT.COL && ALPHA_GO === 140 && typeof renderOv === "function" && typeof legend === "function"), "index.html : fonctions du rendu lissé = RT (mêmes noms globaux qu'avant)");
 ok(err5.length === 0, "index.html : aucune erreur de script " + err5.join(" | ")); await t.close();

 console.log("• légende repliable et placée sans cacher les objets ; étiquettes de jalon au-dessus de la colonne ; étiquettes d'isochrones sur leur ligne");
 const ordre = await p.evaluate(() => { const L = map.getStyle().layers.map(l => l.id); return {col:L.indexOf("en-colonne"), tete:L.indexOf("en-colonne-tete"), et:L.indexOf("en-horaires"), pt:L.indexOf("en-horaires-pt")}; });
 ok(ordre.et > ordre.col && ordre.et > ordre.tete && ordre.pt > ordre.col, "étiquettes et points de jalons dessinés au-dessus de la colonne " + JSON.stringify(ordre));
 await p.evaluate(() => { RE.effacer(map); map.fitBounds([[G.b.w, G.b.s], [G.b.e, G.b.n]], {padding:30, duration:0}); RE.terrain(map, G, "chenille", {});
  RE.axes(map, FAUX.axes, {unite:"u1", choisi:{u1:"sur", u2:"sur"}}); RE.horaires(map, {u1:FAUX.horaires.u1}); RE.colonne(map, FAUX.positions, {unites:FAUX.unites});
  RE.saisies(map, FAUX.etat, {mode:"planification"}); RE.legendeCarte(map, FAUX.etat); });
 await idle(p);
 const couvre = () => p.evaluate(() => { const d = document.getElementById("reLeg"), r = d.getBoundingClientRect(), pts = [];
  FAUX.unites.forEach(u => { pts.push(u.depart); u.objectifs.forEach(o => pts.push(o)); }); FAUX.etat.nos_positions.forEach(a => pts.push(a.lonlat));
  const n = pts.filter(ll => { const q = map.project(ll); return q.x > r.left - 6 && q.x < r.right + 6 && q.y > r.top - 6 && q.y < r.bottom + 6; }).length;
  return {n, replie:d.classList.contains("re-replie"), coin:d.dataset.coin, h:Math.round(r.height)}; });
 let c1 = await couvre(); ok(c1.n === 0 || c1.replie, "légende : ne cache aucun départ, objectif ni position (" + JSON.stringify(c1) + ")");
 // objectif poussé dans chaque coin : la légende change de coin, ou se replie
 for (const [u, v] of [[0.97, 0.97], [0.03, 0.97], [0.97, 0.03]]) {
  const r = await p.evaluate(([u, v]) => { const b = G.b, e = JSON.parse(JSON.stringify(FAUX.etat)), q = map.unproject([map.getContainer().clientWidth*u, map.getContainer().clientHeight*v]);
   e.planification.scenarios[0].unites[0].objectifs = [[q.lng, q.lat]]; RE.saisies(map, e, {mode:"planification"}); const d = RE.legendeCarte(map, e), rr = d.getBoundingClientRect(), o = map.project([q.lng, q.lat]);
   return {coin:d.dataset.coin, replie:d.classList.contains("re-replie"), cache:o.x > rr.left - 6 && o.x < rr.right + 6 && o.y > rr.top - 6 && o.y < rr.bottom + 6}; }, [u, v]);
  ok(!r.cache || r.replie, `objectif dans le coin (${u}, ${v}) : légende ${r.replie ? "repliée" : "placée en " + r.coin}, objectif visible`); }
 await p.evaluate(() => { RE.saisies(map, FAUX.etat, {mode:"planification"}); RE.legendeCarte(map, FAUX.etat); });
 await p.click("#reLeg .re-tete"); const c2 = await couvre(); await p.click("#reLeg .re-tete"); const c3 = await couvre();
 ok(c2.replie !== c3.replie && Math.min(c2.h, c3.h) < 30 && Math.max(c2.h, c3.h) > 100, `légende repliable par son bouton (${c2.h} px ↔ ${c3.h} px)`);
 await p.evaluate(() => RE.replierLegende(map, null));
 await cap(p, "11-legende-placee");
 // isochrones : chaque étiquette sur sa ligne, au front (pas sur un trou intérieur près des contacts)
 await p.evaluate(() => { RE.effacer(map, ["en-axes", "en-horaires", "en-colonne"]); RE.isochrones(map, FAUX.iso, G, {}); RE.saisies(map, FAUX.etat, {mode:"conduite"}); RE.legendeCarte(map, FAUX.etat); });
 await idle(p);
 const et = await p.evaluate(() => { const A = FAUX.iso.arrivee_min, N = G.n*G.n, out = []; let t0 = Infinity; for (let c = 0; c < N; c++) if (A[c] < t0) t0 = A[c];
  const E = map.getSource("en-iso-et")._data.features, org = (() => { let x = 0, y = 0, m = 0; for (let c = 0; c < N; c++) if (A[c] <= t0 + 1e-6) { x += c % G.n; y += (c/G.n) | 0; m++; } return cellLL(Math.round(y/m)*G.n + Math.round(x/m)); })();
  for (const d of FAUX.iso.delais) { const e = E.find(f => f.properties.d === d), m = new Uint8Array(N); for (let c = 0; c < N; c++) if (A[c] <= t0 + d) m[c] = 1;
   const pts = RT.contours(m, G.n, G.b).flat(), dd = pts.map(q => distM(q, org)).sort((a, b) => a - b);
   out.push({d, sur:Math.round(Math.min(...pts.map(q => distM(q, e.geometry.coordinates)))), dist:Math.round(distM(e.geometry.coordinates, org)), med:Math.round(dd[dd.length >> 1])}); }
  return out; });
 ok(et.every(x => x.sur < 1 && x.dist >= x.med), "étiquettes T+5…T+40 sur leur ligne, au front : " + JSON.stringify(et));
 await cap(p, "12-isochrones-etiquettes");
 ok(erreurs.length === 0, "aucune erreur de script (banc, suite) " + erreurs.join(" | "));

 console.log("• ennemi.html avec ce rendu");
 const e = await ctx.newPage(); const err3 = []; e.on("pageerror", x => err3.push(x.message));
 await e.addInitScript(() => { try { localStorage.setItem("tuto-ennemi", "1"); } catch(x) {} });
 await e.goto(base + "ennemi.html"); await e.waitForFunction(() => typeof mapReady !== "undefined" && mapReady, null, T_MAP);
 await e.click("#demoBtn"); await e.waitForFunction(() => /Terrain «|Échec/.test(document.getElementById("status").textContent), null, T_MAP);
 await e.waitForFunction(() => calmeEnnemi(), null, T_MAP); await e.click("#terBtn"); await e.waitForTimeout(400);
 const ev = await e.evaluate(() => ({vis:RE.couchesVisibles(map).includes("en-terrain") && [map.getLayoutProperty("en-terrain", "visibility"), map.getLayoutProperty("en-terrain-z", "visibility")].includes("visible"), st:document.getElementById("status").textContent}));
 ok(ev.vis && /Terrain «/.test(ev.st), "ennemi.html : terrain de démonstration affiché par RE.terrain (bouton Terrain)");
 await cap(e, "10-ennemi-html");
 ok(err3.length === 0, "aucune erreur de script (ennemi.html) " + err3.join(" | "));

 await b.close(); server.close();
 console.log("\n" + (echecs.length ? "ÉCHECS (" + echecs.length + ") :\n - " + echecs.join("\n - ") : `Rendu ennemi : tous les tests passent (${nOk} vérifications).`));
 process.exit(echecs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
