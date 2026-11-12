# terrain-gtia

Outil d'analyse du terrain au niveau GTIA (démonstrateur, données OpenStreetMap + relief mondial ~30 m) : mobilité par arme (chenillé, roue, logistique, fantassin), points de franchissement et goulets uniques, couvert, couloirs, fiche de synthèse, sauvegarde et fichier terrain `.json`.

Ouvrir `index.html` (ou la page GitHub Pages).

**Grandes zones (30, 40, 50 km, maille 100 m)** : OpenStreetMap est téléchargé par tuiles d'environ 10 km (marge de 500 m autour de la zone), deux à la fois, avec nouvel essai et cache dans le navigateur ; une analyse arrêtée ou interrompue se reprend sans retélécharger les tuiles reçues. Le calcul porte ensuite sur la zone entière.

**Téléchargement OpenStreetMap (serveurs Overpass)** : trois serveurs publics essayés dans l'ordre mesuré le 10/11/2026 : Europe (`ovp.dresel.systems`, données de la veille, seulement si la zone est en Europe), principal (`overpass-api.de`), `overpass.private.coffee`. Délais de 45, 75 puis 100 s par requête ; une requête à la fois sur les serveurs qui l'exigent ; 30 s de pause après un refus (429 / 406) ; un serveur qui échoue deux fois de suite passe en dernier. La progression nomme le serveur essayé et le temps écoulé. Tuiles gardées 30 jours dans le navigateur. Le serveur russe `maps.mail.ru` est volontairement exclu (chaque requête montre la zone analysée au serveur).

**Coupures d'ouvrages (hors ligne)** : sur une zone chargée, toucher un point de franchissement → Détruit / Bloqué / Dégradé. Recalcul des goulets, couloirs A→B et zones coupées par arme ; journal des coupures ; enregistré avec la zone et dans l'export `.json` (`coupures`, `journal_coupures`), et appliqué dans les outils ennemi. Pont détruit sur cours d'eau : NO-GO hors pont, **à vérifier** (largeur OSM affichée si renseignée, profondeur inconnue).

**Rendu de la carte (outil terrain)** : rendu lissé par défaut (case « Rendu lissé » dans Couches ; décochée, on revoit les mailles). Le lissage est purement visuel : le calcul et « Infos maille » restent à la maille. Légende toujours visible sur la carte (ordinateur) : arme, état du sol, couleurs de la vue. Fond de mobilité à 35 % d'opacité par défaut. Rivières, canaux, ruisseaux et fossés tracés en vraies lignes ; le tracé des ruisseaux est conservé dans la zone et dans l'export (`ruisseaux`) à partir de la version 10/11 : une zone plus ancienne garde ses ruisseaux en trame jusqu'à sa prochaine analyse.

**Ancien outil ennemi** (défensive / offensive) : `archive/ennemi-v2-posture.html`.

**Outil Ennemi unique (refonte en cours, étape 0 du 12/11/2026)** : `ennemi.html`, deux modes Planification / Conduite ; pour l'instant squelette (chargement du terrain par étapes, bascule de mode, carte). Doctrine fictive unique dans `doctrine.js` ; calculs `moteur-ennemi.js` ; rendu et KML `rendu-ennemi.js` ; interface commune `commun-ennemi.js` ; format d'export `ennemi-gtia` v3 dans `CONTRAT-JSON.md`. Les deux outils ci-dessous restent en service jusqu'à leur redirection vers `ennemi.html`.

**Ennemi prépa mission** : `ennemi-prepa.html` (planification à froid : ennemi, départ, objectif → axes, plausibilité, horaires d'arrivée, position à une heure donnée ; export `.json`). **Ennemi conduite** : `ennemi-conduite.html` (à chaud : un contact vu, où peut être le reste, zones à survoler avec les drones, temps de trajet ; « Enregistrer (.json) » contient terrain, contacts et scénarios et se rouvre dans cet outil).

**Implantation** : `implantation.html` (où placer des radars de 20, 40 et 100 km pour couvrir la plus grande surface d'espace aérien, selon l'altitude de la cible et le relief ; où placer un char pour avoir au moins 2/3 de sa portée pratique en vue). Mode « grande zone » (relief seul) pour les radars, zone de l'outil terrain pour les chars.

**Web app (Android et PC)** : ouvrir `app.html` (accueil des trois outils, installable depuis Chrome, fonctionne sans réseau hors fond de carte).

**Sur ordinateur (les trois outils)** : champ « Aller à » (MGRS, coordonnées ou nom de lieu, Ctrl+F) ; coordonnées MGRS et infos de la maille sous la souris ; MGRS dans les fenêtres, la fiche et la liste « drones » ; fonds « Photo monde » et « Topo monde » (passage automatique hors de France) ; clavier : Ctrl+Z / Ctrl+Y, Échap, 1 à 4 (arme dans l'outil terrain, outils de la barre dans les outils ennemi), Suppr (symbole ouvert) ; exports : carte en image (.png) avec légende et cartouche, impression / PDF, KML (Google Earth, Géoportail, QGIS), fiche OAKOC en .txt.

**Organisation du code** : `moteur-terrain.js` = moteur de calcul unique des trois outils (calculs longs découpés en étapes avec barre de progression) ; `commun.js` = interface commune (MGRS, Aller à, KML, image, impression) ; `donnees-osm.js` = données de l'outil Terrain (relief, OpenStreetMap / Overpass, rastérisation des faits, masque mer) ; `rendu-terrain.js` = rendu carte de l'outil Terrain (couleurs, légende, couches d'analyse, cours d'eau en lignes, lissage) ; `doctrine.js`, `moteur-ennemi.js`, `rendu-ennemi.js`, `commun-ennemi.js` = outil Ennemi unique (voir plus haut) ; `terrain-demo.json` = terrain de démonstration (contrat v3), fabriqué par `node tests/fabriquer-demo.js` ; `lib/` = bibliothèque de carte MapLibre 4.7.1 (licence BSD, `lib/LICENSE-maplibre.txt`), plus de dépendance à unpkg.com.

Cadrage et choix retenus : `CADRAGE.md`. Seuils fictifs, non calibrés.
