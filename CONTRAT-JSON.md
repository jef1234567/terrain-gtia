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
| `faits.cours_eau` | oui (peut être `null`) | tronçons de rivières et canaux : `{id, w: largeur OSM m (0 = absente), p: profondeur OSM m (0 ou absent = absente), wm: largeur mesurée sur le tracé m (0 ou absent = non mesurée), k: "r"/"c", nm, g}` (`id` et `wm` depuis le 12/11/2026, facultatifs à la lecture) |
| `faits.ruisseaux` | oui (peut être `null`) | tracés des ruisseaux `[[lon, lat], …]` |
| `resultats.sol` | oui | `"sec"` ou `"humide"` |
| `resultats.par_arme.<classe>` | oui | pour `chenille`, `roue`, `logistique`, `fantassin` : `classes` (0 eau, 1 NO-GO, 2 SLOW-GO, 3 GO), `vitesse_kmh`, `couloirs_mobilite`, `couvert`, `pourcentages_hors_eau`, `couloirs`, `axes_approche`, `goulets` (`{ouvrage: indice, id_ouvrage, isole_pct}`), `zones_coupees` |
| `resultats.ouvrages` | oui | `{id: indice, id_ouvrage, type, precision, nom, lon, lat, longueur_m, cours_eau_important, etat}` |
| `resultats.intervisibilite`, `resultats.couloirs_AB` | oui | points hauts, observations, « qui voit », couloirs A→B |
| `couloirs`, `obs`, `vus` | oui | saisies (indices de mailles) |
| `coupures` | oui | `{ouvrage: id_ouvrage, type, lon, lat, nm, etat: detruit/bloque/degrade, t}` |
| `journal_coupures` | oui | `{t, txt}` |
| `saisies_eau` | non (absent = aucune) | saisies de largeur ou profondeur sur un tronçon (renseignement, reconnaissance) : `{troncon: id du tronçon, largeur_m, profondeur_m (null = non saisie), source, nm, lon, lat, t}` |

## Encodage des grilles

Grille n × n, ligne 0 au nord, colonne 0 à l'ouest, indice `j*n + i`. Chaque tableau binaire est `{type, b64}` : `type` = `Float32Array`, `Uint8Array`, `Int32Array` ou `Float64Array`, `b64` = octets bruts (petit-boutiste) en base64.

## Identifiant d'ouvrage

`id_ouvrage` = `<type>:n<plus petit identifiant de nœud OSM de l'ouvrage>` (ex. `pont:n123456`), à défaut `<type>:@lon,lat` ; doublons suffixés `#2`, `#3`. Une coupure est rattachée par cet identifiant ; sinon (fichier ancien, ouvrage disparu) par même type à moins de max(100 m, `regroupement_ouvrages_m`), et reçoit alors l'identifiant trouvé.

## Cours d'eau : identifiant de tronçon, valeurs et origine

`id` = `eau:w<identifiant de la voie OSM>` (posé à l'analyse) ; à défaut (zone analysée avant le 12/11/2026) `eau:@<lon>,<lat>` du milieu du tracé, doublons suffixés `#2`, `#3` (calculé à l'ouverture, stable d'une ouverture à l'autre, puis enregistré). Une saisie est rattachée par cet identifiant ; sinon au tronçon le plus proche à moins de 100 m de son point (`lon`, `lat`), qui lui donne son identifiant.

Valeur retenue par le verdict (`valeursEau`, `verdictEau`), avec son origine :
- **largeur** : saisie > mesurée sur le tracé (`wm`) > étiquette OSM (`w`) > inconnue (valeur supposée `parametres.eau.largeur_supposee_*`, prudente) ;
- **profondeur** : saisie > étiquette OSM (`p`) > inconnue (valeur supposée `parametres.eau.profondeur_supposee_*`).

`wm` : rivière dessinée en surface dans OSM (`natural=water` + `water=river`/`canal`, ou `waterway=riverbank`, voies fermées et relations, anneaux intérieurs ignorés) ; perpendiculairement à la ligne, au milieu de chaque pas de 20 m, distance entre les deux berges ; on garde la plus grande largeur locale du tronçon (prudent), arrondie au mètre supérieur. Ces surfaces font partie de la requête Overpass unique (aucune requête en plus ; cache des tuiles `q2`).

Un document v3 sans `saisies_eau`, ni `id`/`wm` dans `cours_eau`, reste lu (aucune saisie, largeur non mesurée).

## Lecture des anciens formats

- **v2** : mêmes champs sans `id`, `t`, `coupures[].ouvrage`, `id_ouvrage` ; paramètres souvent incomplets (complétés).
- **Zone enregistrée avant la v3** : `{id, t, nom, date, parametres, faits:{b, n, cell, W, sl, el, gx, gy, L, M, ways, pnodes, rivs, rus}, couloirs, obs, vus, coupures, journal}` (tableaux binaires, ou `{type, b64}`). Réenregistrée en v3 à la première sauvegarde.

# Export `ennemi-gtia` version 3 (outil Ennemi unique, `ennemi.html`)

Posé à l'étape 0 de la refonte (12/11/2026) ; écrit et lu par `ME.exporter` / `ME.importer` (`moteur-ennemi.js`). Remplace `ennemi-prepa-gtia` v1 et `ennemi-conduite-gtia` v1 (lus par migration, voir plus bas).

Principes :
- **Le terrain n'est pas inclus** : seulement une **référence** (`terrain.id` + `terrain.empreinte`). À l'ouverture, l'outil cherche la zone `id` (IndexedDB de l'outil terrain, ou fichier terrain ouvert à côté) et compare l'empreinte : différente = le terrain a changé (coupure, saisie d'eau, paramètres) depuis l'export, l'outil le signale et recalcule.
- **L'outil Ennemi ne coupe rien** : les coupures d'ouvrages sont dans le terrain (champ `coupures`, outil Terrain) ; l'export ennemi n'en contient pas.
- **Doctrine** : `doctrine.js` (globale `DOCTRINE`) ; l'export ne porte qu'une **surcharge partielle** éventuelle (`doctrine_surcharge`), complétée à la lecture par `completerDoctrine` puis contrôlée par `validerDoctrine`.
- **Classes** : `chenille`, `roue`, `logistique`, `fantassin` (= `ARMS`) ; **modes d'action** : `attaque`, `reco`, `repli`, `marche`.
- **Ouvrages** désignés par `id_ouvrage` (voir « Identifiant d'ouvrage »), jamais par leur indice.
- Positions : `lonlat` = `[lon, lat]` WGS84 ; `mgrs` (texte) ajouté pour lecture humaine, ignoré à la lecture. Heures : `"hh:mm"`.

| Champ | Obligatoire | Contenu |
|---|---|---|
| `format` | oui | `"ennemi-gtia"` |
| `version` | oui | `3` (version supérieure refusée) |
| `nom`, `date` | oui | nom du travail, date d'export (texte) |
| `t` | non | date d'export en ms |
| `terrain` | oui | référence : `{id, nom, date, empreinte, bbox:{w,e,s,n}, n, maille_m}` (`ME.referenceTerrain()`) |
| `doctrine_surcharge` | non | objet partiel de même forme que `DOCTRINE` (absent = doctrine par défaut) ; `doctrine_version` : version de la doctrine utilisée |
| `nos_positions` | oui (peut être vide) | `[{id, nom, lonlat, mgrs}]`, communes aux deux modes |
| `planification.scenarios` | oui (peut être vide) | `[{id, nom, mode_action, heure_depart, unites:[unité planifiée], axe_choisi:{<id unité>: "rapide"/"sur"/"variante"}}]` : **plusieurs unités par scénario** (ex. trois compagnies) |
| unité planifiée | | `{id, nom, unite_type, classe, echelon, elements, front_km, prof_km, dispersion_min, depart:lonlat, objectifs:[lonlat], heure_depart (facultatif, sinon celle du scénario), mode_action (facultatif, sinon celui du scénario)}` |
| `conduite.heure` | oui | heure de la situation (`"hh:mm"`) |
| `conduite.unites` | oui (peut être vide) | `[{id, nom, unite_type, classe, echelon, elements, front_km, prof_km, dispersion_min, mode_action, en_mouvement, scenario_ref:{scenario, unite} ou null}]` ; `scenario_ref` relie l'unité à une unité planifiée (axes prévus) |
| `conduite.contacts` | oui (peut être vide) | `[{id, unite:<id d'unité de conduite>, lonlat, mgrs, heure:"hh:mm", elements_vus, note}]` : **plusieurs contacts horodatés par unité** |
| `resultats` | non | pour la traçabilité seulement, **toujours recalculés** à l'ouverture : `axes:{<scénario>:{<unité>:[{genre, nom, plausibilite, longueur_km, temps_min, ouvrages:[id_ouvrage], goulets:[id_ouvrage], trace:[lonlat]}]}}`, `horaires`, `zones_regroupement`, `zones_a_survoler`, `heure_calcul` |

**Empreinte** (`ME.empreinteTerrain`) : `"e"` + FNV-1a 32 bits (8 chiffres hexadécimaux) du JSON de `[emprise arrondie à 1e-6°, n, maille_m, paramètres complets (withDefaultsTerrain), coupures triées [id_ouvrage, état], saisies d'eau triées [tronçon, largeur, profondeur]]`. Même valeur calculée sur le terrain ouvert (`G`, `P`) ou sur le document `terrain-gtia` v3.

## Migration des anciens exports ennemi (v1)

`ME.migrer(o)` (lot A) produit un document v3 ; le terrain qu'ils incluaient est rendu à part (`{document, terrain}`) pour que l'interface l'ouvre ou l'enregistre, puis la référence est calculée sur ce terrain.

- **Classes** : `meca` → `chenille`, `moto` → `roue`, `pied` → `fantassin` (`classeDepuisAncienType`, `doctrine.js`). Aucun ancien type ne donne `logistique`.
- **`ennemi-prepa-gtia` v1** : chaque ancien scénario (`saisies.scen[]`, une seule unité) devient un scénario à **une** unité (`ennemi` → unité planifiée : `type` → `classe`, `nb` → `elements`, `nom`, `front_km`, `prof_km`, `dispersion_min` repris ; `depart`, `objectifs` repris ; `h0` → `heure_depart` ; `axe` → `axe_choisi`) ; `mode_action` = `attaque` ; `saisies.amis` → `nos_positions` ; `doctrine.modeles` et `doctrine.types.*.vitesse_tactique_pct` → `doctrine_surcharge` (`unites_types` ; `vitesses_pct.<classe>.attaque`) ; `axes` et `horaires` ignorés (recalculés) ; `terrain` inclus → référence.
- **`ennemi-conduite-gtia` v1** : l'ennemi unique (`saisies.enemy` ou `ennemi`) devient une unité de conduite (inconnu : unité par défaut de sa classe, `unite_par_defaut`) ; `en_mouvement` (ou `saisies.mouv`) repris ; `saisies.amis` → `nos_positions` ; chaque contact (`saisies.contacts`) est rattaché à cette unité avec son heure ; `scenarios_prepa` migrés comme ci-dessus dans `planification.scenarios` ; `zones_a_survoler` ignorées (recalculées) ; `terrain` inclus (fichier ou `terrain-gtia-zone`) → référence.
- Les anciens fichiers ne portent pas de coupures propres à l'outil ennemi : rien à reprendre de ce côté.
