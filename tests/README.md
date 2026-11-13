# Tests de bout en bout

Ouvrent les pages dans un vrai Chromium (PC et téléphone simulé), cliquent comme un utilisateur et vérifient le résultat.

```
node tests/run.js              # tous les scénarios
node tests/run.js implantation # ceux dont le nom contient « implantation »
VERBEUX=1 node tests/run.js    # affiche aussi les vérifications réussies
```

Prérequis : Node 18+, le module `playwright` et un Chromium.
Variables : `PLAYWRIGHT_MODULE` (chemin du module, défaut `playwright`), `CHROMIUM` (exécutable, défaut `/opt/pw-browsers/chromium`).
Exemple dans l'environnement de travail : `PLAYWRIGHT_MODULE=/opt/node-tools/node_modules/playwright node tests/run.js`.

Le fond de carte (IGN, OSM) est coupé pendant les tests (plus rapide, et cela vérifie le repli). Les tuiles de relief sont remplacées par un relief synthétique (plaine à 100 m et une grosse colline) : voir `helpers.js`. Les captures d'écran sont écrites dans `tests/out/` (non versionné).

Les scénarios de l'outil Ennemi visent `ennemi.html` (planification, conduite, téléphone, zone courante et reprise de la planification en conduite, terrain visible et repli du fond, aide au démarrage) ; un scénario vérifie que `ennemi-prepa.html` et `ennemi-conduite.html` redirigent vers `ennemi.html?mode=…` ; le scénario « application » vérifie aussi que la liste de `sw.js` contient tous les fichiers du site et que l'outil Ennemi s'ouvre hors ligne.

Le scénario « MGRS seul, filtre des points, légende, zoom fort » vérifie : aucune coordonnée décimale (nom de zone automatique, barre de survol, fiches de point et de maille), le masquage d'un type de point de franchissement (pont), les libellés de la légende sur la carte, et le rendu lissé au zoom 16 (vue recalculée à la résolution de l'écran, seulement les couleurs de la légende).

Le scénario « saisie sur un cours d'eau, seuils de franchissement » vérifie : fiche du tronçon au toucher (valeurs et origine, verdict par classe, MGRS), saisie refusée si invalide, saisie de profondeur → verdict changé, Annuler / Rétablir, tableau des seuils (valeur négative refusée, profondeur max modifiée → verdict changé, JSON synchronisé), export puis import dans un navigateur vierge (saisie et seuils conservés), saisie hors ligne. Captures dans `/tmp/saisie/`.

Un test qui échoue affiche la vérification en cause. Les scénarios sont indépendants : chacun repart d'un navigateur vierge.

Scénarios de l'outil Radars (`radars.html`) : **PC, grande zone** (relief synthétique) : modes Ennemi / Contre-batterie « à venir » désactivés, bandeau des masques (relief seul), réseau mixte MURIN + Giraffe 1X, couverture cumulée, portée inconnue signalée, trous, plancher chiffré en mètres, COBRA à secteur orienté (cible obus, MURIN aveugle), Annuler et Ctrl+Z, recherche en complément et plan à 2, « Ajouter au réseau », « Tester ici », bibliothèque (sources, ennemis, valeur saisie, JSON refusé), reprise après rechargement, liste MGRS ; **téléphone, zone terrain** (`terrain-demo.json`) : masques forêts + bâti, forêts qui réduisent la vue, pose au toucher, « Infos », onglets, pas de défilement horizontal. Captures `tests/out/radars-*.png`.

## Tests de calcul (sans navigateur)

```
node tests/moteur.js           # moteur-terrain.js seul, en Node pur (≈ 10 s)
VERBEUX=1 node tests/moteur.js # affiche aussi les vérifications réussies
```

Grilles synthétiques (pente, eau, pont, coupure, sol sec / humide, les 4 classes), `search` avec options (prédécesseurs, pondération, cible, départs décalés ; identique à l'ancien Dijkstra des pages ennemi), `searchEtapes` et `chamferEtapes` (versions par étapes de l'outil Ennemi : résultats identiques bit à bit à `search` et `chamfer`, avec et sans options, avec ouvrages coupé et dégradé), règle des cours d'eau sans pont, largeur mesurée sur un polygone synthétique, priorité saisie > mesure > étiquette OSM et origine des valeurs, saisies (export, rechargement, repli par position), lecture prudente des largeurs et profondeurs OSM (`metresOSM`), rattachement des pixels d'eau selon la largeur supposée, non-régression sur la démonstration v2 d'origine (`tests/fixtures/terrain-demo-v2.json`), aller-retour export v3 → chargement, lecture d'un fichier version 2, identité fichier / zone enregistrée (voir `CONTRAT-JSON.md`), obstacles en séquences et arrêt.

```
node tests/radars.js           # moteur-radar.js seul, en Node pur (≈ 4 s)
```

Bibliothèque (fiabilité et source de chaque valeur, MURIN / GM400α / Giraffe 1X, complément et contrôle d'une saisie), horizon radar en terrain plat conforme à la formule à 4/3 (antenne, cible, k), portées minimale et maximale, secteur orienté, plancher derrière une crête conforme à la géométrie, forêt à hauteur forfaitaire (masque, cible cachée sous le couvert, ignorée en relief seul), dôme large (crête militaire), réseau et trous, recherche (sommet trouvé, classement, plan à 2, complément d'un réseau, avancement).

## Tests de l'outil Ennemi (sans navigateur)

```
node tests/ennemi.js           # doctrine.js + moteur-ennemi.js + moteur-terrain.js sur terrain-demo.json (Node pur)
```

Étape 0 : chargement sous Node (`require` et contexte partagé), doctrine (classes = ARMS, vitesses par classe × mode, échelons, unités types, regroupement, seuils, délais d'isochrones, validation, surcharge partielle, migration meca/moto/pied), ouverture par étapes de la démonstration v3, cours d'eau guéable par le seul chenillé, référence terrain et empreinte (changée par une coupure ou un seuil), signatures du moteur ennemi. Lot A : axes (coupures, ru par classe), **gué sans ouvrage** (ru de la démonstration, pont coupé, chenillé : franchissement de l'axe avec sa durée, jalon horaire daté, tronçon ; rivière synthétique sans pont), horaires, isochrones multi-contacts, présence, regroupements, export / import v3, migration des v1, aucune valeur de doctrine en dur dans `moteur-ennemi.js`, ni dans `ennemi.html` et `rendu-ennemi.js` (champ de doctrine avec une valeur par défaut chiffrée, liste de doctrine ou valeur de doctrine suivie d'une unité dans un texte ; le contrôle reconnaît les anciennes valeurs en dur du glossaire et du rayon des zones).

`PERF=1 node tests/ennemi.js` ajoute la mesure sur une grille synthétique 500 × 500 : temps de chaque calcul, **gel maximal** (plus long bloc sans rendre la main) des versions par étapes (doit rester sous 0,5 s), `searchEtapes` seul, et identité des axes calculés par étapes et d'un trait.

## Tests de l'interface Ennemi (dans Chromium)

```
node tests/ennemi-ui.js            # ennemi.html avec le VRAI moteur et le VRAI rendu (≈ 3 min)
node tests/ennemi-ui.js import     # ceux dont le nom contient « import »
GRAND=300 node tests/ennemi-ui.js grand   # taille du grand terrain synthétique (défaut 500)
```

Mêmes prérequis et variables que `tests/run.js`. Aucun moteur simulé. Vérifie sur `terrain-demo.json` : ouverture, modes, aucun GPS, MGRS seul (texte, copies et étiquettes de la carte), rendu-terrain.js jamais chargé ; planification à deux unités (axes, axe choisi, horaires avec arrêts et regroupements **identiques à `ME.scenario`**, position de la colonne = `ME.positionSurAxe`), glisser, annuler / rétablir, légende repliable qui ne cache ni départ ni objectif, export v3 (résultats joints) et KML, reprise après rechargement ; conduite : deux contacts à des heures différentes (isochrones **identiques à `ME.isochrones`**, heure d'arrivée au plus tôt sur chaque contact, apport du contact le plus ancien), étiquettes T+x sur le front de leur ligne, zones à survoler, T+x, ennemi connu et scénario repère ; doctrine (glossaire : délais d'isochrones et rayon des zones lus dans la doctrine modifiée, « le plus discret ») ; import d'un `ennemi-prepa-gtia` v1 et d'un `ennemi-conduite-gtia` v1 (terrain inclus), export puis réimport, autre terrain, terrain modifié (refus puis import sur confirmation) ; **fichier d'un autre terrain** : terrain absent → importé quand même sur le terrain ouvert avec avertissement ; terrain enregistré → question, « Annuler » = importé quand même, « OK » = son terrain ouvert ; pont du ru détruit dans le terrain : seul le chenillé passe (à gué), raison affichée pour les autres classes, **gué** dans les franchissements de l'axe (durée), les horaires, les tronçons, la copie, la carte et le KML ; **ergonomie de la carte** en 1500 × 900 et 1366 × 768 : zone cadrée hors du panneau, de la barre et du curseur d'heure, couleurs GO / SLOW-GO / NO-GO / eau dans la légende quand le terrain est affiché, légende compacte repliée par défaut si elle couvre des résultats, étiquettes de départs et de contacts voisins sans chevauchement (zooms 11 et 13 compris) ; grand terrain synthétique **500 × 500** par défaut : progression, **gel maximal mesuré et vérifié à chaque passage** (< 400 ms), bouton « Arrêter » (vitesses restaurées, calcul suivant identique) ; téléphone ; redirections. Captures dans `/tmp/ennemi-ui/`.

## Tests du rendu Ennemi (dans Chromium)

```
node tests/rendu-ennemi.js         # rendu-ennemi.js sur le banc tests/banc-rendu-ennemi.html (≈ 1 min)
```

Résultats factices fabriqués avec le moteur terrain : terrain lissé, axes et plausibilités, points de décision, jalons, colonne, regroupements, saisies, isochrones, présence, légende des seules couches visibles, export KML (XML valide, lon,lat dans l'emprise, dossiers en français), performance du rendu sur 500 × 500 ; rendu lissé par `rendu-lisse.js` (une seule globale `RT`, aucun fetch, erreur claire s'il manque ; `index.html` reprend les mêmes fonctions) ; légende placée sans cacher les objectifs (objectif poussé dans chaque coin) et repliable (son contenu est lu qu'elle soit repliée ou non) ; jalons dessinés au-dessus de la colonne ; étiquettes T+x sur leur ligne, au front. Captures et KML dans `/tmp/rendu-ennemi/`.

## Terrain de démonstration

`terrain-demo.json` (contrat v3) est fabriqué, et non écrit à la main, par `node tests/fabriquer-demo.js` à partir de la démonstration v2 d'origine (`tests/fixtures/terrain-demo-v2.json`, figée, qui sert aussi aux tests de non-régression et de lecture v2 de `tests/moteur.js`) : chargement puis `documentTerrain()`, après ajout d'un affluent de 18 m × 0,9 m (« Ru de démonstration ») guéable par le seul chenillé, avec un pont sur la route tertiaire ouest. `node tests/fabriquer-demo.js --verifier` vérifie que le fichier est à jour (à relancer après tout changement du moteur qui modifie l'export).

## Tests des données (dans Chromium)

```
node tests/donnees.js          # tous les scénarios (≈ 2 min)
node tests/donnees.js mer      # ceux dont le nom contient « mer »
DENSITE=5 node tests/donnees.js grande   # densité du jeu 50 km (défaut 3)
```

Mêmes prérequis et variables que `tests/run.js` (`PLAYWRIGHT_MODULE`, `CHROMIUM`). Récupération des données (`donnees-osm.js`) avec serveurs Overpass et relief simulés (jeu OpenStreetMap synthétique près de Naples) : plusieurs tuiles, tuiles vides en mer et contrôle, bascule de serveur et remise à zéro des échecs, message quand tout échoue, arrêt puis reprise depuis le cache, mer sans trait de côte, grande zone 50 km (temps, réactivité, mêmes grilles en séquences), largeur et profondeur OSM des cours d'eau jusqu'au gué par classe, largeur mesurée sur les rivières dessinées en surface (natural=water + water=river, riverbank, relation avec île). Aucun accès aux vrais serveurs.
