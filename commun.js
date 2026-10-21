/* commun.js – fonctions d'interface partagées par les trois outils terrain-gtia :
   coordonnées MGRS, « Aller à », barre de coordonnées et infos au survol, fonds monde,
   export KML, carte en image et impression, raccourcis communs, message d'erreur visible.
   Tout est rangé dans l'objet CG pour ne pas entrer en conflit avec les noms des pages. */
"use strict";
const CG = {};

/* ---------- erreur visible (au lieu d'une page vide) ---------- */
CG.alerte = (txt) => {
 let b = document.getElementById("cgErr");
 if (!b) { b = document.createElement("div"); b.id = "cgErr";
  b.style.cssText = "position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:99;background:#b3261e;color:#fff;font:13px system-ui;padding:8px 12px;border-radius:8px;max-width:min(640px,92vw);box-shadow:0 2px 10px rgba(0,0,0,.35);cursor:pointer";
  b.title = "Cliquer pour fermer"; b.onclick = () => b.remove(); document.body.appendChild(b); }
 b.textContent = txt;
};
window.addEventListener("error", e => { if (e && e.message && !/ResizeObserver/.test(e.message)) CG.alerte("Erreur de l'outil : " + e.message + " (cliquer pour fermer). Rechargez la page ; si l'erreur revient, notez-la."); });
document.addEventListener("DOMContentLoaded", () => {
 if (!window.maplibregl) CG.alerte("La bibliothèque de carte (lib/maplibre-gl.js) n'a pas pu être chargée : ouvrez l'outil depuis son dossier complet ou depuis la page en ligne.");
 else if (maplibregl.supported && !maplibregl.supported()) CG.alerte("Ce navigateur ne peut pas afficher la carte (WebGL désactivé). Essayez Chrome, Edge ou Firefox à jour, accélération matérielle activée.");
});

/* ---------- MGRS (WGS84) ---------- */
const UTM_A = 6378137, UTM_F = 1/298.257223563, UTM_K0 = 0.9996, UTM_E2 = UTM_F*(2 - UTM_F), UTM_EP2 = UTM_E2/(1 - UTM_E2);
const BANDES = "CDEFGHJKLMNPQRSTUVWXX", COLS = ["ABCDEFGH", "JKLMNPQR", "STUVWXYZ"], LIGNES = "ABCDEFGHJKLMNPQRSTUV";
function utmZone(lon, lat){
 let z = Math.floor((lon + 180)/6) + 1; if (z > 60) z = 60;
 if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) z = 32;                      // Norvège
 if (lat >= 72 && lat < 84) { if (lon >= 0 && lon < 9) z = 31; else if (lon >= 9 && lon < 21) z = 33; else if (lon >= 21 && lon < 33) z = 35; else if (lon >= 33 && lon < 42) z = 37; }   // Svalbard
 return z;
}
function utmDe(lon, lat, zone){
 const e2 = UTM_E2, e4 = e2*e2, e6 = e4*e2, ph = lat*Math.PI/180, l0 = ((zone - 1)*6 - 180 + 3)*Math.PI/180;
 const s = Math.sin(ph), c = Math.cos(ph), t = Math.tan(ph);
 const N = UTM_A/Math.sqrt(1 - e2*s*s), T = t*t, C = UTM_EP2*c*c, A = c*(lon*Math.PI/180 - l0);
 const M = UTM_A*((1 - e2/4 - 3*e4/64 - 5*e6/256)*ph - (3*e2/8 + 3*e4/32 + 45*e6/1024)*Math.sin(2*ph) + (15*e4/256 + 45*e6/1024)*Math.sin(4*ph) - (35*e6/3072)*Math.sin(6*ph));
 const x = UTM_K0*N*(A + (1 - T + C)*A**3/6 + (5 - 18*T + T*T + 72*C - 58*UTM_EP2)*A**5/120) + 500000;
 let y = UTM_K0*(M + N*t*(A*A/2 + (5 - T + 9*C + 4*C*C)*A**4/24 + (61 - 58*T + T*T + 600*C - 330*UTM_EP2)*A**6/720));
 if (lat < 0) y += 10000000;
 return [x, y];
}
function utmVers(x, y, zone, sud){
 const e2 = UTM_E2, e4 = e2*e2, e6 = e4*e2, e1 = (1 - Math.sqrt(1 - e2))/(1 + Math.sqrt(1 - e2));
 const M = (y - (sud ? 10000000 : 0))/UTM_K0, mu = M/(UTM_A*(1 - e2/4 - 3*e4/64 - 5*e6/256));
 const p1 = mu + (3*e1/2 - 27*e1**3/32)*Math.sin(2*mu) + (21*e1*e1/16 - 55*e1**4/32)*Math.sin(4*mu) + (151*e1**3/96)*Math.sin(6*mu) + (1097*e1**4/512)*Math.sin(8*mu);
 const s = Math.sin(p1), c = Math.cos(p1), t = Math.tan(p1);
 const C1 = UTM_EP2*c*c, T1 = t*t, N1 = UTM_A/Math.sqrt(1 - e2*s*s), R1 = UTM_A*(1 - e2)/Math.pow(1 - e2*s*s, 1.5), D = (x - 500000)/(N1*UTM_K0);
 const ph = p1 - (N1*t/R1)*(D*D/2 - (5 + 3*T1 + 10*C1 - 4*C1*C1 - 9*UTM_EP2)*D**4/24 + (61 + 90*T1 + 298*C1 + 45*T1*T1 - 252*UTM_EP2 - 3*C1*C1)*D**6/720);
 const l = (D - (1 + 2*T1 + C1)*D**3/6 + (5 - 2*C1 + 28*T1 - 3*C1*C1 + 8*UTM_EP2 + 24*T1*T1)*D**5/120)/c;
 return [((zone - 1)*6 - 180 + 3) + l*180/Math.PI, ph*180/Math.PI];
}
// lon, lat → « 33T VF 38466 22362 » (chiffres = 5 par axe : mètre ; 4 : 10 m ; 3 : 100 m)
CG.mgrs = (lon, lat, chiffres = 5) => {
 if (!(lat >= -80 && lat < 84)) return "hors MGRS (pôles)";
 const z = utmZone(lon, lat), [x, y] = utmDe(lon, lat, z), bande = BANDES[Math.floor((lat + 80)/8)];
 const col = COLS[(z - 1) % 3][Math.floor(x/100000) - 1], lig = LIGNES[(Math.floor(y/100000) + (z % 2 ? 0 : 5)) % 20];
 const d = 10**(5 - chiffres), f = v => String(Math.floor((v % 100000)/d)).padStart(chiffres, "0");
 return `${z}${bande} ${col}${lig} ${f(x)} ${f(y)}`;
};
// « 33TVF3846622362 », « 33T VF 384 223 »… → [lon, lat] (centre du carré désigné) ou null
CG.lireMGRS = txt => {
 const m = String(txt).toUpperCase().replace(/\s+/g, "").match(/^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z])([A-HJ-NP-V])(\d*)$/);
 if (!m || m[5].length % 2 || m[5].length > 10) return null;
 const z = +m[1], bi = BANDES.indexOf(m[2]); if (z < 1 || z > 60 || bi < 0) return null;
 const ci = COLS[(z - 1) % 3].indexOf(m[3]), ri = LIGNES.indexOf(m[4]); if (ci < 0 || ri < 0) return null;
 const k = m[5].length/2, pas = 10**(5 - k), e = k ? +m[5].slice(0, k)*pas : 0, n = k ? +m[5].slice(k)*pas : 0;
 const x = (ci + 1)*100000 + e + pas/2, latB = -80 + 8*bi, sud = latB < 0;
 let y = ((ri - (z % 2 ? 0 : 5) + 20) % 20)*100000 + n + pas/2;
 const yMin = utmDe(((z - 1)*6 - 180 + 3), latB, z)[1];        // nord minimal de la bande (au méridien central)
 while (y < yMin - 1) y += 2000000;
 const [lon, lat] = utmVers(x, y, z, sud);
 return [lon, lat];
};
CG.ddm = (lon, lat) => `${Math.abs(lat).toFixed(5).replace(".", ",")}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(5).replace(".", ",")}° ${lon >= 0 ? "E" : "O"}`;
CG.position = (ll) => `${CG.mgrs(ll[0], ll[1])} (${CG.ddm(ll[0], ll[1])})`;
// texte saisi : MGRS, « 40.85 14.27 », « 40,85 ; 14,27 », « 40°51'N 14°16'E »
CG.lirePosition = txt => {
 const t = String(txt).trim(); if (!t) return null;
 const m = CG.lireMGRS(t); if (m) return {ll:m, quoi:"Point MGRS"};
 const dms = [...t.matchAll(/(\d+(?:[.,]\d+)?)\s*°\s*(?:(\d+(?:[.,]\d+)?)\s*['′]\s*)?(?:(\d+(?:[.,]\d+)?)\s*(?:"|″|''))?\s*([NSEOW])/gi)];
 if (dms.length === 2) { const v = d => (+d[1].replace(",", ".") + (+(d[2] || "0").replace(",", "."))/60 + (+(d[3] || "0").replace(",", "."))/3600)*(/[SOW]/i.test(d[4]) ? -1 : 1);
  const a = dms.find(d => /[NS]/i.test(d[4])), b = dms.find(d => /[EOW]/i.test(d[4])); if (a && b) return {ll:[v(b), v(a)], quoi:"coordonnées"}; }
 const nums = t.includes(";") || (t.match(/,/g) || []).length === 2 || /^\s*-?\d+,\d+\s+-?\d+,\d+\s*$/.test(t)
  ? t.split(/[;\s]+/).filter(Boolean).map(x => x.replace(",", ".")) : t.split(/[,;\s]+/).filter(Boolean);
 if (nums.length === 2 && nums.every(x => /^-?\d+(\.\d+)?$/.test(x))) { const la = +nums[0], lo = +nums[1];
  if (Math.abs(la) <= 90 && Math.abs(lo) <= 180) return {ll:[lo, la], quoi:"latitude, longitude"}; }
 return null;
};

/* ---------- « Aller à » : MGRS, coordonnées ou nom de lieu ---------- */
CG.allerA = (map, opts = {}) => {
 const box = document.createElement("form"); box.className = "cg-aller";
 box.innerHTML = `<input type="text" placeholder="Aller à : MGRS, coordonnées ou lieu" title="Exemples : 33T VF 38466 22362 · 40.85 14.27 · Caserta (Ctrl+F)" aria-label="Aller à"><button type="submit" title="Aller">➜</button>`;
 (opts.parent || document.body).appendChild(box);
 const inp = box.querySelector("input"); let mk = null, mt = null;
 const poser = (ll, txt) => { if (mk) mk.remove(); clearTimeout(mt);
  const el = document.createElement("div"); el.className = "cg-pin"; el.title = txt;
  mk = new maplibregl.Marker({element:el, anchor:"bottom"}).setLngLat(ll).addTo(map); mt = setTimeout(() => { if (mk) mk.remove(); mk = null; }, 15000);
  const vol = {center:ll, zoom:Math.max(map.getZoom(), opts.zoom || 13)}; if (opts.padding) vol.padding = opts.padding(); map.flyTo(vol);
  if (opts.message) opts.message(txt + " – " + CG.position(ll)); if (opts.apres) opts.apres(ll); };
 box.onsubmit = async e => { e.preventDefault(); const t = inp.value.trim(); if (!t) return;
  const p = CG.lirePosition(t); if (p) return poser(p.ll, p.quoi);
  if (opts.message) opts.message("Recherche de « " + t + " »…");
  try { const r = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=fr&q=" + encodeURIComponent(t));
   const j = await r.json(); if (!j.length) throw new Error("lieu introuvable");
   poser([+j[0].lon, +j[0].lat], j[0].display_name.split(",").slice(0, 3).join(","));
  } catch(err) { if (opts.message) opts.message("« " + t + " » : " + (err.message === "lieu introuvable" ? "lieu introuvable" : "recherche de lieu impossible (réseau)") + ". MGRS et coordonnées marchent sans réseau.", true); } };
 document.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); inp.focus(); inp.select(); } });
 return box;
};

/* ---------- barre de coordonnées et infos au survol ---------- */
CG.barreCoord = (map, infoFn) => {
 const bar = document.createElement("div"); bar.className = "cg-coord"; bar.textContent = "Survolez la carte : coordonnées MGRS";
 document.body.appendChild(bar); let raf = 0, last = null;
 const maj = () => { raf = 0; if (!last) return; const {lng, lat} = last;
  let info = ""; try { info = infoFn ? infoFn(last) || "" : ""; } catch(e) { info = ""; }
  bar.innerHTML = `<b>${CG.mgrs(lng, lat)}</b> <span class="cg-dd">${CG.ddm(lng, lat)}</span>${info ? " · " + info : ""}`; };
 map.on("mousemove", e => { last = e.lngLat; if (!raf) raf = requestAnimationFrame(maj); });
 map.on("mouseout", () => { last = null; });
 return bar;
};

/* ---------- carte prête ----------
   L'événement « load » de la carte n'arrive pas quand un serveur de tuiles répond par une erreur HTTP (fond bloqué par un
   pare-feu, relief indisponible) : la page restait alors vide. On démarre dès que le style est prêt, quel que soit l'événement. */
CG.quandPret = (map, f) => { let fait = false; const go = () => { if (!fait && map.isStyleLoaded()) { fait = true; f(); } };
 map.on("style.load", go); map.on("load", go); map.on("idle", go); map.on("data", go); setTimeout(go, 0); const t = setInterval(() => { go(); if (fait) clearInterval(t); }, 300); };
/* ---------- fonds de carte ---------- */
CG.IGN = (layer, fmt) => "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=" + layer + "&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=" + fmt;
CG.FONDS = {
 osm: {type:"raster", tiles:["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize:256, maxzoom:19, attribution:"© contributeurs OpenStreetMap"},
 ignplan: {type:"raster", tiles:[CG.IGN("GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2","image/png")], tileSize:256, maxzoom:18, attribution:"© IGN"},
 ignortho: {type:"raster", tiles:[CG.IGN("ORTHOIMAGERY.ORTHOPHOTOS","image/jpeg")], tileSize:256, maxzoom:19, attribution:"© IGN"},
 esri: {type:"raster", tiles:["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], tileSize:256, maxzoom:19, attribution:"Photo © Esri, Maxar, Earthstar Geographics"},
 otm: {type:"raster", tiles:["https://a.tile.opentopomap.org/{z}/{x}/{y}.png","https://b.tile.opentopomap.org/{z}/{x}/{y}.png","https://c.tile.opentopomap.org/{z}/{x}/{y}.png"], tileSize:256, maxzoom:17, attribution:"© OpenTopoMap (CC-BY-SA), © contributeurs OpenStreetMap"}
};
CG.FONDS_LBL = {ignplan:"IGN plan (France)", ignortho:"IGN photo (France)", osm:"OSM (en ligne seulement)", esri:"Photo monde (Esri)", otm:"Topo monde (OpenTopoMap)"};
// emprise grossière de la métropole et de la Corse, où les fonds IGN sont garantis
CG.enFrance = (lon, lat) => lon > -5.5 && lon < 9.9 && lat > 41.2 && lat < 51.2;
// zone hors de France avec un fond IGN : passage sur « Photo monde » (renvoie un message, ou "")
CG.fondPourZone = (b, select) => {
 const lon = (b.w + b.e)/2, lat = (b.n + b.s)/2;
 if (CG.enFrance(lon, lat) || !select || !select.value.startsWith("ign")) return "";
 select.value = "esri"; select.dispatchEvent(new Event("change"));
 return "Zone hors de France : fond « Photo monde » affiché (les fonds IGN ne couvrent que la France).";
};

/* ---------- divers ---------- */
CG.horsSaisie = e => { const t = e.target; return !(t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || (t.tagName === "INPUT" && !/^(radio|checkbox|range|button|file|submit)$/.test(t.type))); };
CG.fermerPopups = () => { const b = document.querySelectorAll(".maplibregl-popup-close-button"); b.forEach(x => x.click()); return b.length > 0; };
CG.telecharger = (nom, contenu, type = "text/plain;charset=utf-8") => {
 const blob = contenu instanceof Blob ? contenu : new Blob([contenu], {type}), a = document.createElement("a");
 a.href = URL.createObjectURL(blob); a.download = nom; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
CG.nomFichier = s => String(s || "zone").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w\-]+/g, "_").slice(0, 60);
CG.dateCourte = () => new Date().toLocaleString("fr-FR", {dateStyle:"short", timeStyle:"short"});

/* ---------- KML (Google Earth, Géoportail, QGIS) ---------- */
const xe = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const kc = (hex, a = 1) => { const h = hex.replace("#", ""); return [Math.round(a*255).toString(16).padStart(2, "0"), h.slice(4, 6), h.slice(2, 4), h.slice(0, 2)].join(""); };   // #rrggbb → aabbggrr
const kpts = pts => pts.map(p => (+p[0]).toFixed(6) + "," + (+p[1]).toFixed(6)).join(" ");
// dossiers : [{nom, items:[{nom, desc, pt:[lon,lat] | ligne:[[lon,lat],…] | polys:[anneau,…], couleur:"#rrggbb", remplissage:0-1, epaisseur}] }]
CG.kml = (titre, dossiers, note) => {
 const styles = new Map(), sid = it => { const k = [it.couleur || "#d50000", it.remplissage ?? 0.35, it.epaisseur ?? 2, it.pt ? "p" : it.ligne ? "l" : "a"].join("|");
  if (!styles.has(k)) styles.set(k, "s" + styles.size); return styles.get(k); };
 const corps = dossiers.filter(d => d.items && d.items.length).map(d => `<Folder><name>${xe(d.nom)}</name>${d.ouvert ? "<open>1</open>" : ""}\n` + d.items.map(it => {
  const st = sid(it), desc = it.desc ? `<description>${xe(it.desc)}</description>` : "";
  let g = "";
  if (it.pt) g = `<Point><coordinates>${kpts([it.pt])}</coordinates></Point>`;
  else if (it.ligne) g = `<LineString><tessellate>1</tessellate><coordinates>${kpts(it.ligne)}</coordinates></LineString>`;
  else if (it.polys) g = (it.polys.length > 1 ? "<MultiGeometry>" : "") + it.polys.map(r => `<Polygon><outerBoundaryIs><LinearRing><coordinates>${kpts(r)}</coordinates></LinearRing></outerBoundaryIs></Polygon>`).join("") + (it.polys.length > 1 ? "</MultiGeometry>" : "");
  return `<Placemark><name>${xe(it.nom)}</name>${desc}<styleUrl>#${st}</styleUrl>${g}</Placemark>`;
 }).join("\n") + `\n</Folder>`).join("\n");
 const sty = [...styles].map(([k, id]) => { const [c, a, w, t] = k.split("|");
  if (t === "p") return `<Style id="${id}"><IconStyle><color>${kc(c)}</color><scale>0.9</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle><LabelStyle><scale>0.8</scale></LabelStyle></Style>`;
  if (t === "l") return `<Style id="${id}"><LineStyle><color>${kc(c)}</color><width>${w}</width></LineStyle></Style>`;
  return `<Style id="${id}"><LineStyle><color>${kc(c)}</color><width>${w}</width></LineStyle><PolyStyle><color>${kc(c, +a)}</color><outline>${+w > 0 ? 1 : 0}</outline></PolyStyle></Style>`; }).join("\n");
 return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xe(titre)}</name>${note ? `<description>${xe(note)}</description>` : ""}\n${sty}\n${corps}\n</Document></kml>\n`;
};
// masque de mailles (grille n×n, ligne 0 au nord) → rectangles fusionnés [anneau lon/lat] (lignes, puis colonnes identiques)
CG.masquePolys = (mask, n, b) => {
 const X = i => b.w + i/n*(b.e - b.w), Y = j => b.n - j/n*(b.n - b.s), out = []; let ouverts = new Map();
 const fermer = (k, r) => out.push([[X(r.i0), Y(r.j0)], [X(r.i1), Y(r.j0)], [X(r.i1), Y(r.j1)], [X(r.i0), Y(r.j1)], [X(r.i0), Y(r.j0)]]);
 for (let j = 0; j <= n; j++) {
  const runs = new Map();
  if (j < n) for (let i = 0; i < n; ) { if (!mask[j*n + i]) { i++; continue; } const i0 = i; while (i < n && mask[j*n + i]) i++; runs.set(i0 + ":" + i, [i0, i]); }
  const nv = new Map();
  for (const [k, [i0, i1]] of runs) { const r = ouverts.get(k); if (r) { r.j1 = j + 1; nv.set(k, r); ouverts.delete(k); } else nv.set(k, {i0, i1, j0:j, j1:j + 1}); }
  for (const [k, r] of ouverts) fermer(k, r);
  ouverts = nv;
 }
 return out;
};
CG.cercle = (lon, lat, r, nb = 48) => { const kx = 111320*Math.cos(lat*Math.PI/180), pts = [];
 for (let a = 0; a <= nb; a++) { const t = a/nb*2*Math.PI; pts.push([lon + r*Math.sin(t)/kx, lat + r*Math.cos(t)/110574]); } return pts; };

/* ---------- carte en image (.png) et impression (PDF) ---------- */
// capture du canevas de la carte (dans l'événement « render », le tampon WebGL est encore valide)
CG.capture = map => new Promise(res => { map.once("render", () => res(map.getCanvas().toDataURL("image/png"))); map.triggerRepaint(); });
// image composée : carte + symboles posés (marqueurs HTML) + bandeau (titre, date, échelle, nord, légende, MGRS du centre)
CG.imageCarte = async (map, o = {}) => {
 const url = await CG.capture(map), img = new Image(); img.src = url; await img.decode();
 const dpr = img.width/map.getContainer().clientWidth, W = img.width, leg = o.legende || [], lignes = o.lignes || [];
 const fs = Math.round(13*dpr), lh = Math.round(fs*1.45), marge = 10*dpr;
 // légende en lignes : chaque élément prend sa largeur réelle, retour à la ligne quand il n'y a plus de place
 const m = document.createElement("canvas").getContext("2d"); m.font = `${fs}px system-ui, sans-serif`;
 const pos = []; let lx = marge, ly = 0;
 for (const [, txt] of leg) { const w = fs*1.5 + m.measureText(txt).width + fs*1.6; if (lx > marge && lx + w > W - marge) { lx = marge; ly++; } pos.push([lx, ly]); lx += w; }
 const nLeg = leg.length ? ly + 1 : 0;
 const H = img.height + Math.round(14*dpr) + lh*(2 + lignes.length + nLeg) + Math.round(10*dpr);
 const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
 g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); g.drawImage(img, 0, 0);
 const rect = map.getContainer().getBoundingClientRect();
 document.querySelectorAll(".maplibregl-marker").forEach(el => {               // symboles HTML (départ, objectifs, contacts, zones, horaires…)
  if (el.offsetParent === null || !el.textContent.trim()) return; const r = el.getBoundingClientRect(), cs = getComputedStyle(el.firstElementChild || el);
  const x = (r.left - rect.left)*dpr, y = (r.top - rect.top)*dpr, w = r.width*dpr, h = r.height*dpr; if (x + w < 0 || y + h < 0 || x > W || y > img.height) return;
  g.fillStyle = cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)" ? cs.backgroundColor : "#333"; g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, 8*dpr) : g.rect(x, y, w, h); g.fill();
  g.fillStyle = cs.color || "#fff"; g.font = `700 ${Math.round(11*dpr)}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(el.textContent.trim(), x + w/2, y + h/2); });
 g.textAlign = "left"; g.textBaseline = "alphabetic";
 // nord et échelle sur la carte
 const br = map.getBearing()*Math.PI/180, nx = W - 34*dpr, ny = 44*dpr;
 g.save(); g.translate(nx, ny); g.rotate(-br); g.fillStyle = "rgba(255,255,255,.9)"; g.beginPath(); g.arc(0, 0, 18*dpr, 0, 2*Math.PI); g.fill();
 g.fillStyle = "#1d2430"; g.beginPath(); g.moveTo(0, -14*dpr); g.lineTo(7*dpr, 8*dpr); g.lineTo(0, 3*dpr); g.lineTo(-7*dpr, 8*dpr); g.closePath(); g.fill();
 g.font = `700 ${Math.round(10*dpr)}px system-ui`; g.textAlign = "center"; g.fillText("N", 0, -17*dpr + 0); g.restore(); g.textAlign = "left";
 const ctr = map.getCenter(), mpp = 40075016.686*Math.cos(ctr.lat*Math.PI/180)/(512*2**map.getZoom())/dpr;   // mètres par pixel de l'image
 const cible = 150*dpr*mpp, p10 = 10**Math.floor(Math.log10(cible)), long = [1, 2, 5].map(k => k*p10).filter(v => v <= cible).pop() || p10, px = long/mpp;
 const sx = 14*dpr, sy = img.height - 16*dpr; g.fillStyle = "rgba(255,255,255,.9)"; g.fillRect(sx - 6*dpr, sy - 20*dpr, px + 70*dpr, 28*dpr);
 g.fillStyle = "#1d2430"; g.fillRect(sx, sy - 4*dpr, px, 4*dpr); g.font = `${Math.round(11*dpr)}px system-ui`; g.fillText(long >= 1000 ? long/1000 + " km" : long + " m", sx + px + 6*dpr, sy);
 // bandeau
 let y = img.height + Math.round(14*dpr) + fs; g.fillStyle = "#1d2430"; g.font = `700 ${Math.round(fs*1.15)}px system-ui, sans-serif`; g.fillText(o.titre || "Carte", 10*dpr, y); y += lh;
 g.font = `${fs}px system-ui, sans-serif`; g.fillStyle = "#5a6474";
 g.fillText(`Centre ${CG.mgrs(ctr.lng, ctr.lat)} · ${CG.dateCourte()} · fond : ${o.fond || ""} · démonstrateur, seuils fictifs`, 10*dpr, y); y += lh;
 g.fillStyle = "#1d2430"; for (const l of lignes) { g.fillText(l, 10*dpr, y); y += lh; }
 leg.forEach(([col, txt], i) => { const cx = pos[i][0], cy = y + pos[i][1]*lh;
  g.fillStyle = col; g.fillRect(cx, cy - fs*0.8, fs, fs*0.85); g.strokeStyle = "#888"; g.lineWidth = 1; g.strokeRect(cx, cy - fs*0.8, fs, fs*0.85);
  g.fillStyle = "#1d2430"; g.fillText(txt, cx + fs*1.5, cy); });
 return c;
};
CG.exporterImage = async (map, o) => {
 const c = await CG.imageCarte(map, o); c.toBlob(b => CG.telecharger((o.fichier || "carte") + ".png", b), "image/png");
};
CG.imprimer = async (map, o) => {
 const w = window.open("", "_blank"); if (!w) return CG.alerte("Fenêtre d'impression bloquée par le navigateur : autorisez les fenêtres surgissantes pour ce site.");
 w.document.write("<p style='font:14px system-ui'>Préparation de la carte…</p>");
 const c = await CG.imageCarte(map, o), url = c.toDataURL("image/png");
 w.document.open();
 w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${xe(o.titre || "Carte")}</title><style>@page{size:A4 landscape;margin:8mm}html,body{margin:0}img{display:block;max-width:100%;max-height:190mm;margin:0 auto}p{font:12px system-ui;color:#555;text-align:center}@media print{p{display:none}}</style></head>
  <body><img src="${url}"><p>Imprimer : choisissez « Enregistrer au format PDF » comme imprimante pour obtenir un PDF.</p><script>document.querySelector("img").onload=()=>setTimeout(()=>print(),200);<\/script></body></html>`);
 w.document.close();
};

/* ---------- styles des éléments ajoutés ---------- */
(function(){ const s = document.createElement("style"); s.textContent = `
.cg-aller{position:absolute;z-index:4;display:flex;gap:0;box-shadow:0 1px 6px rgba(0,0,0,.25);border-radius:8px;overflow:hidden;background:#fff}
.cg-aller input{border:0;padding:7px 10px;font:13px system-ui;width:250px;outline:none}
.cg-aller button{border:0;border-left:1px solid #e3e7ec;background:#f5f7fa;padding:0 11px;font-size:15px;cursor:pointer}
.cg-pin{width:18px;height:18px;border-radius:50% 50% 50% 0;background:#d50000;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.6)}
.cg-coord{position:absolute;left:50%;transform:translateX(-50%);bottom:4px;z-index:3;background:rgba(29,36,48,.86);color:#fff;font:12px/1.3 system-ui,sans-serif;padding:4px 10px;border-radius:6px;white-space:nowrap;max-width:calc(100vw - 420px);overflow:hidden;text-overflow:ellipsis;pointer-events:none}
.cg-coord .cg-dd{color:#b8c1cf}
@media (max-width:760px){.cg-coord{display:none}.cg-aller input{width:150px}}
`; document.head.appendChild(s); })();
