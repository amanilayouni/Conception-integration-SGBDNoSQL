# Sharding — distributions, chunks, targeted vs broadcast

## Cluster démarré

```bash
docker compose -f docker-compose.shard.yml up -d
./setup-shard.ps1
```

## Q2. Distribution initiale sur `{ state: 1 }`

```js
db.zips.getShardDistribution()
```

Sortie : 2 chunks, ~31 % sur shardA, ~69 % sur shardB.

```
Shard shardA : 9 242 docs (31,31 %)
Shard shardB : 29 470 docs (68,68 %)
Total : 38 712 docs (2 chunks)
```

La répartition est déséquilibrée : la coupure est à `KY` (milieu de l'alphabet), pas au milieu du volume.

## Q3. Frontières de chunks

```
shardA [MinKey -> KY]
shardB [KY -> MaxKey]
```

- `MinKey` = moins que toute valeur ; `MaxKey` = plus que toute valeur.
- La coupure est à `KY`.
- Ce n'est pas le milieu de l'alphabet strict mais la borne qui divise la plage de `state` en deux pour tenter l'équilibrage.

## Q4. Après 4 `splitAt` supplémentaires

```js
["FL","MI","NY","TX"].forEach(s => sh.splitAt("census.zips", { state: s }))
```

Après 1 minute : 6 chunks, distribution toujours proche de 31 % / 69 %.

Top 5 États les plus peuplés :

```
TX: 1676
NY: 1596
CA: 1523
PA: 1458
IL: 1240
```

Explication : un seul État comme `TX` (1676 docs) pèse plus qu'un chunk entier dans certaines frontières. Le balancer ne peut pas fractionner un État.

## Q5. Orphelins

```js
db.zips.countDocuments({})           // 29 470
db.zips.estimatedDocumentCount()     // 38 712
```

Écart : 9 242 documents orphelins. `countDocuments` est la commande fiable.

`orphanCleanupDelaySecs` = 900 s (15 min). Vérification : après ~20 min, `census.zips` est nettoyé (`countDocuments` = `estimatedDocumentCount` = 29 470). `census.zips_hashed`, shardée plus tard, n'était pas encore nettoyée au même instant (29 470 vs 38 915).

## Q6-Q7. Targeted vs broadcast

### `{ state: "NY" }` — targeted

- `winningPlan.stage` : `SINGLE_SHARD`
- `nReturned` : 1596
- `totalDocsExamined` : 1596

### `{ city: "NEW YORK" }` — broadcast

- `winningPlan.stage` : `SHARD_MERGE`
- `nReturned` : 40
- `totalDocsExamined` : 38 712

Rapport `totalDocsExamined / nReturned` = 38 712 / 40 = **968**.

Sur 20 shards et 500 M docs, une requête broadcast mobiliserait 20 shards et lirait 500 M documents pour ~40 résultats.

## Q8. Distribution hachée

```js
db.zips_hashed.createIndex({ _id: "hashed" })
sh.shardCollection("census.zips_hashed", { _id: "hashed" })
```

Sortie (initiale) :

- 2 chunks, ~32 % / ~68 % en cours de redistribution
- `countDocuments` : 29 470
- `estimatedDocumentCount` : 38 915

Le hachage offre à terme une répartition homogène parce qu'il pré-répartit les clés sur une plage de hachage (`MinKey` -> `Long(-3375...)` -> `MaxKey`).

## Q9. Requête sur `state` après hachage

```js
db.zips_hashed.find({ state: "NY" }).explain("executionStats")
```

- `winningPlan.stage` : `SHARD_MERGE` (broadcast)
- `totalDocsExamined` : 38 915
- `nReturned` : 1596

Le hachage donne une bonne distribution mais sacrifie les requêtes ciblées par `state`.

## Tableau de décision Q9(b)

| Shard key candidate | Cardinalité | Distribution mesurée | Requêtes métier ciblées ? | Verdict |
|---|---|---|---|---|
| `{ state: 1 }` | 51 | déséquilibrée (31/69 %) | oui pour `state` | mauvais (trop peu de valeurs) |
| `{ _id: "hashed" }` | très haute | équilibrée après convergence | non | bonne distribution, mauvais requêtage |
| `{ zip: 1 }` | 29 467 | à vérifier (presque unique) | oui si filtre par zip | bonne clé si requêtes par zip |
| `{ state: 1, zip: 1 }` | 29 467+ | plus fine | oui si filtre `state` puis `zip` | meilleure si le filtre inclut le préfixe |

Choix final : `{ state: 1, zip: 1 }` est un bon compromis pour cibler les requêtes par État tout en gardant une cardinalité élevée, à condition que les filtres incluent `state`.
