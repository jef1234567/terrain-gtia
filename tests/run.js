/* Tests de bout en bout dans un vrai navigateur (Chromium via Playwright).
   Lancer :  node tests/run.js [filtre]     (voir tests/README.md)
   Chaque test ouvre les pages comme un utilisateur (clics, appuis tactiles) et vérifie le résultat. */
const fs = require("fs"), path = require("path");
const H = require("./helpers.js");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, {recursive:true});
const pw = require(process.env.PLAYWRIGHT_MODULE || "playwright"), PHONE = pw.devices["Pixel 7"];
const DEMO = path.join(H.ROOT, "terrain-demo.json");
const T_MAP = {timeout:60000};
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");   // PNG 1×1

const echecs = [], tests = [];
const test = (nom, fn) => tests.push({nom, fn});
async function contexte(T, phone, opts){ const c = await T.b.newContext(Object.assign(phone ? {...PHONE} : {viewport:{width:1500, height:900}}, opts || {}));
 await c.addInitScript(() => { try { ["prepa","conduite","ennemi","implantation","radars"].forEach(k => localStorage.setItem("tuto-" + k, "1")); } catch(e){} });
 await c.route(/geopf\.fr|tile\.openstreetmap\.org/, r => r.fulfill({status:200, contentType:"image/png", body:PIXEL})); return c; }   // fond de carte neutre : plus rapide et stable
function page(ctx, T){ return ctx.newPage().then(p => { p.erreurs = []; p.on("pageerror", e => p.erreurs.push(e.message)); T.pages.push(p); return p; }); }
const prets = p => p.waitForFunction(() => typeof mapReady !== "undefined" && mapReady, null, T_MAP);
const terrainOuvert = p => p.waitForFunction(() => /Terrain «|Zone «.*chargée|Échec/.test(document.getElementById("status").textContent) && typeof G !== "undefined" && G, null, T_MAP);
const px = (p, u, v) => p.evaluate(([u, v]) => { const d = typeof RD !== "undefined" && typeof MODE !== "undefined" && MODE === "radar" ? RD : G, b = d.b, q = map.project([b.w + (b.e - b.w)*u, b.n - (b.n - b.s)*v]); return [q.x, q.y]; }, [u, v]);
const tap = (p, phone, sel) => phone ? p.tap(sel) : p.click(sel);
// outil Ennemi (ennemi.html) : fin des calculs du moteur (calcul par étapes)
const calme = async p => { await p.waitForTimeout(60); await p.waitForFunction(() => typeof calmeEnnemi === "function" && calmeEnnemi(), null, {timeout:120000}); await p.waitForTimeout(150); };
const touche = (p, phone, xy) => phone ? p.touchscreen.tap(...xy) : p.mouse.click(...xy);

/* ---------- 1. toutes les pages s'ouvrent, sans erreur, sans défilement horizontal ---------- */
for (const phone of [false, true]) test("pages : ouverture sans erreur (" + (phone ? "téléphone" : "PC") + ")", async T => {
 const ctx = await contexte(T, phone);
 for (const f of ["app", "index", "ennemi", "ennemi-prepa", "ennemi-conduite", "implantation", "radars"]) {
  const p = await page(ctx, T); await p.goto(T.base + f + ".html"); await p.waitForTimeout(1800);
  T.ok(p.erreurs.length === 0, f + " : aucune erreur de script " + p.erreurs.join(" | "));
  if (phone) T.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), f + " : pas de défilement horizontal"); }
 await ctx.close(); });

/* ---------- 2. planification (ex-« prépa mission », ennemi.html) : saisie, axes, horaires, scénarios, annulation, export / import ---------- */
test("ennemi, planification : parcours complet (PC)", async T => {
 const ctx = await contexte(T, false), p = await page(ctx, T);
 await p.goto(T.base + "ennemi.html?mode=planification"); await prets(p); await p.click("#demoBtn"); await terrainOuvert(p); await calme(p);
 await p.click('#tools button[data-t=dep]'); await p.mouse.click(...await px(p, 0.1, 0.3));
 await p.click('#tools button[data-t=obj]'); await p.mouse.click(...await px(p, 0.9, 0.7));
 await p.click('#tools button[data-t=ami]'); await p.mouse.click(...await px(p, 0.7, 0.2)); await calme(p);
 const axes = await p.evaluate(() => { const r = RP.unites[curU().id]; return r.axes.map(a => [a.genre, a.plausibilite, a.temps_min, a === r.choisi ? r.hor.jalons.length : null]); });
 T.ok(axes.length >= 2, "au moins 2 axes (" + JSON.stringify(axes) + ")"); T.ok(axes.some(a => a[1] === "forte"), "un axe de plausibilité forte");
 T.ok(axes.every(a => a[2] > 0) && axes.some(a => a[3] >= 3), "horaires et jalons présents");
 await p.evaluate(() => { const r = document.getElementById("clockR"); r.value = (+r.min + +r.max)/2 | 0; r.dispatchEvent(new Event("input")); });
 T.ok(/km du départ/.test(await p.textContent("#clockInfo")), "le curseur d'heure place la colonne");
 await p.click(".tabs button[data-tab=sai]"); await p.click("#scDup"); await calme(p); await p.selectOption("#uClasse", "fantassin"); await calme(p);
 T.ok(await p.evaluate(() => ET.planification.scenarios.length === 2 && curU().classe === "fantassin" && RP.unites[curU().id].ue.classe === "fantassin"), "scénario copié puis modifié (classe fantassin, recalculé)");
 await p.click("#undoBtn"); await calme(p); T.ok(await p.evaluate(() => curU().classe === "chenille"), "annulation");
 await p.click(".tabs button[data-tab=res]"); const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#exp")]); await dl.saveAs(path.join(OUT, "planification.json"));
 const j = JSON.parse(fs.readFileSync(path.join(OUT, "planification.json"), "utf8")), s0 = j.planification.scenarios[0];
 T.ok(j.format === "ennemi-gtia" && j.version === 3 && j.planification.scenarios.length === 2 && j.resultats.axes[s0.id][s0.unites[0].id].length >= 2, "export .json complet (ennemi-gtia v3, 2 scénarios, axes joints)");
 const q = await page(ctx, T); await q.goto(T.base + "ennemi.html?zone=inexistante"); await terrainOuvert(q); await q.setInputFiles("#imp", path.join(OUT, "planification.json"));
 await q.waitForFunction(() => typeof ET !== "undefined" && ET.planification.scenarios.length === 2 && calmeEnnemi() && RP && Object.values(RP.unites).some(r => r.axes.length >= 2), null, T_MAP);
 // réimport : mêmes scénarios (id, nom, classe, départ, objectifs) que le fichier, sur son terrain, sans avertissement, axes recalculés
 const resume = sc => sc.map(s => [s.id, s.nom, s.mode_action, s.unites.map(u => [u.id, u.classe, (u.depart || []).map(x => x.toFixed(7)), (u.objectifs || []).map(o => o.map(x => x.toFixed(7)))])]);
 const ri = await q.evaluate(() => ({sc:ET.planification.scenarios, g:G.id, warn:document.getElementById("refWarn").textContent, axes:Object.values(RP.unites).map(r => r.axes.length)}));
 T.ok(JSON.stringify(resume(ri.sc)) === JSON.stringify(resume(j.planification.scenarios)), "réimport du .json : mêmes scénarios, unités, classes, départs et objectifs que le fichier");
 T.ok(ri.g === j.terrain.id && !ri.warn && ri.axes.every(n => n >= 1), "réimport du .json : sur son terrain (" + ri.g + "), sans avertissement, axes recalculés (" + ri.axes.join(", ") + ")");
 T.ok(p.erreurs.length + q.erreurs.length === 0, "aucune erreur de script " + p.erreurs.concat(q.erreurs).join(" | ")); await ctx.close(); });

/* ---------- 3. conduite (ennemi.html) : contact, zones à survoler, ennemi inconnu, export ---------- */
test("ennemi, conduite : contact, zones à survoler, export (PC)", async T => {
 const ctx = await contexte(T, false), p = await page(ctx, T);
 await p.goto(T.base + "ennemi.html?mode=conduite"); await prets(p); await p.click("#demoBtn"); await terrainOuvert(p); await calme(p);
 await p.click('#tools button[data-t=con]'); await p.mouse.click(...await px(p, 0.5, 0.45)); await p.waitForTimeout(300);
 await p.fill(".pf [data-v]", "2"); await p.fill(".pf [data-h]", "14:00"); await p.click(".pf [data-ok]"); await calme(p);
 const z = await p.evaluate(() => RC.pres.zones.map(z => [z.niveau, z.part_pct]));
 T.ok(z.length >= 3 && z.every(x => ["forte", "moyenne", "faible"].includes(x[0])), "zones à survoler avec niveau (" + z.length + ")");
 T.ok(z[0][1] >= z[z.length - 1][1], "zones classées par priorité");
 await p.evaluate(() => { const r = document.getElementById("clockR"); r.value = 40; r.dispatchEvent(new Event("input")); }); await calme(p);
 T.ok(await p.evaluate(() => UI.tx === 40 && RC.t === mins(ET.conduite.heure) + 40), "le temps écoulé élargit la carte (calcul à T+40)");
 await p.click(".tabs button[data-tab=sai]"); await p.click("#mArret"); await calme(p); T.ok(await p.evaluate(() => RC.pres.zones.length > 0 && !ET.conduite.unites[0].en_mouvement), "mode à l'arrêt");
 await p.click(".tabs button[data-tab=res]"); const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#exp")]); await dl.saveAs(path.join(OUT, "conduite.json"));
 T.ok(JSON.parse(fs.readFileSync(path.join(OUT, "conduite.json"), "utf8")).resultats.zones_a_survoler.length >= 3, "export .json (zones à survoler jointes)");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | ")); await ctx.close(); });

/* ---------- 4. navigation téléphone : barre du bas, feuille courte, pastilles ---------- */
test("téléphone : barre d'onglets, feuille, pastilles", async T => {
 const ctx = await contexte(T, true);
 // outil Ennemi unique : 5 onglets (Terrain, Planification, Conduite, Résultats, Affichage) ; les deux anciennes pages redirigent vers lui
 for (const [f, cles] of [["index", ["zone", "carte", "outil", "synth"]], ["ennemi", ["terr", "plan", "cond", "res", "aff"]], ["implantation", ["terr", "reg", "res", "aff"]], ["radars", ["terr", "reseau", "cherch", "res", "aff"]]]) {
  const p = await page(ctx, T); await p.goto(T.base + f + ".html"); await p.waitForTimeout(1800);
  T.ok(JSON.stringify(await p.evaluate(() => [...document.querySelectorAll("#navBar button")].map(b => b.dataset.k))) === JSON.stringify(cles), f + " : " + cles.length + " onglets");
  T.ok(await p.evaluate(() => document.body.classList.contains("sheet")), f + " : feuille ouverte au départ");
  await p.tap("#navBar button:nth-child(2)"); await p.waitForTimeout(300); T.ok(await p.evaluate(() => document.getElementById("panel").dataset.pane) === cles[1], f + " : 2e onglet");
  await p.tap("#navBar button:nth-child(2)"); await p.waitForTimeout(300); T.ok(!(await p.evaluate(() => document.body.classList.contains("sheet"))), f + " : second appui = fermeture");
  const h = await p.evaluate(() => Math.round(document.getElementById("panel").getBoundingClientRect().height)); T.ok(h === 0, f + " : panneau fermé");
  T.ok(p.erreurs.length === 0, f + " : aucune erreur de script"); }
 await ctx.close(); });

/* ---------- 5. outil terrain : outils, « Effacer », annulation ---------- */
test("outil terrain : annulation et effacement (PC)", async T => {
 const ctx = await contexte(T, false), p = await page(ctx, T);
 await p.goto(T.base + "index.html"); await p.waitForTimeout(1500); await p.setInputFiles("#imp", DEMO);
 await p.waitForFunction(() => /Zone «.*chargée/.test(document.getElementById("status").textContent), null, T_MAP); await p.waitForTimeout(1500);
 const st = () => p.evaluate(() => ({c:G.couloirs.length, o:G.obs.length, undo:UNDO.length}));
 await p.evaluate(() => document.querySelector("[data-tool=obs]").click());
 await p.mouse.click(...await px(p, 0.3, 0.3)); await p.waitForTimeout(500); await p.mouse.click(...await px(p, 0.6, 0.5)); await p.waitForTimeout(500);
 T.ok((await st()).o === 2, "2 observations"); await p.click("#undoMap"); await p.waitForTimeout(500); T.ok((await st()).o === 1, "annulation d'une observation");
 await p.evaluate(() => document.getElementById("clearObs").click()); await p.waitForTimeout(400); T.ok((await st()).o === 0, "« Effacer » vide les observations");
 await p.keyboard.press("Control+z"); await p.waitForTimeout(500); T.ok((await st()).o === 1, "Ctrl+Z annule l'effacement");
 const grille = await p.evaluate(() => [...document.querySelectorAll(".toolgrid button")].map(b => b.textContent.trim()));
 T.ok(grille.length === 7 && grille[1] === "Couloir A→B" && /Effacer/.test(grille[2]) && grille[3] === "Point d'observation" && /Effacer/.test(grille[4]) && /Qui voit/.test(grille[5]) && /Effacer/.test(grille[6]), "chaque outil est suivi de son « Effacer » (" + grille.join(" | ") + ")");
 T.ok(p.erreurs.length === 0, "aucune erreur de script"); await ctx.close(); });

/* ---------- 6. zone courante et travail conservé entre les outils ---------- */
/* ---------- rendu lissé, légende sur la carte, cours d'eau en lignes ---------- */
test("outil terrain : rendu lissé, légende sur la carte, cours d'eau (PC)", async T => {
 const ctx = await contexte(T, false), p = await page(ctx, T);
 await p.goto(T.base + "index.html"); await p.waitForTimeout(1500); await p.setInputFiles("#imp", DEMO);
 await p.waitForFunction(() => /Zone «.*chargée/.test(document.getElementById("status").textContent), null, T_MAP); await p.waitForTimeout(1500);
 const regle = (id, v) => p.evaluate(([id, v]) => { const e = document.getElementById(id); if (typeof v === "boolean") e.checked = v; else e.value = v; e.onchange({target:e}); }, [id, v]);   // réglages du panneau, quel que soit l'onglet ouvert
 const larg = id => p.evaluate(id => new Promise(r => { const i = new Image(); i.onload = () => r(i.width); i.src = map.getSource(id).url; }), id);
 const n = await p.evaluate(() => G.n);
 T.ok(await p.isChecked("#lay-liss"), "rendu lissé coché par défaut");
 T.ok(await larg("ov") === await p.evaluate(() => tailleLisse(G.n)) && await larg("ov") > n, "fond de mobilité lissé : image plus fine que la grille");
 T.ok(await p.evaluate(() => map.getPaintProperty("ov", "raster-resampling")) === "linear", "rééchantillonnage linéaire");
 T.ok(Math.abs(await p.evaluate(() => map.getPaintProperty("ov", "raster-opacity")) - 0.35) < 0.01, "opacité par défaut 35 %");
 T.ok(/Chenillé/.test(await p.textContent("#mapLeg")) && /SLOW-GO/.test(await p.textContent("#mapLeg")) && await p.isVisible("#mapLeg"), "légende visible sur la carte");
 await p.evaluate(() => document.querySelector('input[name=cls][value=fantassin]').click()); await regle("sol", "humide"); await p.waitForFunction(() => /Recalculé : sol humide/.test(document.getElementById("status").textContent), null, T_MAP); await p.waitForTimeout(300);
 { const lg = await p.textContent("#mapLeg"); T.ok(/Fantassin.* – sol humide/.test(lg), "la légende suit l'arme et l'état du sol (" + lg.slice(0, 40) + ")"); }
 await regle("sol", "sec"); await p.waitForFunction(() => /Recalculé : sol sec/.test(document.getElementById("status").textContent), null, T_MAP); await p.waitForTimeout(300); await p.evaluate(() => document.querySelector('input[name=cls][value=chenille]').click()); await p.waitForTimeout(800);
 const riv = await p.evaluate(() => !!G.rivs && G.rivs.length > 0);
 T.ok(await p.evaluate(() => map.getLayoutProperty("rivv", "visibility")) === (riv ? "visible" : "none"), "rivières en lignes si leur tracé est connu");
 // lissage fidèle : au centre de chaque maille, la classe affichée est celle de la maille (hors mailles isolées)
 const fid = await p.evaluate(() => { const n = G.n, C = tailleLisse(n), F = C/n, cl = G.cls.chenille, lab = Uint8Array.from(cl, v => v === 0 ? 0 : v === 3 ? 3 : v === 2 ? 2 : 1), up = plusFort(champsDe(lab, n, 4, true), n, C, 0, 0);
  let ok = 0; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (up[Math.floor((j + 0.5)*F)*C + Math.floor((i + 0.5)*F)] === lab[j*n + i]) ok++; return ok/(n*n); });
 T.ok(fid > 0.97, "le lissage garde la classe au centre des mailles (" + Math.round(fid*1000)/10 + " %)");
 await p.screenshot({path:path.join(OUT, "terrain-lisse.png")});
 for (const m of ["qpo", "score", "arme"]) { await regle("mode", m); await p.waitForTimeout(500); }
 for (const id of ["lay-cov", "lay-vue"]) await regle(id, true); await p.waitForTimeout(800);
 await regle("lay-liss", false); await p.waitForTimeout(800);
 T.ok(await larg("ov") === n && await p.evaluate(() => map.getPaintProperty("ov", "raster-resampling")) === "nearest", "décoché : retour aux mailles");
 T.ok(await p.evaluate(() => map.getLayoutProperty("rivv", "visibility")) === "none", "décoché : cours d'eau en trame");
 await p.screenshot({path:path.join(OUT, "terrain-mailles.png")});
 await regle("lay-liss", true); await p.waitForTimeout(800);
 // grande zone : le lissage d'une grille de 500 × 500 (50 km) reste rapide
 const ms = await p.evaluate(() => { const n = 500, lab = new Uint8Array(n*n); for (let c = 0; c < n*n; c++) lab[c] = ((c % n) >> 4 ^ (c / n) >> 4) & 3; const t = performance.now(); plusFort(champsDe(lab, n, 4, true), n, tailleLisse(n), 0, 0); return performance.now() - t; });
 T.ok(ms < 3000, "lissage 50 km en " + Math.round(ms) + " ms");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | "));
 await ctx.close(); });

/* ---------- MGRS seul, filtre des points de franchissement, légende sur la carte, rendu lissé au zoom fort ---------- */
test("outil terrain : MGRS seul, filtre des points, légende, zoom fort (PC)", async T => {
 const ctx = await contexte(T, false); await H.brancherRelief(ctx, H.reliefSynthetique());
 // rivière est-ouest (largeur OSM « 5-10 » : 10 m), route nord-sud avec un pont, voie ferrée avec passage à niveau
 const g = (lat, lon) => ({lat, lon}), rep = {elements:[
  {type:"way", id:1, tags:{highway:"secondary", name:"D1"}, nodes:[11, 12, 13], geometry:[g(47.23, -0.08), g(47.24, -0.08), g(47.248, -0.08)]},
  {type:"way", id:2, tags:{highway:"secondary", name:"D1", bridge:"yes"}, nodes:[13, 14], geometry:[g(47.248, -0.08), g(47.252, -0.08)]},
  {type:"way", id:3, tags:{highway:"secondary", name:"D1"}, nodes:[14, 15, 16], geometry:[g(47.252, -0.08), g(47.27, -0.08), g(47.29, -0.08)]},
  {type:"way", id:4, tags:{waterway:"river", name:"Rivière test", width:"5-10"}, nodes:[41, 42], geometry:[g(47.25, -0.125), g(47.25, -0.03)]},
  {type:"way", id:5, tags:{railway:"rail"}, nodes:[51, 15, 52], geometry:[g(47.27, -0.125), g(47.27, -0.08), g(47.27, -0.03)]},
  {type:"node", id:15, lat:47.27, lon:-0.08, tags:{railway:"level_crossing"}}]};
 await ctx.route(/dresel\.systems|overpass-api\.de|private\.coffee|kumi\.systems/, r => r.fulfill({status:200, contentType:"application/json", body:JSON.stringify(rep)}));
 const p = await page(ctx, T);
 await p.goto(T.base + "index.html"); await prets(p); await p.waitForTimeout(1500);
 await p.fill("#nom", ""); await p.selectOption("#size", {index:0}); await p.click("#go");
 await p.waitForFunction(() => /Terminé et enregistré|Échec|indisponible/.test(document.getElementById("status").textContent), null, {timeout:120000});
 T.ok(/Terminé et enregistré/.test(await p.textContent("#status")), "analyse terminée");
 await p.waitForTimeout(1500);
 // 1. MGRS seul : aucun motif de latitude / longitude décimale (ex. 47.2512, -0.0801, 47,25° N)
 const DEC = /-?\d{1,3}[.,]\d{4,}|\d{1,3}[.,]\d{2,}\s*°\s*[NSEO]/;
 const nom = await p.evaluate(() => G.nom);
 T.ok(/^Zone \d{1,2}[C-X] [A-Z]{2} \d+ \d+ – \d+ km$/.test(nom) && !DEC.test(nom), "nom de zone automatique en MGRS (" + nom + ")");
 T.ok(!DEC.test(await p.inputValue("#nom")), "champ Nom sans coordonnées décimales");
 const [cx, cy] = await px(p, 0.4, 0.4); await p.mouse.move(cx, cy); await p.mouse.move(cx + 5, cy + 5); await p.waitForTimeout(400);
 const barre = await p.textContent(".cg-coord");
 T.ok(/^\d{1,2}[C-X] [A-Z]{2} \d+ \d+/.test(barre) && !DEC.test(barre), "barre de survol : MGRS seul (" + barre.slice(0, 50) + ")");
 const fiches = await p.evaluate(() => { const t = [];
  G.feats.forEach((f, i) => { featPopup(i, {lng:f.lon, lat:f.lat}); const e = document.querySelector(".maplibregl-popup"); t.push(e ? e.textContent : ""); if (e) e.remove(); });
  G.hp.slice(0, 3).forEach((h, i) => { const ll = cellLL(h.c); hpPopup(i, {lng:ll[0], lat:ll[1]}); const e = document.querySelector(".maplibregl-popup"); t.push(e ? e.textContent : ""); if (e) e.remove(); });
  return t; });
 T.ok(fiches.length > 1 && fiches.every(t => t.length > 10 && !DEC.test(t)), "fiches de point (" + fiches.length + ") : aucune coordonnée décimale " + (fiches.find(t => DEC.test(t)) || "").slice(0, 80));
 T.ok(fiches.some(t => /\d{1,2}[C-X] [A-Z]{2} \d+ \d+/.test(t)), "fiches de point : position en MGRS");
 await p.mouse.click(cx, cy); await p.waitForTimeout(600);
 { const t = await p.evaluate(() => { const e = document.querySelector(".maplibregl-popup"); return e ? e.textContent : ""; }); T.ok(t.length > 10 && !DEC.test(t), "fiche d'une maille : aucune coordonnée décimale"); }
 await p.evaluate(() => document.querySelectorAll(".maplibregl-popup").forEach(e => e.remove()));
 // 2. filtre des points de franchissement par type
 const types = await p.evaluate(() => G.feats.map(f => f.type));
 T.ok(types.includes("pont"), "un pont détecté (" + types.join(", ") + ")");
 // lecture des symboles affichés : rendu de la carte forcé d'abord (Chromium sans écran peut le différer)
 // mise à jour des symboles asynchrone (worker, fondu) : attente bornée, une capture d'écran fait avancer le rendu de la carte
 const vis = async attente => { for (let t = 0; t < 20; t++) { await p.waitForTimeout(300); await p.screenshot();
   if (await p.evaluate(() => map.queryRenderedFeatures({layers:["feats"]}).some(f => f.properties.type === "pont")) === (attente === "avec")) break; }
  return p.evaluate(() => { return {feats:map.queryRenderedFeatures({layers:["feats"]}).map(f => f.properties.type), cuts:map.queryRenderedFeatures({layers:["cuts"]}).map(f => f.properties.type), leg:document.getElementById("mapLeg").textContent}; }); };
 await p.evaluate(() => { const f = G.feats.find(f => f.type === "pont"); map.jumpTo({center:[f.lon, f.lat], zoom:13}); }); await p.waitForTimeout(1200);
 const v0 = await vis("avec");
 T.ok(v0.feats.includes("pont") && /Pont/.test(v0.leg), "pont affiché sur la carte et dans la légende");
 await p.evaluate(() => { const c = document.querySelector('.ptt[value="pont"]'); c.checked = false; c.dispatchEvent(new Event("change")); }); await p.waitForTimeout(800);
 const v1 = await vis("sans");
 T.ok(!v1.feats.includes("pont") && !v1.cuts.includes("pont"), "« pont » masqué : plus aucun symbole de pont (" + v1.feats.join(", ") + ")");
 T.ok(v0.feats.filter(t => t !== "pont").length === v1.feats.length, "les autres types restent affichés (" + v0.feats.join(",") + " → " + v1.feats.join(",") + ")");
 T.ok(!/\bPont\b/.test(v1.leg), "« pont » masqué : retiré de la légende");
 await p.evaluate(() => document.getElementById("ptTous").click()); await p.waitForTimeout(800);
 T.ok((await vis("avec")).feats.includes("pont"), "« Tous » : pont de nouveau affiché");
 // 3. légende sur la carte : visible, libellés distincts (voie ferrée obstacle / passage)
 T.ok(await p.isVisible("#mapLeg"), "légende visible sur la carte");
 const libs = await p.evaluate(() => [...document.querySelectorAll("#mapLeg .leg > span")].map(s => s.textContent.trim()));
 T.ok(libs.includes("GO") && libs.includes("NO-GO") && libs.includes("Eau"), "légende : GO, NO-GO, Eau (" + libs.join(" | ") + ")");
 T.ok(new Set(libs).size === libs.length, "légende : aucun libellé en double");
 T.ok(libs.includes("Voie ferrée (obstacle)"), "légende : « Voie ferrée (obstacle) » pour le trait");
 if (types.includes("fer")) T.ok(libs.includes("Passage voie ferrée"), "légende : « Passage voie ferrée » pour le pictogramme");
 // 4. rendu lissé au zoom fort : vue recalculée à la résolution de l'écran, aplats sans couleur intermédiaire
 await p.evaluate(() => { const f = G.feats.find(f => f.type === "pont"); map.jumpTo({center:[f.lon, f.lat], zoom:16}); });
 await p.waitForFunction(() => map.getLayer("ovz") && map.getLayoutProperty("ovz", "visibility") === "visible" && VUEZ_ON.ov && Math.abs(VUEZ_ON.ov.z - map.getZoom()) < 0.01, null, {timeout:10000}).catch(() => {});
 const z = await p.evaluate(() => { const cv = map.getSource("ovz") && map.getSource("ovz").getCanvas(); if (!cv) return null;
  const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data, ok = new Set([COL.eau, COL.no, COL.slow, COL.go].map(c => c.join(","))); let autres = 0, pleins = 0;
  for (let o = 0; o < d.length; o += 4) { if (!d[o+3]) continue; pleins++; if (!ok.has(d[o] + "," + d[o+1] + "," + d[o+2])) autres++; }
  const c = VUEZ_ON.ov, ecran = c ? map.project([c.e, c.n]).x - map.project([c.w, c.n]).x : 0;   // largeur de la partie calculée, en pixels d'écran (image à demi-résolution)
  return {w:cv.width, ecran:Math.round(ecran), ov:map.getLayoutProperty("ov", "visibility"), autres, pleins}; });
 T.ok(z && z.ov === "none" && Math.abs(z.w - z.ecran/2) <= 0.05*z.ecran + 2, "zoom 16 : fond de mobilité recalculé pour la vue (" + JSON.stringify(z) + ")");
 T.ok(z && z.pleins > 0 && z.autres === 0, "zoom 16 : uniquement les couleurs de la légende (aucun dégradé GO / NO-GO)");
 T.ok(await p.evaluate(() => map.getLayer("obsz") && map.getLayoutProperty("obsz", "visibility") === "visible" && map.getLayoutProperty("obs", "visibility") === "none"), "zoom 16 : obstacles recalculés pour la vue");
 await p.screenshot({path:path.join(OUT, "terrain-zoom16.png")});
 await p.evaluate(() => map.jumpTo({zoom:11})); await p.waitForTimeout(1200);
 T.ok(await p.evaluate(() => map.getLayoutProperty("ov", "visibility") === "visible" && map.getLayoutProperty("ovz", "visibility") === "none"), "zoom 11 : retour à l'image de la zone entière");
 await p.evaluate(() => { const e = document.getElementById("lay-liss"); e.checked = false; e.onchange(); map.jumpTo({zoom:16}); }); await p.waitForTimeout(1200);
 T.ok(await p.evaluate(() => map.getLayoutProperty("ovz", "visibility") === "none" && map.getLayoutProperty("ov", "visibility") === "visible"), "rendu lissé décoché : mailles, pas de recalcul de la vue");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | "));
 await ctx.close(); });

/* ---------- téléchargement OpenStreetMap : ordre des serveurs, repli, tracé des ruisseaux ---------- */
test("outil terrain : analyse avec repli de serveur Overpass (PC)", async T => {
 const ctx = await contexte(T, false); await H.brancherRelief(ctx, H.reliefSynthetique());
 const vus = [], rep = {elements:[
  {type:"way", id:1, tags:{highway:"secondary", name:"D1"}, nodes:[11, 12, 13], geometry:[{lat:47.23, lon:-0.13}, {lat:47.26, lon:-0.077}, {lat:47.29, lon:-0.02}]},
  {type:"way", id:2, tags:{waterway:"stream"}, nodes:[21, 22, 23], geometry:[{lat:47.28, lon:-0.12}, {lat:47.27, lon:-0.09}, {lat:47.275, lon:-0.05}]},
  {type:"way", id:3, tags:{waterway:"river", name:"Rivière test"}, nodes:[31, 32], geometry:[{lat:47.24, lon:-0.12}, {lat:47.245, lon:-0.03}]}]};
 await ctx.route(/dresel\.systems/, r => { vus.push("europe"); r.fulfill({status:502, body:"Bad Gateway"}); });
 await ctx.route(/overpass-api\.de/, r => { vus.push("principal"); r.fulfill({status:200, contentType:"application/json", body:JSON.stringify(rep)}); });
 await ctx.route(/private\.coffee|kumi\.systems|mail\.ru/, r => { vus.push("autre"); r.abort(); });
 const p = await page(ctx, T);
 await p.goto(T.base + "index.html"); await prets(p); await p.waitForTimeout(1500);
 await p.fill("#nom", "Essai repli"); await p.selectOption("#size", {index:0}); await p.click("#go");
 await p.waitForFunction(() => /Terminé et enregistré|Échec|indisponible/.test(document.getElementById("status").textContent), null, {timeout:120000});
 const st = await p.textContent("#status");
 T.ok(/Terminé et enregistré/.test(st), "analyse terminée malgré la panne du premier serveur (" + st.slice(0, 60) + ")");
 T.ok(vus[0] === "europe" && vus[1] === "principal" && !vus.includes("autre"), "serveur Europe d'abord, puis le principal (" + vus.join(", ") + ")");
 T.ok(await p.evaluate(() => OVERPASS.every(v => !/mail\.ru/.test(v.u))), "pas de serveur russe dans la liste");
 T.ok(await p.evaluate(() => G.rus && G.rus.length === 1 && G.rivs.length === 1), "tracés conservés : 1 ruisseau, 1 rivière");
 T.ok(await p.evaluate(() => map.getLayoutProperty("rusv", "visibility") === "visible" && map.getSource("eauv")._data.features.length >= 2), "ruisseau et rivière dessinés en lignes");
 T.ok(await p.evaluate(() => !OVERPASS[0].zone({s:31, n:31.5, w:34.5, e:35}) && OVERPASS[0].zone({s:40.7, n:41.2, w:14, e:14.6})), "serveur Europe écarté hors d'Europe, gardé pour Naples");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | "));
 await ctx.close(); });

/* ---------- saisie sur un tronçon de cours d'eau, seuils réglables, export / rechargement ---------- */
test("outil terrain : saisie sur un cours d'eau, seuils de franchissement (PC)", async T => {
 const ctx = await contexte(T, false, {acceptDownloads:true}); await H.brancherRelief(ctx, H.reliefSynthetique());
 const kx = 111320*Math.cos(47.26*Math.PI/180), ky = 110574, L0 = -0.077, B0 = 47.245, q = (dx, dy) => ({lon:L0 + dx/kx, lat:B0 + dy/ky});
 const rep = {elements:[
  {type:"way", id:3, tags:{waterway:"river", name:"Rivière test", width:"10"}, nodes:[31, 32], geometry:[q(-9000, 0), q(9000, 0)]},   // largeur OSM 10 m, profondeur absente
  {type:"way", id:5, tags:{waterway:"river", name:"Rivière large"}, nodes:[51, 52], geometry:[q(-9000, -5000), q(9000, -5000)]},
  {type:"way", id:6, tags:{natural:"water", water:"river"}, nodes:[], geometry:[q(-9000, -5030), q(9000, -5030), q(9000, -4970), q(-9000, -4970), q(-9000, -5030)]}]};   // dessinée en surface : 60 m
 await ctx.route(/dresel\.systems|overpass-api\.de/, r => r.fulfill({status:200, contentType:"application/json", body:JSON.stringify(rep)}));
 const p = await page(ctx, T);
 await p.goto(T.base + "index.html"); await prets(p); await p.waitForTimeout(1200);
 await p.fill("#nom", "Essai cours d'eau"); await p.selectOption("#size", "20"); await p.click("#go");
 await p.waitForFunction(() => /Terminé et enregistré|Échec|indisponible/.test(document.getElementById("status").textContent), null, {timeout:180000});
 T.ok(/Terminé et enregistré/.test(await p.textContent("#status")), "analyse terminée");
 const riv = await p.evaluate(() => G.rivs.map(r => ({id:r.id, w:r.w, wm:r.wm})));
 T.ok(riv.length === 2 && riv[0].id === "eau:w3" && riv[1].wm >= 60 && riv[1].wm <= 62, "tronçons identifiés, largeur mesurée sur la surface (" + JSON.stringify(riv) + ")");
 const ver = k => p.evaluate(k => verdictEau(G.rivs[0], k).ok, k);
 const clic = async (lon, lat) => { await p.evaluate(([lon, lat]) => map.jumpTo({center:[lon, lat], zoom:15}), [lon, lat]); await p.waitForTimeout(1500);
  const xy = await p.evaluate(([lon, lat]) => { const r = map.getCanvas().getBoundingClientRect(), pt = map.project([lon, lat]); return [r.left + pt.x, r.top + pt.y]; }, [lon, lat]); await p.mouse.click(...xy); await p.waitForTimeout(500); };
 // fiche du tronçon : valeurs et leur origine, verdict par classe
 await clic(L0 + 3000/kx, B0);
 let fiche = await p.textContent(".ficheEau").catch(() => "");
 T.ok(/Rivière « Rivière test »/.test(fiche) && /voie OSM 3/.test(fiche), "la fiche du tronçon s'ouvre au toucher du cours d'eau");
 T.ok(/largeur 10 m \(étiquette OSM\)/.test(fiche) && /profondeur inconnue \(bloquant par prudence/.test(fiche), "origine des valeurs : étiquette OSM, inconnue bloquante");
 T.ok(/Chenillé|chenillé/.test(fiche) && /NO-GO/.test(fiche) && !/toutes armes/i.test(fiche), "verdict par classe nommée, NO-GO");
 T.ok(!/\b\d{1,3}\.\d{3,}\s*[,;]\s*-?\d{1,3}\.\d{3,}/.test(fiche) && !/eau:@/.test(fiche), "aucune coordonnée décimale dans la fiche (MGRS)");
 T.ok(!(await ver("chenille")), "avant saisie : chenillé NO-GO");
 await p.fill(".ficheEau [data-p]", "abc"); await p.click(".ficheEau [data-ok]"); await p.waitForTimeout(300);
 T.ok(/Saisie refusée/.test(await p.textContent(".ficheEau [data-err]")), "saisie invalide refusée avec un message");
 await p.fill(".ficheEau [data-p]", "0,6"); await p.fill(".ficheEau [data-s]", "reco génie");
 fs.mkdirSync("/tmp/saisie", {recursive:true}); await p.screenshot({path:"/tmp/saisie/fiche-saisie.png"});
 await p.click(".ficheEau [data-ok]");
 await p.waitForFunction(() => /profondeur 0,6 m/.test(document.getElementById("status").textContent), null, T_MAP); await p.waitForTimeout(500);
 T.ok(await ver("chenille") && !(await ver("logistique")), "après saisie de 0,6 m : chenillé passe à gué, logistique NO-GO");
 T.ok(await p.evaluate(() => G.saisiesEau.length === 1 && G.saisiesEau[0].troncon === "eau:w3" && JSON.stringify(map.getFilter("rivsais")).includes("[0]")), "saisie rattachée au tronçon, surlignée");
 await clic(L0 + 3000/kx, B0); fiche = await p.textContent(".ficheEau");
 T.ok(/profondeur 0,6 m \(saisie\)/.test(fiche) && /reco génie/.test(fiche) && /passe à gué/.test(fiche), "fiche : profondeur « saisie », verdict changé");
 await p.screenshot({path:"/tmp/saisie/fiche-apres-saisie.png"});
 await p.keyboard.press("Escape");
 // tronçon dessiné en surface : largeur mesurée
 await clic(L0 + 3000/kx, B0 - 5000/ky); fiche = await p.textContent(".ficheEau").catch(() => "");
 T.ok(/mesurée sur le tracé OSM/.test(fiche), "rivière en surface : largeur « mesurée sur le tracé »");
 await p.keyboard.press("Escape");
 // annuler / rétablir
 await p.click("#undoMap"); await p.waitForTimeout(1500); T.ok(!(await ver("chenille")) && await p.evaluate(() => G.saisiesEau.length === 0), "Annuler : saisie retirée, chenillé NO-GO");
 await p.click("#redoMap"); await p.waitForTimeout(1500); T.ok(await ver("chenille") && await p.evaluate(() => G.saisiesEau.length === 1), "Rétablir : saisie revenue");
 // seuils réglables : profondeur max du chenillé à 0,5 m → NO-GO sur ce tronçon renseigné
 await p.click(".ptabs button[data-k=outil]");
 const champ = '#seuilsEau input[data-k=chenille][data-f=eau_profondeur_max_m]';
 T.ok(await p.inputValue(champ) === "1", "tableau des seuils : chenillé profondeur max 1 m");
 T.ok(/Valeurs fictives, à valider/.test(await p.textContent("#panel")), "mention « valeurs fictives, à valider »");
 await p.fill(champ, "-2"); await p.press(champ, "Tab"); await p.waitForTimeout(300);
 T.ok(/refusée/.test(await p.textContent("#status")) && await p.evaluate(() => P.chenille.eau_profondeur_max_m === 1), "valeur négative refusée, rien n'est appliqué");
 await p.fill(champ, "0,5"); await p.press(champ, "Tab");
 await p.waitForFunction(() => /Accessibilité recalculée/.test(document.getElementById("status").textContent), null, T_MAP); await p.waitForTimeout(500);
 T.ok(!(await ver("chenille")) && await p.evaluate(() => JSON.parse(document.getElementById("params").value).chenille.eau_profondeur_max_m === 0.5), "profondeur max chenillé 0,5 m : verdict NO-GO, JSON des paramètres synchronisé");
 await p.fill(champ, "1"); await p.press(champ, "Tab"); await p.waitForFunction(() => P.chenille.eau_profondeur_max_m === 1 && /Accessibilité recalculée/.test(document.getElementById("status").textContent), null, T_MAP); await p.waitForTimeout(500);
 T.ok(await ver("chenille"), "retour à 1 m : chenillé passe de nouveau");
 await p.fill('#seuilsEau input[data-k=roue][data-f=eau_profondeur_max_m]', "0,7"); await p.press('#seuilsEau input[data-k=roue][data-f=eau_profondeur_max_m]', "Tab");
 await p.waitForFunction(() => P.roue.eau_profondeur_max_m === 0.7, null, T_MAP); await p.waitForTimeout(800);
 // export puis rechargement dans un navigateur vierge
 await p.click(".ptabs button[data-k=zone]");
 const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#exp")]); const fic = path.join(OUT, "terrain-saisie.json"); await dl.saveAs(fic);
 const j = JSON.parse(fs.readFileSync(fic, "utf8"));
 T.ok(j.saisies_eau && j.saisies_eau.length === 1 && j.saisies_eau[0].troncon === "eau:w3" && j.saisies_eau[0].profondeur_m === 0.6 && j.saisies_eau[0].source === "reco génie", "export : champ saisies_eau");
 T.ok(j.parametres.roue.eau_profondeur_max_m === 0.7 && j.faits.cours_eau[1].wm >= 60, "export : seuil modifié et largeur mesurée");
 const ctx2 = await contexte(T, false), p2 = await page(ctx2, T); await p2.goto(T.base + "index.html"); await prets(p2); await p2.waitForTimeout(800);
 await p2.setInputFiles("#imp", fic); await p2.waitForFunction(() => /Zone «.*chargée/.test(document.getElementById("status").textContent), null, T_MAP); await p2.waitForTimeout(800);
 T.ok(await p2.evaluate(() => G.saisiesEau.length === 1 && G.saisiesEau[0].i === 0 && verdictEau(G.rivs[0], "chenille").ok && !verdictEau(G.rivs[0], "logistique").ok), "rechargement : saisie conservée, même verdict");
 T.ok(await p2.evaluate(() => P.roue.eau_profondeur_max_m === 0.7) && await p2.inputValue('#seuilsEau input[data-k=roue][data-f=eau_profondeur_max_m]') === "0,7", "rechargement : seuil modifié conservé et affiché");
 // hors ligne, zone chargée : la saisie fonctionne (aucun appel réseau nécessaire)
 await ctx2.setOffline(true);
 await p2.evaluate(() => saisirEau(0, null, 1.2, "renseignement")); await p2.waitForFunction(() => /profondeur 1,2 m/.test(document.getElementById("status").textContent), null, T_MAP);
 T.ok(await p2.evaluate(() => !verdictEau(G.rivs[0], "chenille").ok), "hors ligne : nouvelle saisie (1,2 m) appliquée, chenillé NO-GO");
 await p2.waitForTimeout(800); await p2.reload().catch(() => {}); await ctx2.setOffline(false);
 T.ok(p.erreurs.length + p2.erreurs.length === 0, "aucune erreur de script " + p.erreurs.concat(p2.erreurs).join(" | "));
 await ctx2.close(); await ctx.close(); });

test("zone courante, travail conservé, reprise de la planification en conduite", async T => {
 const ctx = await contexte(T, true); let p = await page(ctx, T);
 await p.goto(T.base + "index.html"); await p.waitForTimeout(1500); await p.setInputFiles("#imp", DEMO);
 await p.waitForFunction(() => /Zone «.*chargée/.test(document.getElementById("status").textContent), null, T_MAP); await p.waitForTimeout(2500);
 const zid = await p.evaluate(() => localStorage.getItem("terrain-gtia-zone-courante")); T.ok(!!zid && zid === await p.evaluate(() => G.id), "la zone courante est mémorisée"); await p.close();
 p = await page(ctx, T); await p.goto(T.base + "ennemi.html?mode=planification"); await terrainOuvert(p); T.ok(await p.evaluate(zid => G.id === zid, zid), "l'outil Ennemi ouvre seul la zone courante");
 await prets(p); await calme(p); await p.tap('#tools button[data-t=dep]'); await p.touchscreen.tap(...await px(p, 0.15, 0.4));
 await p.tap('#tools button[data-t=obj]'); await p.touchscreen.tap(...await px(p, 0.85, 0.7)); await calme(p); await p.waitForTimeout(900); await p.close();
 p = await page(ctx, T); await p.goto(T.base + "ennemi.html?mode=planification"); await terrainOuvert(p); await calme(p);
 T.ok(await p.evaluate(() => !!curU().depart && curU().objectifs.length === 1 && RP.unites[curU().id].axes.length >= 2), "la planification retrouve son travail (et ses axes)"); await p.close();
 p = await page(ctx, T); await p.goto(T.base + "ennemi.html?mode=conduite"); await terrainOuvert(p); await calme(p);
 T.ok(await p.evaluate(() => MODE === "conduite" && !document.getElementById("cAddCon").disabled && /Scénario 1/.test(document.getElementById("cRef").textContent)), "la conduite propose l'unité planifiée comme ennemi connu");
 await p.evaluate(() => document.getElementById("cAddCon").click()); await calme(p);
 T.ok(await p.evaluate(() => ET.conduite.unites.length === 1 && !!ET.conduite.unites[0].scenario_ref && UI.repere === ET.planification.scenarios[0].id), "planification reprise sans fichier (ennemi connu, scénario repère)"); await p.close();
 p = await page(ctx, T); await p.goto(T.base + "index.html"); await p.waitForTimeout(6000);
 T.ok(await p.evaluate(() => typeof G !== "undefined" && !!G), "l'outil terrain rouvre la zone courante");
 const q = await page(ctx, T); await q.goto(T.base + "ennemi.html?zone=abc"); await terrainOuvert(q);
 T.ok(await q.evaluate(zid => G.id === zid && !/Échec/.test(document.getElementById("status").textContent), zid), "ennemi.html : zone demandée absente → ouvre la zone courante");
 T.ok(q.erreurs.length === 0, "ennemi.html : aucune erreur de script " + q.erreurs.join(" | "));
 await ctx.close(); });

/* ---------- 6a. les deux anciennes pages redirigent vers l'outil unique, avec le mode ---------- */
test("anciennes pages ennemi-prepa / ennemi-conduite : redirection avec ?mode=", async T => {
 const ctx = await contexte(T, false), p = await page(ctx, T);
 for (const [f, m] of [["ennemi-prepa", "planification"], ["ennemi-conduite", "conduite"]]) {
  await p.goto(T.base + f + ".html?zone=z1#x"); await p.waitForURL(/\/ennemi\.html/); await prets(p);
  const u = new URL(p.url());
  T.ok(u.searchParams.get("mode") === m && u.searchParams.get("zone") === "z1" && u.hash === "#x", f + ".html → ennemi.html?mode=" + m + " (zone et ancre gardées)");
  T.ok(await p.evaluate(m => document.body.dataset.mode === m, m), f + " : outil ouvert en mode " + m); }
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | ")); await ctx.close(); });

/* ---------- 6b. outil Ennemi unique (étape 0) : squelette, bascule de mode, terrain par étapes ---------- */
for (const phone of [false, true]) test("ennemi : squelette, modes, terrain de démonstration par étapes (" + (phone ? "téléphone" : "PC") + ")", async T => {
 const ctx = await contexte(T, phone), p = await page(ctx, T);
 await p.goto(T.base + "ennemi.html"); await prets(p);
 T.ok(await p.evaluate(() => typeof ME === "object" && typeof RE === "object" && typeof CE === "object" && DOCTRINE.version === 1 && D.source === DOCTRINE.source), "scripts chargés : doctrine, moteur ennemi, rendu ennemi, commun ennemi");
 T.ok(await p.evaluate(() => document.body.dataset.mode === "planification" && document.querySelector("#modeSeg [data-m=planification]").classList.contains("on")), "mode Planification par défaut");
 await p.evaluate(() => { window.__etapes = []; new MutationObserver(() => { const t = document.getElementById("status").textContent; if (/%/.test(t)) __etapes.push(t); }).observe(document.getElementById("status"), {childList:true, characterData:true, subtree:true}); });
 if (phone) await p.evaluate(() => document.getElementById("demoBtn").click()); else await p.click("#demoBtn");
 await terrainOuvert(p);
 T.ok(await p.evaluate(() => /Terrain «/.test(document.getElementById("status").textContent) && /empreinte e[0-9a-f]{8}/.test(document.getElementById("status").textContent)), "terrain de démonstration ouvert, empreinte affichée");
 T.ok(await p.evaluate(() => __etapes.length >= 2), "progression affichée pendant le calcul (" + await p.evaluate(() => __etapes.length) + " messages)");
 T.ok(await p.evaluate(() => G.rivs.some(r => r.id === "eau:w900100") && G.feats.length === 8 && !!map.getSource("en-axes") && !!map.getSource("frame")), "terrain v3 de démonstration (ru, 8 ouvrages) et couches de l'outil créées");
 if (phone) { await p.tap("#navBar button[data-k=cond]"); await p.waitForTimeout(300); } else await p.click("#modeSeg [data-m=conduite]");
 T.ok(await p.evaluate(() => document.body.dataset.mode === "conduite" && /mode=conduite/.test(location.search)), "bascule en mode Conduite (adresse mise à jour)");
 await p.reload(); await prets(p); T.ok(await p.evaluate(() => document.body.dataset.mode === "conduite"), "le mode est gardé au rechargement");
 if (phone) T.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "pas de défilement horizontal");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | ")); await ctx.close(); });

/* ---------- 7. terrain visible par défaut ; bascule du fond IGN vers OSM (outil Ennemi, deux modes) ---------- */
test("terrain visible et bascule IGN vers OSM", async T => {
 const ctx = await T.b.newContext({viewport:{width:1500, height:900}}); await ctx.addInitScript(() => { try { ["prepa","conduite","ennemi"].forEach(k => localStorage.setItem("tuto-" + k, "1")); } catch(e){} }); await ctx.route(/geopf\.fr/, r => r.abort());
 for (const m of ["planification", "conduite"]) { const p = await page(ctx, T); await p.goto(T.base + "ennemi.html?mode=" + m); await prets(p); await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById("demoBtn").click()); await terrainOuvert(p); await p.waitForTimeout(3000);   // le 2e onglet peut avoir déjà repris le terrain : clic direct
  T.ok(await p.evaluate(() => map.getLayoutProperty("roads", "visibility") === "visible"), m + " : routes visibles par défaut");
  T.ok(await p.evaluate(() => document.getElementById("base").value) === "osm", m + " : fond IGN indisponible → OSM");
  T.ok(!(await p.evaluate(() => RE.couchesVisibles(map).includes("en-terrain"))), m + " : mobilité du terrain masquée au départ");
  await p.click("#terBtn"); await p.waitForTimeout(400);
  T.ok(await p.evaluate(() => RE.couchesVisibles(map).includes("en-terrain") && (map.getLayoutProperty("en-terrain", "visibility") === "visible" || map.getLayoutProperty("en-terrain-z", "visibility") === "visible") && document.getElementById("terBtn").classList.contains("on")), m + " : bouton Terrain (couche de mobilité du rendu Ennemi)");
  T.ok(p.erreurs.length === 0, m + " : aucune erreur de script " + p.erreurs.join(" | ")); }
 await ctx.close(); });

/* ---------- 8. radars (radars.html) : grande zone, réseau mixte, recherche, plan, bibliothèque, reprise ---------- */
const pxZ = (p, u, v) => p.evaluate(([u, v]) => { const b = Z.b, q = map.project([b.w + (b.e - b.w)*u, b.n - (b.n - b.s)*v]); return [q.x, q.y]; }, [u, v]);
const calmeR = async p => { await p.waitForTimeout(80); await p.waitForFunction(() => typeof calmeRadars === "function" && calmeRadars() && (!Z || !postes().length || RESEAU), null, {timeout:150000}); await p.waitForTimeout(150); };
test("radars : grande zone, réseau mixte, recherche, plan à 2, bibliothèque, reprise (PC)", async T => {
 const ctx = await contexte(T, false); await H.brancherRelief(ctx, H.reliefSynthetique({lon0:0.0, lat0:47.26}));
 let p = await page(ctx, T); await p.goto(T.base + "radars.html"); await prets(p); await p.waitForTimeout(500);
 // modes : Ami actif, Ennemi et Contre-batterie présents mais « à venir »
 const modes = await p.evaluate(() => [...document.querySelectorAll("#modeSeg button")].map(b => [b.dataset.m, b.disabled, b.textContent]));
 T.ok(JSON.stringify(modes.map(m => [m[0], m[1]])) === JSON.stringify([["ami", false], ["ennemi", true], ["cb", true]]) && /à venir/.test(modes[1][2]) && /à venir/.test(modes[2][2]), "modes : Ami actif ; Ennemi et Contre-batterie « à venir » désactivés");
 await p.check("input[name=zm][value=grande]"); await p.waitForTimeout(300);
 T.ok(/chargez le relief/i.test(await p.textContent("#masque")), "grande zone : le bandeau des masques demande le relief");
 await p.click("#rdLoad"); await p.waitForFunction(() => /Relief chargé|Échec/.test(document.getElementById("status").textContent), null, {timeout:90000}); await calmeR(p);
 T.ok(await p.evaluate(() => !!RD && RD.n === 200 && Z && Z.kind === "grande" && Z.H === Z.el && !Z.couv), "relief chargé (200 × 200), grille « grande zone » sans forêts ni bâti");
 T.ok(/relief seul/.test(await p.textContent("#masque")) && /relief seul/.test(await p.textContent("#legend")), "masques utilisés affichés (panneau et légende) : relief seul");
 // réseau mixte : MURIN au pied de la colline, Giraffe 1X en plaine ; cible drone bas
 await p.selectOption("#cibleSel", "drone50"); await p.selectOption("#poseSel", "murin");
 await p.mouse.click(...await pxZ(p, 0.45, 0.5)); await p.keyboard.press("Escape");
 await p.selectOption("#poseSel", "giraffe1x"); await p.mouse.click(...await pxZ(p, 0.15, 0.2)); await p.keyboard.press("Escape"); await calmeR(p);
 const r1 = await p.evaluate(() => ({n:postes().length, types:postes().map(r => r.type), vu:RESEAU.vuKm2, info:RESEAU.info.map(x => [x.f.id, Math.round(x.vuKm2), !!x.s && x.s.connue]), tr:RESEAU.trousKm2, nt:RESEAU.trous.liste.length}));
 T.ok(r1.n === 2 && r1.types.join() === "murin,giraffe1x" && r1.info.every(x => x[1] > 0), "réseau mixte : 2 radars de types différents, chacun voit (" + JSON.stringify(r1.info) + ")");
 T.ok(r1.vu > Math.max(...r1.info.map(x => x[1])) && r1.vu <= r1.info.reduce((a, x) => a + x[1], 0) + 1, "couverture cumulée entre le meilleur radar et la somme (" + Math.round(r1.vu) + " km²)");
 await p.click(".tabs button[data-tab=res]"); const res = await p.textContent("#resBody");
 T.ok(/portée inconnue pour cette cible : portée maximale utilisée/.test(res), "portée inconnue pour la cible signalée (optimiste)");
 T.ok(/Trous du réseau/.test(res) && r1.nt >= 1 && r1.tr > 0, "trous du réseau : surface et liste (" + Math.round(r1.tr) + " km², " + r1.nt + ")");
 // plancher : couche chiffrée en mètres
 await p.click("#couSeg [data-c=plancher]"); await p.waitForTimeout(400);
 const lg = await p.textContent("#legend"); T.ok(/Plancher de détection/.test(lg) && /≤ 10/.test(lg) && /1 000–3 000|1000–3000/.test(lg.replace(/ /g, " ")) && await p.evaluate(() => map.getLayoutProperty("floor", "visibility") === "visible" && map.getLayoutProperty("vu", "visibility") === "none"), "plancher de détection : légende chiffrée en mètres, couche affichée seule");
 T.ok(await p.evaluate(() => { const c = gCell(Z, postes()[0].ll[0], postes()[0].ll[1]); return RESEAU.plancher[c] === 0; }), "plancher nul au pied du radar");
 await p.screenshot({path:path.join(OUT, "radars-plancher.png")}); await p.click("#couSeg [data-c=vu]");
 // contre-batterie : COBRA (secteur de 90° vers l'est), cible obus ; le MURIN ne voit pas les obus
 await p.click(".tabs button[data-tab=reseau]"); await p.selectOption("#cibleSel", "obus"); await p.selectOption("#poseSel", "cobra"); await p.mouse.click(...await pxZ(p, 0.3, 0.7)); await p.waitForTimeout(300);
 await p.fill(".pf [data-k=orient_deg]", "90"); await p.dispatchEvent(".pf [data-k=orient_deg]", "change"); await p.keyboard.press("Escape"); await calmeR(p);
 const cb = await p.evaluate(() => { const x = RESEAU.info.find(i => i.f.id === "cobra"), c0 = gCell(Z, x.r.ll[0], x.r.ll[1]), n = Z.n, pl = CACHE.get(JSON.stringify([x.s, "cobra"]));
  return {murin:!RESEAU.info.find(i => i.f.id === "murin").s, sec:x.s.secteur_deg, or:x.s.orient_deg, est:pl[c0 + 20], ouest:pl[c0 - 20]}; });
 T.ok(cb.murin && cb.sec === 90 && cb.or === 90 && cb.est !== Infinity && cb.ouest === Infinity, "COBRA : secteur de 90° orienté à l'est (ouest hors secteur) ; le MURIN ne voit pas les obus");
 await p.click("#undoBtn"); await calmeR(p); T.ok(await p.evaluate(() => postes()[2] && postes()[2].orient_deg === 0), "annuler : retour à l'orientation précédente");
 await p.keyboard.press("Control+z"); await calmeR(p); T.ok(await p.evaluate(() => postes().length === 2), "Ctrl+Z : radar retiré");
 // recherche : MURIN, piéton... cible drone bas, 2 radars en complément
 await p.selectOption("#cibleSel", "drone50"); await calmeR(p);
 await p.click(".tabs button[data-tab=cherch]"); await p.selectOption("#rchType", "murin"); await p.selectOption("#rchNb", "2"); await p.click("#rchBtn");
 await p.waitForFunction(() => /Recherche terminée|arrêtée|Erreur/.test(document.getElementById("status").textContent), null, {timeout:150000}); await calmeR(p);
 const rc = await p.evaluate(() => ({tops:RCH.tops.map(t => [t.gainKm2, t.totKm2, t.z, t.pct]), plan:RCH.plan.map(x => [x.gainKm2, x.cumKm2]), compl:RCH.complement, vue:ST.vue, aj:RESEAU.ajoutKm2}));
 T.ok(rc.tops.length >= 3 && rc.tops.every((t, i) => !i || t[0] <= rc.tops[i - 1][0]), "emplacements classés par surface nouvelle (" + rc.tops.length + ")");
 T.ok(rc.compl && rc.tops[0][0] <= rc.tops[0][1] && rc.tops[0][3] > 0 && rc.tops[0][3] <= 100.5, "en complément du réseau : surface nouvelle ≤ surface vue, part plausible");
 T.ok(rc.plan.length === 2 && rc.plan[1][1] > rc.plan[0][1], "plan à 2 radars : le 2e ajoute de la surface");
 T.ok(rc.vue === "top:0" && rc.aj > 0 && await p.evaluate(() => map.getLayoutProperty("heat", "visibility") === "visible"), "l'emplacement proposé est montré : surface ajoutée en vert, carte de chaleur");
 await p.screenshot({path:path.join(OUT, "radars-recherche.png")});
 const v0 = await p.evaluate(() => RESEAU.vuKm2);
 await p.click("[data-add='0']"); await calmeR(p);
 T.ok(await p.evaluate(v0 => postes().length === 3 && RESEAU.vuKm2 > v0, v0), "« Ajouter au réseau » pose le radar proposé, la couverture augmente");
 // « Tester ici »
 await p.click(".tabs button[data-tab=reseau]"); await p.selectOption("#poseSel", "murin"); await p.click("#tools [data-t=test]"); await p.mouse.click(...await pxZ(p, 0.6, 0.35)); await calmeR(p); await p.keyboard.press("Escape");
 await p.click(".tabs button[data-tab=res]"); await p.waitForTimeout(300);
 T.ok(await p.evaluate(() => ST.vue === "test" && !!ST.test && document.querySelectorAll("#resBody table.hor tr").length === 6), "« Tester ici » : tableau des 5 cibles du MURIN");
 // bibliothèque : sources, valeur modifiée (fiabilité « saisie »), JSON invalide refusé
 await p.click("#gear"); await p.waitForTimeout(300);
 const bib = await p.evaluate(() => ({liens:[...document.querySelectorAll("#bibFiches a")].map(a => a.href), txt:document.getElementById("bibFiches").textContent}));
 T.ok(bib.liens.some(h => /defense\.gouv\.fr/.test(h)) && /MURIN/.test(bib.txt) && /GM400/.test(bib.txt) && /PAS un radar de niveau GTIA/.test(bib.txt), "bibliothèque : fiches amies avec sources (defense.gouv.fr), GM400α signalé hors niveau GTIA");
 await p.click("#bibFiltre [data-f=ennemi]"); T.ok(/Zoopark/.test(await p.textContent("#bibFiches")) && /Fara/.test(await p.textContent("#bibFiches")), "bibliothèque : radars ennemis (Fara, Zoopark…)");
 await p.click("#bibFiltre [data-f=ami]");
 const vAvant = await p.evaluate(() => RESEAU.info[0].vuKm2);
 await p.fill('#bibFiches input[data-f=murin][data-k=portee_max_km]', "8"); await p.dispatchEvent('#bibFiches input[data-f=murin][data-k=portee_max_km]', "change"); await calmeR(p);
 T.ok(await p.evaluate(vA => fiche("murin").portee_max_km.fiab === "saisie" && fiche("murin").portee_max_km.v === 8 && RESEAU.info[0].vuKm2 < vA && /radars-gtia-bib/.test(Object.keys(localStorage).join()), vAvant), "valeur modifiée : marquée « saisie », recalcul, bibliothèque enregistrée");
 await p.fill("#bibJson", "{ pas du json"); await p.click("#bibApply"); T.ok(/JSON illisible/.test(await p.textContent("#bibErr")), "JSON illisible refusé");
 await p.click("#drawerClose");
 await p.waitForTimeout(800); await p.close();
 // reprise : relief, réseau, recherche, bibliothèque retrouvés
 p = await page(ctx, T); await p.goto(T.base + "radars.html"); await p.waitForFunction(() => typeof Z !== "undefined" && Z && Z.kind === "grande" && postes().length === 3, null, T_MAP); await calmeR(p);
 T.ok(await p.evaluate(() => !!RD.el && RCH && RCH.tops.length >= 3 && fiche("murin").portee_max_km.v === 8 && RESEAU.vuKm2 > 0), "reprise : relief, réseau de 3 radars, recherche et bibliothèque retrouvés");
 T.ok(/\d{2}[A-Z] [A-Z]{2} \d{5} \d{5}/.test(await p.evaluate(() => listeTexte())), "liste copiable en MGRS");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | ")); await ctx.close(); });

/* ---------- 8b. radars sur la zone de l'outil terrain (forêts et bâti), téléphone ---------- */
test("radars : zone terrain, forêts et bâti, téléphone", async T => {
 const ctx = await contexte(T, true), p = await page(ctx, T); await p.goto(T.base + "radars.html"); await prets(p); await p.waitForTimeout(500);
 T.ok(await p.evaluate(() => document.body.classList.contains("sheet") && document.getElementById("panel").dataset.pane === "terr"), "feuille « Zone » ouverte au départ");
 await p.tap("#demoBtn"); await p.waitForFunction(() => typeof Z !== "undefined" && Z && Z.kind === "terrain", null, T_MAP); await calmeR(p);
 const m = await p.textContent("#masque"); T.ok(/forêts \(15 m\)/.test(m) && /bâti \(8 m\)/.test(m) && /maille 100 m/.test(m), "masques : relief + forêts + bâti à hauteur forfaitaire, maille fine (" + m.slice(0, 60) + ")");
 // les forêts réduisent ce que voit un radar, par rapport au relief seul
 const f = await p.evaluate(() => { let c0 = -1; for (let c = 0; c < Z.n*Z.n && c0 < 0; c++) if (Z.ok(c) && (c % Z.n) > 40 && ((c/Z.n) | 0) > 40) c0 = c;
  const s = MR.site(fiche("murin"), {}, "pieton", c0), a = MR.balayage(Z, s, {k:4/3, couvert:true}), b = MR.balayage(Object.assign({}, Z, {H:Z.el, couv:null}), s, {k:4/3});
  let va = 0, vb = 0, nf = 0; for (let c = 0; c < Z.n*Z.n; c++) { if (a[c] <= 1.8) va++; if (b[c] <= 1.8) vb++; if (Z.couv[c] > 0) nf++; } return {va, vb, nf}; });
 T.ok(f.nf > 0 && f.va < f.vb, "forêts et bâti masquent : " + f.va + " mailles vues contre " + f.vb + " en relief seul");
 // poser un radar au toucher (outil « Poser » par défaut), feuille fermée
 await p.tap("#navBar button[data-k=reseau]"); await p.waitForTimeout(300); await p.selectOption("#cibleSel", "pieton"); await p.tap("#poseBtn"); await p.waitForTimeout(300);
 T.ok(!(await p.evaluate(() => document.body.classList.contains("sheet"))), "« Poser sur la carte » ferme la feuille");
 const xy = await pxZ(p, 0.5, 0.45); await p.touchscreen.tap(...xy); await p.waitForTimeout(400); await p.evaluate(() => closePopup()); await calmeR(p);
 const r = await p.evaluate(() => ({n:postes().length, vu:RESEAU && RESEAU.vuKm2, pct:RESEAU && RESEAU.info[0].pct}));
 T.ok(r.n === 1 && r.vu > 0 && r.pct > 0 && r.pct <= 100, "radar posé au toucher, couverture calculée (" + Math.round(r.vu) + " km², " + Math.round(r.pct) + " % de sa portée)");
 // « Infos » : couvert et plancher au point touché
 await p.tap("#tools [data-t=info]"); await p.touchscreen.tap(...await pxZ(p, 0.3, 0.3)); await p.waitForTimeout(400);
 const info = await p.evaluate(() => document.querySelector(".maplibregl-popup-content").textContent);
 T.ok(/Plancher de détection/.test(info) && /(forêt|bâti|terrain découvert)/.test(info) && /\d{2}[A-Z] [A-Z]{2}/.test(info), "« Infos » : couvert, plancher, MGRS");
 await p.evaluate(() => closePopup());
 await p.tap("#navBar button[data-k=res]"); await p.waitForTimeout(300);
 T.ok(/Couverture du réseau/.test(await p.textContent("#resBody")) && await p.evaluate(() => document.getElementById("panel").dataset.pane === "res"), "onglet Résultats sur téléphone");
 T.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "pas de défilement horizontal");
 await p.tap("#navBar button[data-k=res]"); await p.waitForTimeout(300); await p.screenshot({path:path.join(OUT, "radars-telephone.png")});
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | ")); await ctx.close(); });

/* ---------- 9. implantation : chars sur la zone de l'outil terrain ---------- */
test("implantation : chars", async T => {
 const ctx = await contexte(T, false), p = await page(ctx, T); await p.goto(T.base + "implantation.html"); await prets(p);
 T.ok(await p.locator("#rdLoad").count() === 0 && await p.locator("a[href='radars.html']").count() >= 1, "plus de mode Radars ; lien vers l'outil Radars");
 await p.click("#demoBtn"); await terrainOuvert(p); await p.waitForTimeout(1200);
 await p.click(".tabs button[data-tab=reg]"); await p.click("#chCalc"); await p.waitForFunction(() => /Calcul terminé|Aucun|arrêté/.test(document.getElementById("status").textContent), null, {timeout:150000}); await p.waitForTimeout(800);
 const t = await p.evaluate(() => topsChar().map(o => [o.sect, o.surf, o.vmax])); T.ok(t.length >= 3, "au moins 3 emplacements de char (" + t.length + ")");
 T.ok(t.every(o => o[0] >= 30), "secteur utile minimal respecté"); T.ok(t.every(o => o[2] <= 2500 + 1), "la vue ne dépasse pas la portée pratique");
 T.ok(t[0][1] >= t[t.length - 1][1], "classés par surface de tir utile");
 await p.mouse.click(...await px(p, 0.4, 0.5)); await p.waitForTimeout(600); T.ok(await p.evaluate(() => ST.char.vue === "test"), "« Tester ici » mesure un point");
 const copie = await p.evaluate(() => listeTexte()); T.ok(/Emplacement 1/.test(copie), "liste copiable");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join("|")); await ctx.close(); });

/* ---------- 9b. aide au premier lancement et boutons ajoutés (outil Ennemi) ---------- */
test("aide au démarrage, « Maintenant », copie des horaires", async T => {
 const c = await T.b.newContext({viewport:{width:1500, height:900}, permissions:["clipboard-read","clipboard-write"]}); await c.route(/geopf\.fr|tile\.openstreetmap\.org/, r => r.fulfill({status:200, contentType:"image/png", body:PIXEL}));
 const p = await page(c, T); await p.goto(T.base + "ennemi.html?mode=planification"); await prets(p);
 T.ok(await p.isVisible("#cgTuto"), "l'aide s'affiche au premier lancement"); await p.click("#cgTutoOk"); T.ok(!(await p.isVisible("#cgTuto")), "elle se ferme");
 await p.reload(); await prets(p); T.ok(!(await p.isVisible("#cgTuto")), "elle ne revient pas");
 T.ok(await p.locator("#copyH").count() === 1, "bouton « Copier les horaires » présent");
 const q = await page(c, T); await q.goto(T.base + "ennemi.html?mode=conduite"); await prets(q); T.ok(await q.locator("#clockNow").count() === 1 && !(await q.isVisible("#cgTuto")), "bouton « Maintenant » présent (aide déjà vue)");
 T.ok(p.erreurs.length === 0 && q.erreurs.length === 0, "aucune erreur de script"); await c.close(); });

/* ---------- 10. application installable et hors ligne ---------- */
test("application : manifeste, icônes et hors ligne", async T => {
 // sw.js : tous les fichiers du site (pages, scripts, données, icônes) sont dans la liste mise en cache
 const sw = fs.readFileSync(path.join(H.ROOT, "sw.js"), "utf8"), LOCAL = JSON.parse(sw.match(/const LOCAL = (\[[^\]]*\])/)[1]);
 const site = fs.readdirSync(H.ROOT).filter(f => /\.(html|js|json|png|webmanifest)$/.test(f) && f !== "sw.js").concat(["lib/maplibre-gl.js", "lib/maplibre-gl.css"]);
 T.ok(site.every(f => LOCAL.includes(f)) && LOCAL.every(f => fs.existsSync(path.join(H.ROOT, f))), "sw.js : liste des fichiers à jour (manquants : " + site.filter(f => !LOCAL.includes(f)).join(", ") + " ; absents : " + LOCAL.filter(f => !fs.existsSync(path.join(H.ROOT, f))).join(", ") + ")");
 const ctx = await T.b.newContext({...PHONE}); const p = await page(ctx, T); await p.goto(T.base + "app.html");
 await p.evaluate(() => navigator.serviceWorker.ready); await p.waitForTimeout(3500);
 const m = await p.evaluate(async () => { const j = await (await fetch("manifest.webmanifest")).json(); const r = []; for (const i of j.icons) r.push((await fetch(i.src)).status); return {name:j.name, start:j.start_url, r}; });
 T.ok(m.start === "./app.html" && m.r.every(x => x === 200), "manifeste et icônes");
 T.ok(await p.evaluate(() => !!navigator.serviceWorker.controller), "service worker actif");
 const cache = await p.evaluate(async () => (await (await caches.open((await caches.keys())[0])).keys()).map(r => r.url));
 T.ok(cache.some(u => /implantation\.html/.test(u)) && cache.some(u => /radars\.html/.test(u)) && cache.some(u => /moteur-radar\.js/.test(u)), "les outils Implantation et Radars sont en cache");
 T.ok(["ennemi.html", "rendu-lisse.js", "rendu-ennemi.js", "moteur-ennemi.js", "doctrine.js"].every(f => cache.some(u => u.endsWith("/" + f))), "l'outil Ennemi et ses scripts (dont rendu-lisse.js) sont en cache");
 await ctx.setOffline(true); const e = await page(ctx, T); await e.goto(T.base + "ennemi.html"); await e.waitForTimeout(1500);
 T.ok((await e.title()) === "Ennemi" && e.erreurs.length === 0, "l'outil Ennemi s'ouvre hors ligne, sans erreur " + e.erreurs.join(" | ")); await ctx.setOffline(false);
 await ctx.setOffline(true); const q = await page(ctx, T); await q.goto(T.base + "implantation.html"); await q.waitForTimeout(1500);
 T.ok((await q.title()) === "Implantation", "l'outil s'ouvre hors ligne");
 const r = await page(ctx, T); await r.goto(T.base + "radars.html"); await r.waitForTimeout(1500); T.ok((await r.title()) === "Radars" && r.erreurs.length === 0, "l'outil Radars s'ouvre hors ligne, sans erreur " + r.erreurs.join(" | ")); await ctx.close(); });

/* ---------- lancement ---------- */
(async () => {
 const filtre = process.argv[2], {server, base} = await H.serveur(), b = await H.navigateur(); let n = 0;
 for (const t of tests) { if (filtre && !t.nom.toLowerCase().includes(filtre.toLowerCase())) continue; n++;
  const T = {b, base, pages:[], ok:(c, m) => { if (!c) { echecs.push(t.nom + " : " + m); console.log("   ✗ " + m); } else if (process.env.VERBEUX) console.log("   ✓ " + m); }};
  const t0 = Date.now(); process.stdout.write("• " + t.nom + "\n");
  try { await t.fn(T); } catch(e) { echecs.push(t.nom + " : EXCEPTION " + e.message.split("\n")[0]); console.log("   ✗ exception : " + e.message.split("\n")[0]); }
  for (const p of T.pages) { try { const e = await p.evaluate(() => { const b = document.getElementById("cgErr"); return b && b.textContent; }); if (e) T.ok(false, "bannière d'erreur visible : " + e); } catch(e) {} }
  for (const p of T.pages) { try { await p.screenshot({path:path.join(OUT, t.nom.replace(/[^\wà-ü]+/g, "_").slice(0, 50) + "-" + T.pages.indexOf(p) + ".png")}); } catch(e) {} }
  console.log("   (" + Math.round((Date.now() - t0)/1000) + " s)"); }
 await b.close(); server.close();
 console.log("\n" + (echecs.length ? "ÉCHECS (" + echecs.length + ") :\n - " + echecs.join("\n - ") : "Tous les tests passent (" + n + " scénarios)."));
 process.exit(echecs.length ? 1 : 0);
})();
