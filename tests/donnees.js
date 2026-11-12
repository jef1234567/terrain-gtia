/* Tests des données (donnees-osm.js) : téléchargement OpenStreetMap simulé, mer, grandes zones, reprise.
   Lancer :  node tests/donnees.js [filtre]      (mêmes variables que tests/run.js : PLAYWRIGHT_MODULE, CHROMIUM)
   Aucun accès aux vrais serveurs : Overpass et le relief sont simulés (réseau intercepté par Playwright). */
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const H = require("./helpers.js");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, {recursive:true});
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

/* ---------- jeu OpenStreetMap synthétique, déterministe (exécuté dans la page ou dans Node) ----------
   Zone b ; trait de côte ouest → est (terre au nord, mer au sud), une île au large, routes en grille (nœuds partagés aux carrefours),
   bois, bâti, prairies, vignes, étangs, marais (dont relations), rivières, ruisseaux, voies ferrées, haies, ponts, passages à niveau. */
function geoSynth(b, o){
 const latC = o.coteLat === null || o.coteLat === undefined ? b.s + (b.n - b.s)*0.25 : o.coteLat;
 return {coteAt: lon => latC + 0.02*Math.sin((lon - b.w)*9) + 0.008*Math.sin((lon - b.w)*41), ile:{lon:b.w + (b.e - b.w)*0.5, lat:latC - 0.07, r:2500}};
}
function osmSynthetique(b, o){
 o = Object.assign({graine:7, cote:true, ile:true, densite:1, coteLat:null}, o || {});
 let s = o.graine >>> 0; const R = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0)/4294967296; };
 const kx = 111320*Math.cos((b.n + b.s)/2*Math.PI/180), ky = 110574, els = [];
 let id = 1; const wid = () => id++;
 const {coteAt, ile} = geoSynth(b, o);
 const surTerre = (lon, lat) => !o.cote || lat > coteAt(lon) + 0.003;
 const pt = (lon, lat) => ({lat:Math.round(lat*1e7)/1e7, lon:Math.round(lon*1e7)/1e7});
 const way = (tags, g, nodes) => els.push({type:"way", id:wid(), tags, nodes:nodes || g.map(() => 1e9 + id*1000 + Math.floor(R()*999)), geometry:g});
 const poly = (lon, lat, r, k) => { const g = []; for (let i = 0; i < k; i++) { const a = i/k*2*Math.PI, rr = r*(0.6 + 0.4*R()); g.push(pt(lon + Math.cos(a)*rr/kx, lat + Math.sin(a)*rr/ky)); } g.push(g[0]); return g; };
 const W0 = b.w - 1500/kx, E0 = b.e + 1500/kx, S0 = b.s - 1500/ky, N0 = b.n + 1500/ky;
 // trait de côte : tronçons de 150 points, chacun repartant du dernier point du précédent
 if (o.cote) {
  const g = []; for (let lon = W0; lon <= E0; lon += 80/kx) g.push(pt(lon, coteAt(lon)));
  for (let i = 0; i < g.length - 1; i += 149) way({natural:"coastline"}, g.slice(i, i + 150));
 }
 if (o.ile) { const g = []; for (let i = 0; i <= 64; i++) { const a = i/64*2*Math.PI; g.push(pt(ile.lon + Math.cos(a)*ile.r/kx, ile.lat + Math.sin(a)*ile.r/ky)); } g[64] = g[0]; way({natural:"coastline"}, g); }
 // routes en grille : treillis de 100 m, une ligne tous les 7 pas (700 m), tronçons d'environ 1 km, nœuds partagés aux carrefours
 const st = 100, na = Math.ceil((E0 - W0)*kx/st), nb = Math.ceil((N0 - S0)*ky/st), sp = Math.round(7/o.densite) || 1;
 const L = (a, c) => [W0 + a*st/kx, S0 + c*st/ky], nid = (a, c) => a*100000 + c + 1;
 const ligne = (horiz, k) => { let g = [], nd = [];
  const fin = () => { if (g.length > 1) way({highway: k % 10 === 0 ? "secondary" : k % 3 === 0 ? "track" : "residential", name: k % 10 === 0 ? "D" + k : undefined}, g, nd); g = []; nd = []; };
  const m = horiz ? na : nb;
  for (let q = 0; q <= m; q++) { const [lon, lat] = horiz ? L(q, k) : L(k, q);
   if (!surTerre(lon, lat)) { fin(); continue; }
   g.push(pt(lon, lat)); nd.push(horiz ? nid(q, k) : nid(k, q)); if (g.length > 10) { const l = g[g.length - 1], ln = nd[nd.length - 1]; fin(); g = [l]; nd = [ln]; } }
  fin(); };
 for (let c = 0; c <= nb; c += sp) ligne(true, c);
 for (let a = 0; a <= na; a += sp) ligne(false, a);
 // autoroutes (deux), avec un viaduc
 for (const f of [0.55, 0.8]) { const g = []; for (let lon = W0; lon <= E0; lon += 150/kx) g.push(pt(lon, b.s + (b.n - b.s)*f + 0.01*Math.sin(lon*20)));
  for (let i = 0; i < g.length - 1; i += 40) way(i === 80 ? {highway:"motorway", bridge:"yes"} : {highway:"motorway"}, g.slice(i, i + 41)); }
 // voies ferrées
 for (const f of [0.35, 0.7]) { const g = []; for (let lat = coteAt(b.w) + 0.01; lat <= N0; lat += 150/ky) g.push(pt(b.w + (b.e - b.w)*f + 0.02*Math.sin(lat*30), lat));
  for (let i = 0; i < g.length - 1; i += 50) way({railway:"rail"}, g.slice(i, i + 51)); }
 // rivières (nord → mer), avec ponts
 for (const f of [0.15, 0.45, 0.85]) { const g = []; for (let lat = N0; lat >= coteAt(b.w + (b.e - b.w)*f) - 0.001; lat -= 120/ky) g.push(pt(b.w + (b.e - b.w)*f + 0.015*Math.sin(lat*25), lat));
  for (let i = 0; i < g.length - 1; i += 60) way({waterway:"river", name:"Fleuve " + f, width: f < 0.4 ? "40" : undefined}, g.slice(i, i + 61));
  for (let i = 30; i < g.length - 1; i += 90) { const p = g[i]; way({highway:"secondary", bridge:"yes", name:"pont " + i}, [pt(p.lon - 60/kx, p.lat), pt(p.lon + 60/kx, p.lat)]); } }
 // surfaces
 const surf = (nb, r0, r1, tags, k) => { for (let i = 0; i < nb*o.densite; i++) { const lon = W0 + R()*(E0 - W0), lat = S0 + R()*(N0 - S0); if (!surTerre(lon, lat)) continue; way(tags, poly(lon, lat, r0 + R()*(r1 - r0), k)); } };
 surf(1500, 150, 700, {landuse:"forest"}, 12); surf(500, 100, 500, {natural:"wood"}, 10); surf(700, 150, 600, {landuse:"residential"}, 8);
 surf(250, 100, 400, {landuse:"industrial"}, 6); surf(800, 100, 500, {landuse:"meadow"}, 8); surf(300, 100, 400, {landuse:"vineyard"}, 6);
 surf(150, 50, 250, {natural:"water"}, 10); surf(80, 100, 400, {natural:"wetland"}, 8);
 // relations (bois en multipolygone, anneau coupé en deux chemins)
 for (let i = 0; i < 60*o.densite; i++) { const lon = W0 + R()*(E0 - W0), lat = S0 + R()*(N0 - S0); if (!surTerre(lon, lat)) continue;
  const g = poly(lon, lat, 400 + R()*800, 16), h = 8;
  els.push({type:"relation", id:wid(), tags:{type:"multipolygon", natural:"wood"}, members:[{type:"way", ref:wid(), role:"outer", geometry:g.slice(0, h + 1)}, {type:"way", ref:wid(), role:"outer", geometry:g.slice(h)}]}); }
 // ruisseaux et haies (marches aléatoires)
 const marche = (nb, pas, k, tags) => { for (let i = 0; i < nb*o.densite; i++) { let lon = W0 + R()*(E0 - W0), lat = S0 + R()*(N0 - S0); if (!surTerre(lon, lat)) continue; const g = [pt(lon, lat)], a0 = R()*6.28;
  for (let q = 0; q < k; q++) { const a = a0 + (R() - 0.5); lon += Math.cos(a)*pas/kx; lat += Math.sin(a)*pas/ky; if (!surTerre(lon, lat)) break; g.push(pt(lon, lat)); } if (g.length > 1) way(tags, g); } };
 marche(900, 80, 25, {waterway:"stream"}); marche(150, 60, 15, {waterway:"ditch"}); marche(2500, 40, 8, {barrier:"hedge"});
 // points
 for (let i = 0; i < 120*o.densite; i++) { const lon = W0 + R()*(E0 - W0), lat = S0 + R()*(N0 - S0); if (surTerre(lon, lat)) els.push({type:"node", id:wid(), lat, lon, tags: i % 4 ? {railway:"level_crossing"} : i % 8 ? {highway:"motorway_junction", ref:"" + i} : {ford:"yes"}}); }
 return els;
}

/* ---------- serveur Overpass simulé : découpe la réponse au cadre demandé, comme Overpass (`out geom` + [bbox]) ---------- */
function decouper(els, s, w, n, e){
 const dans = p => p && p.lat >= s && p.lat <= n && p.lon >= w && p.lon <= e, out = [];
 for (const el of els) {
  if (el.type === "node") { if (dans(el)) out.push(el); continue; }
  if (el.type === "way") { if (!el.geometry.some(dans)) continue; out.push(Object.assign({}, el, {geometry:el.geometry.map(p => dans(p) ? p : null)})); continue; }
  if (!el.members.some(m => m.geometry.some(dans))) continue;
  out.push(Object.assign({}, el, {members:el.members.map(m => Object.assign({}, m, {geometry:m.geometry.map(p => dans(p) ? p : null)}))}));
 }
 return out;
}
const lireRequete = body => { const q = decodeURIComponent(String(body || "").replace(/^data=/, "").replace(/\+/g, " "));
 const m = q.match(/\[bbox:([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\]/), c = q.match(/\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)/);
 return {q, controle:/place/.test(q) && !m, bbox:(m || c) ? (m || c).slice(1, 5).map(Number) : null}; };

/* ---------- relief synthétique cohérent avec le jeu : terre à +50…+300 m au nord de la côte, fond marin à −20…−200 m au sud ---------- */
const crcT = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = b => { let c = 0xFFFFFFFF; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
function png(rgba){ const raw = Buffer.alloc(256*1025); for (let y = 0; y < 256; y++) rgba.copy(raw, y*1025 + 1, y*1024, (y + 1)*1024);
 const ih = Buffer.alloc(13); ih.writeUInt32BE(256, 0); ih.writeUInt32BE(256, 4); ih[8] = 8; ih[9] = 6;
 return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]); }
function reliefCotier(elev){
 const cache = new Map();
 return {elev, tile:(z, x, y) => { const k = z + "/" + x + "/" + y; if (cache.has(k)) return cache.get(k);
  const n = 2**z, buf = Buffer.alloc(256*256*4);
  for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) { const lon = (x + (px + 0.5)/256)/n*360 - 180, lat = Math.atan(Math.sinh(Math.PI*(1 - 2*(y + (py + 0.5)/256)/n)))*180/Math.PI;
   const v = elev(lon, lat) + 32768, q = (py*256 + px)*4; buf[q] = Math.floor(v/256); buf[q+1] = Math.floor(v) & 255; buf[q+2] = Math.floor((v - Math.floor(v))*256); buf[q+3] = 255; }
  const r = png(buf); cache.set(k, r); return r; }};
}


/* ---------- outillage des scénarios ---------- */
const PW = process.env.PLAYWRIGHT_MODULE || "playwright";
const zoneDe = (lon, lat, km) => { const dLat = km*500/110574, dLon = km*500/(111320*Math.cos(lat*Math.PI/180)); return {w:lon - dLon, e:lon + dLon, s:lat - dLat, n:lat + dLat}; };   // = bboxFrom
// relief cohérent avec le jeu : terre à 60 m (île à 40 m) au nord de la côte, fond marin à −40 m au sud ; « plat » = valeur unique
function reliefPour(b, o){
 if (o && o.plat !== undefined) return reliefCotier(() => o.plat);
 const {coteAt, ile} = geoSynth(b, o || {}), kx = 111320*Math.cos((b.n + b.s)/2*Math.PI/180);
 return reliefCotier((lon, lat) => (o && o.cote === false) ? -40 : lat > coteAt(lon) ? 60 : Math.hypot((lon - ile.lon)*kx, (lat - ile.lat)*110574) < ile.r ? 40 : -40);
}
/* serveurs Overpass simulés. comportement(nomServeur, requête) → {status, corps} | "jeu" (réponse découpée dans le jeu) ; journal des requêtes */
async function brancherOverpass(ctx, els, comportement, journal, delaiMs){
 const nom = u => /dresel/.test(u) ? "europe" : /overpass-api/.test(u) ? "principal" : /private\.coffee/.test(u) ? "coffee" : "autre";
 await ctx.route(/dresel\.systems|overpass-api\.de|private\.coffee|kumi\.systems|mail\.ru/, async r => {
  const srv = nom(r.request().url()), rq = lireRequete(r.request().postData()), type = /out count/.test(rq.q) ? "controle" : "complete";
  const ent = {srv, type, bbox:rq.bbox ? rq.bbox.join(",") : ""}; journal.push(ent);
  if (srv === "autre") return r.abort();
  if (delaiMs) await new Promise(res => setTimeout(res, delaiMs));
  let rep = comportement(srv, rq, type);
  if (rep === "jeu") { const [s, w, n, e] = rq.bbox, sel = decouper(els, s, w, n, e);
   rep = type === "controle" ? {status:200, corps:{elements:[{type:"count", id:0, tags:{total:String(sel.length)}}]}} : {status:200, corps:{elements:sel}}; }
  if (rep === "vide") rep = {status:200, corps:{elements:[]}};
  ent.reponse = rep.status + (rep.corps && rep.corps.elements ? ":" + rep.corps.elements.length : "");
  try { await r.fulfill({status:rep.status, contentType:"application/json", body:typeof rep.corps === "string" ? rep.corps : JSON.stringify(rep.corps)}); } catch(e) {}
 });
}
async function contexte(T, b, oRelief){
 const c = await T.b.newContext({viewport:{width:1500, height:900}});
 await c.route(/geopf\.fr|tile\.openstreetmap\.org/, r => r.fulfill({status:200, contentType:"image/png", body:PIXEL}));
 await H.brancherRelief(c, reliefPour(b, oRelief)); return c;
}
async function ouvrir(T, ctx){ const p = await ctx.newPage(); p.erreurs = []; p.on("pageerror", e => p.erreurs.push(e.message)); T.pages.push(p);
 await p.goto(T.base + "index.html"); await p.waitForFunction(() => typeof mapReady !== "undefined" && mapReady, null, {timeout:60000}); await p.waitForTimeout(500); return p; }
// lance une analyse centrée sur (lon, lat), côté km ; attend la fin (ou un échec / un arrêt)
async function lancer(p, lon, lat, km, nom){
 await p.evaluate(([lon, lat]) => map.jumpTo({center:[lon, lat]}), [lon, lat]);
 await p.fill("#nom", nom || ""); await p.selectOption("#size", String(km)); await p.click("#go");
}
const fin = (p, ms) => p.waitForFunction(() => !ABORT && /Terminé et enregistré|Échec|arrêtée/.test(document.getElementById("status").textContent), null, {timeout:ms || 300000}).then(() => p.textContent("#status"));
// part des mailles en eau (≥ 50 %) dans un rectangle de la zone (fractions 0-1, v vers le sud)
const partEau = (p, u0, v0, u1, v1) => p.evaluate(([u0, v0, u1, v1]) => { const n = G.n; let e = 0, t = 0;
 for (let j = Math.floor(v0*n); j < Math.ceil(v1*n); j++) for (let i = Math.floor(u0*n); i < Math.ceil(u1*n); i++) { t++; e += G.L.eau[j*n + i] >= 0.5; } return e/t; }, [u0, v0, u1, v1]);
const eauEn = (p, lon, lat) => p.evaluate(([lon, lat]) => { const b = G.b, n = G.n, i = Math.floor((lon - b.w)/(b.e - b.w)*n), j = Math.floor((b.n - lat)/(b.n - b.s)*n); return G.L.eau[j*n + i]; }, [lon, lat]);

const echecs = [], tests = [];
const test = (nom, fn) => tests.push({nom, fn});
const NAPLES = [14.25, 40.80];

/* ---------- 1. plusieurs tuiles, mer, tuiles vides : le serveur Europe garde la main ---------- */
test("multi-tuiles avec mer : tuiles vides confirmées, Europe jamais rétrogradé, île et tuiles sans côte", async T => {
 const b = zoneDe(...NAPLES, 30), o = {coteLat:b.s + 0.15}, els = osmSynthetique(b, o), journal = [];
 const ctx = await contexte(T, b, o);
 await brancherOverpass(ctx, els, () => "jeu", journal);
 const p = await ouvrir(T, ctx); await lancer(p, ...NAPLES, 30, "Naples mer"); const st = await fin(p);
 T.ok(/Terminé et enregistré/.test(st), "analyse terminée (" + st.slice(0, 160) + ")");
 const compl = journal.filter(x => x.type === "complete"), ctrl = journal.filter(x => x.type === "controle");
 const nbVides = compl.filter(x => /:0$/.test(x.reponse)).length;
 T.ok(compl.length === 9 && compl.every(x => x.srv === "europe"), "9 tuiles, toutes demandées au serveur Europe (" + compl.map(x => x.srv).join(",") + ")");
 T.ok(nbVides >= 2, "au moins deux tuiles entièrement en mer, vides (" + nbVides + ")");
 T.ok(ctrl.length === nbVides && ctrl.every(x => x.srv === "principal" && /:1$/.test(x.reponse)), "chaque tuile vide confirmée par une requête de contrôle légère au serveur principal (" + ctrl.length + ")");
 T.ok(await p.evaluate(() => !OVP.echecs["https://ovp.dresel.systems/api/interpreter"]), "aucun échec compté au serveur Europe");
 T.ok(!/Attention/.test(st), "pas d'avertissement");
 const sud = await partEau(p, 0.02, 0.9, 0.3, 0.98), nord = await partEau(p, 0, 0, 1, 0.4);
 T.ok(sud > 0.97, "tuile du bas sans trait de côte : en mer (" + Math.round(sud*100) + " %)");
 T.ok(nord < 0.08, "nord : à terre (eau " + Math.round(nord*100) + " %, rivières et étangs)");
 const {ile} = geoSynth(b, o);
 T.ok(await eauEn(p, ile.lon, ile.lat) < 0.5 && await eauEn(p, ile.lon, ile.lat - 3500/110574) >= 0.5, "île à terre, mer autour");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | "));
 await ctx.close(); });

/* ---------- 2. zone entièrement en mer, sans trait de côte ---------- */
test("zone entièrement en mer (aucun trait de côte)", async T => {
 const b = zoneDe(14.05, 40.55, 10), journal = [];
 const ctx = await contexte(T, b, {cote:false});
 await brancherOverpass(ctx, [], () => "jeu", journal);
 const p = await ouvrir(T, ctx); await lancer(p, 14.05, 40.55, 10, "Pleine mer"); const st = await fin(p);
 T.ok(/Terminé et enregistré/.test(st), "analyse terminée (" + st.slice(0, 120) + ")");
 T.ok(journal.length === 2 && journal[0].srv === "europe" && journal[1].type === "controle", "une requête Europe (vide) puis un contrôle (" + journal.map(x => x.srv + "/" + x.type).join(", ") + ")");
 T.ok(await partEau(p, 0, 0, 1, 1) === 1, "toute la zone en mer");
 T.ok(await p.evaluate(() => ARMS.every(a => G.cls[a].every(c => c === 0))), "classes : eau partout, pour chaque arme");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | "));
 await ctx.close(); });

/* ---------- 3. mer sans trait de côte : cas limites, calcul direct ---------- */
test("mer sans trait de côte : polder, terre vide, île seule en mer", async T => {
 const b = zoneDe(...NAPLES, 10), ctx = await contexte(T, b, {plat:0}), p = await ouvrir(T, ctx);
 await p.addScriptTag({content:geoSynth.toString() + "\n" + osmSynthetique.toString()});
 const r = await p.evaluate(() => {
  const b = bboxFrom({lng:14.25, lat:40.80}, 10000), n = 100, N = n*n, alt = v => new Float32Array(N).fill(v);
  const eau = f => f.L.eau.reduce((s, v) => s + (v >= 0.5), 0)/N;
  const terre = osmSynthetique(b, {cote:false, ile:false});
  const ileSeule = osmSynthetique(b, {cote:false, ile:true, coteLat:b.s + (b.n - b.s)*0.5 + 0.07}).filter(e => e.tags && e.tags.natural === "coastline");
  return {polder:eau(extractFacts(terre, b, n, 100, alt(-3))), vide:eau(extractFacts([], b, n, 100, alt(250))), merVide:eau(extractFacts([], b, n, 100, alt(-30))),
   sansRelief:eau(extractFacts([], b, n, 100)), ile:eau(extractFacts(ileSeule, b, n, 100, alt(-30))), ileHaut:eau(extractFacts(ileSeule, b, n, 100, alt(50)))};
 });
 T.ok(r.polder < 0.1, "polder sous 0 m avec routes et cultures : à terre (eau " + Math.round(r.polder*100) + " %)");
 T.ok(r.vide === 0, "zone sans objet à 250 m : à terre");
 T.ok(r.merVide === 1, "zone sans objet à −30 m : en mer");
 T.ok(r.sansRelief === 0, "sans relief fourni : à terre (comportement d'avant)");
 T.ok(r.ile > 0.7 && r.ile < 0.9, "île seule : mer autour, île à terre (eau " + Math.round(r.ile*100) + " %)");
 T.ok(Math.abs(r.ileHaut - r.ile) < 1e-9, "île : décidée par le trait de côte, pas par le relief");
 await ctx.close(); });

/* ---------- 4. bascule de serveur, puis remise à zéro des échecs à l'analyse suivante ---------- */
test("bascule de serveur et remise à zéro des échecs", async T => {
 const b = zoneDe(...NAPLES, 30), o = {coteLat:b.s - 0.2, ile:false}, els = osmSynthetique(b, o), journal = [];
 let panne = true;
 const ctx = await contexte(T, b, o);
 await brancherOverpass(ctx, els, srv => srv === "europe" && panne ? {status:502, corps:"Bad Gateway"} : "jeu", journal);
 const p = await ouvrir(T, ctx); await lancer(p, ...NAPLES, 30, "Panne Europe"); let st = await fin(p);
 T.ok(/Terminé et enregistré/.test(st), "analyse terminée malgré la panne (" + st.slice(0, 100) + ")");
 const eu = journal.filter(x => x.srv === "europe").length, pr = journal.filter(x => x.srv === "principal" && x.type === "complete").length;
 T.ok(journal[0].srv === "europe", "le serveur Europe est essayé d'abord");
 T.ok(eu >= 2 && eu <= 3 && pr === 9, "après deux échecs, Europe passe en dernier : " + eu + " essais Europe, " + pr + " tuiles au principal");
 T.ok(!journal.some(x => x.srv === "coffee"), "le serveur de secours n'est pas sollicité");
 T.ok(await p.evaluate(() => (OVP.echecs["https://ovp.dresel.systems/api/interpreter"] || 0) >= 2), "échecs Europe comptés pendant l'analyse");
 panne = false; const avant = journal.length;
 await lancer(p, NAPLES[0] + 0.01, NAPLES[1], 30, "Europe rétabli"); st = await fin(p);
 const suite = journal.slice(avant);
 T.ok(/Terminé et enregistré/.test(st) && suite[0].srv === "europe" && suite.filter(x => x.type === "complete").every(x => x.srv === "europe"), "analyse suivante : compteurs remis à zéro, Europe d'abord (" + suite.map(x => x.srv).join(",") + ")");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | "));
 await ctx.close(); });

/* ---------- 5. serveur Europe vide à tort (données manquantes) : échec compté, tuile prise au principal ---------- */
test("réponse vide à tort du serveur Europe", async T => {
 const b = zoneDe(...NAPLES, 30), o = {coteLat:b.s - 0.2, ile:false}, els = osmSynthetique(b, o), journal = [];
 const ctx = await contexte(T, b, o);
 await brancherOverpass(ctx, els, (srv, rq, type) => srv === "europe" ? "vide" : "jeu", journal);
 const p = await ouvrir(T, ctx); await lancer(p, ...NAPLES, 30, "Europe vide"); const st = await fin(p);
 T.ok(/Terminé et enregistré/.test(st), "analyse terminée (" + st.slice(0, 100) + ")");
 const eu = journal.filter(x => x.srv === "europe").length, pr = journal.filter(x => x.srv === "principal" && x.type === "complete").length;
 T.ok(eu >= 2 && eu <= 3 && pr === 9, "contrôle non nul → tuile demandée au principal ; Europe rétrogradé après deux erreurs (" + eu + " Europe, " + pr + " principal)");
 T.ok(await p.evaluate(() => G.ways.length > 1000), "les données sont bien là (" + await p.evaluate(() => G.ways.length) + " voies)");
 await ctx.close(); });

/* ---------- 6. tous les serveurs en échec : message clair, en français ---------- */
test("tous les serveurs en échec : message clair", async T => {
 const b = zoneDe(...NAPLES, 10), journal = [];
 const ctx = await contexte(T, b, {coteLat:b.s - 0.2});
 await brancherOverpass(ctx, [], srv => srv === "europe" ? {status:504, corps:"timeout"} : srv === "principal" ? {status:429, corps:"rate"} : {status:200, corps:"<html>erreur</html>"}, journal);
 const p = await ouvrir(T, ctx);
 await p.evaluate(() => { OVP_PAUSES.refus = 50; OVP_PAUSES.tour = 50; });
 await lancer(p, ...NAPLES, 10, "Panne générale"); const st = await fin(p, 60000);
 T.ok(/^Échec : OpenStreetMap indisponible pour la tuile 1\/1 : aucun serveur n'a répondu après 3 essais/.test(st), "message d'échec (" + st + ")");
 T.ok(/Europe : serveur saturé, délai dépassé \(HTTP 504\)/.test(st) && /principal : trop de demandes, serveur saturé \(HTTP 429\)/.test(st) && /private\.coffee : réponse illisible/.test(st), "cause donnée pour chaque serveur");
 T.ok(/Reprendre/.test(st) && (st.match(/Reprendre/g) || []).length === 1, "conseil de reprise, une seule fois");
 T.ok(journal.filter(x => x.srv === "coffee").length === 3, "le serveur de secours est essayé en dernier recours (3 tours)");
 T.ok(await p.isVisible("#resumeBox"), "bouton « Reprendre » proposé");
 await ctx.close(); });

/* ---------- 7. arrêt puis reprise : les tuiles déjà reçues ne sont pas redemandées ---------- */
test("reprise après arrêt sans retélécharger", async T => {
 const b = zoneDe(...NAPLES, 30), o = {coteLat:b.s + 0.15}, els = osmSynthetique(b, o), journal = [];
 const ctx = await contexte(T, b, o);
 await brancherOverpass(ctx, els, () => "jeu", journal, 400);
 const p = await ouvrir(T, ctx); await lancer(p, ...NAPLES, 30, "Reprise");
 await p.waitForFunction(() => /OpenStreetMap : tuile [4-8]\//.test(document.getElementById("progTxt").textContent), null, {timeout:60000});
 await p.click("#stopBtn"); let st = await fin(p);
 T.ok(/Analyse arrêtée/.test(st), "arrêt pris en compte (" + st.slice(0, 80) + ")");
 const enCache = await p.evaluate(async () => (await osmLire(tileKeys(elargir(pendGet().b, 500)))).filter(Boolean).length);
 T.ok(enCache >= 4 && enCache < 9, enCache + " tuiles gardées en cache");
 T.ok(await p.isVisible("#resumeGo"), "« Reprendre » proposé");
 const avant = journal.filter(x => x.type === "complete").length;
 await p.click("#resumeGo"); st = await fin(p);
 const apres = journal.filter(x => x.type === "complete").length - avant;
 T.ok(/Terminé et enregistré/.test(st) && new RegExp("\\(" + enCache + " tuile\\(s\\) reprise\\(s\\) du cache\\)").test(st), "reprise terminée, " + enCache + " tuiles relues du cache (" + st.slice(0, 160) + ")");
 T.ok(apres === 9 - enCache, "seules les tuiles manquantes sont téléchargées (" + apres + " = 9 − " + enCache + ")");
 await p.waitForTimeout(500);
 T.ok(await p.evaluate(async () => (await osmLire(tileKeys(elargir(G.b, 500)))).filter(Boolean).length === 0), "cache de la zone vidé une fois l'analyse enregistrée");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | "));
 await ctx.close(); });

/* ---------- 8. grande zone 50 × 50 km à 100 m : séquences, mêmes grilles, temps mesurés, arrêt réactif ---------- */
test("grande zone 50 km : calcul en séquences, mêmes résultats, temps", async T => {
 const b = zoneDe(...NAPLES, 50), o = {coteLat:b.s + 0.12, densite:+(process.env.DENSITE || 3)}, els = osmSynthetique(b, o), journal = [];
 const ctx = await contexte(T, b, o);
 await brancherOverpass(ctx, els, () => "jeu", journal);
 const p = await ouvrir(T, ctx);
 // surveillance de la page : plus longue période sans réponse (minuterie de 10 ms), par phase affichée
 await p.evaluate(() => { window.GEL = {}; let t = performance.now();
  const phase = () => (document.getElementById("progTxt").textContent.match(/^(Relief|OpenStreetMap|Calcul : [^–…]+|Réseau|Calcul|Enregistrement)/) || ["autre"])[0].trim();
  window.DUR = {}; let ph = phase(); setInterval(() => { const u = performance.now(); GEL[ph] = Math.max(GEL[ph] || 0, u - t); DUR[ph] = (DUR[ph] || 0) + u - t; t = u; ph = phase(); }, 10); });   // gel attribué à la phase affichée au début de l'attente
 const t0 = Date.now(); await lancer(p, ...NAPLES, 50, "Grande zone"); const st = await fin(p, 600000), duree = (Date.now() - t0)/1000;
 T.ok(/Terminé et enregistré/.test(st), "analyse 50 km terminée en " + duree.toFixed(1) + " s (" + st.slice(0, 200) + ")");
 const gel = await p.evaluate(() => GEL), dur = await p.evaluate(() => DUR);
 console.log("   durée par phase (ms) : " + Object.entries(dur).map(([k, v]) => k + " " + Math.round(v)).join(" · "));
 console.log("   page sans réponse au plus (ms) par phase : " + Object.entries(gel).map(([k, v]) => k + " " + Math.round(v)).join(" · "));
 for (const k of ["Calcul : relief", "Calcul : rastérisation", "Calcul : obstacles"]) if (gel[k] !== undefined) T.ok(gel[k] < 400, k + " : la page répond (gel max " + Math.round(gel[k]) + " ms)");
 // mêmes résultats : séquences = calcul d'un trait ; obstacles = barriers() du moteur
 const cmp = await p.evaluate(async () => {
  const h = a => { let x = 2166136261; const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < u.length; i++) x = Math.imul(x ^ u[i], 16777619); return (x >>> 0).toString(16); };
  const {els} = await loadOSM(elargir(G.b, 500), () => {});   // relu du cache ? non : cache vidé ; on retélécharge (simulé)
  const t = {}; let t1 = performance.now();
  const A = finir(extractFactsEtapes(els, G.b, G.n, G.cell, G.el)); t.trait = performance.now() - t1;
  ABORT = new AbortController(); t1 = performance.now(); const B = await enSequences(extractFactsEtapes(els, G.b, G.n, G.cell, G.el)); t.seq = performance.now() - t1;
  t1 = performance.now(); const F1 = barriers(A.M, G.n, A.W); t.barriers = performance.now() - t1;
  t1 = performance.now(); const F2 = await enSequences(barriersEtapes(A.M, G.n, A.W)); t.barriersSeq = performance.now() - t1; ABORT = null;
  const same = LAYERS.every(k => h(A.L[k]) === h(B.L[k]) && h(A.L[k]) === h(G.L[k])) && h(A.M) === h(B.M) && h(A.M) === h(G.M) && h(F1) === h(F2) && h(F1) === h(G.F)
   && JSON.stringify(A.ways) === JSON.stringify(B.ways) && JSON.stringify(A.pnodes) === JSON.stringify(G.pnodes);
  return {same, t, mer:G.L.eau.reduce((s, v) => s + (v >= 0.5), 0)/G.L.eau.length, n:G.n, W:A.W, nels:els.length};
 });
 T.ok(cmp.same, "grilles identiques : séquences = d'un trait = analyse ; obstacles = barriers() du moteur");
 console.log("   " + cmp.n + "×" + cmp.n + " mailles, canevas " + cmp.W + " px, " + cmp.nels + " objets OSM, mer " + Math.round(cmp.mer*100) + " % ; rastérisation d'un trait " + Math.round(cmp.t.trait) + " ms, en séquences " + Math.round(cmp.t.seq) + " ms ; obstacles " + Math.round(cmp.t.barriers) + " / " + Math.round(cmp.t.barriersSeq) + " ms");
 // arrêt pendant la rastérisation : pris en compte vite
 await p.evaluate(() => { const s = performance.now(); window.T_ARRET = null; new MutationObserver((m, o) => { if (/arrêtée/.test(document.getElementById("status").textContent)) { T_ARRET = performance.now() - window.T_CLIC; o.disconnect(); } }).observe(document.getElementById("status"), {childList:true, characterData:true, subtree:true}); });
 await lancer(p, ...NAPLES, 50, "Arrêt");
 await p.waitForFunction(() => /rastérisation/.test(document.getElementById("progTxt").textContent), null, {timeout:300000});
 await p.evaluate(() => { window.T_CLIC = performance.now(); document.getElementById("stopBtn").click(); });
 await fin(p); const ta = await p.evaluate(() => T_ARRET);
 T.ok(ta !== null && ta < 500, "« Arrêter » pendant la rastérisation : arrêt en " + Math.round(ta) + " ms");
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | "));
 await ctx.close(); });

/* ---------- 9. profondeur et largeur OSM des cours d'eau → règle verdictEau du moteur, jusqu'au calcul des trajets ---------- */
test("cours d'eau : profondeur OSM lue, gué selon la classe", async T => {
 const b = zoneDe(...NAPLES, 5), ctx = await contexte(T, b, {plat:100}), p = await ouvrir(T, ctx);
 const r = await p.evaluate(() => {
  const b = bboxFrom({lng:14.25, lat:40.80}, 5000), n = 50, cell = 100, N = n*n, lon = (b.w + b.e)/2;
  const riv = tags => [{type:"way", id:1, tags:Object.assign({waterway:"river", name:"Test"}, tags), nodes:[1, 2], geometry:[{lat:b.n + 0.01, lon}, {lat:b.s - 0.01, lon}]}];
  const cas = {etroite_peu_profonde:{width:"8", depth:"0,7"}, profondeur_absente:{width:"8 m"}, trop_profonde:{width:"8", depth:"1.2"}, large_peu_profonde:{width:"30", depth:"0.4"}};
  const out = {};
  for (const [nom, tags] of Object.entries(cas)) {
   const f = extractFacts(riv(tags), b, n, cell), z = new Float32Array(N);
   const zone = {id:"t-" + nom, nom, date:"test", faits:Object.assign({b, n, cell, sl:z, el:new Float32Array(N).fill(100), gx:z, gy:z}, f)};
   calculerZone(zone);
   const a = 25*n + 5, c = 25*n + 44;   // même ligne, de part et d'autre de la rivière (colonne 25)
   out[nom] = {riv:G.rivs.map(x => ({w:x.w, p:x.p})), passe:Object.fromEntries(ARMS.map(k => [k, isFinite(search([a], k)[c])])),
    verdict:Object.fromEntries(ARMS.map(k => [k, verdictEau(G.rivs[0], k).ok]))};
  }
  return out;
 });
 const att = {etroite_peu_profonde:{chenille:true, roue:true, logistique:false, fantassin:true}, profondeur_absente:{chenille:false, roue:false, logistique:false, fantassin:false},
  trop_profonde:{chenille:false, roue:false, logistique:false, fantassin:false}, large_peu_profonde:{chenille:true, roue:false, logistique:false, fantassin:false}};
 T.ok(r.etroite_peu_profonde.riv[0].w === 8 && r.etroite_peu_profonde.riv[0].p === 0.7, "largeur 8 m et profondeur « 0,7 » lues dans OSM (" + JSON.stringify(r.etroite_peu_profonde.riv) + ")");
 T.ok(r.profondeur_absente.riv[0].w === 8 && r.profondeur_absente.riv[0].p === 0, "« 8 m » lu 8 m ; profondeur absente : 0 (valeur supposée par le moteur)");
 for (const [nom, a] of Object.entries(att)) {
  T.ok(JSON.stringify(r[nom].verdict) === JSON.stringify(a), nom + " : verdict par classe " + JSON.stringify(r[nom].verdict));
  T.ok(JSON.stringify(r[nom].passe) === JSON.stringify(a), nom + " : trajet tout-terrain à travers la rivière " + JSON.stringify(r[nom].passe));
 }
 T.ok(p.erreurs.length === 0, "aucune erreur de script " + p.erreurs.join(" | "));
 await ctx.close(); });

/* ---------- lancement ---------- */
if (require.main === module) (async () => {
 const filtre = process.argv[2], {server, base} = await H.serveur(), b = await H.navigateur(); let n = 0;
 for (const t of tests) { if (filtre && !t.nom.toLowerCase().includes(filtre.toLowerCase())) continue; n++;
  const T = {b, base, pages:[], ok:(c, m) => { if (!c) { echecs.push(t.nom + " : " + m); console.log("   ✗ " + m); } else console.log("   ✓ " + m); }};
  const t0 = Date.now(); process.stdout.write("• " + t.nom + "\n");
  try { await t.fn(T); } catch(e) { echecs.push(t.nom + " : EXCEPTION " + e.message.split("\n")[0]); console.log("   ✗ exception : " + e.message.split("\n")[0]); }
  for (const p of T.pages) { try { const e = await p.evaluate(() => { const b = document.getElementById("cgErr"); return b && b.textContent; }); if (e) T.ok(false, "bannière d'erreur visible : " + e); } catch(e) {} }
  console.log("   (" + Math.round((Date.now() - t0)/1000) + " s)"); }
 await b.close(); server.close();
 console.log("\n" + (echecs.length ? "ÉCHECS (" + echecs.length + ") :\n - " + echecs.join("\n - ") : "Tous les tests de données passent (" + n + " scénarios)."));
 process.exit(echecs.length ? 1 : 0);
})();
module.exports = {osmSynthetique, geoSynth, decouper, lireRequete, reliefCotier, PIXEL};
