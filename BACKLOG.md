# BACKLOG — améliorations à traiter

Ce fichier alimente la boucle autonome (voir « Mode d'emploi » en bas). Un point = une amélioration, avec sa **condition de réussite** vérifiable.
Les points marqués **[à valider]** demandent une décision de l'utilisateur : ne pas les traiter seul, poser la question.

Statuts : `[ ]` à faire · `[x]` fait · `[~]` en cours · `[à valider]`

## Priorité haute

- [ ] **Vérifier l'outil Implantation avec un vrai relief** : lancer « Charger le relief ici » sur une vraie région (réseau normal), calculer, comparer le meilleur site radar à la géographie connue (les sites hauts doivent ressortir pour les cibles basses).
  Réussite : un compte rendu avec captures ; les écarts avec l'intuition sont expliqués (maille, mât, altitude de la cible).
- [ ] **Lisibilité des axes sur téléphone** (retour utilisateur) : vérifier sur un vrai terrain que les trois axes se distinguent (couleur, trait) et que les horaires ne se chevauchent pas ; décaler ou regrouper les étiquettes proches.
  Réussite : capture Pixel 7 sur une zone de 20 km avec 3 axes, étiquettes lisibles.
- [~] **Temps de calcul sur téléphone** : mesurer l'ouverture d'une zone de 20 km (maille 100 m) dans l'outil Ennemi ; si plus de 8 s, passer le calcul lourd dans un Web Worker.
  Réussite : message de progression visible, interface jamais figée plus de 1 s.
  Fait le 12/11/2026 sur PC (Chromium) : calculs Ennemi par étapes, recherche de chemins découpée (`searchEtapes`), barre de progression et « Arrêter » ; gel maximal ≈ 0,3 s sur 500 × 500 (avant ≈ 2 s). Reste : mesure sur un vrai téléphone ; le temps total n'a pas baissé (Web Worker non fait).
- [ ] **Outil Ennemi : plusieurs objectifs enchaînés** : aujourd'hui l'axe va à l'objectif le plus proche (en temps de trajet) ; proposer un axe qui passe par les objectifs dans l'ordre (objectif intermédiaire, puis final).
  Réussite : deux objectifs posés → un axe qui les relie dans l'ordre, horaires à chacun ; test sur `terrain-demo.json`.
- [ ] **Outil Ennemi : essai sur un vrai terrain de 20 à 50 km** (zone analysée dans l'outil Terrain) : axes, horaires, zones à survoler, temps de calcul et gel mesurés.
  Réussite : compte rendu avec captures ; gel < 1 s.
- [ ] **Outil Ennemi : étiquettes qui se chevauchent** (regroupement et jalon proches, zone à survoler sur un contact) : décaler ou masquer par collision.
  Réussite : capture sans chevauchement sur la démonstration à deux unités.
- [ ] **Chars : tenir compte du couvert** (défilement, lisière, crête) en plus du champ de tir : un bon emplacement est caché de l'ennemi.
  Réussite : le résultat distingue « vu de loin » et « abrité » ; test sur relief synthétique avec une crête.

- [à valider] **Seuils de gué par classe** (`eau_largeur_max_m`, `eau_profondeur_max_m`, `franchissement_eau_min`, valeurs supposées `eau.*`) : inventés ; à fixer par le propriétaire (doctrine, fiches véhicules).
- [ ] **Essais réels du produit Terrain** (contrat v3, lots A-B-C) : analyse 50 × 50 km près de Naples sur les vrais serveurs Overpass (Europe, puis principal, puis private.coffee) ; mer et trait de côte justes sur une vraie côte ; part des rivières avec `depth` renseigné dans OSM.
  Réussite : compte rendu (durées par phase, serveurs utilisés, captures de la côte, verdicts de gué d'un pont coupé).
- [ ] **Étape « Couloirs A→B »** d'un seul bloc (≈ 2 s sans réponse sur 50 km, mesuré par `tests/donnees.js`) : la découper en séquences.

## Priorité moyenne

- [ ] **Radars : plancher de détection plus lisible** (légende chiffrée en mètres, courbes de niveau de détection tous les 100 m).
- [ ] **Radars : vulnérabilité du site** (visibilité depuis le sol, pente, distance à une route) pour classer autrement les emplacements.
- [ ] **Lien Implantation ↔ outil Ennemi (planification)** : mesurer la part de chaque axe ennemi couverte par le radar choisi ; exporter les positions vers « Nos positions » de l'outil Ennemi.
- [ ] **Outil terrain : points hauts amis / ennemis / inoccupés** (défaut 2 de la liste du 16/10) : l'axe discret de la prépa suppose tous les points hauts libres.
- [ ] **Conduite : direction du mouvement** (si le contact avance vers un point connu, étirer la carte de présence dans cette direction).
- [ ] **Chiffres vs niveaux** : vérifier que toute valeur chiffrée à l'écran (zones, axes, couverture) a son niveau forte / moyenne / faible (défaut 5).
- [ ] **Accessibilité tactile** : tailles de boutons ≥ 44 px, contraste des étiquettes sur fond IGN photo.

## À valider avec l'utilisateur

- [à valider] **Doctrine ennemie non classifiée** : remplacer les valeurs fictives (modèles d'unités, vitesses, niveaux) dès réception du document.
- [à valider] **Posture défensive / offensive** : ne plus l'utiliser (retirée du parcours) ; confirmer la suppression définitive de l'archive `ennemi-v2-posture.html`.
- [à valider] **Outil ami** : « prisme terrain » annoncé dans CADRAGE.md ; périmètre à préciser.
- [à valider] **Hébergement** : accès restreint aux outils (aujourd'hui public sur GitHub Pages) si des données sensibles sont saisies.

## Fait récemment

- [x] Outil Ennemi unique (12/11/2026) : `ennemi.html` branché sur le vrai moteur et le vrai rendu (calcul par étapes, « Arrêter », import / export par le moteur, migration des v1), rendu lissé commun `rendu-lisse.js` (plus de fetch), légende repliable placée sans cacher les objectifs, étiquettes de jalons et d'isochrones corrigées, anciennes pages redirigées, tests `ennemi-ui.js` et `rendu-ennemi.js` sur le moteur réel, `run.js` réécrit pour `ennemi.html`.

- [x] Outil terrain (10/11) : rendu lissé, légende sur la carte, fond à 35 %, cours d'eau en vraies lignes (tracé des ruisseaux conservé), test associé.
- [ ] Reste : mêmes améliorations de rendu dans l'outil Implantation (fait pour l'outil Ennemi par `rendu-lisse.js`).
- [x] Téléchargement OpenStreetMap (10/11) : serveur Europe en premier, délais courts, file par serveur, pause après refus, progression vivante, cache 30 jours, test de repli.
- [ ] Reste : essai réel sur 50 km (Naples) ; source de secours sans Overpass (tuiles vectorielles) à étudier.

- [x] Finitions d'interface : aide au premier lancement (bouton « Aide »), bandeau d'erreur persistant, focus clavier visible, « Maintenant » (conduite), « Copier les horaires » et étiquettes d'axes selon le zoom (prépa).
- [ ] Reste : pastilles radar/altitude sur la carte (Implantation), accueil avec nom de la zone courante et « travail en cours ».

- [x] Outil 1 « Ennemi prépa mission » et outil 2 « Ennemi conduite » (remplacés le 12/11/2026 par l'outil unique `ennemi.html`, modes Planification / Conduite).
- [x] Web app installable (accueil, manifeste, hors ligne), ergonomie téléphone (barre du bas, pastilles).
- [x] Zone courante partagée et travail conservé terrain par terrain.
- [x] Outil 4 « Implantation » (radars et chars) et dossier `tests/`.

## Mode d'emploi de la boucle autonome

À lancer avec `/loop` (voir le prompt dans la conversation) :

1. Lire `CADRAGE.md` et ce fichier ; prendre le premier point non fait qui n'est pas « à valider ».
2. Résumer en 3 lignes ce qui sera fait, puis le faire, en gardant le style du code existant (pas de sigle non expliqué à l'écran, valeurs fictives visibles et modifiables).
3. Lancer `node tests/run.js` ; regarder les captures dans `tests/out/` ; corriger jusqu'à ce que tout passe. Ajouter un test pour chaque nouvelle fonction.
4. Mettre à jour `CADRAGE.md` (état de l'outil) et ce fichier (cocher, noter les limites trouvées).
5. Commiter, pousser, ouvrir la pull request, la fusionner seulement si tous les tests passent.
6. S'arrêter et poser la question si le point demande une décision d'ergonomie ou de doctrine.
7. Terminer par un compte rendu de 5 lignes : fait, testé, limites, prochain point, questions.
