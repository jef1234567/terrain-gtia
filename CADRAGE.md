# Analyse terrain GTIA – cadrage

Projet de Jean-François Fraysse. Démonstrateur en ligne (GitHub Pages), version hors ligne prévue plus tard (puissance de calcul + fond de carte + données terrain locales).

## Démarche retenue

1. **Outil terrain d'abord**, seul. Il décrit le terrain et la mobilité, sans ennemi.
2. **Outil ennemi ensuite**, séparé, qui charge le fichier terrain produit par le premier.
3. Carte **2D** uniquement.
4. Analyse toujours **par arme** : chenillé, roue, logistique (gros porteur), fantassin ; d'autres classes possibles plus tard.
5. Échelon : **GTIA** (zone de 10 à 20 km de côté, maille de 100 m).
6. Données **open source** : OpenStreetMap (Overpass), relief mondial Terrarium (~30 m). Plus tard : IGN RGE ALTI (sol nu), données locales.
7. Tous les seuils et paramètres sont **fictifs, visibles et modifiables** (JSON), à calibrer ensuite sur un terrain connu.

## État actuel (index.html) – refonte du 16/10/2026

Outil terrain seul (partie ennemi/ami et itinéraires retirées ; copie de l'ancien outil complet dans `archive/outil-complet-v0.html`).

- **4 classes** : chenillé, roue, logistique (gros porteur), fantassin. Paramètres fictifs dans le JSON.
- **Réseau routier** : nœuds OSM (changement de route aux seules vraies jonctions) ; aucune sortie tout-terrain sur ponts, tunnels et autoroutes ; bretelles (_link) à la vitesse de leur route mère ; catégorie de vitesse « autoroute » séparée.
- **Obstacles linéaires** : eau infranchissable hors route ; ruisseaux, autoroutes et voies ferrées avec délai de franchissement (−1 = impossible) ; viaducs, tunnels et cours d'eau busés ne font pas obstacle.
- **Points de franchissement**, à cocher par type : ponts (cours d'eau), passages dénivelés, tunnels, échangeurs autoroutiers, voie ferrée (passage à niveau, pont-route, passage sous la voie). Ouvrages proches regroupés (chaussées doubles).
- **Goulets uniques** par arme : ouvrage dont la suppression isole au moins `seuil_goulet_pct` % de la zone.
- **Vues** : par arme GO vert / SLOW-GO orange / NO-GO rouge, eau bleue ; « qui passe où » en GO, avec les classes nommées (les quatre ; chenillé + roue + fantassin ; chenillé + fantassin ; fantassin seul ; sans couleur = personne).
- **Couches à cocher** : fond de mobilité, obstacles linéaires, routes en surimpression, zones GO larges, couvert accessible, couloirs A→B, goulets.
- **Couloirs orientés A→B** par arme (sans tracé d'itinéraire).
- **Fiche de synthèse chiffrée** copiable (paragraphe terrain).
- **Conservation** : sauvegarde automatique IndexedDB avec liste des zones rechargeables ; export/import `.json` (faits bruts + paramètres + résultats), entrée de l'outil ennemi.

Décisions du 16/10/2026 : « passe » = GO ; pas de mention « toutes armes », les classes sont nommées ; NO-GO reste rouge ; zones d'installation écartées.

### Ajouts du 16/10/2026 (état de l'art, lots 1, 2 et intervisibilité)

- **Explication par maille** : facteur de couvert (et de sol), facteur de pente, seuils, facteur limitant, par arme.
- **Classe = la plus défavorable** entre couvert et pente ; seuils de pente explicites par arme (`pente_GO_max_pct`, `pente_NOGO_pct`) ; chenillé 30/50 % (seuils OTAN cités par Rybanský, à vérifier).
- **Fantassin selon Tobler** (pente anisotrope).
- **Haies** (OSM `barrier=hedge`) : obstacle linéaire avec délai par arme. **Gués** (OSM `ford=yes`) : type de point de franchissement, délai par arme, candidats goulets.
- **Bascule sol sec / sol humide** : coefficient par arme + prairies (grossier, pas de carte des sols).
- **Couloirs de mobilité** (compagnie, GO ≥ 500 m) et **axes d'approche** (≥ 2 couloirs à moins de 2 km) — largeurs de seconde main, à vérifier dans l'ATP 2-01.3.
- **Intervisibilité** : points hauts dominants et zones vues depuis eux ; outil « point d'observation » (ce que je vois) et outil « qui voit ce point ? » (d'où l'on me voit, par réciprocité de la ligne de vue) ; forêts et bâti à hauteur forfaitaire, courbure terrestre.
- **Fiche de synthèse au format OAKOC**, avec rubriques « à compléter » pour le jugement de l'analyste.
- Sources des seuils dans la clé `_sources` des paramètres.

Écartés de l'état de l'art pour l'instant : passage aux données IGN (BD TOPO, BD Forêt, RGE ALTI), carte de canalisation par théorie des circuits, carte des sols ; version hors ligne reportée.

## Défauts connus à garder en tête

- Relief ~30 m, possiblement modèle de surface (fausses pentes en lisière).
- Pas de classe de charge des ponts dans OSM.
- Carte colorée non directionnelle (seuls les déplacements utilisent la pente directionnelle).
- Pas d'humidité des sols ni de météo.
- Poids et seuils non calibrés.

## Référence

Travaux antérieurs d'un autre officier (G3 division, terrain/LSM) sur une approche voisine : grille H3, ETL séparé, séparation faits/jugements, ponts et croisements bruts, empreinte d'unité épousant le terrain, compartiments par watershed. Idées reprises ci-dessus quand elles relèvent du terrain.

## Outil ennemi (ennemi.html) – refonte du 16/10/2026

Outil séparé. **Entrée** : les zones analysées dans l'outil terrain apparaissent directement dans une liste (même site, même navigateur ; bouton « Ennemi → » dans l'outil terrain), l'outil ennemi recalcule alors leurs résultats avec le moteur partagé ; on peut aussi ouvrir un `.json` exporté ou le terrain de démonstration. Délais calculés avec le même moteur que l'outil terrain (`moteur-terrain.js`, copie à l'identique des fonctions de `index.html`), réduits à une vitesse tactique par type d'unité.

**Ergonomie** (PC) : vocabulaire clair à l'écran, sigle entre parenthèses et glossaire (zone à surveiller = NAI, point où frapper = TAI, point de décision, délais d'arrivée) ; barre d'outils sur la carte ; panneau à onglets Situation / Résultats / Affichage ; saisie au toucher par petite fiche sur place ; symboles déplaçables et modifiables ; résultats en cartes cliquables (zoom et explication) ; légende chiffrée (éléments / km²) ; lien « terrain de démonstration » (`terrain-demo.json`, terrain synthétique) ; **étapes guidées** par volet dans l'onglet Situation ; affichage **Essentiel** (couches utiles au volet et à la posture choisis, par défaut) / Tout / Personnalisé, légende des seules couches visibles ; **Ctrl+Z** (et bouton « Annuler ») annule la dernière action sur la carte (pose, déplacement, modification, suppression). Fiche ennemi supprimée (décision du 16/10/2026).

**Deux volets**
- *Préparer / étudier* : unités ennemies supposées (posées comme hypothèses), objectifs, départs, nos positions. Sans unité, la carte montre le terrain favorable à l'ennemi.
- *Réagir à l'ennemi* : contacts (rattachés à une unité existante ou nouvelle, éléments vus, heure), observations sans contact, curseur d'heure de la situation. Une hypothèse confirmée par un contact reste visible (symbole estompé) et l'outil indique si les contacts sont cohérents avec elle (à moins d'un front) ou si elle est à revoir.

**Les deux postures** (défensive, offensive) sont calculées à chaque fois ; bascule en haut et tableau de comparaison.

**Réglage de l'ennemi** (tiroir à droite, formulaire) : bibliothèque de modèles d'unités (type mécanisée / motorisée / à pied, nombre de véhicules ou groupes, front et profondeur en km) ; par type : vitesse tactique (% de la vitesse de l'outil terrain) et portée de tir ; comportement (l'ennemi privilégie vitesse ou sûreté, durée d'effet d'une observation, délais affichés) ; JSON en mode avancé. Valeurs fictives.

**Calculs**
- Présence probable = attractivité du terrain × empreinte de l'unité (temps de trajet réel × gabarit front × profondeur orienté ; en offensive l'unité avance avec le temps écoulé) ; éléments non vus = effectif − vus.
- Attractivité défensive : lisière, point haut, vue sur les points clés, bâti ; offensive : vitesse du terrain, couloirs, axes d'approche.
- Observation sans contact : seules les mailles réellement vues sont « nettoyées », effet qui s'efface avec le temps.
- **Axes ennemis** : le plus rapide ; le plus sûr (évite les zones vues depuis les points hauts du terrain et nos positions, préfère forêts et bâti ; curseur vitesse ↔ sûreté) ; une variante ; temps, longueur, part exposée, part à couvert, ouvrages, goulets, point de décision.
- Zones à surveiller (NAI), points où frapper (TAI : en défensive, ouvrages devant l'ennemi vus par au moins 5 % de ses éléments, avec délai ; en offensive, ouvrages sur les axes), modes d'action le plus probable / le plus dangereux par règles simples.

**Conservation** : dernière situation et réglages dans le navigateur ; export `.json` (format `ennemi-gtia` v2, fichier terrain inclus) = entrée de l'outil ami.

Défauts connus : doctrine et pondérations fictives ; niveaux de présence chiffrés (à revoir avec la doctrine) ; pas d'emploi tactique (bonds, haltes, réactions amies) ; testé sans affichage de carte, sur le terrain synthétique seulement.

## Recadrage du 17-18/10/2026 : deux outils ennemi

`ennemi.html` actuel (postures défensive / offensive calculées toutes deux, deux volets proches) est remplacé par deux outils séparés, qui partagent `moteur-terrain.js` et le fichier terrain. `ennemi.html` reste en place jusqu'à ce que les deux nouveaux fonctionnent, puis passe dans `archive/`.

**1. Ennemi prépa mission** (`ennemi-prepa.html`, à froid, planification) — **codé le 18/10/2026**, voir ci-dessous. L'utilisateur connaît son terrain et l'ennemi qu'il a en face.
- Saisie : l'ennemi (type chenillé / roue / fantassin, nombre, front, vitesse tactique), son **départ** (clic carte), son **objectif** (clic carte), l'heure de départ ; d'autres paramètres au besoin.
- Sortie : plusieurs axes plausibles ; en choisir un donne les **horaires estimés d'arrivée par tronçon et par ouvrage** ; zones où l'ennemi est le plus probable. Plusieurs scénarios possibles.
- Export `.json` du scénario (échange avec l'outil 2 par fichier, pas par le navigateur).

**2. Ennemi conduite** (`ennemi-conduite.html`, **codé le 18/10/2026**, à chaud, aide à la réflexion et à la recherche, par ex. guidage de drones) — ensuite.
- Saisie : position du contact (clic) à l'instant T ; ennemi connu (choisi dans un fichier de l'outil 1) ou inconnu (fantassin / véhicule à roues / véhicule chenillé seulement).
- Sortie : **isochrones** depuis le contact ; carte de probabilité de présence du reste de l'ennemi ; **liste ordonnée de zones à survoler**, avec ce qu'on y cherche. Un scénario de l'outil 1 peut servir de repère.

Le choix global défensive / offensive n'est plus le point de départ. Les défauts 5 (forte / moyenne / faible, chiffre en détail) et 7 (couches, une seule par défaut) seront traités dans la conception de ces deux outils. Les autres défauts de la liste du 16/10 seront reclassés une fois les outils cadrés. Doctrine ennemie non classifiée annoncée par l'utilisateur : valeurs fictives jusqu'à réception.

### Ennemi prépa mission : état au 18/10/2026
Testé dans Chromium (Playwright) sur `terrain-demo.json` : pose du départ / objectif / nos positions par clics, axes, horaires, curseur d'heure, scénarios multiples, Ctrl+Z, export puis réimport du `.json`. Pas encore testé sur un vrai terrain exporté de l'outil terrain.
- **Saisie** : modèle d'ennemi (type, nombre, front, profondeur, vitesse tactique, incertitude), départ et objectifs (clic carte), heure de départ, nos positions (facultatif). Plusieurs scénarios (nouveau, copier, supprimer).
- **Axes** : le plus rapide, le plus discret (évite ce qui est vu des points hauts et de nos positions), une variante. **Plausibilité forte / moyenne / faible** (règle fictive : l'axe que l'ennemi privilégie = forte, l'autre axe principal = moyenne, la variante = faible) ; l'axe choisi par défaut est le plus plausible.
- **Horaires** : heure d'arrivée de la tête à chaque ouvrage et tous les 3 km (réglable), avec incertitude (incertitude du modèle + 10 % du temps de route) ; curseur d'heure : position de la colonne sur l'axe (trait noir = probable, orange = possible).
- **Une seule couche par défaut** (axes + position) ; temps de trajet depuis le départ, zones vues, mobilité, routes à cocher.
- **Export** `ennemi-prepa-gtia` v1 : scénarios, axes, horaires, terrain inclus (entrée de l'outil « conduite »).
- **Ne fait plus** : choix défensive / offensive, zones à surveiller, points où frapper, contacts. L'ancien `ennemi.html` est archivé (voir « Retours du 18/10/2026 (suite) »).
- **Limites** : doctrine fictive ; « discret » suppose tous les points hauts non occupés par l'ennemi (défaut 2 non traité) ; vitesse constante (pas de haltes) ; pas de sauvegarde automatique des scénarios (export `.json` à la main) ; une seule unité par scénario.

### Compatibilité smartphone Android (18/10/2026)
Demandée par l'utilisateur (la règle « PC uniquement » ne tient plus pour l'affichage). Les trois pages (`index.html`, `ennemi.html`, `ennemi-prepa.html`) s'adaptent sous 760 px de large : panneau en bas de l'écran (46 % de la hauteur) avec bouton ▾/▴ pour le replier, barre d'outils compacte en haut, réglage de l'ennemi en plein écran, curseur d'heure pleine largeur, légende masquée (couches listées dans l'onglet Affichage), champs en 16 px (pas de zoom automatique), boutons d'au moins 40 px, info-bulles au toucher (appui sur un mot souligné), carte cadrée au-dessus du panneau. Testé en simulation Pixel 7 sous Chromium (Playwright), tactile : pose du départ et de l'objectif, axes, horaires, repli du panneau, réglage ; pas testé sur un vrai téléphone. Calculs : la durée sur un vrai terrain 20 km est à vérifier sur téléphone.

### Ennemi conduite : état au 18/10/2026
Testé dans Chromium (Playwright, PC et simulation Pixel 7 tactile) sur `terrain-demo.json` et sur un fichier de prépa mission : contact par clic, ennemi inconnu (fantassins / roues / chenilles) ou connu (scénario d'un fichier de prépa mission), en mouvement ou à l'arrêt, curseur d'heure, zones à survoler, copie de la liste, export `.json`. Pas testé sur un vrai terrain ni sur un vrai téléphone.
- **Saisie** : un ou plusieurs contacts (position, heure, éléments vus) ; l'ennemi connu vient du fichier enregistré par « Ennemi prépa mission » (type, nombre, front, profondeur, axes prévus avec leur plausibilité) ; sinon unité type de la catégorie choisie ; « en mouvement » ou « à l'arrêt, il cherche le couvert ».
- **Calcul** (fictif, réglable) : temps de trajet depuis le contact (même moteur que l'outil terrain, vitesse tactique) ; présence probable = attrait du terrain (en mouvement : vitesse du terrain, couloirs, axes d'approche ; à l'arrêt : forêt, bâti) × décroissance gaussienne avec le temps de trajet depuis le contact, dont l'échelle grandit avec le temps écoulé (50 % du temps supposé en mouvement) × bonus le long des axes prévus (si connus) ; éléments vus retirés ; un contact sur l'eau repart de la maille praticable la plus proche (6 mailles).
- **Sorties** : carte de présence probable, lignes de temps de trajet (5, 10, 20, 40 min), **zones à survoler** classées (rayon 500 m, 5 zones) avec niveau forte / moyenne / faible (≥ 30 % / ≥ 10 % du total), distance et délai depuis le contact, raison terrain, ce qu'il faut chercher ; liste copiable (coordonnées, rayon, niveau) pour les drones.
- **Limites** : doctrine fictive ; unité unique ; pas de direction de mouvement (la présence s'étale dans toutes les directions praticables, sauf bonus des axes prévus) ; au-delà de ~40 min, aucune zone ne ressort (tout est « faible », signalé à l'écran).

### Web app installable (18/10/2026)
`app.html` : page d'accueil avec les trois outils (Terrain, Ennemi prépa mission, Ennemi conduite) et l'ancien outil ennemi ; `manifest.webmanifest`, `sw.js` (service worker), icônes `icon-*.png`. Installable sur Android (Chrome : menu ⋮ → Installer l'application). Les pages s'ouvrent sans réseau (copie locale ; réseau d'abord pour recevoir les mises à jour), sauf le fond de carte. Testé hors ligne dans Chromium. Pour forcer une nouvelle version du cache, changer `VERSION` dans `sw.js`.

### Panneau de l'outil terrain sur téléphone (18/10/2026)
Retour de l'utilisateur sur un vrai Android : le paramétrage occupait la moitié de l'écran. Sous 760 px, `index.html` affiche un bandeau « Outil terrain » (message d'état + bouton ▾/▴ pour replier le panneau) et des rubriques repliables (À propos, Zone, Arme et vue, Couches, Points de franchissement, Outil, Synthèse, Zones enregistrées ; seule « Zone » est ouverte au départ). Hauteur maximale du panneau : 44 % de l'écran. Même principe pour `ennemi.html`, `ennemi-prepa.html` et `ennemi-conduite.html` : bandeau fin (titre, état, ▾/▴) et rubrique « Terrain et fichiers » qui se replie dès que le terrain est ouvert, onglets collés sous le bandeau. Autre piste d'ergonomie proposée à l'utilisateur : barre d'onglets en bas + feuilles courtes (en attente de choix).

### Ergonomie téléphone, version 2 (18/10/2026, choix « A + B » de l'utilisateur)
Remplace le panneau repliable : sous 760 px, **barre d'onglets en bas** (4 boutons) ; un appui ouvre une **feuille courte** (40 % de l'écran) sur ce seul sujet, un second appui (ou ▾) la ferme. Outil terrain : Zone / Carte / Outil / Synthèse. Outils ennemi : Terrain / (Préparer | Contact | Situation) / (Horaires | Chercher | Résultats) / Affichage. La feuille s'ouvre sur « Terrain » au départ et se ferme dès que le terrain est ouvert ; le message d'état devient une pastille au-dessus de la barre quand la feuille est fermée. **Pastilles sur la carte** : outil terrain = arme (Chenillé / Roue / Logistique / Fantassin) + « Couches » ; prépa mission = type d'ennemi ; conduite = type d'ennemi + Mouvement / Arrêt. Le bandeau de conseil se masque d'un appui. Sur PC, rien ne change (le calcul non plus). Testé en simulation Pixel 7 tactile ; pas encore sur un vrai téléphone.

### Outil terrain : disposition des outils et annulation (18/10/2026)
Retour sur un vrai Android : les boutons « Effacer » ne correspondaient pas à la position des outils. Chaque outil (Couloir A→B, Point d'observation, Qui voit ce point ?) a désormais son « ✕ Effacer » sur la même ligne. Ajout d'un bouton **« ↶ Annuler » sur la carte** (en haut à gauche sur téléphone, à côté du panneau sur PC) et de **Ctrl+Z** : annule la dernière action sur les couloirs, observations et « qui voit » (pose, ou effacement groupé) ; un point A de couloir déjà posé s'annule d'abord. La pile d'annulation est vidée à l'ouverture ou à l'analyse d'une zone. Testé en simulation Pixel 7 et PC ; pas encore sur un vrai téléphone.

### Retours du 18/10/2026 (suite) : ancien outil, allègement, conservation du travail
- **Ancien outil ennemi archivé** : `archive/ennemi-v2-posture.html` (bandeau « plus maintenu »). `ennemi.html` redirige vers « Ennemi prépa mission » en gardant le paramètre `?zone=` ; le bouton « Ennemi → » de l'outil terrain ouvre désormais la prépa mission. Les axes illisibles (tous blancs) venaient d'un défaut de l'ancien outil (style de ligne en pointillé piloté par donnée, refusé par la carte : seul le trait blanc de contour s'affichait) ; le nouvel outil ne l'a plus.
- **Allègement de la carte sur téléphone** : barre du haut réduite à deux lignes (pastilles d'abord, outils ensuite), « Annuler » en icône, échelle masquée, conseil affiché en bas de carte et masqué seul après 6 s.
- **Travail conservé** (IndexedDB `terrain-gtia-travail`, sur l'appareil, voir aussi « Zone courante partagée ») : prépa mission et conduite enregistrent automatiquement leur état (terrain, scénarios, contacts) et le reprennent à la réouverture ; bouton « Nouveau travail » pour tout effacer. **Passage prépa → conduite sans fichier** : « Reprendre la prépa mission en cours » dans l'onglet Terrain de la conduite (le fichier .json reste possible). Testé en simulation Pixel 7 (saisie, rechargement, reprise de la prépa, contact, rechargement, nouveau travail, redirection) ; pas encore sur un vrai téléphone. Limite : un navigateur en navigation privée ou des données du site effacées font perdre le travail.

### Zone courante partagée entre les outils (18/10/2026)
Défaut signalé : en passant de l'outil terrain à un outil ennemi (ou l'inverse) sans passer par le bouton « Ennemi → », le terrain n'était pas rechargé. Désormais, **la dernière zone ouverte dans un outil est la zone courante** (`localStorage` : `terrain-gtia-zone-courante`) et les trois outils l'ouvrent seuls au démarrage : outil terrain (sinon zone la plus récente), prépa mission et conduite (priorité : zone demandée par `?zone=`, puis zone courante, puis dernier travail, puis zone la plus récente de l'outil terrain). Le travail des outils ennemi est conservé **terrain par terrain** (clés `prepa:<terrain>` et `conduite:<terrain>`, pointeur `…:dernier`) : changer de zone ne détruit pas le travail de l'autre. Un terrain venu d'un fichier .json est gardé à part (`terrain:fichier:<nom>`). Boutons de la liste des zones de l'outil terrain : « Charger », « Prépa → », « Conduite → », « Suppr. ». Testé en simulation Pixel 7 : import dans l'outil terrain, ouverture directe de la conduite puis de la prépa (terrain présent), retour dans l'outil terrain (zone rechargée), reprise du travail, reprise de la prépa dans la conduite, ouverture avec `?zone=`. Non testé sur un vrai téléphone.

### Terrain visible dans les outils ennemi (21/10/2026)
Retour de l'utilisateur sur PC (Edge) : « le terrain ne suit pas » alors que la zone était bien ouverte (message d'état, cadre en pointillés, zone choisie) : l'écran paraissait vide parce que toutes les couches étaient masquées par défaut et que le fond IGN ne s'affichait pas sur ce réseau. Corrections : **routes et ouvrages affichés par défaut** dans la prépa et la conduite ; **bouton « Terrain »** au-dessus de la carte (couleurs de mobilité : vert praticable, orange ralenti, rouge impraticable) ; **bascule automatique du fond IGN vers OSM** après 4 tuiles en erreur (les trois outils), avec message. Reproduction faite avec une vraie analyse de zone (données OpenStreetMap simulées) : la zone se transmet bien de l'outil terrain à la prépa par « Prépa → ». Testé dans Chromium (PC et Pixel 7 simulé, fond IGN bloqué) ; pas sur le réseau de l'utilisateur.

### Outil 4 « Implantation » : radars et chars (23/10/2026)
`implantation.html`, 4e outil de la web app (accueil, hors ligne). Testé par `tests/run.js` (relief synthétique : plaine à 100 m et une grosse colline) ; pas encore avec un vrai relief ni sur un vrai téléphone.
- **Radars (mode « grande zone »)** : relief seul chargé autour du centre de la carte (tuiles Terrarium), zone de 100 à 250 km, maille de 0,5 à 1,25 km, 200 × 200 mailles. Trois radars comparés (20, 40, 100 km, portées modifiables), trois altitudes de cible au-dessus du sol (50, 500, 5 000 m), mât de 10 m. Pour chaque emplacement candidat (environ 800, un tous les 7 mailles) : **surface couverte** en km² par radar et par altitude, avec courbure de la terre à 4/3 de son rayon ; classement, **affinage local** des 5 meilleurs, part du **disque idéal** (niveaux forte ≥ 60 %, moyenne ≥ 30 %). **Plan à 2, 3 ou 4 radars du même type** : chaque radar là où il ajoute le plus de surface nouvelle (masques binaires). **Plancher de détection** (altitude minimale vue) en couche. **« Tester ici »** : tableau 3 radars × 3 altitudes en n'importe quel point. Calcul découpé en tranches (barre de progression, bouton Arrêter), environ 3 s sur PC pour 840 emplacements.
- **Chars (zone de l'outil terrain)** : portée pratique 2 500 m, **distance utile minimale = 2/3 de la portée** (67 %), hauteur des yeux 2,5 m, cible 2 m, forêts et bâti qui cachent la vue. Un emplacement est classé par sa **surface de tir utile** (terrain vu entre 2/3 de la portée et la portée) ; **secteur utile** minimal de 30° ; ouverture forte ≥ 120°, moyenne ≥ 60°. Un seul char.
- **Interface** : choix du mode (Radars / Chars) et outils (Tester ici / Infos) en haut de la carte, panneau à onglets (Zone, Régler, Résultats, Affichage), barre du bas et feuille courte sur téléphone, positions en MGRS (commun.js) avec liste copiable et export `.json`, fond monde automatique hors de France, « Aller à ». Travail conservé (relief, résultats, réglages) et repris à la réouverture.
- **Limites** : pas de parasites au sol, de météo ni de conditions de propagation anormales ; le relief d'environ 30 m peut inclure végétation et bâti ; la cible suit le terrain ; maille de 1 km donc petits obstacles ignorés ; les chars ne tiennent pas encore compte de l'abri (voir `BACKLOG.md`).

### Tests et boucle autonome (23/10/2026)
`tests/` : 11 scénarios de bout en bout dans Chromium (PC et Pixel 7 simulé : ouverture de toutes les pages, parcours de la prépa et de la conduite, navigation téléphone, annulation, zone courante et travail conservé, terrain visible et repli du fond, implantation radars et chars, hors ligne), relief synthétique, bannière d'erreur de `commun.js` surveillée. Lancer `node tests/run.js` (voir `tests/README.md`). `BACKLOG.md` : liste priorisée des améliorations, avec le mode d'emploi de la boucle autonome.

## Outil ami (à venir)

Prisme terrain : délais, contraintes des couloirs de mobilité, à partir du fichier `ennemi-gtia`.
