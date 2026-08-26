# `index_bench.md` — Partie 2 : `explain()` avant / après index

Base `mflix` · MongoDB **7.0.40** · 23 539 films, 50 304 commentaires.
Mesures issues de `.explain("executionStats")` — scripts `scripts/02_partie2.js` et
`scripts/03_r3_esr.js`. État de départ : un seul index, `_id_` (créé par MongoDB).

## Tableau de synthèse

| # | Requête | Index | `stage` racine | `nReturned` | `totalKeysExamined` | `totalDocsExamined` | ms |
|---|---|---|---|---|---|---|---|
| **Q7a** | `find({genres:"Film-Noir"})` | *(aucun)* | `COLLSCAN` | 105 | 0 | **23 539** | 35 |
| **Q7b** | idem | `genres_1` (multi-clés) | `FETCH` ← `IXSCAN` | 105 | 105 | **105** | 5 |
| **Q8** réf. | `find({genres:"Drama",year:{$gte:2000}}).sort({"imdb.rating":-1})` avec `hint({$natural:1})` | *(aucun)* | **`SORT`** ← `COLLSCAN` | 7 761 | 0 | **23 539** | 53 |
| **Q8** interm. | idem, `genres_1` seul disponible | `genres_1` | **`SORT`** ← `FETCH` ← `IXSCAN` | 7 761 | 13 789 | 13 789 | **166** |
| **Q8c** | idem, index ESR | `esr_genres_rating_year` | `FETCH` ← `IXSCAN` | 7 761 | 7 834 | **7 761** | **16** |
| **R3** | idem, mauvais ordre, `.hint("mauvais_ordre_ERS")` | `mauvais_ordre_ERS` | **`SORT`** ← `FETCH` ← `IXSCAN` | 7 761 | 7 761 | 7 761 | **50** |
| **B1** | `find({year:1972},{year:1,title:1,_id:0})` | `cov_year_title` | **`PROJECTION_COVERED`** | 131 | 131 | **0** | 0 |
| **B1** témoin | idem, `_id` non exclu | `cov_year_title` | `PROJECTION_SIMPLE` ← `FETCH` | 131 | 131 | 131 | 8 |

## Q7 — index multi-clés sur `genres`

```js
db.movies.find({ genres: "Film-Noir" }).explain("executionStats")   // avant
db.movies.createIndex({ genres: 1 })                               // -> "genres_1"
db.movies.find({ genres: "Film-Noir" }).explain("executionStats")   // après
```

| | Avant | Après | Gain |
|---|---|---|---|
| `stage` | `COLLSCAN` | `IXSCAN` + `FETCH` | — |
| `totalDocsExamined` | 23 539 | **105** | **÷ 224** |
| `executionTimeMillis` | 35 | 5 | ÷ 7 |
| `nReturned` | 105 | 105 | inchangé |

`genres` étant un tableau, l'index est automatiquement **multi-clés** (`isMultiKey: true`) : une entrée
par élément. On passe au ratio idéal **1 : 1**. Le `FETCH` subsiste car la projection est complète.

## Q8 — index composé & règle ESR

```js
db.movies.countDocuments({ genres: "Drama", year: { $gte: 2000 } })   // 7761
db.movies.createIndex({ genres: 1, "imdb.rating": -1, year: 1 },
                      { name: "esr_genres_rating_year" })
```

| Champ | Rôle | Position |
|---|---|---|
| `genres` | Égalité | 1 — **E** |
| `imdb.rating` | Sort | 2 — **S** |
| `year` | Range | 3 — **R** |

L'égalité fixe un **préfixe exact** : elle isole une plage contiguë où les clés sont **déjà triées par
`imdb.rating`**, donc le `sort()` est servi sans rien trier. Le range va en dernier car il « ouvre »
l'intervalle : tout champ placé après lui n'est plus contigu.

Vérification : `/"stage":"SORT/.test(JSON.stringify(winningPlan))` → **`false`**. **Aucun `SORT`** ✔

> À noter : avec `genres_1` seul, la requête est **plus lente que le `COLLSCAN`** (166 ms contre
> 53 ms) — l'index ramène 13 789 films Drama, mais chacun coûte un `FETCH` aléatoire, puis il faut
> trier. Un index peu sélectif (58,6 % de la collection) peut donc **dégrader** les performances.

## Q9 — index `text`

```js
db.movies.createIndex({ title: "text", plot: "text" }, { name: "txt_title_plot" })
```

| Recherche | Résultats |
|---|---|
| `{ title: { $regex: /Godfather/ } }` | **5** |
| `{ $text: { $search: "godfather" } }` | **12** |
| `{ $text: { $search: "godfathers" } }` | **12** (stemming) |
| `{ title: { $regex: /godfathers/ } }` | **0** |
| `{ $text: { $search: "godfat" } }` | **0** (pas un mot) |
| `{ title: { $regex: /Godfat/ } }` | **5** |

## Q10 — coût de stockage

`db.movies.stats().indexSizes` :

| Index | Taille |
|---|---|
| `_id_` | 364 544 o |
| `genres_1` | 282 624 o |
| `esr_genres_rating_year` | 569 344 o |
| **`txt_title_plot`** | **6 225 920 o (5,94 Mo) — 83,7 % du total** |
| total avant / après `dropIndex` | 7 442 432 o → **1 216 512 o** (**− 83,7 %**) |

L'index `text` stocke une entrée par mot de chaque `title` **et** `plot`. Le supprimer libère 5,94 Mo
de disque, autant de RAM, et supprime autant d'écritures à chaque `insert`/`update`.

## R3 — ESR prouvé par `hint()`

```js
db.movies.createIndex({ genres: 1, year: 1, "imdb.rating": -1 }, { name: "mauvais_ordre_ERS" })
```

| Index forcé par `.hint()` | `SORT` ? | `totalKeysExamined` | `totalDocsExamined` | ms |
|---|---|---|---|---|
| **E S R** `esr_genres_rating_year` | **non** | 7 834 | 7 761 | **16** |
| **E R S** `mauvais_ordre_ERS` | **oui** | **7 761** | 7 761 | **50** |
| **écart** | | −73 pour le mauvais | 0 | **× 3,1 pour le bon** |

L'optimiseur laissé libre choisit spontanément le bon (`winningPlan indexName:
"esr_genres_rating_year"`, 2 plans rejetés). Contre-intuitif : le mauvais index examine **73 clés de
moins** tout en étant **3,1 fois plus lent** — le surcoût est dans le `SORT` bloquant.

## Bonus

**B1 — covered query.** `find({year:1972},{year:1,title:1,_id:0})` → `PROJECTION_COVERED`,
**`totalDocsExamined = 0`**, pas de `FETCH`. La couverture casse si `_id` n'est pas exclu, si l'on
projette un champ hors index, ou avec un index multi-clés.

**B2 — index partiel** sur `{ title: 1 }` :

| | Documents | Taille |
|---|---|---|
| complet | 23 539 | 483 328 o |
| partiel `{type:"series"}` | **254** | **24 576 o = 5,08 %** |

**458 752 o économisés (− 94,92 %).**

**B3 — TTL.** 3 sessions (`createdAt` = maintenant, −1 800 s, −7 200 s), `expireAfterSeconds: 3600`.
Après un passage du `TTLMonitor` (`ttlMonitorSleepSecs: 60`) : **2 documents restants**, `tok-perime`
purgé sans intervention applicative.