# Contrat JSON `terrain-gtia` version 3

Un seul document décrit un terrain analysé. **Le fichier exporté (`.json`) et la zone enregistrée dans le navigateur (IndexedDB, base `terrain-gtia`, magasin `zones`, clé `id`) ont exactement le même contenu** : tous deux sont produits par `documentTerrain()` (`moteur-terrain.js`).

**Un seul chemin de lecture** : `lireTerrain()` puis `ouvrirTerrainEtapes()` (fichier v2 ou v3, zone v3, zone enregistrée avant la v3). Les résultats sont **toujours recalculés** à partir des faits et des paramètres : ceux du document servent aux autres outils et à la traçabilité, ils ne sont pas relus. Les paramètres absents sont complétés par `DEF_TERRAIN`, clé par clé (`withDefaultsTerrain`).

## Champs

| Champ | Obligatoire | Contenu |
|---|---|---|
| `format` | oui | `"terrain-gtia"` |
| `version` | oui | `3` (un document de version supérieure est refusé ; la version 2 est lue) |
| `id` | oui | identifiant de la zone (clé IndexedDB). Fichier v2 sans `id` : empreinte nom + date + emprise |
| `t` | non | date de création, en ms (tri des zones) |
| `nom`, `date` | oui | nom de la zone, date d'analyse (texte) |
| `note` | non | rappel du contrat |
| `parametres` | oui | jeu **complet** (`DEF_TERRAIN` complété), dont `_sources` |
| `faits.bbox` | oui | `{w, e, s, n}` en degrés |
| `faits.n`, `faits.maille_m` | oui | grille de n × n mailles de `maille_m` mètres |
| `faits.sur_echantillonnage`, `faits.W` | oui | raster fin des obstacles : W = n × 4 pixels de côté |
| `faits.grilles` | oui | `altitude_m`, `pente_pct`, `gradient_est`, `gradient_sud`, `fraction_<couche>` (forêt, eau, bâti, marais, vigne, prairie, ruisseau, autoroute, fer, haie, route) |
| `faits.obstacles_fins` | oui | `{bits, donnees}` : raster W × W, bits eau 1, ruisseau 2, autoroute 4, fer 8, route 16, haie 32 |
| `faits.voies` | oui | routes, ponts, tunnels, gués OSM : `{hw, br, tu, fd, nm, nd, g}` (ou `{rail:1, br:1, …}`) |
| `faits.points` | oui | nœuds OSM ponctuels : `{id, t: echangeur/pn/gue, lon, lat, nm}` |
| `faits.cours_eau` | oui (peut être `null`) | rivières et canaux : `{w: largeur m (0 = inconnue), p: profondeur m (0 ou absent = inconnue), k: "r"/"c", nm, g}` |
| `faits.ruisseaux` | oui (peut être `null`) | tracés des ruisseaux `[[lon, lat], …]` |
| `resultats.sol` | oui | `"sec"` ou `"humide"` |
| `resultats.par_arme.<classe>` | oui | pour `chenille`, `roue`, `logistique`, `fantassin` : `classes` (0 eau, 1 NO-GO, 2 SLOW-GO, 3 GO), `vitesse_kmh`, `couloirs_mobilite`, `couvert`, `pourcentages_hors_eau`, `couloirs`, `axes_approche`, `goulets` (`{ouvrage: indice, id_ouvrage, isole_pct}`), `zones_coupees` |
| `resultats.ouvrages` | oui | `{id: indice, id_ouvrage, type, precision, nom, lon, lat, longueur_m, cours_eau_important, etat}` |
| `resultats.intervisibilite`, `resultats.couloirs_AB` | oui | points hauts, observations, « qui voit », couloirs A→B |
| `couloirs`, `obs`, `vus` | oui | saisies (indices de mailles) |
| `coupures` | oui | `{ouvrage: id_ouvrage, type, lon, lat, nm, etat: detruit/bloque/degrade, t}` |
| `journal_coupures` | oui | `{t, txt}` |

## Encodage des grilles

Grille n × n, ligne 0 au nord, colonne 0 à l'ouest, indice `j*n + i`. Chaque tableau binaire est `{type, b64}` : `type` = `Float32Array`, `Uint8Array`, `Int32Array` ou `Float64Array`, `b64` = octets bruts (petit-boutiste) en base64.

## Identifiant d'ouvrage

`id_ouvrage` = `<type>:n<plus petit identifiant de nœud OSM de l'ouvrage>` (ex. `pont:n123456`), à défaut `<type>:@lon,lat` ; doublons suffixés `#2`, `#3`. Une coupure est rattachée par cet identifiant ; sinon (fichier ancien, ouvrage disparu) par même type à moins de max(100 m, `regroupement_ouvrages_m`), et reçoit alors l'identifiant trouvé.

## Lecture des anciens formats

- **v2** : mêmes champs sans `id`, `t`, `coupures[].ouvrage`, `id_ouvrage` ; paramètres souvent incomplets (complétés).
- **Zone enregistrée avant la v3** : `{id, t, nom, date, parametres, faits:{b, n, cell, W, sl, el, gx, gy, L, M, ways, pnodes, rivs, rus}, couloirs, obs, vus, coupures, journal}` (tableaux binaires, ou `{type, b64}`). Réenregistrée en v3 à la première sauvegarde.
