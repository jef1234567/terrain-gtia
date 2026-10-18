# terrain-gtia

Outil d'analyse du terrain au niveau GTIA (démonstrateur, données OpenStreetMap + relief mondial ~30 m) : mobilité par arme (chenillé, roue, logistique, fantassin), points de franchissement et goulets uniques, couvert, couloirs, fiche de synthèse, sauvegarde et fichier terrain `.json`.

Ouvrir `index.html` (ou la page GitHub Pages).

**Outil ennemi** : `ennemi.html` charge le fichier terrain exporté et estime les zones probables de l'ennemi non vu, les axes rouges, les délais, les NAI et TAI, en posture défensive et offensive (doctrine fictive modifiable), en deux volets : préparer / étudier, réagir à l'ennemi. Il utilise `moteur-terrain.js`, à déposer à côté ; `terrain-demo.json` est un terrain synthétique pour l'essayer.

**Ennemi prépa mission** : `ennemi-prepa.html` (planification à froid : ennemi, départ, objectif → axes, plausibilité, horaires d'arrivée, position à une heure donnée ; export `.json`). Un outil « Ennemi conduite » (à chaud) suivra.

Cadrage et choix retenus : `CADRAGE.md`. Seuils fictifs, non calibrés.
