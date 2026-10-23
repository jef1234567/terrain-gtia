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
 await c.route(/geopf\.fr|tile\.openstreetmap\.org/, r => r.fulfill({status:200, contentType:"image/png", body:PIXEL})); return c; }   // fond de carte neutre : plus rapide et stable
function page(ctx, T){ return ctx.newPage().then(p => { p.erreurs = []; p.on("pageerror", e => p.erreurs.push(e.message)); T.pages.push(p); return p; }); }
const prets = p => p.waitForFunction(() => typeof mapReady !== "undefined" && mapReady, null, T_MAP);
const terrainOuvert = p => p.waitForFunction(() => /Terrain «|Zone «.*chargée|Échec/.test(document.getElementById("status").textContent) && typeof G !== "undefined" && G, null, T_MAP);
const px = (p, u, v) => p.evaluate(([u, v]) => { const d = typeof RD !== "undefined" && typeof MODE !== "undefined" && MODE === "radar" ? RD : G, b = d.b, q = map.project([b.w + (b.e - b.w)*u, b.n - (b.n - b.s)*v]); return [q.x, q.y]; }, [u, v]);
const tap = (p, phone, sel) => phone ? p.tap(sel) : p.click(sel);
const touche = (p, phone, xy) => phone ? p.touchscreen.tap(...xy) : p.mouse.click(...xy);

/* ---------- 1. toutes les pages s'ouvrent, sans erreur, sans défilement horizontal ---------- */
for (const phone of [false, true]) test("pages : ouverture sans erreur (" + (phone ? "téléphone" : "PC") + ")", async T => {
 const ctx = await contexte(T, phone);
 for (const f of ["app", "index", "ennemi-prepa", "ennemi-conduite", "implantation"]) {
  const p = await page(ctx, T); await p.goto(T.base + f + ".html"); await p.waitForTimeout(1800);
  T.ok(p.erreurs.length === 0, f + " : aucune erreur de script " + p.erreurs.join(" | "));
  if (phone) T.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), f + " : pas de défilement horizontal"); }
 await ctx.close(); });

/* ---------- 2. prépa mission : saisie, axes, horaires, scénarios, annulation, export / import ---------- */
test("prépa mission : parcours complet (PC)", async T => {
 const ctx = await contexte(T, false), p = await page(ctx, T);
 await p.goto(T.base + "ennemi-prepa.html"); await p.click("#demoBtn"); await terrainOuvert(p); await prets(p); await p.waitForTimeout(1200);
 await p.click('#tools button[data-t=depart]'); await p.mouse.click(...await px(p, 0.1, 0.3));
 await p.click('#tools button[data-t=objectifs]'); await p.mouse.click(...await px(p, 0.9, 0.7));
 await p.click('#tools button[data-t=amis]'); await p.mouse.click(...await px(p, 0.7, 0.2)); await p.waitForTimeout(1500);
 const axes = await p.evaluate(() => RS.axes.map(a => [a.genre, a.plausibilite, a.temps_h*60, a.jalons.length]));
 T.ok(axes.length >= 2, "au moins 2 axes (" + JSON.stringify(axes) + ")"); T.ok(axes.some(a => a[1] === "forte"), "un axe de plausibilité forte");
 T.ok(axes.every(a => a[2] > 0 && a[3] >= 3), "horaires et jalons présents");
 await p.evaluate(() => { const r = document.getElementById("clockR"); r.value = (+r.min + +r.max)/2 | 0; r.dispatchEvent(new Event("input")); });
 T.ok(/km du départ/.test(await p.textContent("#clockInfo")), "le curseur d'heure place la colonne");
 await p.click("#scDup"); await p.waitForTimeout(600); await p.selectOption("#eType", "pied"); await p.waitForTimeout(800);
 T.ok(await p.evaluate(() => ST.scen.length === 2 && cur().ennemi.type === "pied"), "scénario copié puis modifié");
 await p.click("#undoBtn"); await p.waitForTimeout(600); T.ok(await p.evaluate(() => cur().ennemi.type === "meca"), "annulation");
 await p.click(".tabs button[data-tab=res]"); const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#exp")]); await dl.saveAs(path.join(OUT, "prepa.json"));
 const j = JSON.parse(fs.readFileSync(path.join(OUT, "prepa.json"), "utf8")); T.ok(j.format === "ennemi-prepa-gtia" && j.scenarios.length === 2 && j.scenarios[0].axes.length >= 2, "export .json complet");
 const q = await page(ctx, T); await q.goto(T.base + "ennemi-prepa.html?zone=inexistante"); await q.setInputFiles("#imp", path.join(OUT, "prepa.json"));
 await q.waitForFunction(() => typeof ST !== "undefined" && ST.scen.length === 2 && typeof RS !== "undefined" && RS && RS.axes.length >= 2, null, T_MAP); T.ok(true, "réimport du .json");
 T.ok(p.erreurs.length + q.erreurs.length === 0, "aucune erreur de script"); await ctx.close(); });

/* ---------- 3. conduite : contact, zones à survoler, ennemi connu ou inconnu, export ---------- */
test("conduite : contact, zones à survoler, export (PC)", async T => {
 const ctx = await contexte(T, false), p = await page(ctx, T);
 await p.goto(T.base + "ennemi-conduite.html"); await p.click("#demoBtn"); await terrainOuvert(p); await prets(p); await p.waitForTimeout(1000);
 await p.click('#tools button[data-t=contact]'); await p.mouse.click(...await px(p, 0.5, 0.45)); await p.waitForTimeout(300);
 await p.fill(".pf [data-v]", "2"); await p.fill(".pf [data-h]", "14:00"); await p.click(".pf [data-ok]"); await p.waitForTimeout(1800);
 const z = await p.evaluate(() => RS.zones.map(z => [z.niveau, z.part]));
 T.ok(z.length >= 3 && z.every(x => ["forte", "moyenne", "faible"].includes(x[0])), "zones à survoler avec niveau (" + z.length + ")");
 T.ok(z[0][1] >= z[z.length - 1][1], "zones classées par priorité");
 await p.evaluate(() => { const r = document.getElementById("clockR"); r.value = +r.min + 40; r.dispatchEvent(new Event("input")); }); await p.waitForTimeout(800);
 T.ok(await p.evaluate(() => RS.tc === 40), "le temps écoulé élargit la carte");
 await p.click("#mArret"); await p.waitForTimeout(800); T.ok(await p.evaluate(() => RS.zones.length > 0 && !ST.mouv), "mode à l'arrêt");
 await p.click(".tabs button[data-tab=res]"); const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#exp")]); await dl.saveAs(path.join(OUT, "conduite.json"));
 T.ok(JSON.parse(fs.readFileSync(path.join(OUT, "conduite.json"), "utf8")).zones_a_survoler.length >= 3, "export .json");
 T.ok(p.erreurs.length === 0, "aucune erreur de script"); await ctx.close(); });

/* ---------- 4. navigation téléphone : barre du bas, feuille courte, pastilles ---------- */
test("téléphone : barre d'onglets, feuille, pastilles", async T => {
 const ctx = await contexte(T, true);
 for (const [f, cles] of [["index", ["zone", "carte", "outil", "synth"]], ["ennemi-prepa", ["terr", "prep", "res", "aff"]], ["ennemi-conduite", ["terr", "cont", "res", "aff"]], ["implantation", ["terr", "reg", "res", "aff"]]]) {
  const p = await page(ctx, T); await p.goto(T.base + f + ".html"); await p.waitForTimeout(1800);
  T.ok(JSON.stringify(await p.evaluate(() => [...document.querySelectorAll("#navBar button")].map(b => b.dataset.k))) === JSON.stringify(cles), f + " : 4 onglets");
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
test("zone courante, travail conservé, reprise de la prépa", async T => {
 const ctx = await contexte(T, true); let p = await page(ctx, T);
 await p.goto(T.base + "index.html"); await p.waitForTimeout(1500); await p.setInputFiles("#imp", DEMO);
 await p.waitForFunction(() => /Zone «.*chargée/.test(document.getElementById("status").textContent), null, T_MAP); await p.waitForTimeout(2500);
 const zid = await p.evaluate(() => localStorage.getItem("terrain-gtia-zone-courante")); T.ok(!!zid && zid === await p.evaluate(() => G.id), "la zone courante est mémorisée"); await p.close();
 p = await page(ctx, T); await p.goto(T.base + "ennemi-prepa.html"); await terrainOuvert(p); T.ok(true, "la prépa ouvre seule la zone courante");
 await prets(p); await p.waitForTimeout(800); await p.tap('#tools button[data-t=depart]'); await p.touchscreen.tap(...await px(p, 0.15, 0.4));
 await p.tap('#tools button[data-t=objectifs]'); await p.touchscreen.tap(...await px(p, 0.85, 0.7)); await p.waitForTimeout(3500); await p.close();
 p = await page(ctx, T); await p.goto(T.base + "ennemi-prepa.html"); await p.waitForFunction(() => typeof RS !== "undefined" && RS && RS.axes.length >= 2, null, T_MAP);
 T.ok(await p.evaluate(() => !!cur().depart && cur().objectifs.length === 1), "la prépa retrouve son travail"); await p.close();
 p = await page(ctx, T); await p.goto(T.base + "ennemi-conduite.html"); await terrainOuvert(p); await p.waitForTimeout(1500);
 T.ok(await p.evaluate(() => document.getElementById("fromPrepa").style.display === ""), "la conduite propose de reprendre la prépa");
 p.on("dialog", d => d.accept()); await p.evaluate(() => document.getElementById("fromPrepa").click()); await p.waitForTimeout(3500);
 T.ok(await p.evaluate(() => SCN.length === 1 && ST.enemy.mode === "connu"), "scénarios de la prépa repris sans fichier"); await p.close();
 p = await page(ctx, T); await p.goto(T.base + "index.html"); await p.waitForTimeout(6000);
 T.ok(await p.evaluate(() => typeof G !== "undefined" && !!G), "l'outil terrain rouvre la zone courante");
 const q = await ctx.newPage(); await q.goto(T.base + "ennemi.html?zone=abc"); await q.waitForTimeout(1500); T.ok(/ennemi-prepa\.html\?zone=abc/.test(q.url()), "ennemi.html redirige vers la prépa");
 await ctx.close(); });

/* ---------- 7. terrain visible par défaut ; bascule du fond IGN vers OSM ---------- */
test("terrain visible et bascule IGN vers OSM", async T => {
 const ctx = await T.b.newContext({viewport:{width:1500, height:900}}); await ctx.route(/geopf\.fr/, r => r.abort());
 for (const f of ["ennemi-prepa", "ennemi-conduite"]) { const p = await page(ctx, T); await p.goto(T.base + f + ".html"); await p.click("#demoBtn"); await terrainOuvert(p); await prets(p); await p.waitForTimeout(3000);
  T.ok(await p.evaluate(() => map.getLayoutProperty("roads", "visibility") === "visible"), f + " : routes visibles par défaut");
  T.ok(await p.evaluate(() => document.getElementById("base").value) === "osm", f + " : fond IGN indisponible → OSM");
  await p.click("#terBtn"); await p.waitForTimeout(400); T.ok(await p.evaluate(() => map.getLayoutProperty("ter", "visibility") === "visible"), f + " : bouton Terrain"); }
 await ctx.close(); });

/* ---------- 8. implantation : radars (relief synthétique : plaine à 100 m + grosse colline) ---------- */
test("implantation : radars, plan à 2 radars, point testé, reprise", async T => {
 const ctx = await contexte(T, false); await H.brancherRelief(ctx, H.reliefSynthetique({lon0:0.0, lat0:47.26}));
 let p = await page(ctx, T); await p.goto(T.base + "implantation.html"); await prets(p);
 await p.click("#rdLoad"); await p.waitForFunction(() => /Relief chargé|Échec/.test(document.getElementById("status").textContent), null, {timeout:90000});
 T.ok(await p.evaluate(() => !!RD && RD.n === 200), "relief chargé (200 × 200)");
 await p.click("#rdCalc"); await p.waitForFunction(() => /Calcul terminé|Aucun|arrêté/.test(document.getElementById("status").textContent), null, {timeout:150000}); await p.waitForTimeout(1500);
 const r = await p.evaluate(() => { const t = topsRadar(2, 0), t1 = topsRadar(0, 0); const flat = new Float64Array(9); scanAreas(10*200 + 5, RES.radar.p, flat, 0);
  return {n:t.length, a0:t[0] && t[0].area, aLast:t[t.length - 1] && t[t.length - 1].area, z:t[0] && t[0].z, n20:t1.length, flat100:flat[2*3 + 0], pct:t[0] && t[0].pct}; });
 T.ok(r.n >= 3, "au moins 3 emplacements classés (" + r.n + ")"); T.ok(r.a0 >= r.aLast, "classés par surface décroissante");
 T.ok(r.a0 > r.flat100*1.2, "le meilleur site voit nettement plus qu'un site de plaine au coin (" + Math.round(r.a0/1e6) + " contre " + Math.round(r.flat100/1e6) + " km²)");
 T.ok(r.z > 200, "le meilleur site est en hauteur (" + Math.round(r.z) + " m)"); T.ok(r.pct > 0 && r.pct <= 100, "part du disque idéal plausible (" + Math.round(r.pct) + " %)");
 // horizon : à 500 m d'altitude la couverture est supérieure à 50 m
 const hz = await p.evaluate(() => { const t50 = topsRadar(2, 0)[0].area, t500 = topsRadar(2, 1)[0].area; return [t50, t500]; }); T.ok(hz[1] >= hz[0], "plus la cible est haute, plus la couverture est grande");
 await p.click(".tabs button[data-tab=reg]"); await p.selectOption("#rdNb", "2"); await p.waitForFunction(() => /Plan à 2 radars calculé/.test(document.getElementById("status").textContent), null, {timeout:150000});
 const pl = await p.evaluate(() => RES.radar.plan["2,0,2"]); T.ok(pl && pl.length === 2 && pl[1].cumKm2 > pl[0].cumKm2 && pl[1].gainKm2 > 0, "le 2e radar ajoute de la surface nouvelle");
 await p.mouse.click(...await px(p, 0.6, 0.4)); await p.waitForTimeout(800); T.ok(await p.evaluate(() => ST.radar.vue === "test" && !!ST.radar.test), "« Tester ici » place un point testé");
 await p.click(".tabs button[data-tab=res]"); T.ok((await p.evaluate(() => document.querySelectorAll("#resBody table.hor tr").length)) === 4, "tableau 3 radars × 3 altitudes");
 await p.waitForTimeout(1200); await p.close();
 p = await page(ctx, T); await p.goto(T.base + "implantation.html"); await p.waitForFunction(() => typeof RES !== "undefined" && RES.radar && RD, null, T_MAP);
 T.ok(await p.evaluate(() => RES.radar.cands.length > 100 && !!RD.el), "relief et résultats retrouvés après rechargement");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join("|")); await ctx.close(); });

/* ---------- 9. implantation : chars sur la zone de l'outil terrain ---------- */
test("implantation : chars", async T => {
 const ctx = await contexte(T, false), p = await page(ctx, T); await p.goto(T.base + "implantation.html"); await prets(p);
 await p.click("#modeSeg [data-m=char]"); await p.click("#demoBtn"); await terrainOuvert(p); await p.waitForTimeout(1200);
 await p.click(".tabs button[data-tab=reg]"); await p.click("#chCalc"); await p.waitForFunction(() => /Calcul terminé|Aucun|arrêté/.test(document.getElementById("status").textContent), null, {timeout:150000}); await p.waitForTimeout(800);
 const t = await p.evaluate(() => topsChar().map(o => [o.sect, o.surf, o.vmax])); T.ok(t.length >= 3, "au moins 3 emplacements de char (" + t.length + ")");
 T.ok(t.every(o => o[0] >= 30), "secteur utile minimal respecté"); T.ok(t.every(o => o[2] <= 2500 + 1), "la vue ne dépasse pas la portée pratique");
 T.ok(t[0][1] >= t[t.length - 1][1], "classés par surface de tir utile");
 await p.mouse.click(...await px(p, 0.4, 0.5)); await p.waitForTimeout(600); T.ok(await p.evaluate(() => ST.char.vue === "test"), "« Tester ici » mesure un point");
 const copie = await p.evaluate(() => listeTexte()); T.ok(/Emplacement 1/.test(copie), "liste copiable");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join("|")); await ctx.close(); });

/* ---------- 10. application installable et hors ligne ---------- */
test("application : manifeste, icônes et hors ligne", async T => {
 const ctx = await T.b.newContext({...PHONE}); const p = await page(ctx, T); await p.goto(T.base + "app.html");
 await p.evaluate(() => navigator.serviceWorker.ready); await p.waitForTimeout(3500);
 const m = await p.evaluate(async () => { const j = await (await fetch("manifest.webmanifest")).json(); const r = []; for (const i of j.icons) r.push((await fetch(i.src)).status); return {name:j.name, start:j.start_url, r}; });
 T.ok(m.start === "./app.html" && m.r.every(x => x === 200), "manifeste et icônes");
 T.ok(await p.evaluate(() => !!navigator.serviceWorker.controller), "service worker actif");
 T.ok((await p.evaluate(async () => (await (await caches.open((await caches.keys())[0])).keys()).map(r => r.url)))
  .some(u => /implantation\.html/.test(u)), "l'outil Implantation est en cache");
 await ctx.setOffline(true); const q = await page(ctx, T); await q.goto(T.base + "implantation.html"); await q.waitForTimeout(1500);
 T.ok((await q.title()) === "Implantation", "l'outil s'ouvre hors ligne"); await ctx.close(); });

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
