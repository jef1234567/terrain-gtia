/* Tests de bout en bout de l'interface de l'outil Ennemi (ennemi.html), dans Chromium (Playwright), PC et téléphone simulé.
   Lancer :  PLAYWRIGHT_MODULE=/opt/node-tools/node_modules/playwright node tests/ennemi-ui.js [filtre]
   Captures d'écran : /tmp/ennemi-ui/ (à regarder).

   Tourne sur le VRAI moteur (moteur-ennemi.js) et le VRAI rendu (rendu-ennemi.js + rendu-lisse.js), sans moteur simulé, sur
   terrain-demo.json : axes trouvés, horaires (comparés à ME.scenario), ru franchi par le seul chenillé quand son pont est
   coupé dans l'outil Terrain, isochrones de deux contacts à des heures différentes, regroupement, export puis import,
   migration d'un fichier ennemi-prepa-gtia v1 et d'un ennemi-conduite-gtia v1, calcul par étapes sur un grand terrain
   (gel maximal mesuré, bouton « Arrêter »). */
"use strict";
const fs = require("fs"), path = require("path");
const H = require("./helpers.js");
const OUT = "/tmp/ennemi-ui"; fs.mkdirSync(OUT, {recursive:true});
const pw = require(process.env.PLAYWRIGHT_MODULE || "playwright"), PHONE = pw.devices["Pixel 7"];
const DEMO = path.join(H.ROOT, "terrain-demo.json");
const T_MAP = {timeout:60000};
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
const PONT_RU = "pont:@-0.11009,47.24560";

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
function page(ctx, T){ return ctx.newPage().then(p => { p.erreurs = []; p.requetes = []; p.on("pageerror", e => p.erreurs.push(e.message)); p.on("request", r => p.requetes.push(r.url())); T.pages.push(p); return p; }); }
const prets = p => p.waitForFunction(() => typeof mapReady !== "undefined" && mapReady, null, T_MAP);
const terrainOuvert = p => p.waitForFunction(() => /Terrain «|Échec|Travail ouvert|AUTRE terrain|a changé/.test(document.getElementById("status").textContent) && typeof G !== "undefined" && G && !CHARGE, null, T_MAP);
const px = (p, u, v) => p.evaluate(([u, v]) => { const b = G.b, q = map.project([b.w + (b.e - b.w)*u, b.n - (b.n - b.s)*v]); return [q.x, q.y]; }, [u, v]);
// pixel écran du centre de la maille (i, j)
const pxM = (p, i, j) => p.evaluate(([i, j]) => { const q = map.project(cellLL(j*G.n + i)); return [q.x, q.y]; }, [i, j]);
const touche = (p, phone, xy) => phone ? p.touchscreen.tap(...xy) : p.mouse.click(...xy);
const capture = (p, nom) => p.screenshot({path:path.join(OUT, nom + ".png")});
const outil = (p, phone, t) => phone ? p.tap(`#tools button[data-t=${t}]`) : p.click(`#tools button[data-t=${t}]`);
// fin des calculs du moteur (demandés et en cours) puis rendu
const calcule = async p => { await p.waitForTimeout(60); await p.waitForFunction(() => typeof calmeEnnemi === "function" && calmeEnnemi(), null, {timeout:120000}); await p.waitForTimeout(150); };
// aucune coordonnée décimale à l'écran (degrés à 4 décimales ou plus)
const DECIMAL = /-?\b\d{1,3}[.,]\d{4,}\b/;
const texteVisible = p => p.evaluate(() => document.body.innerText);
async function ouvrirDemo(p, phone){ if (phone) await p.evaluate(() => document.getElementById("demoBtn").click()); else await p.click("#demoBtn"); await terrainOuvert(p); await prets(p); await calcule(p); }
const telecharger = async (p, sel, nom) => { const [dl] = await Promise.all([p.waitForEvent("download", {timeout:120000}), p.click(sel)]); const f = path.join(OUT, nom); await dl.saveAs(f); return f; };
// rectangle (écran) de la légende et objets clés qu'elle recouvre
const legendeCouvre = p => p.evaluate(() => { const d = document.getElementById("reLeg"); if (!d || d.style.display === "none") return {aucune:true, cache:[]};
 const r = d.getBoundingClientRect(), mr = map.getContainer().getBoundingClientRect(), pts = [];
 const S = ET.planification.scenarios.find(s => s.id === UI.sc); if (MODE === "planification" && S) S.unites.forEach(u => { if (u.depart) pts.push(["départ", u.depart]); u.objectifs.forEach(o => pts.push(["objectif", o])); });
 if (MODE === "conduite") ET.conduite.contacts.forEach(c => pts.push(["contact", c.lonlat]));
 ET.nos_positions.forEach(a => pts.push(["nos positions", a.lonlat]));
 const cache = pts.filter(([, ll]) => { const q = map.project(ll), x = q.x + mr.left, y = q.y + mr.top; return x > r.left - 6 && x < r.right + 6 && y > r.top - 6 && y < r.bottom + 6; }).map(x => x[0]);
 return {replie:d.classList.contains("re-replie"), coin:d.dataset.coin, cache, h:r.height}; });

/* ---------- 1. ouverture, modes, aucun GPS, aucune coordonnée décimale ---------- */
for (const phone of [false, true]) test("ouverture, bascule de mode, aucun GPS (" + (phone ? "téléphone" : "PC") + ")", async T => {
 const ctx = await contexte(T, phone); const p = await page(ctx, T);
 await p.goto(T.base + "ennemi.html"); await prets(p);
 T.ok(/DOCTRINE FICTIVE/.test(await p.textContent("#panel h1")) && /FICTIF/.test(await p.textContent("#gear")), "doctrine fictive bien visible (titre et bouton)");
 T.ok(await p.evaluate(() => typeof window.__MOTEUR_SIMULE === "undefined" && typeof RT === "object" && typeof plusFort === "undefined" && typeof renderOv === "undefined"), "moteur et rendu réels ; rendu lissé par rendu-lisse.js (une seule globale RT, pas les fonctions de l'outil Terrain)");
 T.ok(!p.requetes.some(u => /rendu-terrain\.js/.test(u)), "rendu-terrain.js n'est jamais chargé (ni par script, ni par fetch)");
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

/* ---------- 2. planification : plusieurs unités, axes et horaires RÉELS, regroupements, horloge, annulation, glisser, légende, export ---------- */
test("planification : unités, axes, horaires, annulation, export (PC)", async T => {
 const ctx = await contexte(T, false); const p = await page(ctx, T);
 await p.goto(T.base + "ennemi.html?mode=planification"); await prets(p); await ouvrirDemo(p, false);
 await outil(p, false, "dep"); await p.mouse.click(...await pxM(p, 12, 30)); await p.waitForTimeout(200);
 T.ok(await p.evaluate(() => UI.tool === "obj"), "après le départ, l'outil passe à « Objectif »");
 await p.mouse.click(...await pxM(p, 85, 70)); await calcule(p);
 // deuxième unité (escadron de chars)
 await p.selectOption("#uAddType", "esc-chars"); await p.click("#uAdd");
 await p.mouse.click(...await pxM(p, 15, 50)); await p.mouse.click(...await pxM(p, 80, 35)); await p.waitForTimeout(200);
 await outil(p, false, "ami"); await p.mouse.click(...await pxM(p, 60, 20)); await calcule(p);
 const st = await p.evaluate(() => ({n:curSc().unites.length, ok:curSc().unites.every(u => u.depart && u.objectifs.length === 1), amis:ET.nos_positions.length, cl:curSc().unites.map(u => u.classe)}));
 T.ok(st.n === 2 && st.ok && st.amis === 1, "2 unités dans le scénario, départs et objectifs posés, 1 position amie");
 T.ok(st.cl.every(c => ["chenille", "roue", "logistique", "fantassin"].includes(c)), "classes de la doctrine (" + st.cl.join(", ") + ")");
 // résultats du moteur réel : identiques à ME.scenario (axes, axe choisi, horaires avec arrêts, regroupements)
 const cmp = await p.evaluate(() => { const s = curSc(), x = ME.scenario(s, {doctrine:D, amis:amis()}), out = [];
  for (const u of s.unites) { const a = RP.unites[u.id], b = x.par_unite[u.id];
   out.push({u:u.nom, axes:a.axes.map(z => z.genre + "/" + z.plausibilite).join(","), axesRef:b.axes.map(z => z.genre + "/" + z.plausibilite).join(","), noeuds:JSON.stringify(a.axes.map(z => z.noeuds)) === JSON.stringify(b.axes.map(z => z.noeuds)),
    choisi:a.choisi && a.choisi.genre, choisiRef:b.axe_choisi, arr:a.hor && a.hor.arrivee_min, arrRef:b.horaires.arrivee_min, jal:a.hor && a.hor.jalons.length, jalRef:b.horaires.jalons.length,
    reg:a.reg.length, regRef:b.regroupements.length, h0:a.ue.heure_depart_min, longueur:a.choisi && a.choisi.longueur_km}); }
  return out; });
 for (const c of cmp) {
  T.ok(c.axes && c.axes === c.axesRef && c.noeuds, `${c.u} : axes du moteur réel (${c.axes}), mêmes nœuds que ME.scenario`);
  T.ok(c.choisi === c.choisiRef && c.arr === c.arrRef && c.jal === c.jalRef && c.jal >= 2, `${c.u} : horaires = ME.scenario (arrivée ${Math.round(c.arr)} min, ${c.jal} jalons, ${c.longueur && c.longueur.toFixed(1)} km)`);
  T.ok(c.arr > c.h0 && c.reg === c.regRef, `${c.u} : arrivée après le départ, ${c.reg} zone(s) de regroupement comme ME.scenario`);
 }
 await p.click(".tabs button[data-tab=res]"); await p.waitForTimeout(300);
 const nAxes = await p.locator("#resPlan [data-axe]").count();
 T.ok(nAxes >= 2, "axes en cartes cliquables (" + nAxes + ")");
 T.ok(await p.locator("#resPlan .lvl").count() >= 2, "plausibilité affichée");
 T.ok(await p.locator("#resPlan tr[data-j]").count() >= 2, "horaires par jalon");
 const h1 = await p.evaluate(() => { const r = RP.unites[curSc().unites[0].id]; return [hmj(r.hor.jalons[1].heure_min), r.hor.jalons.length]; });
 T.ok((await p.textContent("#resPlan")).includes(h1[0]), "le tableau affiche l'heure calculée du 2e jalon (" + h1[0] + ")");
 T.ok(/Par tronçon/.test(await p.textContent("#resPlan")), "horaires par tronçon");
 const nReg = await p.evaluate(() => Object.values(RP.unites).reduce((a, r) => a + r.reg.length, 0));
 T.ok(await p.locator("#resPlan [data-reg]").count() === nReg && nReg >= 1, "zones de regroupement du moteur (mode attaque) : " + nReg);
 T.ok(await p.evaluate(() => map.querySourceFeatures("en-axes").length > 0 && map.querySourceFeatures("en-horaires").length > 0), "axes et jalons dessinés sur la carte (rendu réel)");
 // choisir un autre axe de la 1re unité
 const g = await p.evaluate(() => { const u = curSc().unites[0], r = RP.unites[u.id], a = r.axes.find(x => x !== r.choisi); return a ? u.id + "|" + a.genre : null; });
 T.ok(!!g, "la 1re unité a plusieurs axes : un autre axe peut être choisi (" + g + ")");
 if (g) { await p.click(`#resPlan [data-axe="${g}"]`); await calcule(p);
  T.ok(await p.evaluate(g => { const [u, ge] = g.split("|"); return curSc().axe_choisi[u] === ge && RP.unites[u].choisi.genre === ge && !!RP.unites[u].hor; }, g), "axe choisi par clic (" + g.split("|")[1] + "), horaires recalculés"); }
 // horloge : position des colonnes (ME.positionSurAxe, heure absolue)
 T.ok(await p.isVisible("#clock"), "curseur d'heure affiché");
 const pos = await p.evaluate(() => { const r = document.getElementById("clockR"), u = curSc().unites[0], x = RP.unites[u.id];
  const t = Math.round(x.ue.heure_depart_min + (x.hor.arrivee_min - x.ue.heure_depart_min)/2); r.value = t; r.dispatchEvent(new Event("input"));
  const ref = ME.positionSurAxe(x.choisi, x.ue, t, {doctrine:D, regroupement:x.reg[0] || null});
  return {t, ref:ref && ref.d_tete_km, txt:document.getElementById("clockInfo").textContent}; });
 pos.col = await p.waitForFunction(() => map.querySourceFeatures("en-colonne").length, null, {timeout:5000}).then(h => h.jsonValue()).catch(() => 0);
 T.ok(pos.ref > 0 && pos.txt.includes(pos.ref.toLocaleString("fr-FR", {maximumFractionDigits:1})) && pos.col > 0, "curseur d'heure à mi-parcours : tête à " + (pos.ref || 0).toFixed(1) + " km (ME.positionSurAxe), colonne dessinée");
 // glisser le départ de l'unité 2
 const avant = await p.evaluate(() => curSc().unites[1].depart.slice());
 const [x0, y0] = await p.evaluate(() => { const q = map.project(curSc().unites[1].depart); return [q.x, q.y]; });
 await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move(x0 + 30, y0 - 20, {steps:6}); await p.mouse.up(); await calcule(p);
 const apres = await p.evaluate(() => curSc().unites[1].depart.slice());
 T.ok(Math.abs(apres[0] - avant[0]) > 1e-4, "un départ se déplace en le faisant glisser");
 await p.keyboard.press("Control+z"); await calcule(p);
 T.ok(await p.evaluate(a => { const d = curSc().unites[1].depart; return Math.abs(d[0] - a[0]) < 1e-9 && Math.abs(d[1] - a[1]) < 1e-9; }, avant), "Ctrl+Z annule le déplacement");
 if (g) { await p.click("#undoBtn"); await calcule(p); T.ok(await p.evaluate(() => Object.keys(curSc().axe_choisi).length === 0), "« Annuler » annule le choix d'axe");
  await p.click("#redoBtn"); await calcule(p); T.ok(await p.evaluate(() => Object.keys(curSc().axe_choisi).length === 1), "« Rétablir »"); }
 // légende : ne recouvre aucun départ, objectif ni position ; repliable
 const lg = await legendeCouvre(p);
 T.ok(lg.aucune || lg.replie || lg.cache.length === 0, "la légende ne cache aucun départ, objectif ni position (" + JSON.stringify(lg) + ")");
 await p.click("#reLeg .re-tete"); const lg2 = await legendeCouvre(p);
 await p.click("#reLeg .re-tete"); const lg3 = await legendeCouvre(p);
 T.ok(lg2.replie !== lg3.replie && (lg2.replie ? lg2.h < 40 : lg3.h < 40), "légende repliable par son bouton (" + lg2.h + " / " + lg3.h + " px)");
 await p.evaluate(() => RE.replierLegende(map, null));
 // clic sur un symbole : fiche, pas de nouveau point
 await p.evaluate(() => map.fitBounds([[G.b.w, G.b.s], [G.b.e, G.b.n]], {padding:CE.fitPad(), duration:0})); await p.waitForTimeout(300);
 const [xo, yo] = await p.evaluate(() => { const q = map.project(curSc().unites[0].objectifs[0]); return [q.x, q.y]; });
 await outil(p, false, "obj"); await p.mouse.click(xo, yo); await p.waitForTimeout(400);
 T.ok(await p.evaluate(() => curSc().unites[0].objectifs.length === 1 && /Objectif 1/.test((document.querySelector(".maplibregl-popup-content") || {}).textContent || "")), "toucher un symbole ouvre sa fiche (pas de nouvel objectif)");
 await p.keyboard.press("Escape");
 // scénarios : copier, renommer, supprimer
 await p.click(".tabs button[data-tab=sai]"); await p.click("#scDup"); await calcule(p);
 T.ok(await p.evaluate(() => ET.planification.scenarios.length === 2 && curSc().unites.length === 2 && curSc().unites[0].id !== ET.planification.scenarios[0].unites[0].id), "scénario copié avec ses unités");
 await p.fill("#scNom", "Hypothèse nord"); await p.press("#scNom", "Tab"); await p.selectOption("#scMode", "reco"); await calcule(p);
 T.ok(await p.evaluate(() => curSc().nom === "Hypothèse nord" && curSc().mode_action === "reco" && Object.values(RP.unites).every(r => r.ue.mode === "reco")), "nom et mode d'action du scénario (recalcul en reconnaissance)");
 p.once("dialog", d => d.accept()); await p.click("#scDel"); await calcule(p);
 T.ok(await p.evaluate(() => ET.planification.scenarios.length === 1), "scénario supprimé");
 // copie des horaires
 await p.click(".tabs button[data-tab=res]"); await p.click("#copyH"); await p.waitForTimeout(300);
 const txt = await p.evaluate(() => window.__dernierTexte || "");
 T.ok(/\d{2}:\d{2}/.test(txt) && /\d{2}[A-Z] [A-Z]{2} \d{5} \d{5}/.test(txt) && !DECIMAL.test(txt), "horaires copiés, MGRS, sans coordonnée décimale");
 T.ok(!DECIMAL.test(await texteVisible(p)), "aucune coordonnée décimale à l'écran");
 T.ok(await p.evaluate(() => !map.listImages().some(i => /\d+[.,]\d{4,}/.test(i))), "aucune coordonnée décimale dans les étiquettes de la carte");
 await capture(p, "planification-pc");
 // export .json v3 (ME.exporter, résultats joints) et KML
 const f = await telecharger(p, "#exp", "ennemi-export.json"), j = JSON.parse(fs.readFileSync(f, "utf8"));
 T.ok(j.format === "ennemi-gtia" && j.version === 3 && j.terrain && /^e[0-9a-f]{8}$/.test(j.terrain.empreinte) && j.terrain.id === "f1r08s1r", "export ennemi-gtia v3 avec référence au terrain (id + empreinte)");
 T.ok(!j.faits && !(j.terrain && j.terrain.faits), "le terrain n'est pas inclus");
 T.ok(j.planification.scenarios[0].unites.length === 2 && j.nos_positions.length === 1, "export : 2 unités, nos positions");
 const sid = j.planification.scenarios[0].id, uid = j.planification.scenarios[0].unites[0].id;
 T.ok(j.resultats && j.resultats.axes[sid][uid].length >= 1 && j.resultats.horaires[sid][uid].jalons.length >= 2, "export : résultats du moteur joints (axes, horaires)");
 const fk = await telecharger(p, "#kmlBtn", "ennemi-export.kml"), k = fs.readFileSync(fk, "utf8");
 T.ok(/<kml/.test(k) && /<name>Axes<\/name>/.test(k) && /<name>Jalons et horaires<\/name>/.test(k) && !/NaN|undefined|Infinity/.test(k), "export KML (axes, jalons ; ni NaN ni undefined)");
 // rechargement : travail retrouvé
 await p.waitForTimeout(900); await p.reload(); await terrainOuvert(p); await calcule(p);
 T.ok(await p.evaluate(() => curSc().unites.length === 2 && ET.nos_positions.length === 1 && /Travail repris/.test(document.getElementById("status").textContent)), "travail retrouvé après rechargement (IndexedDB)");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | ")); await ctx.close(); });

/* ---------- 3. conduite : contacts horodatés, isochrones RÉELLES de deux contacts à des heures différentes, zones, copie ---------- */
test("conduite : contacts, ennemi connu et inconnu, zones à survoler (PC)", async T => {
 const ctx = await contexte(T, false); const p = await page(ctx, T);
 await p.goto(T.base + "ennemi.html?mode=planification"); await prets(p); await ouvrirDemo(p, false);
 await outil(p, false, "dep"); await p.mouse.click(...await pxM(p, 10, 40)); await p.mouse.click(...await pxM(p, 90, 60)); await calcule(p);
 await p.click("#modeSeg [data-m=conduite]"); await calcule(p);
 T.ok(await p.isVisible("#clockNow"), "bouton « Maintenant »");
 await p.fill("#cHeure", "14:00"); await p.press("#cHeure", "Tab"); await p.waitForTimeout(200);
 await outil(p, false, "con"); await p.mouse.click(...await pxM(p, 45, 45)); await p.waitForTimeout(300);
 await p.selectOption(".pf [data-u]", "+roue"); await p.fill(".pf [data-h]", "13:40"); await p.fill(".pf [data-v]", "2"); await p.fill(".pf [data-n]", "2 VBR vers l'est"); await p.click(".pf [data-ok]"); await calcule(p);
 await p.mouse.click(...await pxM(p, 55, 50)); await p.waitForTimeout(300); await p.fill(".pf [data-h]", "13:55"); await p.fill(".pf [data-v]", "3"); await p.click(".pf [data-ok]"); await calcule(p);
 const c = await p.evaluate(() => ({u:ET.conduite.unites.length, cl:ET.conduite.unites[0].classe, n:ET.conduite.contacts.length, meme:new Set(ET.conduite.contacts.map(c => c.unite)).size, h:ET.conduite.contacts.map(c => c.heure)}));
 T.ok(c.u === 1 && c.cl === "roue" && c.n === 2 && c.meme === 1, "deux contacts horodatés de la même unité inconnue (roue) " + c.h.join(", "));
 // isochrones du moteur réel : deux contacts à des heures différentes (un seul search multi-sources, départs décalés)
 const iso = await p.evaluate(() => { const A = RC.iso.arrivee_min, cs = RC.contacts, at = x => A[cellAt({lng:x.lonlat[0], lat:x.lonlat[1]})];
  const ref = ME.isochrones(cs, RC.unites, RC.t, {doctrine:D, delais:D.isochrones_min.conduite});
  let egal = ref.arrivee_min.length === A.length; for (let k = 0; egal && k < A.length; k++) if (!Object.is(ref.arrivee_min[k], A[k])) egal = false;
  const seul = ME.isochrones([cs[1]], RC.unites, RC.t, {doctrine:D}).arrivee_min; let plusTot = 0; for (let k = 0; k < A.length; k++) if (A[k] < seul[k] - 1e-6) plusTot++;
  return {a1:at(cs[0]), a2:at(cs[1]), h1:cs[0].heure_min, h2:cs[1].heure_min, t:RC.t, egal, plusTot, delais:RC.iso.delais, lignes:map.querySourceFeatures("en-iso").length,
   et:[...new Set(map.querySourceFeatures("en-iso-et").map(f => f.properties.d))].sort((a, b) => a - b)}; });
 T.ok(iso.egal, "isochrones de l'interface = ME.isochrones (même tableau d'heures d'arrivée)");
 T.ok(Math.abs(iso.a1 - iso.h1) < 0.01 && iso.a2 <= iso.h2 + 0.01, `heure d'arrivée au plus tôt : ${hm(iso.a1)} au 1er contact (13:40), ${hm(iso.a2)} au 2e (≤ 13:55)`);
 T.ok(iso.plusTot > 0, "le contact de 13:40 compte aussi : " + iso.plusTot + " mailles atteintes plus tôt qu'avec le seul contact de 13:55");
 T.ok(iso.lignes > 0 && JSON.stringify(iso.et) === JSON.stringify(iso.delais), "lignes T+" + iso.et.join(", T+") + " dessinées et étiquetées");
 // étiquettes T+x : chacune SUR sa ligne (contour du moteur), sur le front extérieur (pas sur un trou intérieur près des contacts)
 const etq = await p.evaluate(() => { const E = map.getSource("en-iso-et")._data.features, A = RC.iso.arrivee_min, N = G.n*G.n, out = [];
  let mn = Infinity; for (let c = 0; c < N; c++) if (A[c] < mn) mn = A[c];
  const org = (() => { let x = 0, y = 0, m = 0; for (let c = 0; c < N; c++) if (A[c] <= mn + 1e-6) { x += c % G.n; y += (c/G.n) | 0; m++; } return cellLL(Math.round(y/m)*G.n + Math.round(x/m)); })();
  for (const d of RC.iso.delais) { const e = E.find(f => f.properties.d === d); if (!e) { out.push({d, absent:true}); continue; }
   const m = new Uint8Array(N); for (let c = 0; c < N; c++) if (A[c] <= RC.t + d) m[c] = 1;
   const pts = RT.contours(m, G.n, G.b).flat(), dl = Math.min(...pts.map(q => distM(q, e.geometry.coordinates))), dd = pts.map(q => distM(q, org)).sort((a, b) => a - b);
   out.push({d, surLigne:Math.round(dl), dist:Math.round(distM(e.geometry.coordinates, org)), mediane:Math.round(dd[dd.length >> 1])}); }
  return out; });
 T.ok(etq.every(x => !x.absent && x.surLigne < 1 && x.dist >= x.mediane), "étiquettes T+x sur leur ligne et au front : " + JSON.stringify(etq));
 await p.click(".tabs button[data-tab=res]"); await p.waitForTimeout(300);
 const nz = await p.locator("#resCond [data-z]").count(); T.ok(nz >= 1 && nz === await p.evaluate(() => RC.pres.zones.length), "zones à survoler du moteur en cartes (" + nz + ")");
 T.ok(await p.evaluate(() => RC.pres.par_unite[RC.unites[0].id].vus === 3 && RC.pres.par_unite[RC.unites[0].id].dernier_contact_min === mins("13:55")), "présence : dernier contact 13:55, 3 éléments vus retirés");
 await p.evaluate(() => { const r = document.getElementById("clockR"); r.value = 30; r.dispatchEvent(new Event("input")); }); await calcule(p);
 T.ok(await p.evaluate(() => RC.t === mins("14:00") + 30 && RC.iso.heure_min === RC.t && /T\+30/.test(document.getElementById("clockT").textContent)), "curseur T+x (T+30 min) : recalcul à 14:30");
 await p.click(".tabs button[data-tab=sai]"); await p.click("#mArret"); await calcule(p);
 T.ok(await p.evaluate(() => ET.conduite.unites[0].en_mouvement === false && RC.unites[0].en_mouvement === false), "à l'arrêt");
 // ennemi connu (unité du scénario de planification) et scénario repère
 await p.click("#cAddCon"); await calcule(p);
 T.ok(await p.evaluate(() => ET.conduite.unites.length === 2 && !!ET.conduite.unites[1].scenario_ref && UI.repere === ET.planification.scenarios[0].id), "ennemi connu ajouté (repère : son scénario)");
 T.ok(await p.evaluate(() => RC.repere.length === 1 && map.querySourceFeatures("en-axes").length > 0), "axe du scénario repère dessiné");
 await p.mouse.click(...await pxM(p, 30, 42)); await p.waitForTimeout(300); await p.click(".pf [data-ok]"); await calcule(p);
 T.ok(await p.evaluate(() => ET.conduite.contacts.filter(c => c.unite === ET.conduite.unites[1].id).length === 1), "contact rattaché à l'ennemi connu");
 await p.click(".tabs button[data-tab=res]"); await p.click("#copyZ"); await p.waitForTimeout(300);
 const t = await p.evaluate(() => window.__dernierTexte || "");
 T.ok(/^Zones à survoler/.test(t) && /\d{2}[A-Z] [A-Z]{2} \d{5} \d{5}/.test(t) && /rayon \d+ m/.test(t) && !DECIMAL.test(t), "liste ordonnée copiable (MGRS, rayon)");
 T.ok(!DECIMAL.test(await texteVisible(p)), "aucune coordonnée décimale à l'écran");
 const lg = await legendeCouvre(p); T.ok(lg.aucune || lg.replie || lg.cache.length === 0, "la légende ne cache aucun contact (" + JSON.stringify(lg) + ")");
 // annulation d'un contact
 const n0 = await p.evaluate(() => ET.conduite.contacts.length); await p.keyboard.press("Control+z"); await calcule(p);
 T.ok(await p.evaluate(() => ET.conduite.contacts.length) === n0 - 1, "Ctrl+Z annule la pose du contact");
 await capture(p, "conduite-pc");
 const f = await telecharger(p, "#exp", "ennemi-conduite-export.json"), j = JSON.parse(fs.readFileSync(f, "utf8"));
 T.ok(j.conduite.contacts.length === n0 - 1 && j.conduite.unites.length === 2 && j.conduite.heure === "14:00", "export : unités et contacts de conduite");
 T.ok(Array.isArray(j.resultats.zones_a_survoler) && j.resultats.zones_a_survoler.length >= 1, "export : zones à survoler recalculées et jointes");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | ")); await ctx.close(); });
const hm = m => String(Math.floor(((Math.round(m) % 1440) + 1440) % 1440/60)).padStart(2, "0") + ":" + String(((Math.round(m) % 60) + 60) % 60).padStart(2, "0");

/* ---------- 4. doctrine : tiroir, surcharge, refus, retour à la référence ---------- */
test("doctrine : formulaire, JSON, surcharge enregistrée, retour à la référence (PC)", async T => {
 const ctx = await contexte(T, false); const p = await page(ctx, T);
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
 // glossaire : délais des isochrones et rayon des zones lus dans la doctrine en vigueur (jamais recopiés), un seul terme pour l'axe discret
 await p.evaluate(() => { const d = JSON.parse(document.getElementById("dJson").value); d.isochrones_min.conduite = [7, 14, 28]; d.zones_a_survoler.rayon_m = 350; document.getElementById("dJson").value = JSON.stringify(d); });
 await p.click("#dApply"); await p.waitForTimeout(300); await p.click("#drawerClose"); await p.click("#glossBtn");
 const gl = await p.textContent("#gloss");
 T.ok(/7, 14, 28 minutes/.test(gl) && /Cercle de 350 m de rayon/.test(gl) && !/5, 10, 20, 40/.test(gl), "glossaire : isochrones « 7, 14, 28 minutes » et rayon 350 m lus dans la doctrine modifiée");
 T.ok(/le plus discret/.test(gl) && !/plus sûr/.test(gl) && /Gué/.test(gl), "glossaire : « le plus discret » (jamais « le plus sûr »), entrée Gué");
 await p.click("#modalClose");
 await p.evaluate(() => { const d = JSON.parse(document.getElementById("dJson").value); d.isochrones_min.conduite = DOCTRINE.isochrones_min.conduite; d.zones_a_survoler.rayon_m = DOCTRINE.zones_a_survoler.rayon_m; document.getElementById("dJson").value = JSON.stringify(d); });
 await p.click("#gear"); await p.click("#dApply"); await p.waitForTimeout(300);
 await capture(p, "doctrine-pc");
 await p.reload(); await terrainOuvert(p); T.ok(await p.evaluate(() => D.vitesses_pct.chenille.attaque === 45 && D.seuils.forte_pct === 40), "surcharge reprise au rechargement");
 await p.click("#gear"); await p.click("#dReset"); await p.waitForTimeout(300);
 T.ok(await p.evaluate(() => SURCH === null && D.vitesses_pct.chenille.attaque === DOCTRINE.vitesses_pct.chenille.attaque && !localStorage.getItem("ennemi-gtia-doctrine-surcharge")), "retour à la doctrine de référence");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | ")); await ctx.close(); });

/* ---------- 5. import : anciens fichiers v1 (prépa, conduite), fichier v3, autre terrain, terrain modifié ---------- */
function fichierPrepaV1(){
 const terr = JSON.parse(fs.readFileSync(DEMO, "utf8")), b = terr.faits.bbox, P = (u, v) => [b.w + (b.e - b.w)*u, b.n - (b.n - b.s)*v];
 return {format:"ennemi-prepa-gtia", version:1, nom:terr.nom, date:"18/10/2026 10:00", note:"fichier v1 fabriqué par le test",
  doctrine:{modeles:[], types:{meca:{vitesse_tactique_pct:50}, moto:{vitesse_tactique_pct:60}, pied:{vitesse_tactique_pct:80}}},
  saisies:{scen:[{id:1, nom:"Scénario ancien", ennemi:{nom:"Compagnie mécanisée", type:"meca", nb:13, front_km:1.5, prof_km:1, dispersion_min:15}, depart:P(0.1, 0.5), objectifs:[P(0.9, 0.5)], h0:"05:30", axe:null, t:null},
                {id:2, nom:"Scénario à pied", ennemi:{nom:"Compagnie à pied", type:"pied", nb:9, front_km:1, prof_km:0.8, dispersion_min:15}, depart:P(0.2, 0.2), objectifs:[P(0.7, 0.8)], h0:"07:00", axe:null, t:null}],
           cur:1, amis:[{ll:P(0.6, 0.3)}]},
  scenarios:[], terrain:terr};
}
function fichierConduiteV1(){
 const terr = JSON.parse(fs.readFileSync(DEMO, "utf8")), b = terr.faits.bbox, P = (u, v) => [b.w + (b.e - b.w)*u, b.n - (b.n - b.s)*v];
 const cST = {contacts:[{id:1, ll:P(0.45, 0.45), vus:2, h:"07:10"}, {id:2, ll:P(0.55, 0.5), vus:3, h:"07:25"}], heure:null, enemy:{mode:"inconnu", type:"moto", scen:0}, mouv:true, amis:[{ll:P(0.3, 0.2)}]};
 return {format:"ennemi-conduite-gtia", version:1, nom:terr.nom, date:"18/10/2026 11:00", note:"fichier v1 fabriqué par le test", doctrine:{},
  ennemi:{nom:"Ennemi inconnu (véhicules à roues)", type:"moto", nb:12, connu:false}, en_mouvement:true, saisies:cST, scenarios_prepa:[], terrain:terr, contacts:cST.contacts, heure_calcul:"07:25", zones_a_survoler:[{rang:1}]};
}
test("import : ancien fichier v1, fichier v3, autre terrain, terrain modifié (PC)", async T => {
 const v1 = path.join(OUT, "prepa-v1.json"); fs.writeFileSync(v1, JSON.stringify(fichierPrepaV1()));
 const ctx = await contexte(T, false); const p = await page(ctx, T);
 await p.goto(T.base + "ennemi.html"); await prets(p); await p.waitForTimeout(500);
 await p.setInputFiles("#imp", v1); await terrainOuvert(p); await calcule(p);
 const r = await p.evaluate(() => ({n:ET.planification.scenarios.length, cl:ET.planification.scenarios.map(s => s.unites[0].classe), h:ET.planification.scenarios[0].heure_depart, amis:ET.nos_positions.length, g:G && G.id, st:document.getElementById("status").textContent}));
 T.ok(r.g === "f1r08s1r", "le terrain inclus dans l'ancien fichier est ouvert");
 T.ok(r.n === 2 && r.cl[0] === "chenille" && r.cl[1] === "fantassin" && r.h === "05:30" && r.amis === 1, "ancien fichier prépa converti par ME.migrer : 2 scénarios, méca → chenillé, pied → fantassin, heure, nos positions (" + r.cl.join(", ") + ")");
 T.ok(/converti/.test(r.st), "message : ancien fichier converti (" + r.st.slice(0, 90) + ")");
 T.ok(await p.evaluate(() => JSON.stringify(D.vitesses_pct.chenille.attaque) === "50"), "vitesse tactique v1 reprise (méca 50 %)");
 await p.click(".tabs button[data-tab=res]"); await p.waitForTimeout(300);
 T.ok(await p.locator("#resPlan [data-axe]").count() >= 1 && await p.evaluate(() => Object.values(RP.unites).every(r => r.axes.length >= 1 && r.hor)), "axes et horaires recalculés après l'import");
 // export v3 puis réimport dans un navigateur vierge (terrain absent, puis présent)
 const f = await telecharger(p, "#exp", "reimport.json");
 const ctx2 = await contexte(T, false); const q = await page(ctx2, T);
 await q.goto(T.base + "ennemi.html"); await prets(q); await q.waitForTimeout(500);
 await q.setInputFiles("#imp", f); await q.waitForTimeout(800);
 T.ok(/absent de ce navigateur/.test(await q.textContent("#status")), "terrain référencé absent : message clair");
 await ouvrirDemo(q, false); await q.setInputFiles("#imp", f); await calcule(q);
 T.ok(await q.evaluate(() => ET.planification.scenarios.length === 2 && ET.planification.scenarios[0].heure_depart === "05:30" && !document.getElementById("refWarn").textContent), "fichier v3 rouvert (ME.importer) sur le bon terrain, sans avertissement");
 T.ok(await q.evaluate(() => Object.values(RP.unites).every(r => r.axes.length >= 1)), "axes recalculés sur le fichier v3 rouvert");
 // autre terrain (identifiant différent) et terrain modifié (même identifiant, empreinte différente)
 const j = JSON.parse(fs.readFileSync(f, "utf8"));
 const autre = path.join(OUT, "autre-terrain.json"); fs.writeFileSync(autre, JSON.stringify(Object.assign({}, j, {terrain:Object.assign({}, j.terrain, {id:"zz-autre", nom:"Autre zone"})})));
 await q.setInputFiles("#imp", autre); await calcule(q);   // zone absente de ce navigateur : pas de question, travail ouvert avec avertissement
 T.ok(/AUTRE terrain/.test(await q.textContent("#refWarn")), "avertissement : fichier fait sur un autre terrain");
 const modif = path.join(OUT, "terrain-modifie.json"); fs.writeFileSync(modif, JSON.stringify(Object.assign({}, j, {nom:"modifié", terrain:Object.assign({}, j.terrain, {empreinte:"e00000000"})})));
 let msg = ""; q.once("dialog", d => { msg = d.message(); d.dismiss(); }); await q.setInputFiles("#imp", modif); await q.waitForTimeout(600);
 T.ok(/changé depuis l'export/.test(msg) && /refusé/i.test(await q.textContent("#status")) && await q.evaluate(() => ET.nom !== "modifié"), "terrain modifié : ME.importer refuse, l'utilisateur peut refuser (travail inchangé)");
 q.once("dialog", d => d.accept()); await q.setInputFiles("#imp", modif); await calcule(q);
 T.ok(/a changé depuis l'enregistrement/.test(await q.textContent("#refWarn")) && await q.evaluate(() => ET.nom === "modifié"), "terrain modifié : importé quand même sur demande, avec avertissement (empreinte)");
 await capture(q, "import-avertissement-pc");
 // fichier conduite v1 (terrain inclus) : unité inconnue à roues, deux contacts horodatés, mode conduite, calculs réels
 const c1 = path.join(OUT, "conduite-v1.json"); fs.writeFileSync(c1, JSON.stringify(fichierConduiteV1()));
 const ctx3 = await contexte(T, false); const w = await page(ctx3, T);
 await w.goto(T.base + "ennemi.html"); await prets(w); await w.waitForTimeout(500);
 await w.setInputFiles("#imp", c1); await terrainOuvert(w); await calcule(w);
 const rc = await w.evaluate(() => ({mode:MODE, u:ET.conduite.unites.map(u => u.classe + "/" + u.unite_type + "/" + u.en_mouvement), c:ET.conduite.contacts.map(c => c.heure + ":" + c.elements_vus), h:ET.conduite.heure, amis:ET.nos_positions.length,
  iso:!!(RC && RC.iso), z:RC && RC.pres ? RC.pres.zones.length : 0, a1:RC && RC.iso ? RC.iso.arrivee_min[cellAt({lng:ET.conduite.contacts[0].lonlat[0], lat:ET.conduite.contacts[0].lonlat[1]})] : null}));
 T.ok(rc.mode === "conduite" && rc.u.join() === "roue/cie-moto/true" && rc.c.join() === "07:10:2,07:25:3" && rc.h === "07:25" && rc.amis === 1, "ancien fichier conduite converti : unité à roues, contacts 07:10 et 07:25, situation 07:25, mode Conduite (" + JSON.stringify(rc) + ")");
 T.ok(rc.iso && rc.z >= 1 && Math.abs(rc.a1 - 430) < 0.01, "isochrones et zones calculées depuis les contacts du fichier v1 (arrivée 07:10 au 1er contact)");
 T.ok(p.erreurs.length + q.erreurs.length + w.erreurs.length === 0, "aucune erreur de script " + p.erreurs.concat(q.erreurs, w.erreurs).join(" | ")); await ctx3.close(); await ctx2.close(); await ctx.close(); });

/* ---------- 6. ru : l'outil Ennemi subit les coupures du terrain ; seul le chenillé passe le ru à gué quand son pont est coupé ---------- */
test("coupure du terrain : le ru n'est franchi que par le chenillé (PC)", async T => {
 const terr = JSON.parse(fs.readFileSync(DEMO, "utf8"));
 terr.coupures = [{ouvrage:PONT_RU, type:"pont", lon:-0.11009, lat:47.2456, nm:"Pont du Ru", etat:"detruit", t:1}];
 const ft = path.join(OUT, "demo-pont-ru-coupe.json"); fs.writeFileSync(ft, JSON.stringify(terr));
 const ctx = await contexte(T, false); const p = await page(ctx, T);
 await p.goto(T.base + "ennemi.html?mode=planification"); await prets(p); await p.waitForTimeout(400);
 await p.setInputFiles("#imp", ft); await terrainOuvert(p); await calcule(p);
 T.ok(await p.evaluate(() => G.coupe.filter(x => x === 1).length === 1 && /détruit/.test(document.getElementById("lstCoupures").textContent)), "terrain ouvert avec le pont du ru détruit (coupure saisie dans l'outil Terrain), listé");
 T.ok(!/(\bCouper\b|Rétablir l'ouvrage|Détruire)/.test(await texteVisible(p)), "aucune commande pour couper ou rétablir un ouvrage dans l'outil Ennemi");
 await outil(p, false, "dep"); await p.mouse.click(...await pxM(p, 10, 90)); await p.mouse.click(...await pxM(p, 25, 40)); await calcule(p);
 const res = {};
 for (const k of ["chenille", "roue", "logistique", "fantassin"]) {
  await p.click(".tabs button[data-tab=sai]"); await p.selectOption("#uClasse", k); await calcule(p);
  res[k] = await p.evaluate(ru => { const r = RP.unites[curU().id]; return {n:r.axes.length, ru:r.axes.some(a => a.ouvrages.includes(ru)), manque:r.manque || "", fn:r.axes.length ? r.axes[0].franchissement_min : 0}; }, PONT_RU);
  await p.click(".tabs button[data-tab=res]"); await p.waitForTimeout(150); res[k].txt = await p.textContent("#resPlan");
 }
 T.ok(res.chenille.n >= 1 && !res.chenille.ru && res.chenille.fn > 0, `chenillé : passe le ru à gué (${res.chenille.n} axe(s), franchissement ${Math.round(res.chenille.fn)} min, sans le pont détruit)`);
 for (const k of ["roue", "logistique", "fantassin"]) T.ok(res[k].n === 0 && /Aucun passage/.test(res[k].manque) && /Aucun axe/.test(res[k].txt), `${k} : aucun axe, raison affichée (${res[k].manque.slice(0, 60)}…)`);
 // gué sans ouvrage : franchissement de l'axe (avec sa durée), jalon horaire, tronçon, copie, carte et KML
 await p.click(".tabs button[data-tab=sai]"); await p.selectOption("#uClasse", "chenille"); await calcule(p); await p.click(".tabs button[data-tab=res]"); await p.waitForTimeout(150);
 const gu = await p.evaluate(() => { const r = RP.unites[curU().id], j = r.hor.jalons.find(x => x.gue);
  return {fr:r.choisi.franchissements.filter(x => x.genre === "gue").map(x => [x.nom, x.duree_min]), j:j && [j.nom, j.franchissement_min, hmj(j.heure_min)], fe:P.chenille.franchissement_eau_min,
   cartes:[...document.querySelectorAll("#resPlan [data-axe] .franch")].map(e => e.textContent), lignes:[...document.querySelectorAll("#resPlan tr[data-j]")].map(e => e.textContent),
   tr:[...document.querySelectorAll("#resPlan table.hor")].map(t => t.textContent).filter(t => /^Tronçon/.test(t)).join(" "), etiq:map.listImages().filter(i => /gué « Ru de démonstration »/.test(i))}; });
 T.ok(gu.fr.length === 1 && gu.fr[0][0] === "Ru de démonstration" && gu.fr[0][1] === gu.fe, "axe choisi : gué du ru dans ses franchissements, durée " + JSON.stringify(gu.fr));
 T.ok(gu.cartes.length >= 1 && gu.cartes.every(t => /gué « Ru de démonstration » \(10 min\)/.test(t)), "cartes des axes : « Franchissements : gué « Ru de démonstration » (10 min) » (" + gu.cartes[0] + ")");
 T.ok(gu.j && gu.lignes.some(t => t.includes(gu.j[2]) && /gué « Ru de démonstration »/.test(t) && /sans pont, franchissement 10 min/.test(t)), "horaires : jalon du gué daté (" + JSON.stringify(gu.j) + ")");
 T.ok(/→ gué « Ru de démonstration ».*gué « Ru de démonstration »/.test(gu.tr), "horaires par tronçon : le tronçon qui finit au gué le cite");
 T.ok(gu.etiq.length >= 1, "carte : étiquette du jalon du gué (" + gu.etiq.length + ")");
 await p.click("#copyH"); await p.waitForTimeout(300);
 T.ok(/gué « Ru de démonstration » .*\| gué sans pont, franchissement 10 min/.test(await p.evaluate(() => window.__dernierTexte || "")), "horaires copiés : ligne du gué avec sa durée");
 const kml = fs.readFileSync(await telecharger(p, "#kmlBtn", "ru-coupe.kml"), "utf8");
 T.ok(/Gués : gué « Ru de démonstration » sans pont \d{2}[A-Z] [A-Z]{2} \d{5} \d{5} \(10 min\)/.test(kml) && /<name>\d{2}:\d{2}[^<]*gué « Ru de démonstration »<\/name>/.test(kml) && /Gué sans pont, franchissement 10 min/.test(kml), "KML : gué dans la description des axes et jalon du gué");
 T.ok(/Axe le plus discret/.test(kml) && !/plus sûr/.test(kml), "KML : « Axe le plus discret » (même terme que l'interface)");
 await capture(p, "ru-coupe-pc");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | ")); await ctx.close(); });

/* ---------- 6 bis. import d'un fichier fait sur un AUTRE terrain : « importer quand même » ---------- */
test("import : fichier d'un autre terrain, importer quand même ou ouvrir son terrain (PC)", async T => {
 const ctx = await contexte(T, false); const p = await page(ctx, T);
 await p.goto(T.base + "ennemi.html?mode=planification"); await prets(p); await ouvrirDemo(p, false);
 await outil(p, false, "dep"); await p.mouse.click(...await pxM(p, 12, 30)); await p.mouse.click(...await pxM(p, 85, 70)); await calcule(p);
 // fichier v3 du travail, dont la référence désigne un autre terrain (« Autre zone », id zz-autre)
 const doc = await p.evaluate(() => { const d = ME.exporter(etatExport(), {date:"test"}); d.nom = "Travail autre terrain"; d.terrain = Object.assign({}, d.terrain, {id:"zz-autre", nom:"Autre zone"}); return d; });
 const f = path.join(OUT, "autre-terrain-forcer.json"); fs.writeFileSync(f, JSON.stringify(doc));
 const dep = doc.planification.scenarios[0].unites[0].depart;
 const etat = () => p.evaluate(() => ({g:G.id, nom:ET.nom, dep:curSc().unites[0] && curSc().unites[0].depart, warn:document.getElementById("refWarn").textContent, st:document.getElementById("status").textContent,
  axes:RP && RP.unites[curSc().unites[0].id] ? RP.unites[curSc().unites[0].id].axes.length : 0}));
 const memePos = (a, b) => a && b && Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
 // 1. terrain du fichier absent de ce navigateur : travail importé QUAND MÊME sur le terrain ouvert, avertissement clair
 let dial = 0; const compte = () => dial++; p.on("dialog", compte);
 await p.evaluate(() => { ET.nom = "avant"; }); await p.setInputFiles("#imp", f); await calcule(p);
 let e = await etat();
 T.ok(dial === 0 && e.g === "f1r08s1r" && e.nom === "Travail autre terrain" && memePos(e.dep, dep) && e.axes >= 1, "terrain du fichier absent : travail importé quand même sur le terrain ouvert (positions du fichier, axes recalculés)");
 T.ok(/AUTRE terrain \(« Autre zone »\)/.test(e.warn) && /AUTRE terrain/.test(e.st), "avertissement « AUTRE terrain » affiché (panneau et barre d'état)");
 p.off("dialog", compte);
 // 2. terrain du fichier enregistré sur ce navigateur (zone de l'outil Terrain) : question ; « Annuler » = importer quand même sur le terrain ouvert
 const zone = JSON.parse(fs.readFileSync(DEMO, "utf8")); zone.id = "zz-autre"; zone.nom = "Autre zone"; zone.t = 1;
 await p.evaluate(async z => { const db = await CE.terrainDB(); await new Promise((res, rej) => { const tx = db.transaction("zones", "readwrite"); tx.objectStore("zones").put(z); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); await listerZones(); }, zone);
 await p.evaluate(() => { ET.nom = "avant"; });
 let msg = ""; p.once("dialog", d => { msg = d.message(); d.dismiss(); }); await p.setInputFiles("#imp", f); await calcule(p);
 e = await etat();
 T.ok(/« Autre zone », enregistré sur ce navigateur/.test(msg) && /Annuler : garder le terrain ouvert/.test(msg), "question : ouvrir le terrain du fichier ou garder le terrain ouvert (" + msg.slice(0, 70) + "…)");
 T.ok(e.g === "f1r08s1r" && e.nom === "Travail autre terrain" && memePos(e.dep, dep) && /AUTRE terrain/.test(e.warn), "« Annuler » : importé quand même sur le terrain ouvert, avec avertissement");
 // 3. « OK » : le terrain du fichier est ouvert, le travail y est importé sans avertissement
 p.once("dialog", d => d.accept()); await p.setInputFiles("#imp", f); await terrainOuvert(p); await calcule(p);
 e = await etat();
 T.ok(e.g === "zz-autre" && e.nom === "Travail autre terrain" && memePos(e.dep, dep) && !e.warn && e.axes >= 1, "« OK » : terrain « Autre zone » ouvert, travail importé sans avertissement, axes recalculés");
 await capture(p, "import-autre-terrain-pc");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | ")); await ctx.close(); });

/* ---------- 6 ter. ergonomie de la carte (PC) : cadrage, légende compacte, couleurs du terrain, étiquettes sans chevauchement ---------- */
for (const [W, Hh] of [[1500, 900], [1366, 768]]) test(`ergonomie de la carte : cadrage, légende, étiquettes (PC ${W} × ${Hh})`, async T => {
 const ctx = await contexte(T, false, {viewport:{width:W, height:Hh}}); const p = await page(ctx, T);
 await p.goto(T.base + "ennemi.html?mode=planification"); await prets(p);
 await p.evaluate(() => { try { localStorage.removeItem("re-legende-repliee"); } catch(e) {} RE.replierLegende(map, null); });
 await ouvrirDemo(p, false);
 // rectangles (écran) des éléments posés sur la carte
 const rects = () => p.evaluate(() => { const r = id => { const e = document.getElementById(id); if (!e || e.offsetParent === null) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
  const b = G.b, a = map.project([b.w, b.n]), c = map.project([b.e, b.s]), m = map.getContainer().getBoundingClientRect();
  return {cadre:[a.x + m.left, a.y + m.top, c.x + m.left, c.y + m.top], panel:r("panel"), bar:r("bar"), clock:r("clock"), leg:r("reLeg"), coord:(() => { const e = document.querySelector(".cg-coord"); const q = e.getBoundingClientRect(); return [q.left, q.top, q.right, q.bottom]; })()}; });
 const coupe = (a, b) => !!a && !!b && a[0] < b[2] - 1 && a[2] > b[0] + 1 && a[1] < b[3] - 1 && a[3] > b[1] + 1;
 // planification : deux unités aux départs voisins, une position amie, terrain affiché
 await outil(p, false, "dep"); await p.mouse.click(...await pxM(p, 12, 60)); await p.mouse.click(...await pxM(p, 85, 70)); await calcule(p);
 await p.selectOption("#uAddType", "esc-chars"); await p.click("#uAdd"); await p.mouse.click(...await pxM(p, 14, 62)); await p.mouse.click(...await pxM(p, 86, 66)); await calcule(p);
 await outil(p, false, "ami"); await p.mouse.click(...await pxM(p, 60, 20)); await calcule(p);
 let R = await rects();
 T.ok(R.clock && !coupe(R.cadre, R.clock) && !coupe(R.cadre, R.panel) && !coupe(R.cadre, R.bar), "terrain cadré : ni le curseur d'heure, ni le panneau, ni la barre d'outils ne couvrent la zone (" + JSON.stringify({cadre:R.cadre.map(Math.round), clock:R.clock && R.clock.map(Math.round)}) + ")");
 T.ok(R.clock[3] <= R.coord[1] + 1, "curseur d'heure au-dessus de la barre des coordonnées, en bas de la carte");
 // terrain affiché : couleurs GO / SLOW-GO / NO-GO / eau dans la légende (dans sa tête si elle est repliée)
 await p.click("#terBtn"); await calcule(p);
 const lt = await p.evaluate(() => { const d = document.getElementById("reLeg"), rep = d.classList.contains("re-replie"), vu = rep ? d.querySelector(".re-resume") : d.querySelector(".re-corps");
  return {rep, txt:vu.innerText, sw:[...vu.querySelectorAll(".re-sw")].map(e => getComputedStyle(e).backgroundColor), auto:d.dataset.auto}; });
 T.ok(/GO/.test(lt.txt) && /SLOW-GO/.test(lt.txt) && /NO-GO/.test(lt.txt) && /eau/i.test(lt.txt) && lt.sw.length >= 4, `terrain affiché : légende GO / SLOW-GO / NO-GO / eau visible (${lt.rep ? "tête de la légende repliée" : "légende dépliée"} : ${lt.txt.replace(/\s+/g, " ")})`);
 T.ok(lt.rep && lt.auto === "1", "légende repliée par défaut : dépliée, elle couvrirait le terrain affiché");
 R = await rects(); T.ok(R.leg && R.leg[3] - R.leg[1] < 30 && !coupe(R.leg, R.clock), "légende repliée : une ligne (" + Math.round(R.leg[3] - R.leg[1]) + " px), hors du curseur d'heure");
 await p.click("#reLeg .re-tete"); R = await rects();
 T.ok(R.leg && R.leg[2] - R.leg[0] <= 300 && !coupe(R.leg, R.clock) && !coupe(R.leg, R.bar), "légende dépliée à la demande : compacte (" + Math.round(R.leg[2] - R.leg[0]) + " × " + Math.round(R.leg[3] - R.leg[1]) + " px), hors du curseur et de la barre");
 await p.click("#reLeg .re-tete"); await p.evaluate(() => RE.replierLegende(map, null));
 await p.click("#terBtn"); await calcule(p);
 T.ok(await p.evaluate(() => !/SLOW-GO/.test(document.getElementById("reLeg").textContent)), "terrain masqué : ses couleurs quittent la légende");
 // étiquettes des saisies sans chevauchement
 const sans = async () => { const L = await p.evaluate(() => RE.etiquettesPlacees(map)); let n = 0, q = []; for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) if (coupe(L[i].box, L[j].box)) { n++; q.push([L[i].box, L[j].box]); } return {n, nb:L.length, q:JSON.stringify(q)}; };
 let e = await sans(); T.ok(e.nb >= 5 && e.n === 0, `planification : ${e.nb} étiquettes (départs voisins, objectifs, regroupements, position), aucun chevauchement`);
 // conduite : trois unités vues au même endroit (étiquettes voisines), isochrones ; la légende ne couvre pas les résultats
 await p.click("#modeSeg [data-m=conduite]"); await calcule(p); await p.fill("#cHeure", "14:00"); await p.press("#cHeure", "Tab"); await calcule(p);
 await outil(p, false, "con");
 for (const [i, j, cl, h] of [[44, 45, "+roue", "13:40"], [48, 45, "+chenille", "13:50"], [46, 49, "+fantassin", "13:55"]]) {
  await p.mouse.click(...await pxM(p, i, j)); await p.waitForTimeout(300); await p.selectOption(".pf [data-u]", cl); await p.fill(".pf [data-h]", h); await p.fill(".pf [data-v]", "2"); await p.click(".pf [data-ok]"); await calcule(p); }
 T.ok(await p.evaluate(() => ET.conduite.contacts.length === 3 && ET.conduite.unites.length === 3), "trois contacts voisins de trois unités");
 e = await sans(); T.ok(e.nb >= 4 && e.n === 0, `conduite : ${e.nb} étiquettes (contacts voisins, position), aucun chevauchement ${e.q}`);
 const vis = await p.evaluate(() => map.getStyle().layers.filter(l => l.id === "en-saisies").every(l => map.getLayoutProperty(l.id, "visibility") !== "none") && RE.etiquettesPlacees(map).every(x => x.box[0] >= 0 && x.box[2] <= map.getContainer().clientWidth));
 T.ok(vis, "étiquettes toutes dans la carte (aucune masquée)");
 for (const z of [11, 13]) { await p.evaluate(z => map.jumpTo({center:ET.conduite.contacts[1].lonlat, zoom:z}), z); await p.waitForTimeout(400); e = await sans(); T.ok(e.n === 0, `zoom ${z} : étiquettes replacées sans chevauchement (${e.nb})`); }
 await p.evaluate(() => map.fitBounds([[G.b.w, G.b.s], [G.b.e, G.b.n]], {padding:padCarte(), duration:0})); await p.waitForTimeout(400);
 const lc = await p.evaluate(() => { const d = document.getElementById("reLeg"), r = d.getBoundingClientRect(), m = map.getContainer().getBoundingClientRect();
  const iso = map.querySourceFeatures("en-iso").flatMap(f => f.geometry.type === "LineString" ? f.geometry.coordinates : f.geometry.coordinates.flat()).map(ll => map.project(ll)).filter(q => q.x + m.left > r.left && q.x + m.left < r.right && q.y + m.top > r.top && q.y + m.top < r.bottom).length;
  return {rep:d.classList.contains("re-replie"), iso, coin:d.dataset.coin}; });
 T.ok(lc.rep ? true : lc.iso === 0, "conduite : la légende " + (lc.rep ? "est repliée" : "ne couvre aucune isochrone") + " (" + JSON.stringify(lc) + ")");
 R = await rects(); T.ok(!coupe(R.cadre, R.clock), "conduite : le curseur T+x ne couvre pas la zone");
 await capture(p, `ergonomie-conduite-${W}`);
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | ")); await ctx.close(); });

/* ---------- 9. grand terrain (500 × 500 mailles, 50 km) : calcul par étapes, interface réactive, bouton « Arrêter » ---------- */
// terrain synthétique (même construction que tests/ennemi.js), fabriqué dans la page
function grandTerrain(n){
 const N = n*n, W = n*S, b = bboxFrom({lng:-0.08, lat:47.26}, n*100), L = {};
 for (const k of LAYERS) L[k] = new Float32Array(N);
 const f = {b, n, cell:100, W, sl:new Float32Array(N), el:new Float32Array(N).fill(100), gx:new Float32Array(N), gy:new Float32Array(N), L, M:new Uint8Array(W*W), ways:[], pnodes:[], rivs:[], rus:null};
 for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const c = j*n + i, x = Math.sin(i/37)*Math.cos(j/23);
  if (x > 0.55) L.foret[c] = 1; if (x < -0.8) L.bati[c] = 0.7; f.el[c] = 100 + 60*Math.sin(i/50)*Math.sin(j/70); f.sl[c] = Math.abs(3*Math.cos(i/50)); }
 return {id:"grand-synth", nom:"Grand terrain synthétique", date:"test", faits:f, coupures:[]};   // zone au format enregistré (tableaux binaires)
}
test("grand terrain : calcul par étapes, gel maximal, bouton Arrêter (PC)", async T => {
 const ctx = await contexte(T, false); const p = await page(ctx, T);
 await p.goto(T.base + "ennemi.html?mode=planification"); await prets(p); await p.waitForTimeout(400);
 const n = +(process.env.GRAND || 500), GEL_MAX = 400;   // 500 × 500 mailles (50 km) par défaut ; gel maximal toléré (ms)
 await p.evaluate(async ([src, n]) => { const fab = new Function("return " + src)(); await ouvrir(fab(n)); }, [grandTerrain.toString(), n]);
 await terrainOuvert(p); await calcule(p);
 T.ok(await p.evaluate(n => G.n === n, n), `terrain synthétique ${n} × ${n} ouvert`);
 // mesure : plus long intervalle entre deux battements (minuterie de 10 ms) pendant le calcul = gel maximal de l'interface
 const mesure = () => p.evaluate(() => new Promise(res => { let der = performance.now(), max = 0, vu = false; const t0 = performance.now();
  const id = setInterval(() => { const t = performance.now(); max = Math.max(max, t - der); der = t; if (document.getElementById("calc").classList.contains("on")) vu = true;
   if (calmeEnnemi()) { clearInterval(id); res({max, total:t - t0, vu}); } }, 10);
  const s = curSc(), u = s.unites[0]; snap(); u.depart = cellLL(Math.round(G.n*0.9)*G.n + Math.round(G.n*0.05)); u.objectifs = [cellLL(Math.round(G.n*0.08)*G.n + Math.round(G.n*0.95))]; apresSaisie(); }));
 const m = await mesure();
 console.log(`   grand terrain ${n} × ${n} : calcul complet (axes, regroupement, horaires) ${Math.round(m.total)} ms, gel maximal de l'interface ${Math.round(m.max)} ms`);
 T.ok(m.vu, "barre de progression avec bouton « Arrêter » affichée pendant le calcul");
 T.ok(m.max < GEL_MAX, `interface jamais figée plus de ${GEL_MAX} ms (gel maximal mesuré ${Math.round(m.max)} ms)`);
 T.ok(await p.evaluate(() => RP.unites[curU().id].axes.length >= 1 && !!RP.unites[curU().id].hor), "axes et horaires calculés sur le grand terrain");
 // Arrêter : nouveau calcul (autre objectif), arrêt en cours de route, vitesses du terrain restaurées, calcul suivant correct
 const v0 = await p.evaluate(() => { window.__v0 = G.v.chenille; window.__p0 = P.chenille; return true; });
 await p.evaluate(() => { CACHE.clear(); curU().objectifs = [cellLL(Math.round(G.n*0.5)*G.n + Math.round(G.n*0.9))]; apresSaisie(); });
 // clic sur « Arrêter » dès que la barre de calcul apparaît (le calcul dure environ une seconde)
 await p.evaluate(() => new Promise((res, rej) => { const t0 = Date.now(), id = setInterval(() => { if (document.getElementById("calc").classList.contains("on")) { clearInterval(id); document.getElementById("calcStop").click(); res(); }
  else if (Date.now() - t0 > 30000) { clearInterval(id); rej(new Error("barre de calcul jamais affichée")); } }, 2); }));
 await calcule(p);
 const ar = await p.evaluate(() => ({st:document.getElementById("status").textContent, v:G.v.chenille === window.__v0 && P.chenille === window.__p0, calc:document.getElementById("calc").classList.contains("on")}));
 T.ok(v0 && /Calcul arrêté/.test(ar.st) && ar.v && !ar.calc, "« Arrêter » : calcul arrêté, message, vitesses du terrain restaurées (" + ar.st.slice(0, 40) + ")");
 await p.evaluate(() => { curU().objectifs = [cellLL(Math.round(G.n*0.1)*G.n + Math.round(G.n*0.9))]; apresSaisie(); }); await calcule(p);
 T.ok(await p.evaluate(() => { const r = RP.unites[curU().id], ref = ME.axes(uniteME(curU(), curSc()), {doctrine:D, mode:"attaque", amis:amis()}); return r.axes.length >= 1 && JSON.stringify(r.axes.map(a => a.noeuds)) === JSON.stringify(ref.map(a => a.noeuds)); }), "après un arrêt, le calcul suivant donne les mêmes axes que ME.axes d'un trait");
 await capture(p, "grand-terrain-pc");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | ")); await ctx.close(); });

/* ---------- 7. téléphone : pose d'unités et de contacts au toucher ---------- */
test("téléphone : départ, objectif, contact au toucher, feuille courte", async T => {
 const ctx = await contexte(T, true); const p = await page(ctx, T);
 await p.goto(T.base + "ennemi.html"); await prets(p); await ouvrirDemo(p, true);
 T.ok(!(await p.evaluate(() => document.body.classList.contains("sheet"))), "la feuille se ferme une fois le terrain ouvert");
 await p.tap("#tools button[data-t=dep]"); await p.touchscreen.tap(...await px(p, 0.15, 0.35)); await p.waitForTimeout(200); await p.touchscreen.tap(...await px(p, 0.85, 0.65)); await calcule(p);
 T.ok(await p.evaluate(() => !!curU().depart && curU().objectifs.length === 1), "départ et objectif posés au toucher");
 T.ok(await p.evaluate(() => RP && RP.unites[curU().id].axes.length >= 1 && !!RP.unites[curU().id].hor), "téléphone : axes et horaires du moteur réel");
 await p.tap("#navBar button[data-k=res]"); await p.waitForTimeout(400);
 T.ok(await p.evaluate(() => document.getElementById("panel").dataset.pane === "res" && document.getElementById("tab-res").classList.contains("on")), "onglet Résultats en feuille courte");
 await capture(p, "telephone-resultats");
 await p.tap("#navBar button[data-k=cond]"); await p.waitForTimeout(300); await p.tap("#sheetClose"); await p.waitForTimeout(200);
 await p.tap("#tools button[data-t=con]"); await p.touchscreen.tap(...await px(p, 0.5, 0.45)); await p.waitForTimeout(400);
 await p.tap(".pf [data-ok]"); await calcule(p);
 T.ok(await p.evaluate(() => !!RC && !!RC.iso && RC.pres.zones.length >= 1), "téléphone : isochrones et zones calculées par le moteur réel");
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
