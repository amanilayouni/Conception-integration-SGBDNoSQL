# TP Jour 2 — Modélisation, Indexation & Drivers (MFlix)

Reproduction complète du TP de bout en bout. Base `mflix` (23 539 films, 50 304 commentaires),
MongoDB 7.0, PyMongo 4.17.

## Livrables

| Fichier | Contenu |
|---|---|
| **`reponses_jour2.md`** | Commande + résultat exact pour Q1 → Q19, réponses rédigées R1 → R4, bonus B1/B2/B3 |
| **`analyses.js`** | Partie 3 — les 5 agrégations (Q11 → Q15) |
| **`patterns.py`** | Partie 4 — Computed Pattern (Q16, Q17) + Subset Pattern (Q18) |
| **`transaction.js`** | Partie 5 — transaction ACID (Q19), avec commit, abort et contre-exemple |
| **`index_bench.md`** | Partie 2 — tableau `explain()` avant / après index |
| `scripts/` | Scripts intermédiaires ayant produit les chiffres cités |

## Écart assumé sur les ports

| Conteneur | Énoncé | Chez moi | Raison |
|---|---|---|---|
| `mongo-ipssi` | `27017` | **`27018`** | un service MongoDB local occupe déjà `127.0.0.1:27017` (déjà constaté au Jour 1) |
| `mongo-rs` | `27018` | **`27019`** | `27018` est pris par `mongo-ipssi` |

Le port **interne** reste `27017` dans les deux cas : **toutes les commandes `docker exec` de
l'énoncé fonctionnent sans modification**. Seules les connexions depuis l'hôte changent de port.

## Reproduction

### 0. Données

```powershell
curl.exe -L -o movies.json   https://raw.githubusercontent.com/neelabalan/mongodb-sample-dataset/main/sample_mflix/movies.json
curl.exe -L -o comments.json https://raw.githubusercontent.com/neelabalan/mongodb-sample-dataset/main/sample_mflix/comments.json

# equivalent de `wc -l` sous PowerShell
python -c "print(sum(1 for l in open('movies.json',encoding='utf-8') if l.strip()))"    # 23539
python -c "print(sum(1 for l in open('comments.json',encoding='utf-8') if l.strip()))"  # 50304
```

> Les deux `.json` (60 Mo au total) ne sont pas joints au rendu : ils se retéléchargent avec les
> commandes ci-dessus.

### 1. Instance principale (Parties 0 à 4)

```powershell
docker compose up -d      # docker-compose.yml repris du Jour 1 (mongo:7.0 + mongo-express)

docker cp movies.json   mongo-ipssi:/tmp/movies.json
docker cp comments.json mongo-ipssi:/tmp/comments.json
docker exec mongo-ipssi mongoimport -u admin -p ipssi2025 --authenticationDatabase admin `
  --db mflix --collection movies   --drop --file /tmp/movies.json
docker exec mongo-ipssi mongoimport -u admin -p ipssi2025 --authenticationDatabase admin `
  --db mflix --collection comments --drop --file /tmp/comments.json
```

### 2. Parties 1 à 3 (mongosh)

```powershell
docker exec mongo-ipssi rm -rf /tmp/scripts
docker cp scripts mongo-ipssi:/tmp/scripts
docker cp analyses.js mongo-ipssi:/tmp/analyses.js

docker exec mongo-ipssi mongosh -u admin -p ipssi2025 --authenticationDatabase admin --quiet --file /tmp/scripts/00_p0.js
docker exec mongo-ipssi mongosh -u admin -p ipssi2025 --authenticationDatabase admin --quiet --file /tmp/scripts/01_partie1.js
docker exec mongo-ipssi mongosh -u admin -p ipssi2025 --authenticationDatabase admin --quiet --file /tmp/scripts/01b_verif.js
docker exec mongo-ipssi mongosh -u admin -p ipssi2025 --authenticationDatabase admin --quiet --file /tmp/scripts/02_partie2.js
docker exec mongo-ipssi mongosh -u admin -p ipssi2025 --authenticationDatabase admin --quiet --file /tmp/scripts/03_r3_esr.js
docker exec mongo-ipssi mongosh -u admin -p ipssi2025 --authenticationDatabase admin --quiet --file /tmp/analyses.js
```

**Ordre important** : `02_partie2.js` doit tourner **avant** `03_r3_esr.js` (qui utilise
`.hint("esr_genres_rating_year")`), et les deux avant `04_bonus.js`.

### 3. Partie 4 (PyMongo)

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install "pymongo>=4.6"
.\.venv\Scripts\python.exe patterns.py
```

L'URI est surchargeable sans toucher au code :

```powershell
$env:MFLIX_URI = "mongodb://admin:ipssi2025@localhost:27017/?authSource=admin"
.\.venv\Scripts\python.exe patterns.py
```

> `patterns.py` **modifie la base** : il corrige les 12 244 compteurs (Q17) et ajoute
> `recent_comments` sur 10 films (Q18). Pour retrouver l'état d'origine, relancer les deux
> `mongoimport` de l'étape 1.

### 4. Partie 5 (replica set + transaction)

```powershell
docker run -d --name mongo-rs -p 27019:27017 mongo:7.0 --replSet rs0
docker exec mongo-rs mongosh --port 27017 --eval "rs.initiate()"

docker cp movies.json   mongo-rs:/tmp/movies.json
docker cp comments.json mongo-rs:/tmp/comments.json
docker exec mongo-rs mongoimport --db mflix -c movies   --drop --file /tmp/movies.json
docker exec mongo-rs mongoimport --db mflix -c comments --drop --file /tmp/comments.json

docker cp transaction.js mongo-rs:/tmp/transaction.js
docker exec mongo-rs mongosh --port 27017 --quiet --file /tmp/transaction.js
```

`transaction.js` est **idempotent** : il se termine sur une réparation manuelle qui remet la base
dans un état cohérent, et peut être relancé autant de fois que voulu.

### 5. Bonus et vérification finale

```powershell
docker exec mongo-ipssi mongosh -u admin -p ipssi2025 --authenticationDatabase admin --quiet --file /tmp/scripts/04_bonus.js
docker exec mongo-ipssi mongosh -u admin -p ipssi2025 --authenticationDatabase admin --quiet --file /tmp/scripts/05_r2_bson.js
docker exec mongo-ipssi mongosh -u admin -p ipssi2025 --authenticationDatabase admin --quiet --file /tmp/scripts/06_r1_r4.js
docker exec mongo-ipssi mongosh -u admin -p ipssi2025 --authenticationDatabase admin --quiet --file /tmp/scripts/99_verif_finale.js
```

`05_r2_bson.js` doit tourner **après** `patterns.py` (il lit `recent_comments`) et au moins 60 s
après `04_bonus.js` pour laisser le `TTLMonitor` faire son passage (B3).

## Détail des scripts

| Script | Rôle |
|---|---|
| `00_p0.js` | Contrôle P0 + structure d'un film et d'un commentaire |
| `01_partie1.js` | Q1 → Q6 |
| `01b_verif.js` | Q5 corrigé (`$and` au lieu d'une clé dupliquée) et Q6 approfondie |
| `02_partie2.js` | Q7 → Q10 : `explain()` avant/après, index text, `indexSizes` |
| `03_r3_esr.js` | Baseline `$natural` de Q8, R3 (index en mauvais ordre + `.hint()`), Q9e |
| `04_bonus.js` | B1 covered query, B2 index partiel, B3 TTL |
| `05_r2_bson.js` | R2 (`bsonsize` d'un commentaire, projection 16 Mo), vérif Q18 et B3 |
| `06_r1_r4.js` | R1 (anatomie des orphelins), R4 (coût mesuré d'un recomptage) |
| `07_distinct_26.js` | Pourquoi `distinct("genres")` passe de 25 à 26 après création de l'index |
| `99_verif_finale.js` | Rejoue tous les chiffres clés du récapitulatif |

## Chiffres clés

| | |
|---|---|
| Commentaires orphelins | **9 224 / 50 304 = 18,34 %** |
| Compteurs `num_mflix_comments` faux | **12 244 / 15 740 = 77,79 %** (100 % de sur-estimations) |
| `COLLSCAN` → `IXSCAN` sur `genres` | 23 539 → **105** documents examinés (÷ 224) |
| Index ESR vs mauvais ordre | **16 ms** vs **50 ms** (× 3,1), `SORT` supprimé |
| Index `text` | **5,94 Mo = 83,7 %** de l'espace d'indexation |
| Transaction | commit −1/−1 ✔ · abort 0/0 ✔ · sans transaction −1/**0** ✘ |
