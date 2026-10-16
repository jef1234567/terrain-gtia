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

## Outil ami (à venir)

Prisme terrain : délais, contraintes des couloirs de mobilité, à partir du fichier `ennemi-gtia`.
