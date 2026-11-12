/* Tests de bout en bout de l'interface de l'outil Ennemi (ennemi.html, lot C), dans Chromium (Playwright), PC et téléphone simulé.
   Lancer :  PLAYWRIGHT_MODULE=/opt/node-tools/node_modules/playwright node tests/ennemi-ui.js [filtre]
   Captures d'écran : /tmp/ennemi-ui/ (à regarder).

   Moteur simulé : tant que des fonctions de moteur-ennemi.js sont encore des ébauches (étape 0 : corps vides), le test
   ajoute À LA VOLÉE (route Playwright, aucun fichier modifié) des versions simplistes de ces seules fonctions (axes en ligne
   droite, isochrones à vitesse constante…), pour exercer l'interface avec des résultats. Une fonction déjà écrite par le
   lot A n'est jamais remplacée : après fusion, le test tourne sur le vrai moteur. Le scénario « mode dégradé » charge le
   moteur tel quel et vérifie que l'interface reste utilisable. */
"use strict";
const fs = require("fs"), path = require("path");
const H = require("./helpers.js");
const OUT = "/tmp/ennemi-ui"; fs.mkdirSync(OUT, {recursive:true});
const pw = require(process.env.PLAYWRIGHT_MODULE || "playwright"), PHONE = pw.devices["Pixel 7"];
const DEMO = path.join(H.ROOT, "terrain-demo.json");
const T_MAP = {timeout:60000};
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

/* ---------- moteur simulé (seulement pour les fonctions encore à l'état d'ébauche) ---------- */
const SIMULE = `
;(function(){
 const eb = (f, re) => re.test(String(f).replace(/\\s+/g, " ").trim()); window.__MOTEUR_SIMULE = [];
 const rempl = (nom, re, f) => { if (eb(ME[nom], re)) { ME[nom] = f; __MOTEUR_SIMULE.push(nom); } };
 const lerp = (a, b, t) => [a[0] + (b[0] - a[0])*t, a[1] + (b[1] - a[1])*t];
 const kmh = u => ({chenille:20, roue:30, logistique:25, fantassin:4}[u.classe] || 20);
 rempl("axes", /^\\(unite, opts\\) => \\[\\]$/, (u, o) => {
  if (!u.depart || !u.objectifs || !u.objectifs.length) return [];
  const A = u.depart, B = u.objectifs[u.objectifs.length - 1], dx = B[0] - A[0], dy = B[1] - A[1];
  const mk = (genre, nom, pl, dev) => { const m = lerp(A, B, 0.5), c = [A, [m[0] - dy*dev, m[1] + dx*dev], B]; const dn = [0]; for (let i = 1; i < c.length; i++) dn.push(dn[i-1] + distM(c[i-1], c[i])/1000);
   const tn = dn.map(d => d/kmh(u)*60), f = G.feats[0];
   return {genre, nom, plausibilite:pl, noeuds:[], coords:c, dn, tn, longueur_km:dn[dn.length-1], temps_min:tn[tn.length-1], ouvrages:f ? [f.id] : [], goulets:[], part_exposee:0.2 + dev, part_couvert:0.4}; };
  return [mk("rapide", "Axe le plus rapide", "forte", 0), mk("sur", "Axe le plus sûr", "moyenne", 0.15), mk("variante", "Variante", "faible", -0.2)];
 });
 rempl("horaires", /^\\(axe, unite, opts\\) => \\(\\{jalons:\\[\\], troncons:\\[\\]\\}\\)$/, (a, u, o) => {
  const h0 = o && o.heure_depart_min != null ? o.heure_depart_min : u.heure_depart_min || 0, f = G.feats[0];
  const jalons = a.coords.map((c, i) => ({nom:i === 0 ? "Départ" : i === a.coords.length - 1 ? "Objectif" : "Jalon " + i, id_ouvrage:i === 1 && f ? f.id : null, lonlat:c, distance_km:a.dn[i], t_min:a.tn[i], heure_min:h0 + a.tn[i], incertitude_min:5 + Math.round(a.tn[i]/10), expose:i === 1, goulet:false}));
  const troncons = jalons.slice(1).map((j, i) => ({de:jalons[i].nom, a:j.nom, longueur_km:j.distance_km - jalons[i].distance_km, duree_min:j.t_min - jalons[i].t_min, heure_entree_min:jalons[i].heure_min, heure_sortie_min:j.heure_min, ouvrages:j.id_ouvrage ? [j.id_ouvrage] : []}));
  return {jalons, troncons};
 });
 rempl("positionSurAxe", /^\\(axe, unite, t_min\\) => null$/, (a, u, t) => {
  const T = a.temps_min, f = Math.max(0, Math.min(1, t/T)), g = Math.max(0, f - 0.1), at = x => { const d = x*a.longueur_km; let i = 1; while (i < a.dn.length - 1 && a.dn[i] < d) i++; const s = (d - a.dn[i-1])/Math.max(1e-9, a.dn[i] - a.dn[i-1]); return lerp(a.coords[i-1], a.coords[i], Math.max(0, Math.min(1, s))); };
  return {tete:at(f), queue:at(g), d_tete_km:f*a.longueur_km, d_queue_km:g*a.longueur_km, trace:[at(g), at(f)]};
 });
 rempl("isochrones", /^\\(contacts, unites, t_min, opts\\) => \\(\\{a_faire:true/, (C, U, t, o) => {
  const N = G.n*G.n, arr = new Float32Array(N).fill(Infinity), at = new Uint8Array(N);
  for (const c of C) { const u = U.find(x => x.id === c.unite) || {classe:"chenille"}; for (let k = 0; k < N; k++) { const v = c.heure_min + distM(cellLL(k), c.lonlat)/1000/kmh(u)*60; if (v < arr[k]) arr[k] = v; } }
  for (let k = 0; k < N; k++) at[k] = arr[k] <= t ? 1 : 0;
  return {arrivee_min:arr, atteint:at, delais:(o && o.delais) || [5, 10, 20, 40], par_unite:{}};
 });
 rempl("presence", /^\\(unites, contacts, t_min, opts\\) => \\(\\{a_faire:true/, (U, C, t, o) => {
  const N = G.n*G.n, Q = new Float32Array(N); let tot = 0; const last = C.slice().sort((a, b) => b.heure_min - a.heure_min)[0];
  for (let k = 0; k < N; k++) { const d = distM(cellLL(k), last.lonlat)/1000, s = 0.5 + (t - last.heure_min)/30; Q[k] = Math.exp(-d*d/(2*s*s)); tot += Q[k]; }
  const z = [[0, 0], [0.006, 0.004], [-0.007, -0.003]].map((dv, i) => ({rang:i + 1, lonlat:[last.lonlat[0] + dv[0], last.lonlat[1] + dv[1]], rayon_m:500, niveau:["forte", "moyenne", "faible"][i], part_pct:[45, 20, 8][i], elements_attendus:[3, 2, 1][i], distance_contact_km:i*0.6, delai_min:i*4, pourquoi:["couvert", "axe d'approche"].slice(0, 2 - (i > 1))}));
  return {Q, total:tot, par_unite:{}, zones:z};
 });
 rempl("zonesRegroupement", /^\\(unite, opts\\) => \\[\\]$/, (u, o) => !u.objectifs || !u.objectifs.length ? [] :
  [0, 1].map(i => ({centre:[u.objectifs[0][0] - 0.02 - i*0.01, u.objectifs[0][1] + 0.005*i], mailles:[], surface_km2:0.6 - i*0.2, couvert:0.7, distance_objectif_km:2 + i, vue:false, duree_min:45, niveau:i ? "moyenne" : "forte"})));
 rempl("migrer", /^o => \\(\\{a_faire:true/, o => {   // version très simplifiée de la migration v1 (prépa) : test de l'interface seulement
  const cl = {meca:"chenille", moto:"roue", pied:"fantassin"}, S = (o.saisies && o.saisies.scen) || [];
  const doc = {format:"ennemi-gtia", version:3, nom:o.nom, date:o.date, terrain:{id:o.terrain.id, nom:o.terrain.nom, empreinte:ME.empreinteTerrain(o.terrain)},
   nos_positions:((o.saisies && o.saisies.amis) || []).map((a, i) => ({id:"a" + (i + 1), nom:"Position " + (i + 1), lonlat:a.ll})),
   planification:{scenarios:S.map((s, i) => ({id:"s" + (i + 1), nom:s.nom, mode_action:"attaque", heure_depart:s.h0, axe_choisi:{}, unites:[Object.assign(ME.uniteDepuisType(DOCTRINE.unite_par_defaut[cl[s.ennemi.type]], DOCTRINE), {id:"u" + (i + 1), nom:s.ennemi.nom, classe:cl[s.ennemi.type], elements:s.ennemi.nb, depart:s.depart, objectifs:s.objectifs})]}))},
   conduite:{heure:"06:00", unites:[], contacts:[]}};
  return {document:doc, terrain:o.terrain};
 });
})();`;
async function moteurSimule(ctx){ await ctx.route(/moteur-ennemi\.js/, async r => { const res = await r.fetch(); r.fulfill({response:res, body:(await res.text()) + SIMULE}); }); }

/* ---------- outillage ---------- */
const echecs = [], tests = []; const test = (nom, fn) => tests.push({nom, fn});
async function contexte(T, phone, opts){
 const c = await T.b.newContext(Object.assign(phone ? {...PHONE} : {viewport:{width:1500, height:900}}, {acceptDownloads:true}, opts || {}));
 await c.addInitScript(() => { try { localStorage.setItem("tuto-ennemi", "1"); } catch(e){}
  // aucun GPS : tout appel à la géolocalisation est compté
  window.__gps = 0; try { const g = navigator.geolocation; if (g) { g.getCurrentPosition = () => { window.__gps++; }; g.watchPosition = () => { window.__gps++; return 0; }; } } catch(e){} });
 await c.route(/geopf\.fr|tile\.openstreetmap\.org|arcgisonline|opentopomap/, r => r.fulfill({status:200, contentType:"image/png", body:PIXEL}));
 await c.route(/elevation-tiles-prod/, r => r.abort());
 return c; }
function page(ctx, T){ return ctx.newPage().then(p => { p.erreurs = []; p.on("pageerror", e => p.erreurs.push(e.message)); T.pages.push(p); return p; }); }
const prets = p => p.waitForFunction(() => typeof mapReady !== "undefined" && mapReady, null, T_MAP);
const terrainOuvert = p => p.waitForFunction(() => /Terrain «|Échec/.test(document.getElementById("status").textContent) && typeof G !== "undefined" && G && !CHARGE, null, T_MAP);
const px = (p, u, v) => p.evaluate(([u, v]) => { const b = G.b, q = map.project([b.w + (b.e - b.w)*u, b.n - (b.n - b.s)*v]); return [q.x, q.y]; }, [u, v]);
const touche = (p, phone, xy) => phone ? p.touchscreen.tap(...xy) : p.mouse.click(...xy);
const capture = (p, nom) => p.screenshot({path:path.join(OUT, nom + ".png")});
const outil = (p, phone, t) => phone ? p.tap(`#tools button[data-t=${t}]`) : p.click(`#tools button[data-t=${t}]`);
const calcule = p => p.waitForTimeout(400);
// aucune coordonnée décimale à l'écran (degrés à 4 décimales ou plus)
const DECIMAL = /-?\b\d{1,3}[.,]\d{4,}\b/;
const texteVisible = p => p.evaluate(() => document.body.innerText);
async function ouvrirDemo(p, phone){ if (phone) await p.evaluate(() => document.getElementById("demoBtn").click()); else await p.click("#demoBtn"); await terrainOuvert(p); await prets(p); await p.waitForTimeout(500); }

/* ---------- 1. ouverture, modes, aucun GPS, aucune coordonnée décimale ---------- */
for (const phone of [false, true]) test("ouverture, bascule de mode, aucun GPS (" + (phone ? "téléphone" : "PC") + ")", async T => {
 const ctx = await contexte(T, phone); await moteurSimule(ctx); const p = await page(ctx, T);
 await p.goto(T.base + "ennemi.html"); await prets(p);
 T.ok(/DOCTRINE FICTIVE/.test(await p.textContent("#panel h1")) && /FICTIF/.test(await p.textContent("#gear")), "doctrine fictive bien visible (titre et bouton)");
 await p.evaluate(() => { window.__etapes = []; new MutationObserver(() => { const t = document.getElementById("status").textContent; if (/%/.test(t)) __etapes.push(t); }).observe(document.getElementById("status"), {childList:true, characterData:true, subtree:true}); });
 await ouvrirDemo(p, phone);
 T.ok(await p.evaluate(() => __etapes.length >= 2), "chargement par étapes avec progression (" + await p.evaluate(() => __etapes.length) + " messages)");
 T.ok(await p.evaluate(() => /empreinte e[0-9a-f]{8}/.test(document.getElementById("status").textContent)), "empreinte du terrain affichée");
 T.ok(await p.evaluate(() => G.feats.length === 8 && map.getLayoutProperty("roads", "visibility") === "visible"), "terrain de démonstration et routes visibles");
 T.ok(await p.evaluate(() => /Aucune coupure/.test(document.getElementById("lstCoupures").textContent)), "liste des coupures du terrain (aucune sur la démonstration)");
 if (phone) {
  T.ok(JSON.stringify(await p.evaluate(() => [...document.querySelectorAll("#navBar button")].map(b => b.dataset.k))) === JSON.stringify(["terr", "plan", "cond", "res", "aff"]), "téléphone : 5 onglets en bas");
  await p.tap("#navBar button[data-k=cond]"); await p.waitForTimeout(300);
 } else await p.click("#modeSeg [data-m=conduite]");
 T.ok(await p.evaluate(() => document.body.dataset.mode === "conduite" && /mode=conduite/.test(location.search)), "bascule en Conduite (adresse mise à jour)");
 T.ok(JSON.stringify(await p.evaluate(() => [...document.querySelectorAll("#tools button")].map(b => b.dataset.t))) === '["info","con","ami"]', "outils de la conduite : Infos, Contact, Nos positions");
 if (phone) { await p.tap("#navBar button[data-k=plan]"); await p.waitForTimeout(300); } else await p.click("#modeSeg [data-m=planification]");
 T.ok(JSON.stringify(await p.evaluate(() => [...document.querySelectorAll("#tools button")].map(b => b.dataset.t))) === '["info","dep","obj","ami"]', "outils de la planification : Infos, Départ, Objectif, Nos positions");
 // Infos au toucher : MGRS, pas de décimales
 if (phone) await p.evaluate(() => closeSheet());
 await touche(p, phone, await px(p, 0.5, 0.5)); await p.waitForTimeout(400);
 const pop = await p.evaluate(() => (document.querySelector(".maplibregl-popup-content") || {}).innerText || "");
 T.ok(/\d{2}[A-Z] [A-Z]{2} \d{5} \d{5}/.test(pop) && !DECIMAL.test(pop), "fiche Infos en MGRS seul (" + pop.split("\n")[0] + ")");
 // aucun GPS
 T.ok(await p.evaluate(() => !document.querySelector(".maplibregl-ctrl-geolocate") && ![...document.querySelectorAll("button")].some(b => /GPS|localis/i.test(b.textContent + b.title)) && window.__gps === 0), "aucun bouton ni appel GPS");
 T.ok(!DECIMAL.test(await texteVisible(p)), "aucune coordonnée décimale à l'écran");
 if (phone) T.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "pas de défilement horizontal");
 await capture(p, "ouverture-" + (phone ? "telephone" : "pc"));
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | ")); await ctx.close(); });

/* ---------- 2. planification : plusieurs unités, axes, horaires, regroupements, horloge, annulation, glisser, export ---------- */
test("planification : unités, axes, horaires, annulation, export (PC)", async T => {
 const ctx = await contexte(T, false); await moteurSimule(ctx); const p = await page(ctx, T);
 await p.goto(T.base + "ennemi.html?mode=planification"); await prets(p); await ouvrirDemo(p, false);
 T.ok(await p.evaluate(() => typeof __MOTEUR_SIMULE !== "undefined"), "moteur : " + await p.evaluate(() => (window.__MOTEUR_SIMULE || []).length ? "simulé pour " + __MOTEUR_SIMULE.join(", ") : "réel"));
 await outil(p, false, "dep"); await p.mouse.click(...await px(p, 0.12, 0.3)); await p.waitForTimeout(200);
 T.ok(await p.evaluate(() => UI.tool === "obj"), "après le départ, l'outil passe à « Objectif »");
 await p.mouse.click(...await px(p, 0.85, 0.7)); await calcule(p);
 // deuxième unité (escadron de chars)
 await p.selectOption("#uAddType", "esc-chars"); await p.click("#uAdd");
 await p.mouse.click(...await px(p, 0.15, 0.5)); await p.mouse.click(...await px(p, 0.8, 0.35)); await p.waitForTimeout(200);
 await outil(p, false, "ami"); await p.mouse.click(...await px(p, 0.6, 0.2)); await calcule(p);
 const st = await p.evaluate(() => ({n:curSc().unites.length, ok:curSc().unites.every(u => u.depart && u.objectifs.length === 1), amis:ET.nos_positions.length, cl:curSc().unites.map(u => u.classe)}));
 T.ok(st.n === 2 && st.ok && st.amis === 1, "2 unités dans le scénario, départs et objectifs posés, 1 position amie");
 T.ok(st.cl.every(c => ["chenille", "roue", "logistique", "fantassin"].includes(c)), "classes de la doctrine (" + st.cl.join(", ") + ")");
 await p.click(".tabs button[data-tab=res]"); await p.waitForTimeout(300);
 const nAxes = await p.locator("#resPlan [data-axe]").count();
 T.ok(nAxes >= 2, "axes en cartes cliquables (" + nAxes + ")");
 T.ok(await p.locator("#resPlan .lvl").count() >= 2, "plausibilité affichée");
 T.ok(await p.locator("#resPlan tr[data-j]").count() >= 2, "horaires par jalon");
 T.ok(/Par tronçon/.test(await p.textContent("#resPlan")), "horaires par tronçon");
 T.ok(await p.locator("#resPlan [data-reg]").count() >= 1, "zones de regroupement (mode attaque)");
 // choisir la variante de la 1re unité
 const carte = p.locator("#resPlan [data-axe]").nth(2); const g = await carte.getAttribute("data-axe"); await carte.click(); await calcule(p);
 T.ok(await p.evaluate(g => { const [u, ge] = g.split("|"); return curSc().axe_choisi[u] === ge && RP.unites[u].choisi.genre === ge; }, g), "axe choisi par clic (" + g.split("|")[1] + ")");
 // horloge
 T.ok(await p.isVisible("#clock"), "curseur d'heure affiché");
 await p.evaluate(() => { const r = document.getElementById("clockR"); r.value = Math.round((+r.min + +r.max)/2); r.dispatchEvent(new Event("input")); });
 T.ok(/km du départ|en route|arrivée/.test(await p.textContent("#clockInfo")), "le curseur d'heure place les unités (" + (await p.textContent("#clockInfo")).slice(0, 60) + ")");
 // glisser le départ de l'unité 2
 const avant = await p.evaluate(() => curSc().unites[1].depart.slice());
 const [x0, y0] = await p.evaluate(() => { const q = map.project(curSc().unites[1].depart); return [q.x, q.y]; });
 await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move(x0 + 30, y0 - 20, {steps:6}); await p.mouse.up(); await calcule(p);
 const apres = await p.evaluate(() => curSc().unites[1].depart.slice());
 T.ok(Math.abs(apres[0] - avant[0]) > 1e-4, "un départ se déplace en le faisant glisser");
 await p.keyboard.press("Control+z"); await calcule(p);
 T.ok(await p.evaluate(a => { const d = curSc().unites[1].depart; return Math.abs(d[0] - a[0]) < 1e-9 && Math.abs(d[1] - a[1]) < 1e-9; }, avant), "Ctrl+Z annule le déplacement");
 await p.click("#undoBtn"); await calcule(p); T.ok(await p.evaluate(() => curSc().axe_choisi && Object.keys(curSc().axe_choisi).length === 0), "« Annuler » annule le choix d'axe");
 await p.click("#redoBtn"); await calcule(p); T.ok(await p.evaluate(() => Object.keys(curSc().axe_choisi).length === 1), "« Rétablir »");
 // clic sur un symbole : fiche, pas de nouveau point
 const [xo, yo] = await p.evaluate(() => { const q = map.project(curSc().unites[0].objectifs[0]); return [q.x, q.y]; });
 await outil(p, false, "obj"); await p.mouse.click(xo, yo); await p.waitForTimeout(400);
 T.ok(await p.evaluate(() => curSc().unites[0].objectifs.length === 1 && /Objectif 1/.test((document.querySelector(".maplibregl-popup-content") || {}).textContent || "")), "toucher un symbole ouvre sa fiche (pas de nouvel objectif)");
 await p.keyboard.press("Escape");
 // scénarios : copier, renommer, supprimer
 await p.click(".tabs button[data-tab=sai]"); await p.click("#scDup"); await p.waitForTimeout(300);
 T.ok(await p.evaluate(() => ET.planification.scenarios.length === 2 && curSc().unites.length === 2 && curSc().unites[0].id !== ET.planification.scenarios[0].unites[0].id), "scénario copié avec ses unités");
 await p.fill("#scNom", "Hypothèse nord"); await p.press("#scNom", "Tab"); await p.selectOption("#scMode", "reco"); await calcule(p);
 T.ok(await p.evaluate(() => curSc().nom === "Hypothèse nord" && curSc().mode_action === "reco"), "nom et mode d'action du scénario");
 p.once("dialog", d => d.accept()); await p.click("#scDel"); await p.waitForTimeout(300);
 T.ok(await p.evaluate(() => ET.planification.scenarios.length === 1), "scénario supprimé");
 // copie des horaires
 await p.click(".tabs button[data-tab=res]"); await p.click("#copyH"); await p.waitForTimeout(300);
 const txt = await p.evaluate(() => window.__dernierTexte || "");
 T.ok(/\d{2}:\d{2}/.test(txt) && /\d{2}[A-Z] [A-Z]{2} \d{5} \d{5}/.test(txt) && !DECIMAL_TXT(txt), "horaires copiés, MGRS, sans coordonnée décimale");
 T.ok(!DECIMAL.test(await texteVisible(p)), "aucune coordonnée décimale à l'écran");
 await capture(p, "planification-pc");
 // export .json v3 et KML
 const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#exp")]); const f = path.join(OUT, "ennemi-export.json"); await dl.saveAs(f);
 const j = JSON.parse(fs.readFileSync(f, "utf8"));
 T.ok(j.format === "ennemi-gtia" && j.version === 3 && j.terrain && /^e[0-9a-f]{8}$/.test(j.terrain.empreinte) && j.terrain.id === "f1r08s1r", "export ennemi-gtia v3 avec référence au terrain (id + empreinte)");
 T.ok(!j.faits && !(j.terrain && j.terrain.faits), "le terrain n'est pas inclus");
 T.ok(j.planification.scenarios[0].unites.length === 2 && j.nos_positions.length === 1, "export : 2 unités, nos positions");
 const [dk] = await Promise.all([p.waitForEvent("download"), p.click("#kmlBtn")]); const fk = path.join(OUT, "ennemi-export.kml"); await dk.saveAs(fk);
 T.ok(/<kml/.test(fs.readFileSync(fk, "utf8")), "export KML");
 // rechargement : travail retrouvé
 await p.waitForTimeout(900); await p.reload(); await terrainOuvert(p); await p.waitForTimeout(500);
 T.ok(await p.evaluate(() => curSc().unites.length === 2 && ET.nos_positions.length === 1 && /Travail repris/.test(document.getElementById("status").textContent)), "travail retrouvé après rechargement (IndexedDB)");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | ")); await ctx.close(); });
const DECIMAL_TXT = t => DECIMAL.test(t);

/* ---------- 3. conduite : contacts horodatés, connu / inconnu, mouvement / arrêt, T+x, zones, copie ---------- */
test("conduite : contacts, ennemi connu et inconnu, zones à survoler (PC)", async T => {
 const ctx = await contexte(T, false); await moteurSimule(ctx); const p = await page(ctx, T);
 await p.goto(T.base + "ennemi.html?mode=planification"); await prets(p); await ouvrirDemo(p, false);
 await outil(p, false, "dep"); await p.mouse.click(...await px(p, 0.1, 0.4)); await p.mouse.click(...await px(p, 0.9, 0.6)); await calcule(p);
 await p.click("#modeSeg [data-m=conduite]"); await p.waitForTimeout(300);
 T.ok(await p.isVisible("#clockNow"), "bouton « Maintenant »");
 await p.fill("#cHeure", "14:00"); await p.press("#cHeure", "Tab"); await p.waitForTimeout(200);
 await outil(p, false, "con"); await p.mouse.click(...await px(p, 0.45, 0.45)); await p.waitForTimeout(300);
 await p.selectOption(".pf [data-u]", "+roue"); await p.fill(".pf [data-h]", "13:40"); await p.fill(".pf [data-v]", "2"); await p.fill(".pf [data-n]", "2 VBR vers l'est"); await p.click(".pf [data-ok]"); await calcule(p);
 await p.mouse.click(...await px(p, 0.55, 0.5)); await p.waitForTimeout(300); await p.fill(".pf [data-h]", "13:55"); await p.fill(".pf [data-v]", "3"); await p.click(".pf [data-ok]"); await calcule(p);
 const c = await p.evaluate(() => ({u:ET.conduite.unites.length, cl:ET.conduite.unites[0].classe, n:ET.conduite.contacts.length, meme:new Set(ET.conduite.contacts.map(c => c.unite)).size, h:ET.conduite.contacts.map(c => c.heure)}));
 T.ok(c.u === 1 && c.cl === "roue" && c.n === 2 && c.meme === 1, "deux contacts horodatés de la même unité inconnue (roue) " + c.h.join(", "));
 await p.click(".tabs button[data-tab=res]"); await p.waitForTimeout(300);
 const nz = await p.locator("#resCond [data-z]").count(); T.ok(nz >= 1, "zones à survoler en cartes (" + nz + ")");
 T.ok(await p.evaluate(() => !!RC.iso && !!RC.iso.arrivee_min), "isochrones calculées");
 await p.evaluate(() => { const r = document.getElementById("clockR"); r.value = 30; r.dispatchEvent(new Event("input")); }); await p.waitForTimeout(500);
 T.ok(await p.evaluate(() => RC.t === mins("14:00") + 30 && /T\+30/.test(document.getElementById("clockT").textContent)), "curseur T+x (T+30 min)");
 await p.click(".tabs button[data-tab=sai]"); await p.click("#mArret"); await calcule(p);
 T.ok(await p.evaluate(() => ET.conduite.unites[0].en_mouvement === false), "à l'arrêt");
 // ennemi connu (unité du scénario de planification) et scénario repère
 await p.click("#cAddCon"); await calcule(p);
 T.ok(await p.evaluate(() => ET.conduite.unites.length === 2 && !!ET.conduite.unites[1].scenario_ref && UI.repere === ET.planification.scenarios[0].id), "ennemi connu ajouté (repère : son scénario)");
 await p.mouse.click(...await px(p, 0.3, 0.42)); await p.waitForTimeout(300); await p.click(".pf [data-ok]"); await calcule(p);
 T.ok(await p.evaluate(() => ET.conduite.contacts.filter(c => c.unite === ET.conduite.unites[1].id).length === 1), "contact rattaché à l'ennemi connu");
 await p.click(".tabs button[data-tab=res]"); await p.click("#copyZ"); await p.waitForTimeout(300);
 const t = await p.evaluate(() => window.__dernierTexte || "");
 T.ok(/^Zones à survoler/.test(t) && /\d{2}[A-Z] [A-Z]{2} \d{5} \d{5}/.test(t) && /rayon \d+ m/.test(t) && !DECIMAL.test(t), "liste ordonnée copiable (MGRS, rayon)");
 T.ok(!DECIMAL.test(await texteVisible(p)), "aucune coordonnée décimale à l'écran");
 // annulation d'un contact
 const n0 = await p.evaluate(() => ET.conduite.contacts.length); await p.keyboard.press("Control+z"); await calcule(p);
 T.ok(await p.evaluate(() => ET.conduite.contacts.length) === n0 - 1, "Ctrl+Z annule la pose du contact");
 await capture(p, "conduite-pc");
 const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#exp")]); const f = path.join(OUT, "ennemi-conduite-export.json"); await dl.saveAs(f);
 const j = JSON.parse(fs.readFileSync(f, "utf8"));
 T.ok(j.conduite.contacts.length === n0 - 1 && j.conduite.unites.length === 2 && j.conduite.heure === "14:00", "export : unités et contacts de conduite");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | ")); await ctx.close(); });

/* ---------- 4. doctrine : tiroir, surcharge, refus, retour à la référence ---------- */
test("doctrine : formulaire, JSON, surcharge enregistrée, retour à la référence (PC)", async T => {
 const ctx = await contexte(T, false); await moteurSimule(ctx); const p = await page(ctx, T);
 await p.goto(T.base + "ennemi.html"); await prets(p); await ouvrirDemo(p, false);
 await p.click("#gear"); T.ok(await p.isVisible("#drawer"), "tiroir de la doctrine ouvert");
 T.ok(/FICTIF/.test(await p.textContent("#drawer header")) && /FICTIF/.test(await p.textContent("#dSource")), "mention FICTIF dans le tiroir");
 await p.fill('[data-d="vitesses_pct.chenille.attaque"]', "45"); await p.press('[data-d="vitesses_pct.chenille.attaque"]', "Tab"); await p.waitForTimeout(300);
 T.ok(await p.evaluate(() => D.vitesses_pct.chenille.attaque === 45 && JSON.parse(localStorage.getItem("ennemi-gtia-doctrine-surcharge")).vitesses_pct.chenille.attaque === 45), "vitesse modifiée, surcharge enregistrée dans le navigateur");
 T.ok(await p.evaluate(() => JSON.stringify(SURCH) === JSON.stringify({vitesses_pct:{chenille:{attaque:45}}})), "surcharge minimale (seule la valeur changée)");
 await p.fill('[data-d="vitesses_pct.roue.marche"]', "150"); await p.press('[data-d="vitesses_pct.roue.marche"]', "Tab"); await p.waitForTimeout(300);
 T.ok(await p.evaluate(() => D.vitesses_pct.roue.marche === 85 && /refusée/.test(document.getElementById("status").textContent)), "valeur invalide refusée (150 %)");
 await p.click("#dAvance summary"); await p.evaluate(() => { const d = JSON.parse(document.getElementById("dJson").value); d.seuils.forte_pct = 40; document.getElementById("dJson").value = JSON.stringify(d); });
 await p.click("#dApply"); await p.waitForTimeout(300); T.ok(await p.evaluate(() => D.seuils.forte_pct === 40), "JSON avancé appliqué");
 await capture(p, "doctrine-pc");
 await p.reload(); await terrainOuvert(p); T.ok(await p.evaluate(() => D.vitesses_pct.chenille.attaque === 45 && D.seuils.forte_pct === 40), "surcharge reprise au rechargement");
 await p.click("#gear"); await p.click("#dReset"); await p.waitForTimeout(300);
 T.ok(await p.evaluate(() => SURCH === null && D.vitesses_pct.chenille.attaque === DOCTRINE.vitesses_pct.chenille.attaque && !localStorage.getItem("ennemi-gtia-doctrine-surcharge")), "retour à la doctrine de référence");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | ")); await ctx.close(); });

/* ---------- 5. import : ancien fichier v1 (prépa mission), fichier v3, autre terrain, terrain modifié ---------- */
function fichierPrepaV1(){
 const terr = JSON.parse(fs.readFileSync(DEMO, "utf8")), b = terr.faits.bbox, P = (u, v) => [b.w + (b.e - b.w)*u, b.n - (b.n - b.s)*v];
 return {format:"ennemi-prepa-gtia", version:1, nom:terr.nom, date:"18/10/2026 10:00", note:"fichier v1 fabriqué par le test",
  doctrine:{modeles:[], types:{meca:{vitesse_tactique_pct:50}, moto:{vitesse_tactique_pct:60}, pied:{vitesse_tactique_pct:80}}},
  saisies:{scen:[{id:1, nom:"Scénario ancien", ennemi:{nom:"Compagnie mécanisée", type:"meca", nb:13, front_km:1.5, prof_km:1, dispersion_min:15}, depart:P(0.1, 0.5), objectifs:[P(0.9, 0.5)], h0:"05:30", axe:null, t:null},
                {id:2, nom:"Scénario à pied", ennemi:{nom:"Compagnie à pied", type:"pied", nb:9, front_km:1, prof_km:0.8, dispersion_min:15}, depart:P(0.2, 0.2), objectifs:[P(0.7, 0.8)], h0:"07:00", axe:null, t:null}],
           cur:1, amis:[{ll:P(0.6, 0.3)}]},
  scenarios:[], terrain:terr};
}
test("import : ancien fichier v1, fichier v3, autre terrain, terrain modifié (PC)", async T => {
 const v1 = path.join(OUT, "prepa-v1.json"); fs.writeFileSync(v1, JSON.stringify(fichierPrepaV1()));
 const ctx = await contexte(T, false); await moteurSimule(ctx); const p = await page(ctx, T);
 await p.goto(T.base + "ennemi.html"); await prets(p); await p.waitForTimeout(500);
 await p.setInputFiles("#imp", v1); await terrainOuvert(p); await p.waitForTimeout(600);
 const r = await p.evaluate(() => ({n:ET.planification.scenarios.length, cl:ET.planification.scenarios.map(s => s.unites[0].classe), h:ET.planification.scenarios[0].heure_depart, amis:ET.nos_positions.length, g:G && G.id, st:document.getElementById("status").textContent}));
 T.ok(r.g === "f1r08s1r", "le terrain inclus dans l'ancien fichier est ouvert");
 T.ok(r.n === 2 && r.cl[0] === "chenille" && r.cl[1] === "fantassin" && r.h === "05:30" && r.amis === 1, "ancien fichier converti : 2 scénarios, méca → chenillé, pied → fantassin, heure, nos positions (" + r.cl.join(", ") + ")");
 await p.click(".tabs button[data-tab=res]"); await p.waitForTimeout(500);
 T.ok(await p.locator("#resPlan [data-axe]").count() >= 1, "axes recalculés après l'import");
 // export v3 puis réimport dans un navigateur vierge (terrain absent, puis présent)
 const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#exp")]); const f = path.join(OUT, "reimport.json"); await dl.saveAs(f);
 const ctx2 = await contexte(T, false); await moteurSimule(ctx2); const q = await page(ctx2, T);
 await q.goto(T.base + "ennemi.html"); await prets(q); await q.waitForTimeout(500);
 await q.setInputFiles("#imp", f); await q.waitForTimeout(800);
 T.ok(/absent de ce navigateur/.test(await q.textContent("#status")), "terrain référencé absent : message clair");
 await ouvrirDemo(q, false); await q.setInputFiles("#imp", f); await q.waitForTimeout(800);
 T.ok(await q.evaluate(() => ET.planification.scenarios.length === 2 && !document.getElementById("refWarn").textContent), "fichier v3 rouvert sur le bon terrain, sans avertissement");
 // autre terrain (identifiant différent) et terrain modifié (même identifiant, empreinte différente)
 const j = JSON.parse(fs.readFileSync(f, "utf8"));
 const autre = path.join(OUT, "autre-terrain.json"); fs.writeFileSync(autre, JSON.stringify(Object.assign({}, j, {terrain:Object.assign({}, j.terrain, {id:"zz-autre", nom:"Autre zone"})})));
 q.once("dialog", d => d.dismiss()); await q.setInputFiles("#imp", autre); await q.waitForTimeout(800);
 T.ok(/AUTRE terrain/.test(await q.textContent("#refWarn")), "avertissement : fichier fait sur un autre terrain");
 const modif = path.join(OUT, "terrain-modifie.json"); fs.writeFileSync(modif, JSON.stringify(Object.assign({}, j, {terrain:Object.assign({}, j.terrain, {empreinte:"e00000000"})})));
 await q.setInputFiles("#imp", modif); await q.waitForTimeout(800);
 T.ok(/a changé depuis l'enregistrement/.test(await q.textContent("#refWarn")), "avertissement : terrain modifié depuis l'enregistrement (empreinte)");
 await capture(q, "import-avertissement-pc");
 T.ok(p.erreurs.length + q.erreurs.length === 0, "aucune erreur de script " + p.erreurs.concat(q.erreurs).join(" | ")); await ctx2.close(); await ctx.close(); });

/* ---------- 6. mode dégradé : moteur ennemi tel quel (fonctions encore vides) ---------- */
test("mode dégradé : moteur et rendu tels quels, interface utilisable (PC)", async T => {
 const ctx = await contexte(T, false), p = await page(ctx, T);
 await p.goto(T.base + "ennemi.html"); await prets(p); await ouvrirDemo(p, false);
 const eb = await p.evaluate(() => ({axes:ME.axes(curU() ? Object.assign({}, curU(), {depart:cellLL(10), objectifs:[cellLL(5000)]}) : {}, {}).length === 0, presence:CE.aFaire(ME.presence([], [], 0, {})), migrer:CE.aFaire(ME.migrer({}))}));
 await outil(p, false, "dep"); await p.mouse.click(...await px(p, 0.15, 0.3)); await p.mouse.click(...await px(p, 0.85, 0.6)); await calcule(p);
 await p.click(".tabs button[data-tab=res]"); await p.waitForTimeout(300);
 if (eb.axes) T.ok(/Aucun axe calculé/.test(await p.textContent("#resPlan")), "planification : message clair sans axes");
 else T.ok(await p.locator("#resPlan [data-axe]").count() >= 1, "planification : axes du moteur réel");
 T.ok(await p.evaluate(() => curSc().unites[0].depart && curSc().unites[0].objectifs.length === 1), "saisies conservées");
 await p.click("#modeSeg [data-m=conduite]"); await outil(p, false, "con"); await p.mouse.click(...await px(p, 0.5, 0.5)); await p.waitForTimeout(300); await p.click(".pf [data-ok]"); await calcule(p);
 if (eb.presence) T.ok(/pas encore disponibles/.test(await p.textContent("#resCond")), "conduite : message clair sans présence calculée");
 else T.ok(await p.locator("#resCond [data-z]").count() >= 0, "conduite : moteur réel");
 const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#exp")]); const f = path.join(OUT, "degrade.json"); await dl.saveAs(f);
 const j = JSON.parse(fs.readFileSync(f, "utf8")); T.ok(j.format === "ennemi-gtia" && j.version === 3 && j.conduite.contacts.length === 1, "export v3 (repli de l'interface si le moteur n'exporte pas encore)");
 const v1 = path.join(OUT, "prepa-v1.json"); fs.writeFileSync(v1, JSON.stringify(fichierPrepaV1()));
 await p.setInputFiles("#imp", v1); await p.waitForTimeout(1500);
 if (eb.migrer) T.ok(/pas encore disponible/.test(await p.textContent("#status")), "ancien fichier v1 : message clair tant que la migration n'est pas écrite");
 else T.ok(await p.evaluate(() => ET.planification.scenarios.length === 2), "ancien fichier v1 migré par le moteur réel");
 await capture(p, "degrade-pc");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | ")); await ctx.close(); });

/* ---------- 7. téléphone : pose d'unités et de contacts au toucher ---------- */
test("téléphone : départ, objectif, contact au toucher, feuille courte", async T => {
 const ctx = await contexte(T, true); await moteurSimule(ctx); const p = await page(ctx, T);
 await p.goto(T.base + "ennemi.html"); await prets(p); await ouvrirDemo(p, true);
 T.ok(!(await p.evaluate(() => document.body.classList.contains("sheet"))), "la feuille se ferme une fois le terrain ouvert");
 await p.tap("#tools button[data-t=dep]"); await p.touchscreen.tap(...await px(p, 0.15, 0.35)); await p.waitForTimeout(200); await p.touchscreen.tap(...await px(p, 0.85, 0.65)); await calcule(p);
 T.ok(await p.evaluate(() => !!curU().depart && curU().objectifs.length === 1), "départ et objectif posés au toucher");
 await p.tap("#navBar button[data-k=res]"); await p.waitForTimeout(400);
 T.ok(await p.evaluate(() => document.getElementById("panel").dataset.pane === "res" && document.getElementById("tab-res").classList.contains("on")), "onglet Résultats en feuille courte");
 await capture(p, "telephone-resultats");
 await p.tap("#navBar button[data-k=cond]"); await p.waitForTimeout(300); await p.tap("#sheetClose"); await p.waitForTimeout(200);
 await p.tap("#tools button[data-t=con]"); await p.touchscreen.tap(...await px(p, 0.5, 0.45)); await p.waitForTimeout(400);
 await p.tap(".pf [data-ok]"); await calcule(p);
 T.ok(await p.evaluate(() => ET.conduite.contacts.length === 1 && ET.conduite.unites.length === 1), "contact posé au toucher");
 T.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "pas de défilement horizontal");
 T.ok(!DECIMAL.test(await texteVisible(p)), "aucune coordonnée décimale à l'écran");
 await capture(p, "telephone-conduite");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | ")); await ctx.close(); });

/* ---------- 8. redirections et accueil ---------- */
test("redirections des anciennes pages, accueil à un seul lien Ennemi", async T => {
 const ctx = await contexte(T, false), p = await page(ctx, T);
 await p.goto(T.base + "ennemi-prepa.html?zone=abc#vue"); await p.waitForURL(/ennemi\.html/); await prets(p);
 let u = new URL(p.url()); T.ok(u.pathname.endsWith("/ennemi.html") && u.searchParams.get("mode") === "planification" && u.searchParams.get("zone") === "abc" && u.hash === "#vue", "ennemi-prepa.html → ennemi.html?mode=planification (zone et ancre gardées) : " + u.search + u.hash);
 T.ok(await p.evaluate(() => document.body.dataset.mode === "planification"), "mode Planification");
 await p.goto(T.base + "ennemi-conduite.html?zone=xyz"); await p.waitForURL(/ennemi\.html/); await prets(p);
 u = new URL(p.url()); T.ok(u.searchParams.get("mode") === "conduite" && u.searchParams.get("zone") === "xyz", "ennemi-conduite.html → ennemi.html?mode=conduite : " + u.search);
 T.ok(await p.evaluate(() => document.body.dataset.mode === "conduite"), "mode Conduite");
 await p.goto(T.base + "app.html");
 const liens = await p.evaluate(() => [...document.querySelectorAll("a.tool")].map(a => a.getAttribute("href")));
 T.ok(liens.filter(h => /ennemi/.test(h)).length === 1 && liens.includes("ennemi.html"), "accueil : un seul lien Ennemi (" + liens.join(", ") + ")");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | ")); await ctx.close(); });

/* ---------- lancement ---------- */
(async () => {
 const filtre = process.argv[2], {server, base} = await H.serveur(), b = await H.navigateur(); let n = 0;
 for (const t of tests) { if (filtre && !t.nom.toLowerCase().includes(filtre.toLowerCase())) continue; n++;
  const T = {b, base, pages:[], ok:(c, m) => { if (!c) { echecs.push(t.nom + " : " + m); console.log("   ✗ " + m); } else if (process.env.VERBEUX) console.log("   ✓ " + m); }};
  const t0 = Date.now(); process.stdout.write("• " + t.nom + "\n");
  try { await t.fn(T); } catch(e) { echecs.push(t.nom + " : EXCEPTION " + e.message.split("\n")[0]); console.log("   ✗ exception : " + e.message.split("\n")[0]); }
  for (const p of T.pages) { try { const e = await p.evaluate(() => { const b = document.getElementById("cgErr"); return b && b.textContent; }); if (e) T.ok(false, "bannière d'erreur visible : " + e); } catch(e) {} }
  console.log("   (" + Math.round((Date.now() - t0)/1000) + " s)"); }
 await b.close(); server.close();
 console.log("\n" + (echecs.length ? "ÉCHECS (" + echecs.length + ") :\n - " + echecs.join("\n - ") : "Tous les tests passent (" + n + " scénarios)."));
 process.exit(echecs.length ? 1 : 0);
})();
