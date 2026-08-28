# TP Jour 4 — Sharding & Performances


---

## Partie A — Sharding

### A0. Rôles des conteneurs

- **cfg1** : serveur de configuration (Config Server). Stocke la carte du cluster : bases, collections, chunks, frontières.
- **shardA** / **shardB** : shards, stockent les morceaux de données.
- **mongos** : routeur. Ne stocke aucune donnée utilisateur ; il lit la carte sur cfg1 et redirige les requêtes.

Le `chunkSize` a été fixé à 1 Mo (vs 128 Mo par défaut) pour pouvoir observer des splits et des migrations rapidement sur 29 470 documents. En production, ce serait une mauvaise idée : les chunks trop petits provoquent trop de migrations et surchargent le balancer.

### Q2. Distribution sur `{ state: 1 }`

```js
db.zips.getShardDistribution()
```

Résultat :

- ShardA : 9 242 docs / 31,31 %
- ShardB : 29 470 docs 
- 2 chunks

### Q3. Frontières de chunks

```js
const c = db.getSiblingDB("config");
const u = c.collections.findOne({ _id: "census.zips" }).uuid;
c.chunks.find({ uuid: u }).sort({ shard: 1 }).toArray().forEach(x => {
  const borne = v => (v && v.constructor && /^(MinKey|MaxKey)$/.test(v.constructor.name)) ? v.constructor.name : v;
  print(x.shard + " [" + borne(x.min.state) + " -> " + borne(x.max.state) + "]");
})
```

Sortie :

```
shardA [MinKey -> KY]
shardB [KY -> MaxKey]
```

La coupure est au milieu de l'alphabet (`KY`), mais ce n'est pas une répartition équilibrée car les États ne sont pas équirépartis en volume.

### Q4. Coupures supplémentaires

```js
["FL","MI","NY","TX"].forEach(s => sh.splitAt("census.zips", { state: s }))
```

Après 1 minute : 6 chunks, mais la distribution reste déséquilibrée (env. 31 % / 69 %) car la taille réelle des États (p. ex. CA, NY, TX) ne rentre pas dans les bornes artificielles.

Top 5 États par nombre de zips :

```
TX: 1676, NY: 1596, CA: 1523, PA: 1458, IL: 1240
```

Le balancer ne peut pas rééquilibrer un État qui pèse plus lourd qu'un chunk.

### Q5. Comptage : `countDocuments` vs `estimatedDocumentCount`

```js
db.zips.countDocuments({})      // 29470
db.zips.estimatedDocumentCount() // 38712 (initialement)
```

Écart : 9 242 documents (soit un shard entier). Ce sont des **documents orphelins** laissés par la migration de chunks.

- `estimatedDocumentCount` est interdite sur un cluster shardé car elle additionne les documents physiques par shard, y compris les orphelins.
- `countDocuments` est plus coûteuse car elle effectue une agrégation certifiant le nombre logique de documents.

`orphanCleanupDelaySecs` = 900 (15 min). Vérification : environ 20 minutes après la première migration, `census.zips` a été nettoyé (`countDocuments` et `estimatedDocumentCount` tous deux à 29 470). La collection `census.zips_hashed`, shardée plus tard, n'était pas encore nettoyée au même moment (29 470 vs 38 915) : le compte à rebours démarre après la migration.

### Q6-Q7. Targeted vs broadcast

Requête targeted (`state = "NY"`) :

- `winningPlan.stage` : `SINGLE_SHARD`
- `nReturned` : 1596
- `totalDocsExamined` : 1596

Requête broadcast (`city = "NEW YORK"`) :

- `winningPlan.stage` : `SHARD_MERGE`
- `nReturned` : 40
- `totalDocsExamined` : 38 712 (tous les documents des deux shards)

Rapport `totalDocsExamined / nReturned` = 38 712 / 40 ≈ **968**.

Sur 20 shards et 500 M docs, une requête broadcast lirait les 500 M documents pour renvoyer ~40 résultats. Cela ne scale pas : le coût est proportionnel au volume total, pas à la sélectivité.

### Q8. Clé hachée

```js
db.zips_hashed.createIndex({ _id: "hashed" });
sh.shardCollection("census.zips_hashed", { _id: "hashed" });
docker exec mongos mongoimport --db census --collection zips_hashed --file /tmp/zips.json
```

`db.zips_hashed.getShardDistribution()` :

- 2 chunks, ~9445 docs sur A, ~29 470 sur B (données en cours de redistribution)
- `countDocuments` : 29 470
- `estimatedDocumentCount` : 38 915 (présence d'orphelins au moment de la mesure)

L'écart existe aussi ici tant que les orphelins n'ont pas été nettoyés. Le hachage offre à terme une répartition bien plus uniforme que `state`.

### Q9. Compromis

`db.zips_hashed.find({ state: "NY" }).explain("executionStats")` :

- `winningPlan.stage` : `SHARD_MERGE` (broadcast)
- `totalDocsExamined` : 38 915
- `nReturned` : 1596

Conclusion : la clé hachée répartit mieux les données mais rend impossible le `SINGLE_SHARD` sur des requêtes métier qui filtrent par `state`.

Tableau de décision :

| Shard key | Cardinalité | Distribution | Requêtes ciblées | Verdict |
|---|---|---|---|---|
| `{ state: 1 }` | 51 | déséquilibrée | oui pour `state` | mauvais (faible cardinalité) |
| `{ _id: "hashed" }` | très haute | équilibrée | non | bonne distribution, mauvais requêtage |
| `{ zip: 1 }` | 29 467 unique | équilibrée | oui si filtre zip | bonne clé candidate |
| `{ state: 1, zip: 1 }` | 29 467+ | plus fine | oui si filtre state+zip | meilleure si requêtes filtreraient les deux |

---

## Partie B — Performances & diagnostic

### B0. Import

```bash
docker compose -f docker-compose.yml up -d
curl -L -o trips.json https://raw.githubusercontent.com/neelabalan/mongodb-sample-dataset/main/sample_training/trips.json
wc -l trips.json          
docker cp trips.json mongo-j4:/tmp/trips.json
docker exec mongo-j4 mongoimport -u admin -p ipssi2025 --authenticationDatabase admin --db citibike --collection trips --drop --file /tmp/trips.json
```

Résultat : `10000 document(s) imported successfully`.

### Q10. Espaces dans les noms de champs

Les champs contiennent des espaces : `start station id`, `start station name`, `birth year`, etc.

Syntaxe correcte :

```js
// (a) filtre
{ "start station id": 2006 }

// (b) référence dans $group
{ $group: { _id: "$start station id" } }
```

Sans guillemets, `start station id` est interprété comme `start` (variable) suivi de mots-clés ; la requête est invalide ou ne filtre pas le bon champ.

### Q11. Plage temporelle

```js
db.trips.aggregate([
  { $group: { _id: null, minStart: { $min: "$start time" }, maxStop: { $max: "$stop time" } } }
]).toArray()
```

Résultat :

- `minStart` : 2016-01-01T00:00:41Z
- `maxStop` : 2016-01-05T21:47:46Z

Le jeu ne couvre pas uniquement les 1er et 2 janvier : des trajets vont jusqu'au 5 janvier, sans doute parce qu'ils n'ont pas été clos immédiatement.

### Q12. Top 5 stations de départ

Résultat :

1. Central Park S & 6 Ave — 114
2. Lafayette St & E 8 St — 99
3. Carmine St & 6 Ave — 95
4. Broadway & E 14 St — 93
5. E 17 St & Broadway — 86

### Q13. Répartition par usertype

| usertype | n | durée moyenne (s) |
|---|---|---|
| Subscriber | 8011 | 762,36 |
| Customer | 1989 | 2610,71 |

Écart : les **Customer** durent en moyenne ~3,4 fois plus longtemps. Hypothèse : les Customer sont des touristes qui font de plus longs trajets/visites.

### Q14. Trajets par jour

| Jour | n |
|---|---|
| 2016-01-01 | 6348 |
| 2016-01-02 | 3652 |

Cohérent avec Q11 : la majorité des trajets ont commencé le 1er janvier.

### Q15. Top 5 heures de départ

| Heure | n |
|---|---|
| 13 | 1061 |
| 12 | 827 |
| 11 | 778 |
| 15 | 709 |
| 14 | 685 |

Profil d'usage : heures creuses du matin, forte activité le midi et l'après-midi. Le 1er janvier 2016 était un vendredi ; un profil domicile-travail serait plus marqué le matin et le soir.

### Q16. Distribution des durées

| Tranche (s) | n |
|---|---|
| 0-300 | 2009 |
| 300-600 | 3136 |
| 600-1800 | 3953 |
| 1800-3600 | 652 |
| 3600-... | 250 |

La tranche la plus peuplée est **600-1800 s** (10-30 min).

### Q17. Boucles

316 trajets repartent de la même station d'où ils sont arrivés.

### Q18. Champ `birth year` piégé

- 8 011 `int`
- 1 989 `string`
- Croisement : **Subscriber → int**, **Customer → string**

La requête `{ "birth year": { $lt: 1950 } }` compare des chaînes et des nombres, ce qui donne des résultats faux pour les Customers (comparaison lexicographique).

### Q19. Âge moyen

- Moyenne : 39,86 ans
- Effectif retenu : 8 011
- Âge max : 131 ans

Le 131 ans n'est pas crédible. En production, on filtrerait `birth year` à des valeurs plausibles (par exemple 1900-2000).

### Q20. Trajets aberrants

- Plus de 3 h : 54
- Plus de 24 h : 9
- 3 plus longs : 326 222 s, 279 620 s, 173 357 s

Explication : vélos non rendus, vols, tests, ou locations mal clôturées.

### Q21. Durée moyenne sans les > 3 h

| usertype | moyenne (s) | n |
|---|---|---|
| Subscriber | 648,59 | 7998 |
| Customer | 1717,93 | 1948 |

Écart avec Q13 :

- Subscriber : (762,36 - 648,59)/762,36 = **+14,9 %** avant / après
- Customer : (2610,71 - 1717,93)/2610,71 = **+34,2 %**

Les Customer sont beaucoup plus affectés : ils concentrent les trajets longs. Trajets exclus : 52 sur 10 000 (0,52 %).

Je communiquerais la valeur filtrée (sans > 3 h), car les outliers sont des anomalies opérationnelles.

### Q22. `$match` en premier

Plan A (`$match` d'abord) et Plan B (`$group` d'abord) :

- Plan A : `totalDocsExamined = 10 000` (pas d'index sur `usertype`), `nReturned = 8011`
- Plan B : `totalDocsExamined = 10 000`, `nReturned = 8011`

Les deux plans sont similaires car l'optimiseur a remonté le `$match` (aggregation pipeline optimization).

### Q23. Limite de l'optimiseur

Pipeline : `{ $group: ... n ... }, { $match: { n: { $gt: 50 } } }`

- `totalDocsExamined = 10 000` (tous les documents traversent `$group`)
- L'optimiseur ne peut pas appliquer `$match` avant `$group` car il n'a pas encore calculé `n`.
- 34 stations dépassent 50 départs.

Règle : on peut pousser un `$match` avant un `$group` seulement s'il ne dépend pas d'un champ créé par `$group`.

### Q24. `$merge` : collection `stations`

- 462 stations
- Top 3 : Central Park S & 6 Ave (114), Lafayette St & E 8 St (99), Carmine St & 6 Ave (95)

### Q25. `$out` vs `$merge`

- `$out` remplace entièrement la collection cible.
- `$merge` peut mettre à jour/réconcilier les documents existants (`whenMatched: "replace"`, `merge`, etc.).

Pour un rafraîchissement quotidien, utiliser `$merge` : il remplace les lignes modifiées sans supprimer les stations devenues inactives (si on le souhaite).

### Q26. `$lookup` : top 5 arrivées

Résultat (extrait) :

- E 17 St & Broadway : 96 arrivées / 86 départs
- Central Park S & 6 Ave : 95 / 114
- Broadway & E 14 St : 91 / 93
- W 21 St & 6 Ave : 85 / 67
- West St & Chambers St : 85 / 68

La station W 21 St & 6 Ave reçoit beaucoup plus de vélos qu'elle n'en émet (85 arrivées vs 67 départs) : c'est un puits, il faudra prévoir des réapprovisionnements.

### Q27. `$near` sans index

Erreur : `NoQueryExecutionPlans` — `unable to find index for $geoNear query`.

Un index est obligatoire pour `$near` car il faut trier par distance.

### Q28. `$near` avec index `2dsphere`

```js
db.trips.createIndex({ "start station location": "2dsphere" })
```

- 148 trajets dans un rayon de 500 m
- Les 5 premiers noms de station sont renvoyés triés par distance croissante.

### Q29. `$geoWithin`

`countDocuments` avec `$near` est interdit car `$near` impose un tri. Remplacement par `$geoWithin` + `$centerSphere` :

- 500 m : 148 trajets
- 1000 m : 774 trajets

### Q30. `$geoNear` sur `stations`

```js
db.stations.createIndex({ position: "2dsphere" })
db.stations.aggregate([
  { $geoNear: { near: { type: "Point", coordinates: [-73.9855, 40.7580] }, distanceField: "dist", maxDistance: 1000, spherical: true } },
  { $project: { nom: 1, departs: 1, dist: { $round: ["$dist", 0] } } },
  { $limit: 5 }
])
```

Résultat (5 plus proches) :

- W 45 St & 6 Ave — 4 départs — 256 m
- W 45 St & 8 Ave — 33 départs — 298 m
- Broadway & W 49 St — 24 départs — 310 m
- Broadway & W 41 St — 10 départs — 332 m
- W 43 St & 6 Ave — 26 départs — 362 m

`$geoNear` doit être le premier stage car il a besoin de l'index pour calculer les distances.

### Q31. `explain()` avant/après index

Requête `db.trips.find({ "start station id": 476 })` :

| Étape | Stage | `nReturned` | `totalKeysExamined` | `totalDocsExamined` | ratio |
|---|---|---|---|---|---|
| Sans index | `COLLSCAN` | 36 | 0 | 10 000 | 277,8 |
| Avec index | `FETCH`/`IXSCAN` | 36 | 36 | 36 | 1 |

La valeur idéale est `totalDocsExamined = nReturned`, mais on ne l'atteint presque jamais sans projection car un `FETCH` doit aller chercher le document entier.

### Q32. Profiler

```js
db.setProfilingLevel(1, { slowms: 0 })
db.trips.find({ "end station name": "W 52 St & 9 Ave" }).toArray()
db.trips.aggregate([{ $group: { _id: "$start station id", n: { $sum: 1 } } }]).toArray()
db.setProfilingLevel(0)
```

Extraits `system.profile` (4 entrées) :

- `op: query`, `ns: citibike.trips`, `millis: 6`, `planSummary: COLLSCAN`
- `op: command`, `ns: citibike.trips`, `millis: 38`, `planSummary: COLLSCAN`
- etc.

Le `planSummary` indique que les requêtes ont fait un scan complet (`COLLSCAN`).

### Q33. Niveaux de profiling

- 0 : désactivé
- 1 : opérations plus lentes que `slowms`
- 2 : toutes les opérations

En production : niveau 1 avec `slowms` autour de 100-500 ms. Le niveau 2 pèse lourd sur une base chargée car il écrit un document par opération.

`db.system.profile` est une collection capped : les anciennes entrées sont écrasées quand la taille maximale est atteinte.

### Q34. Tableau de bord COLLSCAN lents

```js
db.system.profile.find({ planSummary: /COLLSCAN/, millis: { $gt: 5 } })
```

Résultat : les opérations `COLLSCAN` de plus de 5 ms (la requête sur `end station name` et l'agrégation).

---

## Partie C — Réflexion

### R1. Tableau de bord quotidien

Architecture : `trips` reçoit les trajets du jour, un job nocturne exécute les pipelines `$merge`/`$out` dans une collection `stations` (ou un tableau de bord) matérialisé. Le matin, le serveur lit les documents matérialisés au lieu de relancer l'agrégation complète.

Gain : l'agrégation complète lit 10 000 documents (`totalDocsExamined` de Q23), tandis qu'une requête sur `stations` en lit 462. Rapport ≈ 21.5 : 1. Compromis : les données sont figées jusqu'au prochain rafraîchissement.

### R2. Règle des pipelines

1. **L'optimiseur remonte automatiquement un `$match` simple** avant un `$group` quand le filtre ne dépend que de champs d'entrée (Q22).
2. **Il ne peut rien faire** dès que le `$match` porte sur un champ créé par `$group` (Q23).
3. **Test complémentaire** : si un `$project` retire un champ utilisé dans un `$match` plus loin, l'optimiseur ne peut plus remonter le `$match` avant le `$project` car le champ n'existe plus.

### R3. Chiffre unique : durée moyenne

> « Sur les trajets de janvier 2016, la durée moyenne est de 648,6 s pour les Subscribers et de 1717,9 s pour les Customers, calculées sur 9 946 trajets après exclusion des 54 trajets de plus de 3 h. »

Médiane (`$median`) :

- Abonnés : 6 895 docs (Subscriber retenus)
- Customers : 1948

La médiane est plus robuste que la moyenne car elle ignore les valeurs extrêmes. Communiquer une moyenne sans préciser le filtre serait malhonnête : la valeur doublerait artificiellement à cause de quelques trajets anormaux.

### R4. `explain()` ou profiler ?

- `explain()` montre le plan d'une requête isolée avant/après index (Q31).
- Le profiler montre le passé : opérations réelles, durées, plans utilisés (Q32).

Ordre d'investigation d'un incident 14 h :

1. **mongostat** : voir si le serveur est CPU/I/O bound.
2. **profiler** : identifier les requêtes lentes et leurs plans.
3. **logs** : corrélations avec erreurs/connexions.
4. **explain()** sur les requêtes coupables pour optimiser.
