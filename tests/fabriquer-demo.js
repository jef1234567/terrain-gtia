/* Fabrique terrain-demo.json (contrat terrain-gtia v3) à partir de la démonstration v2 d'origine
   (tests/fixtures/terrain-demo-v2.json), par le chemin d'export de l'outil terrain : chargerTerrain puis documentTerrain.
     node tests/fabriquer-demo.js            # écrit terrain-demo.json
     node tests/fabriquer-demo.js --verifier # vérifie seulement que terrain-demo.json est à jour (code 1 sinon)

   Ajout aux faits de la démonstration (terrain synthétique) : un affluent ouest-est, « Ru de démonstration », de 18 m de large
   et 0,9 m de profond, qui rejoint la rivière principale au sud de la D1, avec un pont sur la route tertiaire ouest.
   Avec les seuils par défaut (DEF_TERRAIN), seul le chenillé le passe à gué (40 m / 1 m) ; roue (0,8 m), logistique
   (15 m / 0,5 m) et fantassin (0,8 m) doivent prendre le pont. La rivière principale reste infranchissable hors pont et gué. */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.resolve(__dirname, "..");
const ctx = vm.createContext({console, atob, btoa, performance, setTimeout, requestAnimationFrame:f => setTimeout(f, 0)});
vm.runInContext("var G = null, P = null;", ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, "moteur-terrain.js"), "utf8"), ctx, {filename:"moteur-terrain.js"});
const M = new Proxy({}, {get:(_, k) => vm.runInContext(k, ctx)});

const RU = {id:"eau:w900100", nm:"Ru de démonstration", largeur_m:18, profondeur_m:0.9};
const X_ROUTE = -0.110091;   // route tertiaire ouest (verticale)

function fabriquer(){
 const o = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "terrain-demo-v2.json"), "utf8"));
 const f = o.faits, b = f.bbox, n = f.n, W = f.W, cell = f.maille_m;
 const Mb = M.dec(f.obstacles_fins.donnees), eau = M.dec(f.grilles.fraction_eau);
 const px = lon => (lon - b.w)/(b.e - b.w)*W, py = lat => (b.n - lat)/(b.n - b.s)*W;
 const lon = x => b.w + x/W*(b.e - b.w), lat = y => b.n - y/W*(b.n - b.s);
 // tracé : du bord ouest à la rive ouest de la rivière principale (premier pixel d'eau déjà présent)
 const pts = [[b.w + 1e-6, 47.2470], [-0.125, 47.2462], [X_ROUTE, 47.2456], [-0.098, 47.2450], [-0.088, 47.2460], [-0.070, 47.2466]];
 const trace = [], vus = new Set(); let fin = null, prec = null;
 const marquer = (x, y) => { const k = y*W + x; if (vus.has(k)) return; vus.add(k); trace.push([x, y]); };
 boucle: for (let q = 1; q < pts.length; q++) {
  const x0 = px(pts[q-1][0]), y0 = py(pts[q-1][1]), x1 = px(pts[q][0]), y1 = py(pts[q][1]), pas = Math.ceil(Math.hypot(x1 - x0, y1 - y0)*4);
  for (let s = 0; s <= pas; s++) {
   const x = Math.floor(x0 + (x1 - x0)*s/pas), y = Math.floor(y0 + (y1 - y0)*s/pas);
   if (Mb[y*W + x] & M.BIT.eau && !vus.has(y*W + x)) { fin = [lon(x), lat(y + 0.5)]; break boucle; }   // rivière principale atteinte
   if (prec && prec[0] !== x && prec[1] !== y) marquer(x, prec[1]);   // tracé 4-connexe : pas de passage en diagonale entre deux pixels
   marquer(x, y); prec = [x, y];
  }
 }
 if (!fin) throw new Error("le ru n'atteint pas la rivière principale");
 for (const [x, y] of trace) Mb[y*W + x] |= M.BIT.eau;
 // part d'eau des mailles traversées : 18 m sur 100 m
 const parMaille = new Map(); for (const [x, y] of trace) { const c = Math.floor(y/(W/n))*n + Math.floor(x/(W/n)); parMaille.set(c, 1); }
 for (const c of parMaille.keys()) eau[c] = Math.max(eau[c], RU.largeur_m/cell);
 f.obstacles_fins.donnees = M.enc(Mb); f.grilles.fraction_eau = M.enc(eau);
 // tronçon de cours d'eau (tracé jusqu'à la rive ouest)
 const g = pts.filter(p => px(p[0]) < px(fin[0])); g.push(fin);
 f.cours_eau = (f.cours_eau || []).concat([{id:RU.id, w:RU.largeur_m, p:RU.profondeur_m, k:"r", nm:RU.nm, g:g.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)])}]);
 // pont de la route tertiaire ouest sur le ru : la voie est coupée en trois (avant, pont, après), raccordée par coordonnées
 const yRu = pts[2][1], i = f.voies.findIndex(w => w.hw === "tertiary" && Math.abs(w.g[0][0] - X_ROUTE) < 1e-6);
 if (i < 0) throw new Error("route tertiaire ouest introuvable");
 const w = f.voies[i], s = +(yRu - 0.0009).toFixed(6), nn = +(yRu + 0.0009).toFixed(6);
 const avant = w.g.filter(p => p[1] < s).concat([[X_ROUTE, s]]), apres = [[X_ROUTE, nn]].concat(w.g.filter(p => p[1] > nn));
 f.voies.splice(i, 1, Object.assign({}, w, {g:avant}), Object.assign({}, w, {br:1, nm:"Pont du Ru", g:[[X_ROUTE, s], [X_ROUTE, nn]]}), Object.assign({}, w, {g:apres}));
 // chemin d'export de l'outil terrain
 M.chargerTerrain(o);
 return JSON.stringify(M.documentTerrain());
}

const doc = fabriquer(), cible = path.join(ROOT, "terrain-demo.json");
if (process.argv.includes("--verifier")) {
 const ok = fs.existsSync(cible) && fs.readFileSync(cible, "utf8") === doc;
 console.log(ok ? "terrain-demo.json à jour" : "terrain-demo.json différent de ce que produit tests/fabriquer-demo.js");
 process.exit(ok ? 0 : 1);
}
fs.writeFileSync(cible, doc);
console.log("terrain-demo.json écrit (" + Math.round(doc.length/1024) + " Ko, contrat v3)");
