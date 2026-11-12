# Tests de bout en bout

Ouvrent les pages dans un vrai Chromium (PC et téléphone simulé), cliquent comme un utilisateur et vérifient le résultat.

```
node tests/run.js              # tous les scénarios
node tests/run.js implantation # ceux dont le nom contient « implantation »
VERBEUX=1 node tests/run.js    # affiche aussi les vérifications réussies
```

Prérequis : Node 18+, le module `playwright` et un Chromium.
Variables : `PLAYWRIGHT_MODULE` (chemin du module, défaut `playwright`), `CHROMIUM` (exécutable, défaut `/opt/pw-browsers/chromium`).
Exemple dans l'environnement de travail : `PLAYWRIGHT_MODULE=/opt/node-tools/node_modules/playwright node tests/run.js`.

Le fond de carte (IGN, OSM) est coupé pendant les tests (plus rapide, et cela vérifie le repli). Les tuiles de relief sont remplacées par un relief synthétique (plaine à 100 m et une grosse colline) : voir `helpers.js`. Les captures d'écran sont écrites dans `tests/out/` (non versionné).

Un test qui échoue affiche la vérification en cause. Les scénarios sont indépendants : chacun repart d'un navigateur vierge.

## Tests de calcul (sans navigateur)

```
node tests/moteur.js           # moteur-terrain.js seul, en Node pur (≈ 10 s)
VERBEUX=1 node tests/moteur.js # affiche aussi les vérifications réussies
```

Grilles synthétiques (pente, eau, pont, coupure, sol sec / humide, les 4 classes), non-régression sur `terrain-demo.json`, aller-retour export v3 → chargement, lecture d'un fichier version 2, identité fichier / zone enregistrée (voir `CONTRAT-JSON.md`).
`node tests/donnees.js [filtre]` : récupération des données (donnees-osm.js) avec serveurs Overpass et relief simulés (jeu OpenStreetMap synthétique près de Naples) : plusieurs tuiles, tuiles vides en mer et contrôle, bascule de serveur et remise à zéro des échecs, message quand tout échoue, arrêt puis reprise depuis le cache, mer sans trait de côte, grande zone 50 km (temps, réactivité, mêmes grilles en séquences). `DENSITE=n` règle la densité du jeu 50 km (défaut 3). Aucun accès aux vrais serveurs.
