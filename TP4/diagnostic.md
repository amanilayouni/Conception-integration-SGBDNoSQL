# Diagnostic — `explain()` et `system.profile`

## Q31. `explain()` avant/après index

Requête : `db.trips.find({ "start station id": 476 })`

| Étape | `stage` | `nReturned` | `totalKeysExamined` | `totalDocsExamined` | ratio `examined/returned` |
|---|---|---|---|---|---|
| Sans index | `COLLSCAN` | 36 | 0 | 10 000 | 277,8 |
| Avec index `{ "start station id": 1 }` | `FETCH`/`IXSCAN` | 36 | 36 | 36 | 1 |

Commandes :

```js
db.trips.find({ "start station id": 476 }).explain("executionStats")
db.trips.createIndex({ "start station id": 1 })
db.trips.find({ "start station id": 476 }).explain("executionStats")
```

Commentaire : le ratio idéal est 1. On ne l'atteint souvent qu'avec une projection couverte (covered query) car `FETCH` doit lire le document entier.

## Q32. Profiling

Activation :

```js
db.setProfilingLevel(1, { slowms: 0 })
db.trips.find({ "end station name": "W 52 St & 9 Ave" }).toArray()
db.trips.aggregate([{ $group: { _id: "$start station id", n: { $sum: 1 } } }]).toArray()
db.setProfilingLevel(0)
```

Résultat : 4 entrées dans `db.system.profile`.

| op | ns | millis | planSummary |
|---|---|---|---|
| query | citibike.trips | 6 | COLLSCAN |
| command | citibike.trips | 38 | COLLSCAN |
| getmore | citibike.trips | 0 | COLLSCAN |
| query | citibike.trips | 5 | COLLSCAN |

Enseignement : `planSummary: COLLSCAN` signifie qu'aucun index n'a été utilisé. Ces requêtes sont les premières candidates à l'indexation.

## Q33. Niveaux de profiling

- **0** : arrêt.
- **1** : seules les opérations plus lentes que `slowms` sont loggées.
- **2** : toutes les opérations sont loggées.

En production : niveau **1** avec `slowms` de 100-500 ms pour ne pas surcharger le disque. Risques du niveau 2 :

1. Coût d'écriture élevé (un doc par opération).
2. `system.profile` est une collection capped : les anciennes traces sont écrasées.

## Q34. COLLSCAN lents

```js
db.system.profile.find({ planSummary: /COLLSCAN/, millis: { $gt: 5 } })
```

Résultat :

```json
[
  { "op": "query", "ns": "citibike.trips", "millis": 6, "planSummary": "COLLSCAN" },
  { "op": "command", "ns": "citibike.trips", "millis": 38, "planSummary": "COLLSCAN" }
]
```

Cette requête est typiquement celle qu'on affiche dans un tableau de bord de production pour détecter les opérations à optimiser.
