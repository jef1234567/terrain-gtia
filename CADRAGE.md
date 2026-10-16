# Analyse terrain GTIA – cadrage

Projet de Jean-François Fraysse. Démonstrateur en ligne (GitHub Pages), version hors ligne prévue plus tard (puissance de calcul + fond de carte + données terrain locales).

## Démarche retenue

1. **Outil terrain d'abord**, seul. Il décrit le terrain et la mobilité, sans ennemi.
2. **Outil ennemi ensuite**, séparé, qui charge le fichier terrain produit par le premier.
3. Carte **2D** uniquement.
4. Analyse toujours **par arme** : char, fantassin (à pied), logistique à roues ; d'autres classes possibles plus tard.
5. Échelon : **GTIA** (zone de 10 à 20 km de côté, maille de 100 m).
6. Données **open source** : OpenStreetMap (Overpass), relief mondial Terrarium (~30 m). Plus tard : IGN RGE ALTI (sol nu), données locales.
7. Tous les seuils et paramètres sont **fictifs, visibles et modifiables** (JSON), à calibrer ensuite sur un terrain connu.

## État actuel (index.html)

Fonctionne sur la région de Saumur :
- grille de mailles, vitesse tout-terrain par arme (moyenne harmonique des couverts : forêt, bâti, marais, vigne/verger, eau) ;
- pente directionnelle (montée, descente, dévers) dans les déplacements ;
- obstacles linéaires : eau infranchissable hors pont, ruisseaux et autoroutes avec délai de franchissement ;
- réseau routier en graphe séparé ;
- zones GO larges (contour), itinéraire A→B, couloir orienté.
- Partie ennemi/ami (doctrine fictive, probabilité de présence, isochrones, NAI, évitement) : **à sortir de l'outil terrain**. Une copie est conservée dans `archive/outil-complet-v0.html` pour l'outil ennemi.

## Refonte de l'outil terrain – périmètre validé

1. **Connectivité routière fiable** : pas de sortie de route sur les ponts et tunnels ; changement de route aux seules vraies jonctions ; bretelles (_link) à la vitesse de leur route mère.
2. **Ponts et points de passage obligés** affichés ; détection des **goulets uniques** (franchissement dont la suppression coupe la zone pour une arme).
3. **Couches couvert et installation** : surface plate exploitable, possibilité de stationner à couvert, par arme.
4. **Couloirs de mobilité** : zones GO larges et couloirs orientés entre deux points, par arme.
5. ~~Itinéraires~~ : retirés de l'outil terrain (jugés peu utiles ; les couloirs orientés suffisent).
6. **Lisibilité** :
   - carte « **qui passe où** » toutes armes : vert = toutes armes, jaune = char + fantassin, orange = fantassin seul, aucune couleur = personne ;
   - **fiche de synthèse chiffrée** de la zone, par arme : % GO / SLOW-GO / NO-GO, ponts, goulets uniques, couloirs principaux (utilisable pour un paragraphe terrain d'ordre) ;
   - infranchissable non coloré, routes en surimpression, couches à cocher.
7. **Conservation du travail** :
   - automatique dans le navigateur (IndexedDB), liste des zones analysées rechargeables ;
   - **fichier terrain exportable/importable (.json)**, qui sera l'entrée de l'outil ennemi.

Écarté pour l'instant : hexagones H3, débit et flux logistiques, compartiments de terrain.

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
