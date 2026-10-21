# terrain-gtia

Outil d'analyse du terrain au niveau GTIA (démonstrateur, données OpenStreetMap + relief mondial ~30 m) : mobilité par arme (chenillé, roue, logistique, fantassin), points de franchissement et goulets uniques, couvert, couloirs, fiche de synthèse, sauvegarde et fichier terrain `.json`.

Ouvrir `index.html` (ou la page GitHub Pages).

**Grandes zones (30, 40, 50 km, maille 100 m)** : OpenStreetMap est téléchargé par tuiles d'environ 10 km (marge de 500 m autour de la zone), deux à la fois, avec nouvel essai et cache dans le navigateur ; une analyse arrêtée ou interrompue se reprend sans retélécharger les tuiles reçues. Le calcul porte ensuite sur la zone entière.

**Coupures d'ouvrages (hors ligne)** : sur une zone chargée, toucher un point de franchissement → Détruit / Bloqué / Dégradé. Recalcul des goulets, couloirs A→B et zones coupées par arme ; journal des coupures ; enregistré avec la zone et dans l'export `.json` (`coupures`, `journal_coupures`), et appliqué dans les outils ennemi. Pont détruit sur cours d'eau : NO-GO hors pont, **à vérifier** (largeur OSM affichée si renseignée, profondeur inconnue).

**Ancien outil ennemi** (défensive / offensive, remplacé par les deux outils ci-dessous) : `archive/ennemi-v2-posture.html` ; `ennemi.html` renvoie vers « Ennemi prépa mission ».

**Ennemi prépa mission** : `ennemi-prepa.html` (planification à froid : ennemi, départ, objectif → axes, plausibilité, horaires d'arrivée, position à une heure donnée ; export `.json`). **Ennemi conduite** : `ennemi-conduite.html` (à chaud : un contact vu, où peut être le reste, zones à survoler avec les drones, temps de trajet).

**Web app (Android et PC)** : ouvrir `app.html` (accueil des trois outils, installable depuis Chrome, fonctionne sans réseau hors fond de carte).

Cadrage et choix retenus : `CADRAGE.md`. Seuils fictifs, non calibrés.
