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
- **Intervisibilité** : points hauts dominants et zones vues depuis eux ; outil « point d'observation » ; forêts et bâti à hauteur forfaitaire, courbure terrestre.
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

## Outil ennemi (plus tard)

Pistes déjà prototypées : doctrine fictive par échelon (front, profondeur, effectif), attractivité selon la posture, gabarit autour d'un contact, mise à jour bayésienne par zones vues vides, isochrones, NAI. À améliorer : empreinte d'unité épousant le terrain (au lieu d'une tache gaussienne), axes rouges probables distincts, intervisibilité sur relief + forêts.
