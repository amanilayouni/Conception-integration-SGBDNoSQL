# TP Jour 1 — Introduction au NoSQL & MongoDB


## Contenu du dépôt

| Fichier | Description |
|---|---|
| `reponses_jour1.md` | **Rendu principal** — Q1 → Q28 avec commande et résultat exact, R1 → R3, bonus B1/B2 |
| `rapport.js` | Script `mongosh` de la Partie 5 (Q27) |
| `docker-compose.yml` | Infrastructure MongoDB 7.0 + mongo-express |
| `query.json` | Filtre de l'export `mongoexport` (Q28) |
| `staten_island.json` | Export de l'arrondissement Staten Island — 969 documents (Q28) |
| `primer-dataset.json` | Jeu de données source (25 359 lignes, format JSON Lines) |
| `capture_express.png` | Capture de la collection `restaurants` dans mongo-express |
| `scripts/` | Scripts `mongosh` par partie, utilisés pour produire les résultats du rendu |

### Détail du dossier `scripts/`

| Script | Couvre |
|---|---|
| `01_partie1.js` | P0 + Q1 → Q11 (lecture, opérateurs, `$in`, `$regex`, dot-notation) |
| `02_partie2.js` | Q12 → Q19 (tableaux, `$size`, `$exists`, `$elemMatch`, agrégation) |
| `02b_verif.js` | Contrôle de l'écart de notes du pipeline Q18b |
| `02c_verif.js` | Identification des 13 notes à `score: null` |
| `03_partie3.js` | Q20 → Q23 (`insertOne`, `$push`, `$set`, `updateMany`) |
| `04_partie4.js` | Q24 → Q26 (`deleteMany`, gouvernance des données) |
| `05_bson_r3.js` | Mesures `bsonsize()` pour la réflexion R3 |
| `06_b1_index.js` | Bonus B1 — index sur `cuisine` + `explain("executionStats")` |
| `07_b2_geo.js` | Bonus B2 — index `2dsphere` + `$near` / `$geoNear` |

---



### 1. Lancer l'infrastructure

```bash
docker compose up -d
docker compose ps          
```

Résultat attendu :

```
NAME                  IMAGE                  SERVICE         STATUS   PORTS
mongo-express-ipssi   mongo-express:latest   mongo-express   Up       0.0.0.0:8081->8081/tcp
mongo-ipssi           mongo:7.0              mongo           Up       0.0.0.0:27018->27017/tcp
```

> **Port hôte : 27018 et non 27017.** Voir la section [Choix techniques](#choix-techniques) ci-dessous.

### 2. Récupérer le jeu de données

```bash
curl -L -o primer-dataset.json \
  https://raw.githubusercontent.com/mongodb/docs-assets/primer-dataset/primer-dataset.json
wc -l primer-dataset.json      # 25359
```

Équivalents PowerShell (`curl` y est un alias d'`Invoke-WebRequest`, et `wc` n'existe pas) :

```powershell
curl.exe -L -o primer-dataset.json https://raw.githubusercontent.com/mongodb/docs-assets/primer-dataset/primer-dataset.json
python -c "print(sum(1 for line in open('primer-dataset.json') if line.strip()))"
```

### 3. Importer dans MongoDB

```bash
docker cp primer-dataset.json mongo-ipssi:/tmp/primer-dataset.json

docker exec mongo-ipssi mongoimport \
  --username admin --password ipssi2025 --authenticationDatabase admin \
  --db nyc --collection restaurants --drop --file /tmp/primer-dataset.json
```

Résultat attendu : `25359 document(s) imported successfully. 0 document(s) failed to import.`

Le flag `--drop` rend l'import **idempotent** : on peut le rejouer autant de fois que nécessaire
pour repartir d'un état propre.

### 4. Se connecter

**Shell :**

```bash
docker exec -it mongo-ipssi mongosh -u admin -p ipssi2025 --authenticationDatabase admin
```

```js
use nyc
db.restaurants.countDocuments({})   // 25359
```

**Interface graphique :**

- **mongo-express** — <http://localhost:8081> (identifiants `admin` / `ipssi2025`)
- **MongoDB Compass** — URI : `mongodb://admin:ipssi2025@localhost:27018/?authSource=admin`

### 5. Rejouer les questions

Les scripts sont à copier dans le conteneur, puis à exécuter dans l'ordre :

```bash
docker cp scripts/01_partie1.js mongo-ipssi:/tmp/
docker exec -i mongo-ipssi mongosh -u admin -p ipssi2025 \
  --authenticationDatabase admin nyc --quiet --file /tmp/01_partie1.js
```

> **L'ordre compte.** Les scripts `03` et `04` **modifient** la base (insertion, mises à jour,
> suppression). Pour reproduire exactement les chiffres du rendu, rejouer l'import de l'étape 3
> avant de relancer la séquence complète `01 → 02 → 03 → 04`.

### 6. Générer le rapport (Q27)

```bash
docker exec -i mongo-ipssi mongosh -u admin -p ipssi2025 \
  --authenticationDatabase admin nyc < rapport.js
```

Sous PowerShell, la redirection `<` n'est pas supportée — passer par `cmd` :

```powershell
cmd /c "docker exec -i mongo-ipssi mongosh -u admin -p ipssi2025 --authenticationDatabase admin nyc --quiet < rapport.js"
```

Pour une sortie sans les invites `nyc>` (inhérentes au mode stdin) :

```bash
docker cp rapport.js mongo-ipssi:/tmp/
docker exec -i mongo-ipssi mongosh -u admin -p ipssi2025 \
  --authenticationDatabase admin nyc --quiet --file /tmp/rapport.js
```

### 7. Exporter Staten Island (Q28)

```bash
docker cp query.json mongo-ipssi:/tmp/query.json

docker exec mongo-ipssi mongoexport \
  --username admin --password ipssi2025 --authenticationDatabase admin \
  --db nyc --collection restaurants \
  --queryFile /tmp/query.json \
  --out /tmp/staten_island.json

docker cp mongo-ipssi:/tmp/staten_island.json staten_island.json
```

Résultat attendu : `exported 969 records`.

### 8. Arrêter l'infrastructure

```bash
docker compose down          # conserve les données (volume nommé)
docker compose down -v       # supprime aussi le volume et donc les données
```

---

## Résultats clés

| Indicateur | Valeur |
|---|---|
| Documents importés | **25 359** |
| Types de cuisine distincts | **85** |
| Notes d'inspection (après `$unwind`) | **93 463** |
| Restaurants actuellement notés C | **220** |
| Restaurants marqués `risque: "eleve"` | **349** |
| Documents `borough: "Missing"` supprimés | **51** |
| Effectif final | **25 309** *(= 25 359 + 1 − 51)* |
| Export Staten Island | **969** lignes |

Anomalies de qualité détectées par la requête :

- **13** notes à score négatif (toutes à `-1`, valeur sentinelle) — impact sur la moyenne : **+0,0151 %**
- **13** notes à `score: null` (toutes en statut `Not Yet Graded`)
- **51** arrondissements encodés `"Missing"` — supprimés
- **738** tableaux `grades` vides (**2,91 %**) — conservés, voir la justification en Q26b
- **6** valeurs distinctes de `grade` : `A`, `B`, `C`, `P`, `Z`, `Not Yet Graded`

---

## Choix techniques

### Port hôte 27018 au lieu de 27017

L'énoncé publie MongoDB sur `27017`. Sur mon poste, un **service MongoDB local** occupait déjà ce
port sur `127.0.0.1`. Docker ne pouvait donc réserver que le wildcard IPv6, et toute connexion vers
`localhost:27017` était résolue en `127.0.0.1` — elle atteignait l'instance **locale**, pas le
conteneur. Symptôme : `Authentication failed` dans Compass malgré des identifiants corrects.

Diagnostic :

```powershell
Get-NetTCPConnection -LocalPort 27017 | Select-Object LocalAddress, State, OwningProcess
Get-Service | Where-Object { $_.Name -like '*mongo*' }    # service "MongoDB" : Running
```

Le conteneur est donc publié sur `27018:27017`. Le port **interne reste 27017**, ce qui laisse
inchangées toutes les commandes `docker exec` de l'énoncé. Seule l'URI Compass est adaptée.

Alternative si l'on tient au port 27017 — libérer le port en arrêtant le service local
(PowerShell **administrateur**) :

```powershell
Stop-Service MongoDB -Force
```

### `--queryFile` plutôt que `--query` pour `mongoexport`

L'option `--query` attend du JSON avec des guillemets doubles, que PowerShell ré-interprète avant de
transmettre l'argument. Trois erreurs successives selon les échappements tentés :
`provide only one MongoDB connection string`, `invalid argument for flag -q`, puis
`query '[123 98 111 ...]' is not valid JSON`. Passer le filtre par un **fichier** (`query.json`)
supprime le problème de *quoting* et rend la commande reproductible quel que soit le shell.

### IIFE dans `rapport.js`

En mode redirection stdin (`< rapport.js`), `mongosh` se comporte comme un REPL et affiche la valeur
de retour de **chaque** instruction — la sortie était polluée par le `Map(85)` complet et le tableau
brut des arrondissements. Le corps du script est encapsulé dans une **fonction auto-invoquée**, qui
ne renvoie rien : la sortie ne contient plus que le rapport formaté.

### `bsonsize()` et non `Object.bsonsize()`

`Object.bsonsize()` est la syntaxe de l'ancien shell `mongo`. Sur `mongosh` / MongoDB 7 elle lève
`TypeError: Object.bsonsize is not a function` ; la fonction s'appelle simplement **`bsonsize()`**.

### `itcount()` et non `countDocuments()` avec `$near`

`countDocuments()` encapsule le filtre dans un `$match` d'agrégation, où `$near` est interdit car il
impose un tri géospatial. Le comptage se fait donc par `find(...).itcount()`, ou via l'étage
`$geoNear` qui doit être le **premier** du pipeline.


```yaml
environment:
  MONGO_INITDB_ROOT_USERNAME: ${MONGO_USER}
  MONGO_INITDB_ROOT_PASSWORD: ${MONGO_PASSWORD}
```
