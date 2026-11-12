/* commun-ennemi.js – fonctions d'interface de l'outil Ennemi (ennemi.html), extraites des anciennes pages
   ennemi-prepa.html et ennemi-conduite.html (où elles étaient recopiées à l'identique).

   Fichier séparé de commun.js : les pages index.html et implantation.html déclarent déjà ces noms à leur niveau
   (navInit, travDB, esc, num, IGN…) ; les ajouter dans commun.js, chargé par toutes les pages, aurait créé des
   conflits de déclaration. Tout est rangé dans l'objet CE (comme CG dans commun.js).
   Les anciennes pages gardent leurs copies jusqu'à leur redirection vers ennemi.html.

   Dépend de commun.js (CG) et, pour CE.ouvrirTerrain, de moteur-terrain.js (calculerZoneEtapes, P).
   Éléments de page attendus par CE.navInit : #panel, #navBar, #statusPill, #status, (#hint). */
"use strict";
const CE = {};

/* ---------- textes ---------- */
CE.esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
CE.num = (x, d = 1) => Number(x).toLocaleString("fr-FR", {maximumFractionDigits:d, minimumFractionDigits:0});
CE.hm = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(m/60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };   // minutes → « hh:mm »
CE.mins = h => { const [a, b] = String(h || "0:0").split(":").map(Number); return (a || 0)*60 + (b || 0); };                                              // « hh:mm » → minutes
CE.dateCourte = () => new Date().toLocaleString("fr-FR", {dateStyle:"short", timeStyle:"short"});

/* ---------- téléphone : barre d'onglets en bas, feuille courte ---------- */
CE.PHONE = () => matchMedia("(max-width:760px)").matches;
CE.sheetPx = () => 56 + (document.body.classList.contains("sheet") ? Math.round(innerHeight*0.4) : 0);
CE.fitPad = () => CE.PHONE() ? {left:10, right:10, top:150, bottom:CE.sheetPx() + 10} : {left:410, right:20, top:60, bottom:20};
// panes : [{key, label, icon, title?, activate?}] ; start : clé ouverte au départ. Sur PC : ne fait rien.
// Définit window.openPane(k) et window.closeSheet() (mêmes noms que les anciennes pages).
CE.navInit = (panes, start) => {
 if (!CE.PHONE()) return;
 const $ = id => document.getElementById(id), panel = $("panel"), nav = $("navBar"), pill = $("statusPill");
 const bar = document.createElement("div"); bar.id = "sheetBar"; bar.innerHTML = '<b id="sheetTitle"></b><button id="sheetClose" aria-label="Fermer le panneau">▾</button>'; panel.insertBefore(bar, panel.firstChild);
 let cur = null;
 nav.innerHTML = panes.map(p => `<button data-k="${p.key}"><span>${p.icon}</span>${p.label}</button>`).join("");
 window.openPane = k => { const p = panes.find(x => x.key === k); if (!p) return; panel.dataset.pane = k; cur = k; document.body.classList.add("sheet");
  nav.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.k === k)); $("sheetTitle").textContent = p.title || p.label; pill.classList.remove("show"); if (p.activate) p.activate(); panel.scrollTop = 0; };
 window.closeSheet = () => { document.body.classList.remove("sheet"); cur = null; nav.querySelectorAll("button").forEach(b => b.classList.remove("on")); };
 nav.querySelectorAll("button").forEach(b => b.onclick = () => (document.body.classList.contains("sheet") && cur === b.dataset.k) ? closeSheet() : openPane(b.dataset.k));
 $("sheetClose").onclick = () => closeSheet();
 const st = $("status"); let pt = null;
 new MutationObserver(() => { const t = st.textContent.trim(); if (!t || document.body.classList.contains("sheet")) return;
  const err = st.classList.contains("err"); pill.textContent = t; pill.classList.toggle("err", err); pill.classList.add("show"); clearTimeout(pt); if (!err) pt = setTimeout(() => pill.classList.remove("show"), 7000); })
  .observe(st, {childList:true, characterData:true, subtree:true});
 const h = $("hint"); if (h) h.addEventListener("click", () => { h.style.display = "none"; });
 if (start) openPane(start);
};

/* ---------- carte : fonds, repli IGN → OSM ---------- */
CE.TERRT = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
CE.IGN = (layer, fmt) => "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=" + layer + "&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=" + fmt;
CE.FONDS = ["osm", "ignplan", "ignortho", "esri", "otm"];
// style MapLibre de départ : fonds (IGN plan visible) et ombrage du relief, comme les anciennes pages
CE.styleCarte = () => ({version:8,
 sources:{
  osm:{type:"raster", tiles:["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize:256, maxzoom:19, attribution:"© contributeurs OpenStreetMap"},
  ignplan:{type:"raster", tiles:[CE.IGN("GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2", "image/png")], tileSize:256, maxzoom:18, attribution:"© IGN"},
  ignortho:{type:"raster", tiles:[CE.IGN("ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg")], tileSize:256, maxzoom:19, attribution:"© IGN"},
  esri:CG.FONDS.esri, otm:CG.FONDS.otm,
  dem:{type:"raster-dem", tiles:[CE.TERRT], encoding:"terrarium", tileSize:256, maxzoom:14}},
 layers:[{id:"osm", type:"raster", source:"osm", layout:{visibility:"none"}}, {id:"ignplan", type:"raster", source:"ignplan"},
  {id:"ignortho", type:"raster", source:"ignortho", layout:{visibility:"none"}}, {id:"esri", type:"raster", source:"esri", layout:{visibility:"none"}},
  {id:"otm", type:"raster", source:"otm", layout:{visibility:"none"}}, {id:"hill", type:"hillshade", source:"dem", paint:{"hillshade-exaggeration":0.4}}]});
// liste déroulante des fonds ; bascule automatique vers OSM après 4 tuiles IGN en erreur (réseau qui bloque l'IGN)
CE.fondsEtRepli = (map, select, message) => {
 select.onchange = () => CE.FONDS.forEach(l => map.setLayoutProperty(l, "visibility", l === select.value ? "visible" : "none"));
 let ko = 0, bascule = false;
 map.on("error", e => { if (bascule || !e || (e.sourceId !== "ignplan" && e.sourceId !== "ignortho") || select.value === "osm") return;
  if (++ko >= 4) { bascule = true; select.value = "osm"; select.dispatchEvent(new Event("change")); if (message) message("Fond IGN indisponible sur ce réseau : fond OSM affiché."); } });
};

/* ---------- zones de l'outil terrain (IndexedDB « terrain-gtia », magasin « zones ») ---------- */
CE.terrainDB = () => new Promise((res, rej) => { const r = indexedDB.open("terrain-gtia", 1);
 r.onupgradeneeded = () => r.result.createObjectStore("zones", {keyPath:"id"});   // même structure que l'outil terrain
 r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
// toutes les zones enregistrées, la plus récente d'abord ([] si la base est inaccessible)
CE.listerZones = async () => {
 let Z = [];
 try { const db = await CE.terrainDB(); Z = await new Promise((res, rej) => { const rq = db.transaction("zones").objectStore("zones").getAll(); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); }
 catch(e) { Z = []; }
 return Z.sort((a, b) => (b.t || 0) - (a.t || 0));
};
// zone courante partagée entre les outils (localStorage)
CE.ZC = "terrain-gtia-zone-courante";
CE.zoneCourante = () => { try { return localStorage.getItem(CE.ZC); } catch(e) { return null; } };
CE.memoriserZoneCourante = id => { try { localStorage.setItem(CE.ZC, id); } catch(e) {} };

/* ---------- travail en cours (IndexedDB « terrain-gtia-travail », magasin « travaux ») ---------- */
CE.travDB = () => new Promise((res, rej) => { const r = indexedDB.open("terrain-gtia-travail", 1);
 r.onupgradeneeded = () => r.result.createObjectStore("travaux", {keyPath:"id"}); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
CE.travPut = async rec => { const db = await CE.travDB(); return new Promise((res, rej) => { const tx = db.transaction("travaux", "readwrite"); tx.objectStore("travaux").put(rec); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); };
CE.travGet = async id => { const db = await CE.travDB(); return new Promise((res, rej) => { const rq = db.transaction("travaux").objectStore("travaux").get(id); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); };
CE.travDel = async id => { const db = await CE.travDB(); return new Promise((res, rej) => { const tx = db.transaction("travaux", "readwrite"); tx.objectStore("travaux").delete(id); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); };

/* ---------- ouverture d'un terrain sans gel ---------- */
// o : document terrain-gtia (fichier v2/v3 ou zone enregistrée). Calcul par étapes (calculerZoneEtapes) avec
// onStep(texte, fraction 0..1). Comme chargerTerrain : o.parametres devient les paramètres complets (P). Renvoie G.
CE.ouvrirTerrain = async (o, onStep) => {
 const g = await calculerZoneEtapes(o, undefined, onStep);
 if (o && typeof o === "object") o.parametres = P;
 return g;
};

/* ---------- ajouts du lot C (interface de ennemi.html, 12/11/2026) ---------- */
// heure avec jour suivant : « 01:10 (+1 j) »
CE.hmj = m => CE.hm(m) + (m >= 1440 ? " (+1 j)" : "");
// durée en minutes → « 1 h 05 » ou « 25 min »
CE.duree = m => { m = Math.round(+m || 0); return m >= 60 ? Math.floor(m/60) + " h " + String(m % 60).padStart(2, "0") : m + " min"; };
// surcharge minimale : clés de d qui diffèrent de ref (sous-objets comparés clé par clé, tableaux en entier) ; null si aucune
CE.diffDoctrine = (d, ref) => {
 const diff = (a, b) => { const r = {}; let n = 0;
  for (const k in a) { if (k === "version" || k === "source" || k === "note") continue;
   const x = a[k], y = b ? b[k] : undefined;
   if (x && typeof x === "object" && !Array.isArray(x) && y && typeof y === "object" && !Array.isArray(y)) { const s = diff(x, y); if (s) { r[k] = s; n++; } }
   else if (JSON.stringify(x) !== JSON.stringify(y)) { r[k] = JSON.parse(JSON.stringify(x)); n++; } }
  return n ? r : null; };
 return diff(d, ref);
};
// copie dans le presse-papiers ; repli par zone de texte sélectionnée (navigateur sans permission) ; renvoie true si copié
CE.copier = async txt => {
 try { await navigator.clipboard.writeText(txt); return true; } catch(e) {}
 try { const t = document.createElement("textarea"); t.value = txt; t.style.cssText = "position:fixed;left:-9999px;top:0"; document.body.appendChild(t); t.select();
  const ok = document.execCommand("copy"); t.remove(); return ok; } catch(e) { return false; }
};
// message bref en bas de l'écran (élément #toast attendu)
CE.toast = (t, ms = 6000) => { const el = document.getElementById("toast"); if (!el) return; el.textContent = t; el.style.display = "block";
 clearTimeout(CE._toastT); CE._toastT = setTimeout(() => { el.style.display = "none"; }, ms); };
// emprise [[w, s], [e, n]] d'une liste de points lonlat (null si vide)
CE.emprise = pts => { pts = (pts || []).filter(p => p && isFinite(p[0]) && isFinite(p[1])); if (!pts.length) return null;
 let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity; for (const [x, y] of pts) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
 return [[w, s], [e, n]]; };
