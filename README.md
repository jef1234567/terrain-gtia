# terrain-gtia

Outil d'analyse du terrain au niveau GTIA (démonstrateur, données OpenStreetMap + relief mondial ~30 m) : mobilité par arme (chenillé, roue, logistique, fantassin), points de franchissement et goulets uniques, couvert, couloirs, fiche de synthèse, sauvegarde et fichier terrain `.json`.

Ouvrir `index.html` (ou la page GitHub Pages).

**Grandes zones (30, 40, 50 km, maille 100 m)** : OpenStreetMap est téléchargé par tuiles d'environ 10 km (marge de 500 m autour de la zone), deux à la fois, avec nouvel essai et cache dans le navigateur ; une analyse arrêtée ou interrompue se reprend sans retélécharger les tuiles reçues. Le calcul porte ensuite sur la zone entière.

**Coupures d'ouvrages (hors ligne)** : sur une zone chargée, toucher un point de franchissement → Détruit / Bloqué / Dégradé. Recalcul des goulets, couloirs A→B et zones coupées par arme ; journal des coupures ; enregistré avec la zone et dans l'export `.json` (`coupures`, `journal_coupures`), et appliqué dans les outils ennemi. Pont détruit sur cours d'eau : NO-GO hors pont, **à vérifier** (largeur OSM affichée si renseignée, profondeur inconnue).

**Ancien outil ennemi** (défensive / offensive, remplacé par les deux outils ci-dessous) : `archive/ennemi-v2-posture.html` ; `ennemi.html` renvoie vers « Ennemi prépa mission ».

**Ennemi prépa mission** : `ennemi-prepa.html` (planification à froid : ennemi, départ, objectif → axes, plausibilité, horaires d'arrivée, position à une heure donnée ; export `.json`). **Ennemi conduite** : `ennemi-conduite.html` (à chaud : un contact vu, où peut être le reste, zones à survoler avec les drones, temps de trajet ; « Enregistrer (.json) » contient terrain, contacts et scénarios et se rouvre dans cet outil).

**Implantation** : `implantation.html` (où placer des radars de 20, 40 et 100 km pour couvrir la plus grande surface d'espace aérien, selon l'altitude de la cible et le relief ; où placer un char pour avoir au moins 2/3 de sa portée pratique en vue). Mode « grande zone » (relief seul) pour les radars, zone de l'outil terrain pour les chars.

**Web app (Android et PC)** : ouvrir `app.html` (accueil des trois outils, installable depuis Chrome, fonctionne sans réseau hors fond de carte).

**Sur ordinateur (les trois outils)** : champ « Aller à » (MGRS, coordonnées ou nom de lieu, Ctrl+F) ; coordonnées MGRS et infos de la maille sous la souris ; MGRS dans les fenêtres, la fiche et la liste « drones » ; fonds « Photo monde » et « Topo monde » (passage automatique hors de France) ; clavier : Ctrl+Z / Ctrl+Y, Échap, 1 à 4 (arme dans l'outil terrain, outils de la barre dans les outils ennemi), Suppr (symbole ouvert) ; exports : carte en image (.png) avec légende et cartouche, impression / PDF, KML (Google Earth, Géoportail, QGIS), fiche OAKOC en .txt.

**Organisation du code** : `moteur-terrain.js` = moteur de calcul unique des trois outils (calculs longs découpés en étapes avec barre de progression) ; `commun.js` = interface commune (MGRS, Aller à, KML, image, impression) ; `lib/` = bibliothèque de carte MapLibre 4.7.1 (licence BSD, `lib/LICENSE-maplibre.txt`), plus de dépendance à unpkg.com.

Cadrage et choix retenus : `CADRAGE.md`. Seuils fictifs, non calibrés.
