# `index_bench.md` — Partie 2 : `explain()` avant / après index

Base `mflix` · MongoDB **7.0.40** · conteneur `mongo-ipssi` · 23 539 films, 50 304 commentaires.

Toutes les mesures viennent de `.explain("executionStats")`. Le script qui les produit est
`scripts/02_partie2.js` (et `scripts/03_r3_esr.js` pour la baseline `$natural` et R3).

État de départ — un seul index, celui que MongoDB crée tout seul :

```js
db.movies.getIndexes()
// [ { v: 2, key: { _id: 1 }, name: '_id_' } ]
```

---

## Tableau de synthèse

| # | Requête | Index utilisé | `stage` racine | `nReturned` | `totalKeysExamined` | `totalDocsExamined` | `executionTimeMillis` | docs examinés / retournés |
|---|---|---|---|---|---|---|---|---|
| **Q7a** | `find({genres:"Film-Noir"})` | *(aucun)* | `COLLSCAN` | 105 | 0 | **23 539** | 35 | **224,2 : 1** |
| **Q7b** | idem | `genres_1` (multi-clés) | `FETCH` ← `IXSCAN` | 105 | 105 | **105** | 5 | **1,0 : 1** |
| **Q8 (ref.)** | `find({genres:"Drama",year:{$gte:2000}}).sort({"imdb.rating":-1})` — `hint({$natural:1})` | *(aucun)* | **`SORT`** ← `COLLSCAN` | 7 761 | 0 | **23 539** | 53 | 3,0 : 1 |
| **Q8 (interm.)** | idem, avec seulement `genres_1` disponible | `genres_1` | **`SORT`** ← `FETCH` ← `IXSCAN` | 7 761 | 13 789 | **13 789** | 166 | 1,8 : 1 |
| **Q8c** | idem, index ESR | `esr_genres_rating_year` | `FETCH` ← `IXSCAN` | 7 761 | 7 834 | **7 761** | **16** | **1,0 : 1** |
| **R3** | idem, index en **mauvais ordre**, `.hint("mauvais_ordre_ERS")` | `mauvais_ordre_ERS` | **`SORT`** ← `FETCH` ← `IXSCAN` | 7 761 | 7 761 | 7 761 | **50** | 1,0 : 1 |
| **B1** | `find({year:1972},{year:1,title:1,_id:0})` | `cov_year_title` | **`PROJECTION_COVERED`** | 131 | 131 | **0** | 0 | **0 : 1** |
| **B1 (témoin)** | même requête, `_id` non exclu | `cov_year_title` | `PROJECTION_SIMPLE` ← `FETCH` | 131 | 131 | 131 | 8 | 1,0 : 1 |

---

## Q7 — index multi-clés sur `genres`

### (a) Avant tout index

```js
db.movies.find({ genres: "Film-Noir" }).explain("executionStats")
```

```
stage             : COLLSCAN
filter            : { genres: { $eq: "Film-Noir" } }
nReturned         : 105
totalKeysExamined : 0
totalDocsExamined : 23539
executionTimeMillis : 35
```

MongoDB lit **les 23 539 documents** pour en retenir 105. Il en jette 99,55 %.

### (b) Après `createIndex({ genres: 1 })`

```js
db.movies.createIndex({ genres: 1 })     // -> "genres_1"
db.movies.find({ genres: "Film-Noir" }).explain("executionStats")
```

```
stage             : FETCH
  inputStage      : IXSCAN
    indexName     : genres_1
    isMultiKey    : true
    multiKeyPaths : { genres: [ "genres" ] }
    indexBounds   : { genres: [ '["Film-Noir", "Film-Noir"]' ] }
nReturned         : 105
totalKeysExamined : 105
totalDocsExamined : 105
executionTimeMillis : 5
```

| | Avant | Après | Gain |
|---|---|---|---|
| `stage` | `COLLSCAN` | `IXSCAN` + `FETCH` | — |
| `totalDocsExamined` | 23 539 | **105** | **÷ 224** |
| `executionTimeMillis` | 35 | 5 | ÷ 7 |
| `nReturned` | 105 | 105 | inchangé (même résultat) |

`genres` est un **tableau** : MongoDB crée automatiquement un index **multi-clés**
(`isMultiKey: true`), c'est-à-dire une entrée d'index par élément du tableau. Un film
`genres: ["Crime","Drama"]` génère deux clés. C'est pour cela que l'index compte plus d'entrées
que la collection n'a de documents — et c'est aussi pourquoi un index multi-clés **ne peut jamais
couvrir** une requête (cf. B1).

`totalDocsExamined = nReturned = 105` : on est au ratio idéal de **1 : 1**. Le `FETCH` subsiste
parce que la projection est complète — l'index seul ne contient pas `title`, `plot`, etc.

---

## Q8 — index composé & règle ESR

### (a) Volume concerné

```js
db.movies.countDocuments({ genres: "Drama", year: { $gte: 2000 } })
```

**Résultat : `7761`**

### (b) Ordre des champs selon ESR

Requête cible :

```js
db.movies.find({ genres: "Drama", year: { $gte: 2000 } }).sort({ "imdb.rating": -1 })
```

Décomposition :

| Champ | Rôle dans la requête | Position ESR |
|---|---|---|
| `genres` | **É**galité (`"Drama"`) | 1ᵉʳ — **E** |
| `imdb.rating` | **S**ort (`-1`) | 2ᵉ — **S** |
| `year` | **R**ange (`$gte: 2000`) | 3ᵉ — **R** |

```js
db.movies.createIndex(
  { genres: 1, "imdb.rating": -1, year: 1 },
  { name: "esr_genres_rating_year" }
)
```

**Justification.** Un index B-tree composé n'est ordonné que *lexicographiquement*, champ après
champ. L'égalité sur `genres` fixe un **préfixe exact** : elle isole une plage contiguë de l'index,
et **dans cette plage les clés sont déjà triées par `imdb.rating`**. MongoDB peut donc parcourir
l'index dans l'ordre et servir le `sort()` sans rien trier — c'est la lecture d'un intervalle
contigu. Si on plaçait le range `year` avant le tri, la plage lue serait *ordonnée par `year`* et
non par `imdb.rating` : l'ordre du tri serait détruit et il faudrait un `SORT` bloquant (démonstration
en R3). Le range va en dernier parce qu'il est le seul des trois qui « ouvre » l'intervalle : tout
champ placé après lui n'est plus contigu.

### (c) Vérification : le tri est-il couvert par l'index ?

```js
db.movies.find({ genres: "Drama", year: { $gte: 2000 } })
         .sort({ "imdb.rating": -1 })
         .explain("executionStats")
```

```
stage             : FETCH
  inputStage      : IXSCAN
    indexName     : esr_genres_rating_year
    keyPattern    : { genres: 1, "imdb.rating": -1, year: 1 }
nReturned         : 7761
totalKeysExamined : 7834
totalDocsExamined : 7761
executionTimeMillis : 23
```

Test explicite :

```js
/"stage":"SORT/.test(JSON.stringify(winningPlan))   // -> false
```

**Aucun stage `SORT`.** Le tri est entièrement absorbé par le parcours d'index. Comparaison des
trois états :

| État | `stage` racine | SORT ? | `totalKeysExamined` | `totalDocsExamined` | ms |
|---|---|---|---|---|---|
| Aucun index (`hint({$natural:1})`) | `SORT` | **oui** | 0 | 23 539 | 53 |
| `genres_1` seul | `SORT` | **oui** | 13 789 | 13 789 | 166 |
| `esr_genres_rating_year` | `FETCH` | **non** | 7 834 | **7 761** | **16** |

> Point que je n'attendais pas : avec `genres_1` seul, la requête est **plus lente que le
> `COLLSCAN`** (166 ms contre 53 ms). L'index ramène 13 789 films Drama, mais chacun coûte un accès
> aléatoire (`FETCH`) au disque pour appliquer le filtre `year` — puis il faut trier 7 761
> résultats en mémoire. Le balayage séquentiel, lui, lit tout d'un trait. **Un index à faible
> sélectivité (58,6 % de la collection ici) peut donc dégrader les performances** : c'est exactement
> pourquoi l'index composé est nécessaire, et non pas seulement « souhaitable ».

`totalKeysExamined` (7 834) dépasse légèrement `nReturned` (7 761) : les 73 clés en trop sont les
films Drama dont `year < 2000`, rencontrés en bord d'intervalle pendant le parcours — le range étant
en 3ᵉ position, MongoDB fait du *seek* dans l'index pour les éviter, sans y parvenir parfaitement.

---

## Q9 — index `text`

```js
db.movies.createIndex({ title: "text", plot: "text" }, { name: "txt_title_plot" })
```

| Recherche | Résultats |
|---|---|
| `find({ title: { $regex: /Godfather/ } })` | **5** |
| `find({ $text: { $search: "godfather" } })` | **12** |
| `find({ $text: { $search: "godfathers" } })` | **12** (stemming) |
| `find({ title: { $regex: /godfathers/ } })` | **0** |
| `find({ $text: { $search: "godfat" } })` | **0** (pas un mot) |
| `find({ title: { $regex: /Godfat/ } })` | **5** |

Détail rédigé dans `reponses_jour2.md` (Q9a → Q9e).

---

## Q10 — coût de stockage des index

`db.movies.stats().indexSizes` :

| Index | Créé par | Taille | Poids relatif |
|---|---|---|---|
| `_id_` | **MongoDB, automatiquement** | 364 544 o | référence |
| `genres_1` | moi (Q7) | 282 624 o | 0,78 × `_id_` |
| `esr_genres_rating_year` | moi (Q8) | 569 344 o | 1,56 × `_id_` |
| `txt_title_plot` | moi (Q9) | **6 225 920 o (5,94 Mo)** | **17,1 × `_id_`** |
| **total avant `dropIndex`** | | **7 442 432 o (7,10 Mo)** | |
| **total après `dropIndex("txt_title_plot")`** | | **1 216 512 o (1,16 Mo)** | **− 83,7 %** |

L'index `text` pèse à lui seul **83,7 %** de l'espace d'indexation de la collection : il stocke une
entrée par mot de chaque `title` **et** de chaque `plot`, après normalisation. Le supprimer libère
**5,94 Mo** — et surtout autant de RAM et d'écritures à chaque `insert`/`update`.

```js
db.movies.dropIndex("txt_title_plot")   // { nIndexesWas: 4, ok: 1 }
```

---

## R3 — ESR prouvé par `hint()`

Second index, champs dans le **mauvais** ordre (E → R → S) :

```js
db.movies.createIndex({ genres: 1, year: 1, "imdb.rating": -1 }, { name: "mauvais_ordre_ERS" })
```

Même requête, forcée sur chaque index :

| Index (forcé par `.hint()`) | `stage` racine | stage `SORT` ? | `totalKeysExamined` | `totalDocsExamined` | `executionTimeMillis` |
|---|---|---|---|---|---|
| `esr_genres_rating_year` — **E S R** | `FETCH` | **non** | 7 834 | 7 761 | **16** |
| `mauvais_ordre_ERS` — **E R S** | `FETCH` | **oui** | **7 761** | 7 761 | **50** |
| **écart** | | | −73 en faveur du mauvais | 0 | **× 3,1 en faveur du bon** |

L'optimiseur, laissé libre, choisit spontanément le bon :

```
winningPlan indexName : "esr_genres_rating_year"
plans rejetés         : 2
```

Analyse détaillée dans `reponses_jour2.md` (R3) — y compris le fait, contre-intuitif, que le
mauvais index examine **73 clés de moins** tout en étant **3,1 fois plus lent**.

---

## Bonus

### B1 — covered query

| Requête | `stage` racine | `FETCH` ? | `totalKeysExamined` | `totalDocsExamined` |
|---|---|---|---|---|
| `find({year:1972},{year:1,title:1})` | `PROJECTION_SIMPLE` | oui | 131 | 131 |
| `find({year:1972},{year:1,title:1,_id:0})` | **`PROJECTION_COVERED`** | **non** | 131 | **0** |
| `find({year:1972},{year:1,title:1,plot:1,_id:0})` | `PROJECTION_SIMPLE` | oui | 131 | 131 |
| `find({genres:"Film-Noir"},{genres:1,_id:0})` *(multi-clés)* | `PROJECTION_SIMPLE` | oui | 105 | 105 |

### B2 — index partiel

| Index sur `{ title: 1 }` | Documents indexés | Taille |
|---|---|---|
| complet (`full_title`) | 23 539 | 483 328 o |
| partiel `{type:"series"}` (`part_title_series`) | **254** | **24 576 o** |
| | | **5,08 %** du complet — **458 752 o économisés** |

### B3 — TTL

3 sessions insérées (`createdAt` = maintenant, −1 800 s, −7 200 s), `expireAfterSeconds: 3600`.
Après un passage du `TTLMonitor` (`ttlMonitorSleepSecs: 60`) : **2 documents restants**,
`tok-perime` a été purgé sans aucune intervention applicative.
