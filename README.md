# terrain-gtia

Outil d'analyse du terrain au niveau GTIA (démonstrateur, données OpenStreetMap + relief mondial ~30 m) : mobilité par arme (chenillé, roue, logistique, fantassin), points de franchissement et goulets uniques, couvert, couloirs, fiche de synthèse, sauvegarde et fichier terrain `.json`.

Ouvrir `index.html` (ou la page GitHub Pages).

**Outil ennemi** : `ennemi.html` charge le fichier terrain exporté et estime les zones probables de l'ennemi non vu, les axes rouges, les délais, les NAI et TAI, en posture défensive et offensive (doctrine fictive modifiable). Il utilise `moteur-terrain.js`, à déposer à côté.

Cadrage et choix retenus : `CADRAGE.md`. Seuils fictifs, non calibrés.
