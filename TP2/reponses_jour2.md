# TP Jour 2 — Modélisation, Indexation & Drivers

**Environnement :** Docker (`mongo:7.0`, serveur **7.0.40**), base `mflix`, collections `movies` et
`comments`. Réplica set dédié `mongo-rs` pour la Partie 5. Driver **PyMongo 4.17.0**, Python 3.13.

**Livrables associés :** `analyses.js` (Partie 3) · `patterns.py` (Partie 4) · `transaction.js`
(Partie 5) · `index_bench.md` (Partie 2) · scripts intermédiaires dans `scripts/`.

---

## Partie 0 — Import des données réelles

### 0.1 Téléchargement

```powershell
curl.exe -L -o movies.json   https://raw.githubusercontent.com/neelabalan/mongodb-sample-dataset/main/sample_mflix/movies.json
curl.exe -L -o comments.json https://raw.githubusercontent.com/neelabalan/mongodb-sample-dataset/main/sample_mflix/comments.json
```

`wc` n'existe pas sous PowerShell, j'ai utilisé l'équivalent Python (comme au Jour 1) :

```powershell
python -c "print('movies.json',   sum(1 for l in open('movies.json',encoding='utf-8')   if l.strip()))"
python -c "print('comments.json', sum(1 for l in open('comments.json',encoding='utf-8') if l.strip()))"
```

```
movies.json 23539
comments.json 50304
```

Conforme à l'attendu. Les deux fichiers sont du **JSON Lines** en *Extended JSON* : un document par
ligne, avec des types annotés (`{"$oid": "..."}`, `{"$date": "..."}`). C'est ce qui permet à
`mongoimport` de restituer de vrais `ObjectId` et de vraies `ISODate` — et non des chaînes.

> **Écart assumé par rapport à l'énoncé — le port hôte.**
> Comme au Jour 1, mon conteneur `mongo-ipssi` est publié sur **`27018:27017`** : un service
> MongoDB local occupe déjà `127.0.0.1:27017` sur ma machine. Le port **interne** reste `27017`,
> donc **toutes les commandes `docker exec` de l'énoncé fonctionnent sans modification**. Seules les
> connexions depuis l'hôte (PyMongo, Compass) utilisent `27018`. Par ricochet, le conteneur
> `mongo-rs` de la Partie 5 est publié sur **`27019`** au lieu de `27018`, qui est occupé.

### 0.2 Import

```bash
docker cp movies.json   mongo-ipssi:/tmp/movies.json
docker cp comments.json mongo-ipssi:/tmp/comments.json

docker exec mongo-ipssi mongoimport -u admin -p ipssi2025 --authenticationDatabase admin \
  --db mflix --collection movies   --drop --file /tmp/movies.json
docker exec mongo-ipssi mongoimport -u admin -p ipssi2025 --authenticationDatabase admin \
  --db mflix --collection comments --drop --file /tmp/comments.json
```

```
dropping: `mflix.movies`
23539 document(s) imported successfully. 0 document(s) failed to import.
dropping: `mflix.comments`
50304 document(s) imported successfully. 0 document(s) failed to import.
```

### Point de contrôle P0

```js
use mflix
db.movies.countDocuments({})     // 23539  ✔
db.comments.countDocuments({})   // 50304  ✔
```

### Observation de la structure

`db.movies.findOne({ title: "The Godfather" })` (extrait) :

```js
{
  _id: ObjectId('573a1396f29313caabce4a9a'),
  title: 'The Godfather',
  year: 1972,
  genres: [ 'Crime', 'Drama' ],                              // TABLEAU
  cast: [ 'Marlon Brando', 'Al Pacino', 'James Caan', ... ], // TABLEAU
  directors: [ 'Francis Ford Coppola' ],                     // TABLEAU
  countries: [ 'USA' ], languages: [ 'English', 'Italian', 'Latin' ],
  imdb:     { rating: 9.2, votes: 1038358, id: 68646 },      // SOUS-DOCUMENT
  awards:   { wins: 33, nominations: 19, text: 'Won 3 Oscars. ...' },
  tomatoes: { viewer: { rating: 4.4, numReviews: 725773, meter: 98 },
              critic: { rating: 9.2, numReviews: 84, meter: 99 },
              dvd: ISODate('2001-10-09T00:00:00.000Z'), ... },   // SOUS-DOC IMBRIQUÉ
  num_mflix_comments: 380,                                   // COMPTEUR PRÉ-CALCULÉ
  type: 'movie',
  released: ISODate('1972-03-24T00:00:00.000Z'),
  runtime: 175
}
```

`db.comments.findOne()` :

```js
{
  _id: ObjectId('5a9427648b0beebeb69579d0'),
  name: 'Talisa Maegyr',
  email: 'oona_chaplin@gameofthron.es',
  movie_id: ObjectId('573a1390f29313caabcd41b1'),   // <-- LA RÉFÉRENCE
  text: 'Rem itaque ad sit rem voluptatibus. ...',
  date: ISODate('1998-08-22T11:45:03.000Z')
}
```

Quatre observations que je réutilise plus loin :

- `genres`, `cast`, `directors` sont des **tableaux** → les index dessus seront **multi-clés** (Q7),
  et il faudra un `$unwind` avant tout `$group` (Q11, Q14).
- `imdb` et `tomatoes` sont des **sous-documents** → notation pointée `"imdb.rating"`.
- `num_mflix_comments` est un **compteur dénormalisé** (Computed Pattern) — donc susceptible de
  dériver (Q4, Q16).
- `comments.movie_id` est un `ObjectId` **sans aucune contrainte** vers `movies._id` (Q2).

---

# Partie 1 — Modélisation & intégrité référentielle

## Q1. Films, commentaires, genres distincts

```js
db.movies.countDocuments({})
db.comments.countDocuments({})
db.movies.distinct("genres").length
```

| | Résultat |
|---|---|
| Films | **23 539** |
| Commentaires | **50 304** |
| Genres distincts | **25** |

Les 25 genres :

```
Action, Adventure, Animation, Biography, Comedy, Crime, Documentary, Drama, Family,
Fantasy, Film-Noir, History, Horror, Music, Musical, Mystery, News, Romance, Sci-Fi,
Short, Sport, Talk-Show, Thriller, War, Western
```

`distinct("genres")` traverse automatiquement les tableaux : il retourne les valeurs **contenues
dans** les tableaux, pas les tableaux eux-mêmes. C'est le même comportement que celui qui rend les
index multi-clés possibles.

> **Découverte en rejouant le TP : l'index de la Q7 change la réponse à la Q1.**
>
> En relançant ma vérification finale (`scripts/99_verif_finale.js`) après avoir créé l'index
> `genres_1`, `distinct("genres").length` ne renvoie plus 25 mais **26**. La 26ᵉ valeur est `null` :
>
> ```js
> db.movies.distinct("genres")
> // [ null, "Action", "Adventure", ..., "Western" ]     <-- 26 entrées
> db.movies.countDocuments({ genres: { $exists: false } })   // 116
> ```
>
> **116 films n'ont pas de champ `genres` du tout.** L'explication est dans le plan d'exécution :
>
> ```js
> db.runCommand({ explain: { distinct: "movies", key: "genres" } })
> // stage: PROJECTION_COVERED
> //   inputStage: { stage: 'DISTINCT_SCAN', indexName: 'genres_1',
> //                 isMultiKey: true, isSparse: false, ... }
> ```
>
> Sans index, `distinct` balaye la collection et **saute** les documents où le champ est absent → 25.
> Avec l'index, MongoDB bascule sur un **`DISTINCT_SCAN`**, qui lit les clés de l'index — or un index
> **non *sparse*** stocke une clé `null` pour chaque document où le champ manque. Les 116 films sans
> genre y figurent donc, et `null` remonte comme une valeur.
>
> Ce n'est pas un bug, mais c'est un piège réel : **la même commande renvoie deux résultats
> différents selon l'état des index**. La réponse robuste, indépendante du plan choisi, passe par une
> agrégation qui ne compte que les valeurs réellement portées :
>
> ```js
> db.movies.aggregate([ { $unwind: "$genres" }, { $group: { _id: "$genres" } } ]).toArray().length
> // -> 25
> ```
>
> **Je retiens `25` comme réponse à la Q1** (genres réellement portés par au moins un film), et je
> note que `distinct` ne doit pas être utilisé sans savoir si le champ peut être absent.
>
> Répartition complète, obtenue par agrégation (elle sert de base à la Q11) : Drama 13 789 · Comedy
> 7 024 · Romance 3 665 · Crime 2 678 · Thriller 2 658 · Action 2 539 · Documentary 2 129 · Adventure
> 2 045 · Horror 1 703 · Biography 1 404 · Family 1 311 · Mystery 1 259 · Fantasy 1 153 · Sci-Fi
> 1 034 · History 999 · Animation 971 · Music 840 · War 794 · Musical 487 · Short 478 · Sport 390 ·
> Western 274 · Film-Noir 105 · News 51 · **Talk-Show 1**.

## Q2. Commentaires orphelins

MongoDB n'a **pas** de clé étrangère : rien n'empêche un `comments.movie_id` de pointer vers un
`_id` qui n'existe pas dans `movies`. Un `$lookup` qui ne trouve rien renvoie un tableau **vide** —
c'est exactement le signal recherché.

```js
db.comments.aggregate([
  { $lookup: {
      from: "movies",
      localField: "movie_id",
      foreignField: "_id",
      as: "film"
  } },
  { $match: { film: { $eq: [] } } },   // aucune correspondance trouvée
  { $count: "orphelins" }
])
```

```js
[ { orphelins: 9224 } ]
```

**Résultat : `9224` commentaires orphelins**, soit **9 224 / 50 304 = 18,34 %** de la collection.

En creusant (`scripts/06_r1_r4.js`), ces 9 224 commentaires pointent vers **6 796 `movie_id`
distincts qui n'existent pas** (1,4 commentaire par identifiant fantôme en moyenne) :

```js
db.movies.countDocuments({ _id: { $in: [ ObjectId("573a13f5f29313caabde3e49"), ... ] } })
// -> 0
```

## Q3. Films distincts référencés par au moins un commentaire

```js
db.comments.aggregate([
  { $group: { _id: "$movie_id" } },
  { $count: "films_references" }
])
```

```js
[ { films_references: 14245 } ]
```

**Résultat : `14245`**.

Nuance importante que révèle la Q2 : ces 14 245 sont des **identifiants référencés**, pas des films.
Seuls **7 449** d'entre eux correspondent à un film réel — les **6 796** autres sont des fantômes.
Autrement dit **47,7 % des identifiants référencés dans `comments` ne désignent aucun document**.
La formulation « films distincts référencés » cache déjà le bug.

## Q4. Computed Pattern — l'écart

### (a) Combien de films portent le champ ?

```js
db.movies.countDocuments({ num_mflix_comments: { $exists: true } })   // 15740
db.movies.countDocuments({})                                          // 23539
```

| | Valeur |
|---|---|
| Films portant `num_mflix_comments` | **15 740** |
| Films au total | 23 539 |
| **Pourcentage** | **66,87 %** |
| Films sans le champ | 7 799 |

Premier signal d'alarme : **un tiers du catalogue n'a même pas le champ**. Une application qui
écrirait `film.num_mflix_comments` sans garde obtiendrait `undefined` sur 7 799 films — et
afficherait « undefined commentaires ».

### (b) « The Taking of Pelham 1 2 3 »

```js
var pelham = db.movies.findOne({ title: "The Taking of Pelham 1 2 3" });
pelham._id                                              // ObjectId('573a13bff29313caabd5e91e')
pelham.num_mflix_comments                               // 437
db.comments.countDocuments({ movie_id: pelham._id })    // 161
```

| | Valeur |
|---|---|
| `num_mflix_comments` (compteur stocké) | **437** |
| Commentaires réellement présents | **161** |

### (c) L'écart

| | Valeur |
|---|---|
| Écart absolu | **+276** |
| Écart relatif (par rapport au réel) | **+171,43 %** |
| Écart relatif (part fausse du compteur affiché) | 276 / 437 = **63,2 %** |

**Le compteur sur-estime.** Il annonce **2,71 fois** le nombre réel. Ce n'est pas un arrondi : près
de **deux commentaires sur trois annoncés n'existent pas**.

### (d) Ce que voit l'utilisateur, et ce que cela révèle

Sous la fiche du film, le site affiche « **437 commentaires** ». L'utilisateur clique, et la page de
discussion en charge… **161**. Il ne voit pas une erreur : il voit une page qui a l'air normale,
avec 276 commentaires manquants. Sa lecture spontanée sera « le site a censuré/perdu des messages »,
ou « la pagination est cassée ». Pire pour le développeur : si la pagination est dimensionnée sur le
compteur (`437 / 20 = 22 pages`), les pages 9 à 22 seront **vides** — un bug qui ne lève aucune
exception, ne remplit aucun log, et n'apparaît que dans les tickets support.

Ce que cela révèle sur les compteurs dénormalisés en général : **un champ pré-calculé n'est pas une
donnée, c'est un cache** — et comme tout cache, il est faux dès qu'une écriture échappe au chemin
qui le met à jour. Ici, la cause est identifiée : `num_mflix_comments` a été figé sur un état où les
9 224 commentaires orphelins (Q2) existaient encore, ou bien il comptait des commentaires supprimés
sans décrémentation. Le compteur n'a pas « dérivé » lentement : **il n'a jamais été transactionnel**
avec la collection qu'il résume. C'est précisément le scénario que la transaction de la **Q19**
empêche, et que le CAS 3 de `transaction.js` reproduit volontairement.

La règle que j'en tire : un compteur dénormalisé n'est acceptable que si (1) son écriture est
atomique avec la donnée source, ou (2) un job de réconciliation le recalcule périodiquement — c'est
exactement ce que fait `patterns.py` en **Q17**. Sans l'un des deux, ce n'est pas une optimisation,
c'est une dette. L'ampleur sur tout le catalogue est mesurée en **Q16** : **12 244 compteurs faux**.

## Q5. Data quality — `year` en chaîne (type bracketing)

```js
db.movies.countDocuments({ year: { $type: "string" } })   // 37
db.movies.countDocuments({ year: { $type: "int" } })      // 23502
```

**Résultat : `37` films ont un `year` stocké en chaîne** (37 + 23 502 = 23 539 ✔).

Les valeurs concernées (`db.movies.distinct("year", { year: { $type: "string" } })`) :

```
'1981è', '1986è', '1987è', '1988è', '1994è1998', '1995è', '1996è', '1997è', '1999è',
'2000è', '2002è', '2003è', '2005è', '2006è', '2006è2007', '2006è2012', '2007è',
'2009è', '2010è', '2011è', '2012è', '2014è', '2015è'
```

Ce sont des **séries** : le `è` est un tiret cadratin `–` mal décodé, et la valeur note une plage
(`"2006–2012"`) ou une série encore en cours (`"2015–"`). L'information n'est pas erronée, elle est
juste **d'un autre type** : une période, pas un millésime.

### Pourquoi `{ year: { $gte: 2000 } }` les ignore silencieusement

```js
db.movies.countDocuments({ $and: [ { year: { $type: "string" } }, { year: { $gte: 2000 } } ] })
// -> 0
```

**Zéro.** Pas une erreur, pas un avertissement : zéro.

MongoDB applique le **type bracketing** : un opérateur de comparaison ne compare **qu'à l'intérieur
du même type BSON**. `$gte: 2000` est un `int`, donc la comparaison n'est tentée que sur les valeurs
numériques ; les 37 chaînes sont écartées d'office, sans jamais être converties. Ce n'est pas un
bug : l'ordre BSON global (`null < nombres < chaînes < objets < tableaux < ... `) rend une
comparaison inter-types arbitraire, MongoDB refuse donc de l'inventer.

Preuve par la symétrie — la même requête avec un opérande **chaîne** :

```js
db.movies.countDocuments({ $and: [ { year: { $type: "string" } }, { year: { $gte: "2000" } } ] })
// -> 26
```

26 résultats, cette fois. Mais c'est une comparaison **lexicographique** : `"2000è"` ≥ `"2000"` parce
que `'è'` vient après la fin de chaîne, pas parce que 2000 ≥ 2000.

**Conséquence chiffrée :**

```js
db.movies.countDocuments({ year: { $gte: 2000 } })   // 13721
db.movies.countDocuments({ $expr: { $gte: [
  { $toInt: { $substrBytes: [ { $toString: "$year" }, 0, 4 ] } }, 2000 ] } })   // 13747
```

**26 films manquent** dans le premier résultat. L'erreur est de 0,19 % — assez petite pour ne jamais
être remarquée, assez réelle pour fausser un rapport. Le danger n'est pas la taille de l'écart,
c'est son **silence** : aucune requête ne signale jamais qu'elle a ignoré des documents.

> Piège rencontré : ma première version écrivait
> `{ year: { $type: "string" }, year: { $gte: 2000 } }`. En JavaScript, **une clé dupliquée dans un
> littéral d'objet écrase la précédente** : MongoDB ne recevait que le second filtre. D'où le `$and`
> explicite ci-dessus. Le shell n'émet aucun avertissement.

## Q6. `imdb.rating` égale à la chaîne vide

```js
db.movies.countDocuments({ "imdb.rating": "" })                      // 61
db.movies.countDocuments({ "imdb.rating": { $type: "number" } })     // 23478
db.movies.countDocuments({ "imdb.rating": { $exists: false } })      // 0
```

**Résultat : `61` films ont `imdb.rating: ""`** (61 + 23 478 = 23 539 ✔). Exemples : *La nao
capitana*, *Landet som icke är*, *The Danish Girl*.

Le champ n'est jamais **absent** : il est **présent et vide**. C'est la nuance qui rend le piège
efficace, car `{ "imdb.rating": { $exists: true } }` renvoie 23 539 — donc « tout va bien ».

### En quoi est-ce un piège pour un calcul de moyenne ?

Contre-intuitivement, `$avg` **ne se laisse pas piéger** :

```js
db.movies.aggregate([ { $group: { _id: null, moyenne: { $avg: "$imdb.rating" }, n: { $sum: 1 } } } ])
// [ { _id: null, moyenne: 6.693466223698782, n: 23539 } ]

db.movies.aggregate([
  { $match: { "imdb.rating": { $type: "number" } } },
  { $group: { _id: null, moyenne: { $avg: "$imdb.rating" }, n: { $sum: 1 } } }
])
// [ { _id: null, moyenne: 6.693466223698782, n: 23478 } ]
```

**La moyenne est rigoureusement identique** (6,693466223698782) : `$avg` ignore les valeurs
non numériques **au numérateur comme au dénominateur**. Seul le `n` change (23 539 vs 23 478).

Le vrai piège est donc ailleurs — il apparaît dès qu'on calcule la moyenne **à la main**, ce que
tout le monde finit par faire pour combiner plusieurs métriques :

```js
db.movies.aggregate([
  { $group: { _id: null,
      somme:   { $sum: "$imdb.rating" },   // ignore les ""
      nb_docs: { $sum: 1 }                 // les compte !
  } },
  { $project: { moyenne_a_la_main: { $divide: [ "$somme", "$nb_docs" ] } } }
])
```

| | Valeur |
|---|---|
| Somme des notes | 157 149,2 |
| Dénominateur naïf (`$sum: 1`) | **23 539** |
| Dénominateur correct | **23 478** |
| Moyenne `$avg` (correcte) | **6,6935** |
| Moyenne « à la main » (fausse) | **6,6761** |
| Écart | **−0,0174 point** |

`$sum` et `$sum: 1` n'appliquent pas la même règle : le premier saute les non-numériques, le second
compte les documents. **Le numérateur et le dénominateur ne portent alors pas sur la même
population.** Sur 61 documents l'écart est de 0,26 % ; sur un champ à 30 % de valeurs vides il
serait catastrophique — et toujours silencieux.

Le second piège est côté `find` : `{ "imdb.rating": { $gte: 7 } }` renvoie **10 417** films et écarte
les 61 chaînes vides par type bracketing (Q5). Elles ne sont donc jamais ni « bien notées » ni « mal
notées » : elles sortent de tous les histogrammes sans laisser de trace.

**C'est pourquoi tous mes pipelines de la Partie 3 filtrent explicitement sur `$type`** — voir Q13,
où 38 films Drama sont ainsi écartés.

---

# Partie 2 — Indexation & `explain()`

> Le détail complet des plans d'exécution, avec les tableaux avant/après, est dans **`index_bench.md`**.
> Script : `scripts/02_partie2.js`. Je reprends ici l'essentiel et les réponses rédigées.

État initial — un seul index, celui que MongoDB crée automatiquement :

```js
db.movies.getIndexes()
// [ { v: 2, key: { _id: 1 }, name: '_id_' } ]
```

## Q7. Index multi-clés sur `genres`

### (a) Avant tout index

```js
db.movies.find({ genres: "Film-Noir" }).explain("executionStats")
```

```
stage               : COLLSCAN
nReturned           : 105
totalKeysExamined   : 0
totalDocsExamined   : 23539
executionTimeMillis : 35
```

| | Valeur |
|---|---|
| `stage` | **`COLLSCAN`** |
| `totalDocsExamined` | **23 539** |
| `nReturned` | **105** |
| Ratio examinés/retournés | **224,2 : 1** |

MongoDB lit chaque document de la collection et jette 99,55 % de ce qu'il a lu.

### (b) Après création de l'index

```js
db.movies.createIndex({ genres: 1 })   // -> "genres_1"
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
| `stage` | `COLLSCAN` | **`IXSCAN` + `FETCH`** | — |
| `totalDocsExamined` | 23 539 | **105** | **÷ 224** |
| `executionTimeMillis` | 35 | 5 | ÷ 7 |
| `nReturned` | 105 | 105 | identique |

`genres` étant un tableau, MongoDB crée d'office un index **multi-clés** (`isMultiKey: true`) : une
entrée d'index **par élément** du tableau. Un film `["Crime","Drama"]` produit deux clés. Je n'ai
rien eu à demander — c'est le type de la donnée qui décide.

Le ratio est passé à **1 : 1** : chaque document lu est un document retourné. Le stage `FETCH`
subsiste parce que la projection est complète et que l'index ne contient que `genres` (voir **B1**
pour une requête sans `FETCH`).

## Q8. Index composé & règle ESR

### (a) Volume concerné

```js
db.movies.countDocuments({ genres: "Drama", year: { $gte: 2000 } })
```

**Résultat : `7761`**

### (b) L'ordre ESR et sa justification

| Champ | Rôle | Position |
|---|---|---|
| `genres: "Drama"` | **É**galité | 1 — **E** |
| `imdb.rating: -1` | **S**ort | 2 — **S** |
| `year: { $gte: 2000 }` | **R**ange | 3 — **R** |

```js
db.movies.createIndex(
  { genres: 1, "imdb.rating": -1, year: 1 },
  { name: "esr_genres_rating_year" }
)
```

**Justification.** Un index composé est un B-tree trié **lexicographiquement**, champ après champ —
comme un annuaire trié par (nom, prénom, ville).

1. **E d'abord.** L'égalité `genres = "Drama"` fixe un préfixe **exact** : elle sélectionne une
   **plage contiguë** de l'index, et rien qu'elle. C'est le filtre le plus réducteur possible pour
   le coût le plus faible : un seul *seek*.
2. **S ensuite.** À l'intérieur de cette plage contiguë, les clés sont **déjà ordonnées par
   `imdb.rating`**. MongoDB n'a qu'à parcourir l'index dans l'ordre pour servir le `sort()` : le tri
   devient gratuit. C'est la seule position où le tri peut l'être.
3. **R en dernier.** Un range « ouvre » l'intervalle : dès qu'un champ est comparé par inégalité,
   tout champ situé **après** lui dans l'index n'est plus contigu et ne peut donc plus servir ni au
   tri ni à un filtre efficace. Le range doit donc être le dernier à consommer de l'ordre.

Si l'on inversait S et R (`genres, year, imdb.rating`), la plage lue serait ordonnée par `year` et
non par `imdb.rating` : l'ordre du tri serait détruit et MongoDB devrait tout retrier en mémoire.
**C'est exactement ce que je prouve en R3.**

### (c) Le tri est-il couvert par l'index ?

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
executionTimeMillis : 16
```

Test explicite :

```js
/"stage":"SORT/.test(JSON.stringify(winningPlan))   // -> false
```

**Aucun stage `SORT`.** ✔ Le tri est absorbé par le parcours d'index.

Comparaison des trois états :

| État | `stage` racine | `SORT` ? | clés | docs | ms |
|---|---|---|---|---|---|
| Aucun index (`hint({$natural:1})`) | `SORT` | **oui** | 0 | 23 539 | 53 |
| `genres_1` seul | `SORT` | **oui** | 13 789 | 13 789 | **166** |
| `esr_genres_rating_year` | `FETCH` | **non** | 7 834 | **7 761** | **16** |

> **Résultat que je n'attendais pas.** Avec `genres_1` seul, la requête est **trois fois plus lente
> que le balayage complet** (166 ms contre 53 ms). L'index ramène bien les 13 789 films Drama, mais
> chacun impose un accès aléatoire (`FETCH`) pour vérifier `year`, puis il faut trier 7 761
> résultats en mémoire. Le `COLLSCAN`, lui, lit séquentiellement.
> **Un index insuffisamment sélectif (58,6 % de la collection) peut donc dégrader les performances.**
> L'index composé n'est pas une optimisation confortable ici : il est nécessaire.

Les **73 clés** examinées en trop (7 834 − 7 761) sont des films Drama dont `year < 2000`, rencontrés
en bord d'intervalle : le range étant en 3ᵉ position, MongoDB fait du *seek* pour les sauter sans y
parvenir parfaitement. C'est le prix — très faible — de l'ordre ESR.

## Q9. Index `text` vs `$regex`

### (a) Avec `$regex`

```js
db.movies.countDocuments({ title: { $regex: /Godfather/ } })
```

**Résultat : `5`**

```
The Godfather · The Godfather: Part II · The Godfather: Part III · Godfather · Tokyo Godfathers
```

### (b) Avec un index `text`

```js
db.movies.createIndex({ title: "text", plot: "text" }, { name: "txt_title_plot" })
db.movies.countDocuments({ $text: { $search: "godfather" } })
```

**Résultat : `12`**

### (c) L'écart : +7 films

Trois films que **seule** la version `$text` trouve :

| Titre | Pourquoi il sort |
|---|---|
| *Jane Austen's Mafia!* | `plot` : « Takeoff on the **Godfather** with the son of a mafia king… » |
| *The Nutcracker in 3D* | `plot` : « …a little girl, whose **godfather** gives her a special doll… » |
| *C(r)ook* | `plot` : « The mafia **godfather** suspects treason. » |

Deux raisons cumulées :

1. **Le champ.** Mon `$regex` ne portait que sur `title`. L'index `text` couvre `title` **et**
   `plot` : ces trois films n'ont jamais « Godfather » dans leur titre, seulement dans leur résumé.
2. **La casse.** `$text` normalise en minuscules ; `/Godfather/` est sensible à la casse et aurait
   raté un `godfather` en minuscule dans un titre.

Remarquer au passage la nature différente du résultat : *The Kennedys* sort parce que son `plot`
compare la famille au *Godfather* — c'est une **pertinence sémantique**, pas une correspondance de
caractères. `$text` sait d'ailleurs classer par `{ $meta: "textScore" }`, ce qu'un `$regex` ne
pourra jamais faire.

### (d) Le stemming — vérification au pluriel

```js
db.movies.countDocuments({ $text: { $search: "godfathers" } })   // 12
db.movies.countDocuments({ title: { $regex: /godfathers/ } })    //  0
db.movies.countDocuments({ title: { $regex: /Godfathers/ } })    //  1
```

| Recherche | Résultats |
|---|---|
| `$text "godfather"` (singulier) | **12** |
| `$text "godfathers"` (pluriel) | **12** — *identique* |
| `$regex /godfathers/` | **0** |
| `$regex /Godfathers/` | **1** (*Tokyo Godfathers*) |

**Oui, exactement le même nombre : 12.** Le *stemming* a réduit `godfathers` → `godfather` **avant**
la recherche, exactement comme il avait indexé `Godfathers` sous le même radical. Singulier et
pluriel interrogent la même entrée d'index.

**Ce que j'en déduis :** `$text` n'indexe pas des chaînes de caractères, il indexe des **concepts
lexicaux**. Sa chaîne de traitement est : minuscules → découpage en mots (*tokenisation*) →
suppression des mots vides (*stop words*) → réduction au radical (*stemming*), et elle est appliquée
**deux fois** — à l'indexation et à la requête. C'est ce qui garantit qu'elles se rencontrent.

**Ce qu'aurait donné un `$regex` :** `0` résultat pour `/godfathers/` (casse), `1` pour
`/Godfathers/` — *Tokyo Godfathers* et rien d'autre. Un `$regex` compare des **octets** : il ne sait
pas que « godfathers » et « Godfather » désignent la même chose. Pour obtenir l'équivalent, il
faudrait écrire à la main `/[Gg]odfathers?/` — et recommencer pour chaque irrégularité de chaque
langue (*mice/mouse*, *ran/run*, *cheval/chevaux*).

### (e) Quand `$regex` reste préférable

**Quand on cherche une sous-chaîne qui n'est pas un mot entier.** Preuve :

```js
db.movies.countDocuments({ $text: { $search: "godfat" } })   // 0
db.movies.countDocuments({ title: { $regex: /Godfat/ } })    // 5
```

**`$text` renvoie 0, `$regex` renvoie 5.** L'unité atomique de `$text` est le **mot** : `"godfat"`
n'est un mot d'aucun titre, donc rien ne remonte. `$regex` travaille au caractère et trouve les 5.

C'est décisif pour les cas suivants :

- **Numéros de série, références, codes** : chercher `A7X-9` dans `REF-A7X-9931-B`. `$text`
  tokeniserait sur les tirets et ne trouverait jamais le fragment.
- **Recherche « contient » / autocomplétion préfixe** : `/^Star Wars/` est en plus **indexable**
  (une regex ancrée à gauche et sans classe de caractères utilise un index classique — le préfixe
  délimite une plage contiguë du B-tree, exactement comme une égalité).
- **Correspondance exacte sensible à la casse** : distinguer `Ford` de `ford`, que `$text` fusionne.
- **Fragments internes** : `/father/i` sur `title` renvoie **67** films — dont *Stepfather*,
  *Godfather*, *Fatherland* — là où `$text "father"` en renvoie **1 060**, mais uniquement là où
  « father » est un mot isolé (donc *sans* les mots composés, et *avec* tous les résumés).

Enfin, une collection ne peut porter **qu'un seul index `text`** : si l'on a besoin de recherches
ciblées sur plusieurs champs indépendants, `$regex` (ou Atlas Search) reste la seule option.

**Synthèse :** `$text` pour la recherche en langue naturelle (mots entiers, casse indifférente,
pertinence, plusieurs champs) ; `$regex` pour la correspondance structurelle sur des identifiants ou
des fragments — de préférence **ancré à gauche** pour rester indexable.

## Q10. Inventaire des index & coût de l'inutile

```js
db.movies.getIndexes()
```

```
_id_                    { "_id": 1 }
genres_1                { "genres": 1 }
esr_genres_rating_year  { "genres": 1, "imdb.rating": -1, "year": 1 }
txt_title_plot          { "_fts": "text", "_ftsx": 1 }
```

**L'index que je n'ai pas créé : `_id_`.** MongoDB le crée **automatiquement à la création de toute
collection**, il est **unique** et **impossible à supprimer** (`dropIndex("_id_")` est rejeté par le
serveur). C'est lui qui garantit l'unicité de la clé primaire et qui rend les `$lookup` de la Q2 et
de la Q15 efficaces — jointures sur `movies._id`.

`db.movies.stats().indexSizes` :

| Index | Taille | Part du total |
|---|---|---|
| `_id_` | 364 544 o | 4,9 % |
| `genres_1` | 282 624 o | 3,8 % |
| `esr_genres_rating_year` | 569 344 o | 7,7 % |
| **`txt_title_plot`** | **6 225 920 o (5,94 Mo)** | **83,7 %** |
| **Total** | **7 442 432 o (7,10 Mo)** | |

```js
db.movies.dropIndex("txt_title_plot")   // { nIndexesWas: 4, ok: 1 }
```

Après suppression : **1 216 512 o (1,16 Mo)** — soit **83,7 % d'espace d'indexation libéré**.

### Pourquoi un index inutilisé est un coût pur

Un index n'est jamais neutre : il **coûte sans jamais rien rendre** s'il n'est pas lu.

1. **Coût en écriture — le plus important.** Chaque `insert`, `update` ou `delete` doit mettre à
   jour **tous** les index de la collection, de façon transactionnelle. Un index supplémentaire,
   c'est un B-tree de plus à réécrire à chaque écriture. Pour l'index `text`, c'est pire : il faut
   re-tokeniser `title` **et** `plot` et écrire **une entrée par mot** — sur un `plot` de 40 mots,
   une seule écriture de document déclenche des dizaines d'écritures d'index.
2. **Coût en RAM.** WiredTiger garde les index chauds en cache. Les 5,94 Mo du `text` occupent une
   place que le cache aurait donnée aux index réellement interrogés, ou aux documents. Sur une
   collection de production, c'est ce qui fait basculer un *working set* de « tient en RAM » à « part
   sur le disque ».
3. **Coût en stockage et en sauvegarde** : espace disque, temps de `mongodump`/restauration,
   réplication vers les secondaires.
4. **Coût à l'optimisation.** Le *query planner* énumère les plans candidats et fait une phase
   d'essai avant d'en élire un (j'ai relevé **2 `rejectedPlans`** sur la requête de la Q8). Plus il y
   a d'index, plus cette phase est longue — et plus le risque d'élire un plan médiocre augmente.

La règle : **on n'indexe pas « au cas où ».** On indexe une requête que l'on a mesurée, et on
surveille `$indexStats` pour supprimer ceux dont le compteur d'accès reste à zéro. C'est exactement
la démarche de ce TP : j'ai créé `txt_title_plot` pour répondre à la Q9, mesuré son coût, et je l'ai
supprimé une fois la démonstration faite.

---

# Partie 3 — Agrégation analytique

> Fichier livré : **`analyses.js`** (exécutable tel quel). Résultats reproduits ci-dessous.

```bash
docker cp analyses.js mongo-ipssi:/tmp/analyses.js
docker exec mongo-ipssi mongosh -u admin -p ipssi2025 \
  --authenticationDatabase admin --quiet --file /tmp/analyses.js
```

## Q11. Top 5 des genres par nombre de films

```js
db.movies.aggregate([
  { $unwind: "$genres" },
  { $group: { _id: "$genres", nb_films: { $sum: 1 } } },
  { $sort: { nb_films: -1 } },
  { $limit: 5 }
])
```

| # | Genre | Films |
|---|---|---|
| 1 | **Drama** | **13 789** |
| 2 | Comedy | 7 024 |
| 3 | Romance | 3 665 |
| 4 | Crime | 2 678 |
| 5 | Thriller | 2 658 |

Le `$unwind` est **indispensable** : sans lui, `$group` regrouperait sur le **tableau entier**, et
`["Crime","Drama"]` deviendrait une catégorie distincte de `["Drama"]`. Corollaire : la somme des
colonnes dépasse 23 539, puisqu'un film compte dans chacun de ses genres.

Drama couvre **58,6 % du catalogue** — c'est précisément ce qui explique pourquoi l'index `genres_1`
seul était contre-productif en Q8 : filtrer sur Drama ne réduit presque rien.

## Q12. Films par décennie

```js
db.movies.aggregate([
  { $match: { year: { $type: "int" } } },
  { $project: { decennie: { $subtract: [ "$year", { $mod: [ "$year", 10 ] } ] } } },
  { $group: { _id: "$decennie", nb_films: { $sum: 1 } } },
  { $sort: { nb_films: -1 } }
])
```

**Top 3 :**

| # | Décennie | Films |
|---|---|---|
| 1 | **2000** | **7 749** |
| 2 | **2010** | **5 972** |
| 3 | **1990** | **3 773** |

Classement complet : 2000 (7 749) · 2010 (5 972) · 1990 (3 773) · 1980 (2 081) · 1970 (1 253) · 1960
(1 050) · 1950 (767) · 1940 (418) · 1930 (313) · 1920 (96) · 1910 (23) · 1890 (5) · 1900 (2).
Total = **23 502** = les films à `year` entier (Q5) ✔ — les **37 séries à `year` en chaîne sont
exclues**, et le total le prouve.

Le `$match { year: { $type: "int" } }` n'est pas cosmétique : `$mod` sur la chaîne `"2006è2012"`
ferait échouer le pipeline (`$mod only supports numeric types`). Filtrer sur le type est le seul
moyen de garantir qu'un pipeline analytique ne casse pas sur une donnée sale.

## Q13. Note IMDB moyenne des films Drama

```js
db.movies.aggregate([
  { $match: { genres: "Drama", "imdb.rating": { $type: "number" } } },
  { $group: { _id: null, moyenne: { $avg: "$imdb.rating" }, nb_films: { $sum: 1 },
              note_min: { $min: "$imdb.rating" }, note_max: { $max: "$imdb.rating" } } },
  { $project: { _id: 0, nb_films: 1, note_min: 1, note_max: 1,
                moyenne_4_dec: { $round: [ "$moyenne", 4 ] } } }
])
```

| | Valeur |
|---|---|
| **Moyenne (4 décimales)** | **6,8305** |
| Valeur brute | 6,830528688822631 |
| **Films comptés** | **13 751** |
| Note minimale | 1,9 |
| Note maximale | 9,6 |

Contrôle du filtre de type :

```js
db.movies.countDocuments({ genres: "Drama" })                                        // 13789
db.movies.countDocuments({ genres: "Drama", "imdb.rating": { $not: { $type: "number" } } })  // 38
```

13 789 − 38 = **13 751** ✔. **38 films Drama** sur les 61 de la Q6 sont écartés. Sans le
`$match`, `$avg` donnerait la même moyenne — mais le `nb_films` rapporté serait **13 789**, un
dénominateur faux de 38 unités que personne ne vérifierait.

Les Drama (6,8305) sont au-dessus de la moyenne générale du catalogue (**6,6935**, Q6) de **+0,137
point**.

## Q14. Top 3 réalisateurs par nombre de films

```js
db.movies.aggregate([
  { $match: { directors: { $exists: true, $ne: null } } },
  { $unwind: "$directors" },
  { $group: { _id: "$directors", nb_films: { $sum: 1 } } },
  { $sort: { nb_films: -1, _id: 1 } },
  { $limit: 3 }
])
```

| # | Réalisateur | Films |
|---|---|---|
| 1 | **Woody Allen** | **40** |
| 2 | **John Ford** | **35** |
| 3 | **John Huston** | **34** |

Le `$unwind` sur `directors` gère les **co-réalisations** : un film des frères Coen compte pour Joel
**et** pour Ethan. Le `$sort` secondaire sur `_id: 1` rend le résultat **déterministe** en cas
d'ex æquo — sans lui, l'ordre de sortie de `$group` n'est pas garanti et deux exécutions peuvent
donner deux classements différents.

## Q15. `$lookup` inversé — top 5 des films les plus commentés

```js
db.comments.aggregate([
  { $group: { _id: "$movie_id", nb_commentaires: { $sum: 1 } } },
  { $sort:  { nb_commentaires: -1 } },
  { $limit: 5 },
  { $lookup: { from: "movies", localField: "_id", foreignField: "_id", as: "film" } },
  { $project: {
      _id: 0, movie_id: "$_id", nb_commentaires: 1,
      titre: { $ifNull: [ { $first: "$film.title" }, "<<< FILM INEXISTANT (orphelin) >>>" ] },
      annee: { $first: "$film.year" },
      compteur_stocke: { $first: "$film.num_mflix_comments" }
  } },
  { $sort: { nb_commentaires: -1 } }
])
```

| # | Titre | Année | **Commentaires réels** | `num_mflix_comments` stocké | Écart |
|---|---|---|---|---|---|
| 1 | **The Taking of Pelham 1 2 3** | 2009 | **161** | 437 | **+276** |
| 2 | **50 First Dates** | 2004 | **158** | 403 | +245 |
| 3 | **Ocean's Eleven** | 2001 | **158** | 424 | +266 |
| 4 | **About a Boy** | 2002 | **158** | 441 | +283 |
| 5 | **Terminator Salvation** | 2009 | **158** | 416 | +258 |

Deux points de méthode :

- **L'ordre des stages est ce qui rend ce pipeline viable.** On part de `comments` (le côté
  « many »), on agrège **d'abord**, puis on ne joint que les **5** lignes survivantes. Placer le
  `$lookup` avant le `$group` aurait déclenché **50 304** recherches d'index au lieu de 5.
- Le `$ifNull` n'est pas de la coquetterie : avec **18,34 %** d'orphelins (Q2), un `movie_id` du top
  aurait très bien pu ne correspondre à aucun film. Ici les 5 existent, mais le pipeline le dirait.

Le tableau **confirme la Q4 sur les 5 films** : le compteur sur-estime systématiquement, dans un
rapport de 2,6 à 2,8. Ce n'est pas un accident isolé sur Pelham — c'est structurel. La Q16 le
quantifie sur tout le catalogue.

---

# Partie 4 — Drivers : PyMongo

> Fichier livré : **`patterns.py`**. Exécution : `python patterns.py`.

```
connecte a : mongodb://admin:****@localhost:27018/?authSource=admin
serveur    : MongoDB 7.0.40
```

Un **seul `MongoClient` global**, créé au chargement du module et réutilisé partout : le client gère
son propre pool de connexions, en instancier un par fonction serait un anti-pattern (nouveau
handshake, nouveau pool, nouveau monitoring de topologie à chaque appel).

## Q16. Computed Pattern — réconciliation

**Stratégie de performance.** Boucler sur 23 539 films avec un `count_documents()` par film, c'est
23 539 allers-retours réseau. Ma mesure (`scripts/06_r1_r4.js`) : **28,05 ms par film sans index**
sur `comments.movie_id`, soit **≈ 400 s** extrapolées ; **1,41 ms par film avec index**, soit
**≈ 20 s**. Un **seul** `$group` côté serveur fait le même travail en **188 ms**. C'est donc ce que
je fais : un aggregate, chargé dans un `dict` Python, puis comparaison en mémoire.

```python
def vrais_compteurs() -> Counter:
    pipeline = [{"$group": {"_id": "$movie_id", "n": {"$sum": 1}}}]
    return Counter({d["_id"]: d["n"] for d in db.comments.aggregate(pipeline)})
```

Puis un seul curseur sur `movies` avec **projection minimale** (`{"_id": 1, "num_mflix_comments": 1}`)
pour ne pas rapatrier 1,6 Ko par film inutilement.

**Résultats :**

```
films au total                          : 23539
films portant num_mflix_comments        : 15740
films SANS le champ mais commentes      : 0
--> COMPTEURS INCOHERENTS               : 12244
    soit 77.79 % des films portant le champ
    dont sur-estimations                : 12244
    dont sous-estimations               : 0
films avec un compteur JUSTE            : 3496
somme des compteurs stockes             : 122595
somme des commentaires reellement lies  : 41080
total de commentaires en base           : 50304
```

| | Valeur |
|---|---|
| **Films avec un compteur incohérent** | **12 244** |
| Sur le nombre de films portant le champ | 12 244 / 15 740 = **77,79 %** |
| Sur le catalogue entier | 12 244 / 23 539 = **52,02 %** |
| Compteurs justes | 3 496 (22,21 %) |
| **Sur-estimations** | **12 244 (100 %)** |
| **Sous-estimations** | **0** |
| Somme des compteurs stockés | 122 595 |
| Somme des commentaires réellement rattachés | 41 080 |
| **Sur-comptage total** | **+81 515 commentaires fantômes** |

**Réponse : `12244` films ont un compteur incohérent.**

Trois enseignements que les chiffres imposent :

1. **La dérive est unidirectionnelle : 12 244 sur-estimations, 0 sous-estimation.** Ce n'est donc
   pas du bruit aléatoire. La signature est celle d'un compteur qu'on **incrémente à la création**
   d'un commentaire mais qu'on **ne décrémente jamais à la suppression** — exactement le CAS 3 de
   `transaction.js`.
2. **Vérification croisée avec la Q2 :** 50 304 commentaires − **9 224 orphelins** = **41 080**, qui
   est *exactement* la somme des commentaires réellement rattachés. Les deux mesures, obtenues par
   deux chemins totalement indépendants (`$lookup` en mongosh d'un côté, `$group` + Python de
   l'autre), tombent au commentaire près. La cause est donc confirmée : **les commentaires ont été
   supprimés de `comments` sans jamais décrémenter le compteur** — et le sur-comptage de 81 515
   dépasse même les orphelins, ce qui indique plusieurs vagues de purge successives.
3. **`films SANS le champ mais commentés : 0`** — les 7 799 films sans `num_mflix_comments` (Q4a)
   n'ont effectivement aucun commentaire. Sur ce point-là, l'absence du champ est cohérente.

Contrôle sur le film de la Q4b : `num_mflix_comments = 437`, réel `= 161` ✔ (identique à mongosh).

## Q17. Correction par `bulk_write` / `UpdateOne`

```python
operations = [
    UpdateOne({"_id": _id}, {"$set": {"num_mflix_comments": reels.get(_id, 0)}})
    for _id, _stocke, _reel in incoherents
]
resultat = db.movies.bulk_write(operations, ordered=False)
```

```
operations UpdateOne preparees : 12244
matchedCount  : 12244
modifiedCount : 12244
```

**Réponse : `modifiedCount = 12244`.**

`matchedCount == modifiedCount` : chaque document ciblé a effectivement changé de valeur — logique,
puisque je n'ai soumis que les films dont je savais le compteur faux. Si j'avais soumis les 15 740,
j'aurais eu `matchedCount = 15740` et `modifiedCount = 12244`, MongoDB n'écrivant pas un `$set`
idempotent.

`ordered=False` : les 12 244 mises à jour sont **indépendantes**. Le serveur peut donc les
paralléliser et poursuivre malgré une erreur isolée, au lieu de s'arrêter à la première. Et surtout,
`bulk_write` regroupe tout en **un seul aller-retour réseau** au lieu de 12 244 `update_one()`.

> À noter : `bulk_write` **n'est pas une transaction**. Chaque `UpdateOne` est atomique
> individuellement, mais le lot ne l'est pas. Ici c'est sans conséquence (opérations idempotentes,
> réexécutables), mais ce serait inacceptable pour le scénario de la Q19 — d'où la Partie 5.

### Re-vérification (Q16 relancée à l'identique)

```
films portant num_mflix_comments        : 15740
--> COMPTEURS INCOHERENTS               : 0
films avec un compteur JUSTE            : 15740
somme des compteurs stockes             : 41080
somme des commentaires reellement lies  : 41080
  (ecart)                               : 0

controle Q4b — The Taking of Pelham 1 2 3 :
  num_mflix_comments = 161   reel = 161

>>> incoherences restantes : 0
>>> OK : 0 incoherence.
```

**0 incohérence.** ✔ Le script se termine sur un `assert len(incoherents2) == 0` qui échouerait
bruyamment sinon. Pelham est passé de 437 à **161**, et les deux sommes coïncident à 41 080.

## Q18. Subset Pattern — `recent_comments`

```python
db.comments.aggregate([
    {"$match": {"movie_id": {"$in": ids}}},
    {"$sort":  {"movie_id": 1, "date": -1}},
    {"$group": {"_id": "$movie_id",
                "derniers": {"$push": {"name": "$name", "text": "$text", "date": "$date"}}}},
    {"$project": {"derniers": {"$slice": ["$derniers", 3]}}},
])
```

Un `$sort` + `$group` + `$push` + `$slice` : **un seul aller-retour** au lieu de 10
`find().sort().limit()`. Le `$push` respecte l'ordre imposé par le `$sort` amont, le `$slice` coupe
aux 3 premiers. La projection est faite **dans le `$push`** — seuls `name`, `text`, `date` sont
embarqués, sans `_id`, `email` ni `movie_id` (redondants une fois dans le film).

```
films cibles  : 10
modifiedCount : 10
```

**Vérification sur les 10 films :**

| `recent_comments` | Commentaires au total | Film |
|---|---|---|
| **3** | 161 | The Taking of Pelham 1 2 3 |
| **3** | 158 | 50 First Dates |
| **3** | 158 | Terminator Salvation |
| **3** | 158 | Ocean's Eleven |
| **3** | 158 | About a Boy |
| **3** | 157 | The Mummy |
| **3** | 157 | Sherlock Holmes |
| **3** | 155 | Hellboy II: The Golden Army |
| **3** | 154 | Anchorman: The Legend of Ron Burgundy |
| **3** | 154 | The Mummy Returns |

Détail du premier — `len(recent_comments) = 3`, tri décroissant sur `date` respecté :

```
- 2017-06-28 02:28:25 | Robert Baratheon   | Asperiores fugit doloribus ipsum suscipit...
- 2016-12-18 06:24:57 | Shireen Baratheon  | Perspiciatis deserunt saepe id nisi blandi...
- 2016-09-22 22:30:38 | Deborah Kennedy    | Provident omnis excepturi aliquid quidem...
cles du sous-document : ['date', 'name', 'text']
```

Confirmation en mongosh :

```js
db.movies.findOne({ _id: ObjectId("573a13bff29313caabd5e91e") }).recent_comments.length   // 3
db.movies.countDocuments({ recent_comments: { $exists: true } })                          // 10
```

### Pourquoi 3 commentaires et pas 161 ?

Le script mesure la facture (`bson.BSON.encode`) au lieu de la supposer :

| | Valeur |
|---|---|
| Document film **avec 3** commentaires embarqués | **2 902 octets** |
| Le seul tableau `recent_comments` (3 sous-doc) | 705 octets |
| Coût moyen d'un commentaire embarqué | **235 octets** |
| Si l'on embarquait les **161** | **≈ 40 032 octets (39,1 Ko)** |
| Facteur | **× 13,8** |

Quatre raisons, dans l'ordre d'importance :

1. **Le coût d'écriture, pas le plafond de 16 Mo.** MongoDB **relit et réécrit le document entier**
   à chaque modification. Ajouter un commentaire de 235 octets à un film de 39 Ko fait transiter
   39 Ko en écriture, en réplication vers les secondaires, et dans l'oplog. Avec le subset à 3, on
   écrit 2,9 Ko. **13,8 fois moins.**
2. **Le tableau est non borné.** 161 aujourd'hui, rien ne dit combien demain. Un modèle qui grossit
   sans limite naturelle est structurellement condamné — la question n'est que la date.
3. **Le besoin réel est borné, lui.** L'UI affiche un aperçu de 2 ou 3 commentaires sous la fiche.
   Les 158 autres ne sont chargés que si l'utilisateur clique — et une pagination sur `comments`
   avec l'index `movie_id_1` le fait très bien. **On embarque ce qui est lu à chaque affichage,
   on référence le reste** : c'est la règle d'or « *data that is accessed together should be stored
   together* », appliquée non pas à l'entité mais à l'**accès**.
4. **La RAM.** Une liste de 20 films chargerait 20 × 39 Ko = 780 Ko au lieu de 58 Ko, alors que
   l'écrasante majorité de ces octets ne sera jamais affichée.

**Le prix à payer, honnêtement :** le Subset Pattern est une **duplication**. Éditer ou supprimer un
commentaire impose désormais de mettre à jour **deux** endroits — la collection `comments` **et** le
tableau `recent_comments` du film. C'est exactement le type de double écriture que la Q19 rend
atomique, et exactement le type de désynchronisation que la Q16 vient de mesurer sur un autre
champ dénormalisé.

---

# Partie 5 — Transaction ACID multi-documents

> Fichier livré : **`transaction.js`**.

## Mise en place du replica set

```bash
docker run -d --name mongo-rs -p 27019:27017 mongo:7.0 --replSet rs0
docker exec mongo-rs mongosh --port 27017 --eval "rc = rs.initiate()"
```

```js
{ info2: 'no configuration specified. Using a default configuration for the set',
  me: '0d58a6aa4fac:27017', ok: 1 }
```

> **Port 27019 et non 27018** : `27018` est déjà pris par `mongo-ipssi` (cf. Partie 0). Le port
> interne reste `27017`, les `docker exec` de l'énoncé sont inchangés.

Réimport dans l'instance dédiée :

```bash
docker cp movies.json   mongo-rs:/tmp/movies.json
docker cp comments.json mongo-rs:/tmp/comments.json
docker exec mongo-rs mongoimport --db mflix -c movies   --drop --file /tmp/movies.json
docker exec mongo-rs mongoimport --db mflix -c comments --drop --file /tmp/comments.json
# 23539 / 50304 document(s) imported successfully
```

**Pourquoi un replica set est obligatoire.** Les transactions multi-documents s'appuient sur le
mécanisme de *snapshot* de WiredTiger et sur l'**oplog** pour pouvoir annuler proprement. Une
instance *standalone* n'a pas d'oplog : le serveur répond
`Transaction numbers are only allowed on a replica set member or mongos`. Un replica set à **un seul
nœud** suffit — c'est l'existence de l'oplog qui compte, pas le nombre de membres.

## Q19. Scénario de modération

Contexte vérifié à l'exécution :

```
setName           : rs0
isWritablePrimary : true
```

Cible : `ObjectId("573a13bff29313caabd5e91e")` — *The Taking of Pelham 1 2 3*, le film le plus
commenté (Q15). État initial dans `mongo-rs` : `num_mflix_comments = 437`, **161** commentaires.

### CAS 1 — la transaction est validée

```js
const session = db.getMongo().startSession();
const sDb = session.getDatabase("mflix");

session.startTransaction({
  readConcern:  { level: "snapshot" },
  writeConcern: { w: "majority" }
});

try {
  sDb.comments.deleteOne({ _id: cible._id });                                   // écriture 1
  sDb.movies.updateOne({ _id: FILM_ID }, { $inc: { num_mflix_comments: -1 } }); // écriture 2
  session.commitTransaction();
} catch (e) {
  session.abortTransaction();
}
```

```
deleteOne  -> deletedCount  = 1
updateOne  -> modifiedCount = 1
--- pendant la transaction, vu de l'EXTERIEUR (hors session) :
  [exterieur] num_mflix_comments = 437  |  commentaires en base = 161
--- vu de l'INTERIEUR de la session :
  commentaires = 160  compteur = 436
>>> commitTransaction() OK

[apres commit] num_mflix_comments = 436  |  commentaires en base = 160
delta compteur : -1   delta commentaires : -1     -> CONFORME
```

**L'isolation est visible en direct** : au même instant, la session voit `160/436` et le reste du
monde voit toujours `161/437`. Aucune lecture concurrente ne peut observer l'état intermédiaire.

### CAS 2 — erreur au milieu, `abortTransaction()`

Mêmes deux écritures, puis une exception levée **après** les deux :

```js
throw new Error("PANNE SIMULEE apres les deux ecritures");
```

```
[avant abort] num_mflix_comments = 436  |  commentaires en base = 160
deleteOne  -> deletedCount  = 1
updateOne  -> modifiedCount = 1
vu de l'INTERIEUR : commentaires = 159  compteur = 435
exception attrapee : PANNE SIMULEE apres les deux ecritures
>>> abortTransaction() appele

[apres abort] num_mflix_comments = 436  |  commentaires en base = 160
delta compteur : 0   delta commentaires : 0     -> ROLLBACK CONFIRME
le commentaire 5a9427658b0beebeb6977207 existe-t-il encore ? true
```

**Rien n'est appliqué.** Les deux écritures avaient pourtant *réussi* (`deletedCount = 1`,
`modifiedCount = 1`) et étaient visibles dans la session (`159/435`). L'`abortTransaction()` les
annule **toutes les deux**, et le commentaire supprimé est de retour.

### CAS 3 — contre-exemple : les mêmes écritures sans transaction

```
deleteOne (hors transaction) -> 1
exception : PANNE SIMULEE : le processus meurt AVANT le $inc  (aucun rollback possible)
[apres panne] num_mflix_comments = 436  |  commentaires en base = 159
delta compteur : 0   delta commentaires : -1
>>> INCOHERENCE : le commentaire a disparu mais le compteur n'a pas bouge.
>>> l'ecart compteur/reel vaut maintenant 277  — exactement le bug de la Q4.
```

En trois lignes, **j'ai reproduit le bug du jeu de données**. L'écart est passé de 276 à **277** par
une seule panne au mauvais moment. Répétez l'opération 276 fois et vous obtenez exactement l'état
dans lequel `sample_mflix` nous a été livré. **La Q4 n'était pas une curiosité : c'est la trace de
milliers de doubles écritures non transactionnelles.**

### Ce que garantit chaque lettre, ici précisément

**A — Atomicité.** « Supprimer le commentaire » et « décrémenter le compteur » forment **une seule
unité indivisible** : tout ou rien. Le CAS 2 le prouve — deux écritures réussies, annulées ensemble.
Le CAS 3 montre l'alternative : une écriture appliquée, l'autre non, **et aucun moyen de revenir en
arrière** puisque le processus est mort. C'est la lettre qui manquait au jeu de données.

**C — Cohérence.** L'invariant métier `num_mflix_comments == countDocuments({movie_id: film})` est
vrai avant et après, jamais faux durablement. La transaction ne *crée* pas l'invariant — c'est à moi
de l'écrire correctement — mais elle **empêche l'application d'un état qui le violerait**. À noter
que MongoDB ne connaît pas cet invariant : il n'a ni clé étrangère ni `CHECK`. Le C est entièrement
porté par le code, la transaction ne fait que le rendre tenable.

**I — Isolation.** Avec `readConcern: "snapshot"`, la transaction lit une **vue figée** de la base à
son instant de départ, et ses écritures sont invisibles de l'extérieur jusqu'au commit. Mesuré dans
le CAS 1 : `160/436` dans la session, `161/437` dehors, **au même instant**. Un utilisateur qui
rafraîchit la page pendant la modération ne verra jamais « 160 commentaires, compteur 437 ». MongoDB
prévient aussi les conflits d'écriture : une autre transaction touchant le même document reçoit un
`WriteConflict` et un `TransientTransactionError` (à rejouer), plutôt que d'écraser silencieusement.

**D — Durabilité.** `writeConcern: { w: "majority" }` : le `commitTransaction()` ne rend la main
qu'une fois l'écriture acquittée par la **majorité** des membres du replica set et inscrite dans le
journal. Si le primaire tombe juste après, le commit **survit** — un secondaire promu le possède
déjà. C'est aussi ce qui rend le résultat résistant à un *rollback* d'élection. Sans `w: "majority"`
(par exemple `w: 1`), le commit serait acquitté par le seul primaire et pourrait être perdu lors
d'un basculement : la lettre D serait affaiblie même avec A, C et I intacts.

**Le coût, pour être complet.** Une transaction verrouille des documents et retient un snapshot :
elle a une durée de vie limitée (`transactionLifetimeLimitSeconds`, **60 s** par défaut) et un
plafond de 16 Mo d'oplog. Elle est faite pour des écritures **courtes et ciblées** comme celle-ci —
pas pour un batch de 12 244 documents comme celui de la Q17, où `bulk_write(ordered=False)` sur des
opérations idempotentes est le bon outil.

---

# Partie 6 — Réflexion

## R1. Ce que le SGBD ne fait plus pour vous

**La responsabilité qui bascule : l'intégrité référentielle.** En relationnel, `FOREIGN KEY
comments.movie_id REFERENCES movies(_id)` est vérifiée **par le moteur, à chaque écriture**. Insérer
un commentaire vers un film inexistant échoue ; supprimer un film déclenche `ON DELETE CASCADE`,
`SET NULL` ou un refus. Le développeur ne peut pas produire la faute même en essayant.

MongoDB n'a **rien** de cela. `movie_id` est un `ObjectId` comme un autre — le serveur ne sait même
pas que c'est censé être une référence. La validation **passe intégralement dans le code
applicatif**, et tout ce que le code oublie devient une incohérence permanente et silencieuse.

**Le chiffrage.**

| | Valeur | Source |
|---|---|---|
| Commentaires au total | 50 304 | **Q1** |
| **Commentaires orphelins** | **9 224** | **Q2** |
| **Part de la collection pointant dans le vide** | **18,34 %** | **Q2** |
| `movie_id` distincts fantômes | 6 796 | Q2 (détail) |
| Identifiants référencés existant réellement | 7 449 / 14 245 = **52,3 %** | **Q3** |
| Sur-comptage induit sur les compteurs | +81 515 | **Q16** |

**Presque un commentaire sur cinq pointe dans le vide.** Et sur les 14 245 identifiants distincts
référencés (Q3), **47,7 % ne désignent aucun document**. Ce n'est pas un cas limite : c'est la moitié
du graphe de références qui est cassé, dans le jeu de données **officiel** de MongoDB.

Et le dégât ne s'arrête pas là : la Q16 montre que ces 9 224 orphelins expliquent exactement l'écart
des compteurs (50 304 − 9 224 = **41 080**, la somme réelle après correction). **Un défaut
d'intégrité référentielle a contaminé un second champ, dans une autre collection.** C'est la
propriété la plus coûteuse de ce type de bug : il ne reste pas où il est né.

### Deux stratégies côté application — et leur facture

**Stratégie 1 — Valider à l'écriture avec `$jsonSchema` + validation applicative.**

Le *schema validation* de MongoDB (`db.createCollection(..., { validator: { $jsonSchema: {...} } })`)
impose que `movie_id` **existe** et soit bien un `objectId`. Puis l'application vérifie l'existence
du film avant chaque insertion :

```js
if (!await db.movies.findOne({ _id: movieId }, { projection: { _id: 1 } })) throw ...
await db.comments.insertOne({ movie_id: movieId, ... })
```

*Ce qu'elle coûte :*
- **Performance** : une lecture supplémentaire avant chaque écriture. Avec l'index `_id_` c'est
  rapide, mais c'est +1 aller-retour sur le chemin critique de chaque post.
- **Couverture partielle — et c'est le point grave** : la vérification et l'insertion ne sont pas
  atomiques. Entre le `findOne` et l'`insertOne`, le film peut être supprimé (*TOCTOU*). Il faudrait
  une transaction (Q19) pour fermer complètement la fenêtre — nouveau coût.
- **Couverture partielle bis** : `$jsonSchema` ne sait vérifier que le **type et la présence**, pas
  l'**existence de la cible**. Il n'existe aucun équivalent déclaratif de la clé étrangère.
- **Ne protège pas du côté suppression** : c'est l'effacement des films qui a créé les 9 224
  orphelins, pas l'insertion des commentaires. Cette stratégie seule n'aurait rien empêché ici.

**Stratégie 2 — Suppression en cascade transactionnelle, et réconciliation périodique.**

Toute suppression d'un film supprime ses commentaires dans la **même transaction** (le mécanisme de
la Q19, appliqué à la cascade). En complément, un job nocturne rejoue la réconciliation de la Q16 :
un `$group` + `bulk_write`, qui a corrigé **12 244** compteurs en quelques secondes.

*Ce qu'elle coûte :*
- **Performance** : la transaction verrouille le film **et tous ses commentaires** le temps de la
  cascade. Sur les 161 commentaires de Pelham c'est indolore ; sur un film à 100 000 commentaires,
  on dépasse `transactionLifetimeLimitSeconds` (60 s) et la limite de 16 Mo d'oplog. Il faut alors
  découper en lots — et on **reperd l'atomicité** que l'on cherchait.
- **Complexité** : le replica set devient obligatoire (impossible en standalone, cf. Partie 5), il
  faut gérer les `TransientTransactionError` et le rejeu, et le job de réconciliation est un
  composant de plus à écrire, ordonnancer et superviser.
- **Couverture partielle dans le temps** : la réconciliation est *a posteriori*. Entre deux
  passages, la base est incohérente. Elle réduit la **durée** du problème, pas son existence — et
  elle ne peut rien restaurer, seulement recompter.

**Ce que je retiens.** Aucune des deux ne rend le résultat de la Q2 impossible ; elles le rendent
plus rare ou plus court. Le vrai arbitrage est celui du cours : **MongoDB échange l'intégrité
garantie contre la flexibilité et la scalabilité horizontale** (une clé étrangère est ingérable
entre *shards*). Ce troc est parfaitement rationnel — à condition de savoir que l'on paie, et de
budgéter le code qui remplace le moteur. Ici, personne n'a payé : **18,34 %**.

## R2. Embed vs reference — la borne

**Pourquoi référencer est le bon choix pour film ↔ commentaires.**

Point de départ, **Q15** : le film le plus commenté, *The Taking of Pelham 1 2 3*, porte
**161 commentaires**.

**Le calcul de taille** (méthode du Jour 1, R3 — `bsonsize()` en mongosh, `scripts/05_r2_bson.js`) :

```js
var c = db.comments.findOne({ movie_id: FILM });
bsonsize(c)                                              // 328 octets (document complet)
bsonsize({ name: c.name, text: c.text, date: c.date })   // 252 octets (version embarquée)
```

Moyenne mesurée sur les **161** commentaires du film, pas sur un seul :

| Élément | Taille |
|---|---|
| Commentaire complet (avec `_id`, `email`, `movie_id`) | **283,0 octets** en moyenne |
| Commentaire **embarqué** (`{name, text, date}` seuls) | **203,9 octets** en moyenne |
| Tableau des 161 commentaires embarqués | **33 548 octets** |
| Socle du film (sans `recent_comments`) | **2 202 octets** |
| `movies.avgObjSize` (collection) | 1 598 octets |
| `comments.avgObjSize` (collection) | 284 octets |

**Taille du film si l'on imbriquait tout :**

```
2 202 + 161 × 203,9 ≈ 35 030 octets ≈ 34,2 Ko
```

| Nb de commentaires embarqués | Taille du film | % de la limite 16 Mo |
|---|---|---|
| **161** *(réel aujourd'hui)* | **34,2 Ko** | **0,209 %** |
| 1 000 | 201,3 Ko | 1,229 % |
| 10 000 | 1 993,7 Ko | 12,168 % |
| 100 000 | 19 917,4 Ko | **121,566 %** — dépassement |
| **82 258** | **16 Mo** | **100 % — seuil de rupture** |

### Est-ce la limite des 16 Mo qui tranche ?

**Non.** À 161 commentaires on occupe **0,209 %** du plafond, et il faudrait **82 258** commentaires
pour le saturer — 511 fois plus que le film le plus commenté du catalogue. Sur ce seul critère,
l'imbrication passerait sans problème.

**Ce qui tranche, c'est le coût d'écriture et l'absence de borne.**

1. **Réécriture intégrale à chaque modification.** MongoDB relit et réécrit le document entier. Un
   nouveau commentaire de 204 octets sur un film de 34,2 Ko fait transiter **34,2 Ko** en écriture,
   en réplication et dans l'oplog — un facteur d'amplification de **× 172**. En référencé, on écrit
   283 octets dans `comments`, point. Mesuré en Q18 : le Subset Pattern à 3 commentaires garde le
   document à 2 902 octets au lieu de 40 032, soit **13,8 fois moins d'octets réécrits**.
2. **Aucune borne naturelle.** 161 est le maximum *observé* sur ce catalogue figé. Sur une
   plateforme vivante, un film viral n'a aucun plafond. Un modèle dont la validité repose sur
   « les utilisateurs ne commenteront pas trop » n'est pas un modèle.
3. **Contention en écriture.** 161 commentateurs modifient **le même document**. Chaque écriture
   prend un verrou document et invalide la version cachée. En référencé, chacun écrit son propre
   document : aucune contention.
4. **Lecture inutilement lourde.** Une liste de 20 films chargerait 20 × 34,2 Ko = **684 Ko** de
   commentaires jamais affichés, au lieu de 20 × 2,2 Ko = 44 Ko.
5. **Les commentaires sont une entité de plein droit.** Ils ont leur cycle de vie (modération,
   signalement, suppression) et leurs propres accès — « tous les commentaires de tel utilisateur »
   est une requête légitime, et elle est *impossible* efficacement si les commentaires sont dispersés
   dans 23 539 films. Le cours est clair : **1:beaucoup + entités indépendantes + écritures
   fréquentes ⇒ référencer.**

**Verdict : ce n'est pas le plafond BSON qui tranche, c'est l'amplification d'écriture (× 172) sur
un tableau non borné.** Le plafond arriverait 511 fois trop tard pour servir d'alerte — c'est
d'ailleurs la leçon commune avec le Jour 1 (R3) : les 16 Mo ne sont jamais le bon critère de
décision.

### Dans quel cas imbriquerait-on quand même ?

**Quand le tableau est borné par la nature même du domaine, et lu à chaque affichage.** Trois cas
précis :

1. **Le Subset Pattern — que j'ai justement implémenté en Q18.** On imbrique les **3** derniers
   commentaires (`recent_comments`, 705 octets mesurés) parce que ce nombre est **fixé par l'UI**,
   pas par les utilisateurs. La fiche s'affiche alors **sans aucune jointure**, et l'historique
   complet reste référencé. C'est la vraie réponse de production : ce n'est pas « embed *ou*
   reference », c'est **les deux**, chacun sur le bon sous-ensemble.
2. **Un tableau structurellement borné** : les `genres` d'un film (max 25, Q1), ses `directors` (40
   films chez Woody Allen, mais 1 à 3 réalisateurs par film, Q14), son sous-document `imdb` ou
   `tomatoes`. Ces données n'existent pas sans le film et sont lues avec lui — l'imbrication est
   évidente, et c'est d'ailleurs le choix fait par `sample_mflix`.
3. **Une relation 1:1 ou 1:peu, en lecture massivement dominante**, où l'atomicité gratuite du
   document unique est un bénéfice direct : elle rendrait inutile la transaction de la Q19.

Le seuil que je retiendrais, en reprenant le raisonnement du Jour 1 : **on bascule vers le référencé
dès que le tableau n'a pas de borne connue *a priori*, ou que le document dépasse ~100 Ko** — soit
ici **≈ 490 commentaires**, atteint bien avant les 82 258 du plafond BSON.

## R3. ESR — vérifié par l'expérience

### Pourquoi l'ordre Equality → Sort → Range est optimal

Un index composé est un **B-tree trié lexicographiquement**, champ par champ. L'image la plus juste
est un annuaire trié par (nom, prénom, ville) : je peux trouver instantanément tous les « Dupont »,
et **à l'intérieur** de cette tranche les prénoms sont déjà classés. Mais je ne peux pas obtenir la
liste triée par ville sans tout relire.

- **E (égalité) en premier** parce qu'une égalité fixe un **préfixe exact** : elle découpe une
  **plage strictement contiguë** de l'index, atteinte par un seul *seek*. C'est la réduction maximale
  pour le coût minimal, et elle **préserve intégralement l'ordre** des champs suivants à l'intérieur
  de la plage.
- **S (tri) en deuxième** parce que, dans cette plage contiguë, les clés sont **déjà physiquement
  ordonnées** par ce champ. MongoDB n'a qu'à parcourir l'index dans le sens voulu : le tri devient
  **gratuit**, il disparaît du plan. C'est la seule position où c'est possible.
- **R (range) en dernier** parce qu'un range « **ouvre** » l'intervalle : il ne sélectionne pas une
  valeur mais une étendue. Tout champ placé **après** un range dans l'index n'est plus contigu — ses
  valeurs sont éparpillées dans toute l'étendue lue. Il ne peut donc plus servir ni au tri, ni à un
  filtre efficace. Le range doit être le **dernier** à consommer de l'ordre, parce qu'il le détruit.

En une phrase : **l'égalité conserve l'ordre, le tri le consomme, le range le détruit** — d'où E, S, R.

### La preuve

```js
db.movies.createIndex({ genres: 1, year: 1, "imdb.rating": -1 }, { name: "mauvais_ordre_ERS" })

db.movies.find({ genres: "Drama", year: { $gte: 2000 } }).sort({ "imdb.rating": -1 })
         .hint("esr_genres_rating_year").explain("executionStats")
db.movies.find({ genres: "Drama", year: { $gte: 2000 } }).sort({ "imdb.rating": -1 })
         .hint("mauvais_ordre_ERS").explain("executionStats")
```

### (a) Un stage `SORT` apparaît-il ?

**Oui — et c'est toute la différence.**

| Index forcé par `.hint()` | `stage` racine | **stage `SORT` ?** | `totalKeysExamined` | `totalDocsExamined` | `nReturned` | ms |
|---|---|---|---|---|---|---|
| `esr_genres_rating_year` — **E S R** | `FETCH` | **NON** | **7 834** | 7 761 | 7 761 | **16** |
| `mauvais_ordre_ERS` — **E R S** | `FETCH` | **OUI** | **7 761** | 7 761 | 7 761 | **50** |

L'ordre E-R-S produit `SORT ← FETCH ← IXSCAN` : les 7 761 documents sont d'abord récupérés, puis
**retriés en mémoire**. L'ordre E-S-R produit `FETCH ← IXSCAN` : l'index sort déjà les résultats dans
le bon ordre.

Laissé libre, l'optimiseur ne s'y trompe pas :

```
winningPlan indexName : "esr_genres_rating_year"
plans rejetés         : 2
```

### (b) L'écart — et un résultat contre-intuitif

| Métrique | E-S-R (bon) | E-R-S (mauvais) | Écart |
|---|---|---|---|
| `totalKeysExamined` | 7 834 | **7 761** | **−73 en faveur du MAUVAIS** |
| `totalDocsExamined` | 7 761 | 7 761 | **0 — identique** |
| Stage `SORT` bloquant | non | **oui** | — |
| `executionTimeMillis` | **16** | **50** | **× 3,1 en faveur du BON** |

**Le plus coûteux est l'index en mauvais ordre : 3,1 fois plus lent (50 ms contre 16 ms).**

Et le résultat est instructif précisément parce qu'il est **contre-intuitif** : le mauvais index
examine **73 clés de moins** et **exactement le même nombre de documents**. Sur les métriques
habituelles de sélectivité, il semble *meilleur*. C'est logique : avec `year` en 2ᵉ position, le
range est appliqué directement dans l'index, sans les 73 clés de bordure que le bon index doit
franchir.

**Le surcoût est ailleurs, et `totalDocsExamined` ne le voit pas.** Il est dans le **`SORT`
bloquant** : MongoDB doit matérialiser les 7 761 documents en mémoire, les trier intégralement, et ne
peut **rien renvoyer avant d'avoir tout reçu**. C'est un point de blocage total du pipeline.
L'index ESR, lui, *streame* : il peut renvoyer le premier résultat immédiatement.

**La leçon de méthode :** on ne juge pas un index sur `totalDocsExamined` seul. Sur ce cas précis, ce
compteur aurait désigné le mauvais gagnant. Il faut lire le **plan complet** — la présence d'un
`SORT` ou d'un `COLLSCAN` — et le temps d'exécution. C'est aussi ce que la Q8 avait déjà montré
autrement : `genres_1` seul (13 789 docs, **166 ms**) est plus lent que le `COLLSCAN` (23 539 docs,
**53 ms**), alors qu'il examine 42 % de documents en moins.

Le désavantage réel du `SORT` bloquant explose avec `.limit()` : sur `.limit(10)`, l'index ESR
s'arrête après 10 clés, le mauvais doit trier les 7 761 résultats pour en garder 10.

### (c) Que se passe-t-il si le tri en mémoire dépasse la limite ?

MongoDB refuse et lève :

```
QueryExceededMemoryLimitNoDiskUseAllowed:
  Sort exceeded memory limit of <N> bytes, but did not opt in to external sorting.
```

L'erreur n'est **pas** un ralentissement : c'est un **échec dur** de la requête. Un `SORT` bloquant
doit tout matérialiser en RAM ; au-delà du quota, le serveur préfère échouer plutôt que de consommer
la mémoire de toute l'instance.

> **Précision sur le chiffre de 32 Mo.** L'énoncé mentionne 32 Mo, ce qui était la valeur historique
> (jusqu'à MongoDB 4.2). Sur mon serveur **7.0.40**, j'ai relevé la valeur réelle :
>
> ```js
> db.adminCommand({ getParameter: 1, internalQueryMaxBlockingSortMemoryUsageBytes: 1 })
> // { internalQueryMaxBlockingSortMemoryUsageBytes: 104857600, ok: 1 }
> ```
>
> Et le plan d'exécution du `SORT` l'annonce lui-même : `"memLimit": 104857600`.
> **La limite par défaut est donc de 100 Mo (104 857 600 octets)**, et non 32 Mo, depuis MongoDB 4.4.
> Le principe reste identique, seul le seuil a changé.

**Les issues, par ordre de préférence :**

1. **Créer le bon index** — la seule vraie solution. Avec l'ordre ESR, il n'y a **pas de stage
   `SORT`**, donc pas de mémoire consommée, donc la limite ne peut pas être atteinte. C'est
   exactement ce que démontre le tableau (a).
2. **`allowDiskUse`** — le contournement. En agrégation : `db.coll.aggregate(pipeline, {
   allowDiskUse: true })`, activé par défaut depuis MongoDB 6.0 (`allowDiskUseByDefault`). Sur un
   `find().sort()`, l'option est `.allowDiskUse()` (MongoDB 4.4+). Le tri déborde alors dans des
   fichiers temporaires (`_tmp` du `dbPath`) via un tri-fusion externe. *Le prix :* on passe d'un
   tri RAM à un tri **disque**, avec des ordres de grandeur d'écart en latence, plus des I/O et de
   l'espace disque temporaire. Cela transforme une erreur en lenteur — ce n'est pas une correction.
3. **Réduire le volume trié** : `$limit`/`$project` **avant** le `$sort` (l'optimiseur le fait
   parfois seul), ou filtrer plus tôt.
4. **Relever `internalQueryMaxBlockingSortMemoryUsageBytes`** — à éviter : c'est déplacer le mur, et
   on le déplace pour **toutes** les requêtes de l'instance.

## R4. Patterns — le bénéfice et sa facture

Le champ `num_mflix_comments` est un **Computed Pattern** : une valeur dérivée, stockée au plus près
de sa lecture pour éviter de la recalculer.

### Le bénéfice, chiffré

Combien de films sont concernés ? **Q3 : 14 245 identifiants de films sont référencés par au moins
un commentaire** (dont 7 449 correspondent à un film réel, cf. R1). Sans compteur, chaque affichage
de fiche exige un recomptage. J'ai mesuré ce que cela coûte (`scripts/06_r1_r4.js`, 200 films
échantillonnés puis extrapolés) :

| Méthode | Par film | Extrapolé aux 14 245 films |
|---|---|---|
| `countDocuments({movie_id})` **sans** index sur `comments.movie_id` | **28,05 ms** | **≈ 399,5 s (6 min 40 s)** |
| `countDocuments({movie_id})` **avec** index `movie_id_1` | **1,41 ms** | **≈ 20,1 s** |
| **Un seul `$group` recomptant les 14 245** | — | **188 ms** |
| **Lecture du champ pré-calculé** (`findOne` projeté) | **8 ms** | — |

**Le bénéfice.** Sur la page d'accueil, afficher 20 fiches sans compteur coûte 20 recomptages, soit
**28 ms** avec index (**561 ms** sans). Avec le compteur, l'information arrive **dans le document
déjà lu pour afficher le titre et l'affiche** : **coût marginal nul, zéro requête supplémentaire,
zéro jointure**. Sur 14 245 films, on supprime **20,1 s** de calcul cumulé — et surtout on supprime
une requête du **chemin critique** de chaque affichage, celle qui grossit avec le nombre de
commentaires alors que la lecture du compteur, elle, est en O(1) pour toujours.

C'est la règle d'or du cours : *data that is accessed together should be stored together*. Le nombre
de commentaires est affiché **avec** le film, il doit donc être stocké **dans** le film.

### Le risque, chiffré

| | Valeur | Source |
|---|---|---|
| Films portant `num_mflix_comments` | 15 740 | Q4a |
| **Compteurs faux** | **12 244** | **Q16** |
| **Pourcentage** | **12 244 / 15 740 = 77,79 %** | **Q16** |
| Compteurs justes | 3 496 (22,21 %) | Q16 |
| Sur-estimations / sous-estimations | **12 244 / 0** | Q16 |
| Sur-comptage cumulé | +81 515 commentaires fantômes | Q16 |
| Pire écart individuel relevé | Pelham : 437 annoncés / **161** réels (**+171 %**) | Q4b-c |

**Plus de trois compteurs sur quatre sont faux (77,79 %).** Le champ n'est pas « légèrement
désynchronisé » : il est **majoritairement mensonger**. Un utilisateur qui consulte une fiche au
hasard a **77,79 % de chances** de lire un nombre inexact — et **100 %** des erreurs sont des
sur-estimations, donc des promesses de contenu qui n'existe pas.

Le pire, du point de vue de l'exploitation : **cette erreur n'a jamais levé la moindre exception.**
Pas un log, pas une alerte, pas un test rouge. Elle a traversé le jeu de données **officiel** de
MongoDB et n'apparaît que si l'on écrit délibérément la requête de réconciliation.

### À quelle condition ce pattern est-il acceptable en production ?

Le Computed Pattern est un **cache**, et il obéit aux règles des caches. Je le considère acceptable
si — et seulement si — **quatre conditions** sont réunies :

1. **La mise à jour du compteur est atomique avec la donnée source.** C'est la condition
   structurante, et c'est exactement la Q19 : `deleteOne` sur `comments` + `$inc` sur `movies` dans
   **une seule transaction**. Mon CAS 3 prouve la nécessité par l'absurde — une seule panne au mauvais
   moment a fait passer l'écart de 276 à **277**. Répétez 276 fois : vous obtenez le jeu de données
   tel qu'il nous a été livré. **Les 12 244 compteurs faux sont la signature de 12 244 doubles
   écritures non transactionnelles.**
2. **Un job de réconciliation tourne périodiquement**, et c'est un **filet**, pas la stratégie
   principale. Ma Q17 le montre viable : `$group` + `bulk_write(ordered=False)` a corrigé
   **12 244** compteurs, `modifiedCount = 12244`, en un seul aller-retour réseau, avec un recomptage
   complet à **188 ms**. Un tel job peut tourner toutes les nuits sans gêner personne.
3. **L'écart est mesuré et alerté en continu.** Une métrique `nb_compteurs_incoherents` exposée en
   supervision, avec un seuil. Ce qu'aucune erreur ne signalera jamais, seule une mesure délibérée
   peut le révéler — c'est précisément ce que fait ma fonction `q16_reconcilier()`.
4. **La donnée tolère l'approximation.** Un compteur de commentaires, oui : afficher 160 au lieu de
   161 pendant une minute n'a aucune conséquence. Un solde bancaire, un stock, un quota facturé :
   **non** — pour ceux-là, on recompte, ou on recourt à une source de vérité transactionnelle.

**Conclusion.** Le Computed Pattern échange **de la justesse contre de la vitesse**. Le gain est
réel et mesurable (**20,1 s** de recomptage supprimées, une requête retirée de chaque affichage), et
la facture aussi : **77,79 %** de valeurs fausses quand personne ne paie l'entretien. Le pattern
n'est pas en cause — c'est un excellent pattern. Ce qui a échoué ici, c'est qu'on en a pris le
bénéfice sans en assumer le coût. **En NoSQL, la dénormalisation n'est jamais gratuite : elle est
payable en code, et le SGBD n'enverra jamais la facture.**

---

# Pour aller plus loin

> Script : `scripts/04_bonus.js`.

## B1. Covered query

Une requête est **couverte** quand tous les champs — du filtre **et** de la projection — sont
présents dans l'index : MongoDB répond **sans jamais ouvrir un document**.

```js
db.movies.createIndex({ year: 1, title: 1 }, { name: "cov_year_title" })
db.movies.find({ year: 1972 }, { year: 1, title: 1, _id: 0 }).explain("executionStats")
```

```
stage             : PROJECTION_COVERED
  inputStage      : IXSCAN (cov_year_title)
nReturned         : 131
totalKeysExamined : 131
totalDocsExamined : 0          <-- aucun document lu
executionTimeMillis : 0
```

**`totalDocsExamined = 0`**, stage **`PROJECTION_COVERED`**, **aucun `FETCH`** ✔

Trois contre-exemples qui montrent la fragilité de la couverture :

| Requête | `stage` racine | `FETCH` | `totalDocsExamined` | Pourquoi |
|---|---|---|---|---|
| `{year:1972}` proj `{year:1,title:1}` | `PROJECTION_SIMPLE` | oui | **131** | `_id` non exclu, et il n'est pas dans l'index |
| `{year:1972}` proj `{year:1,title:1,_id:0}` | **`PROJECTION_COVERED`** | **non** | **0** | ✔ couverte |
| `{year:1972}` proj `{..., plot:1, _id:0}` | `PROJECTION_SIMPLE` | oui | 131 | `plot` n'est pas dans l'index |
| `{genres:"Film-Noir"}` proj `{genres:1,_id:0}` | `PROJECTION_SIMPLE` | oui | 105 | **index multi-clés** : jamais couvrant |

Deux pièges à retenir : **`_id` est projeté par défaut** et casse la couverture s'il n'est pas dans
l'index (d'où le `_id: 0`), et un **index multi-clés ne peut jamais couvrir** une requête — l'index
ne stocke que les éléments individuels du tableau, pas le tableau original, donc MongoDB ne peut pas
le reconstituer sans lire le document.

## B2. Index partiel

```js
db.movies.aggregate([{ $group: { _id: "$type", n: { $sum: 1 } } }])
// [ { _id: 'movie', n: 23285 }, { _id: 'series', n: 254 } ]

db.movies.createIndex({ title: 1 }, { name: "full_title" })
db.movies.createIndex({ title: 1 }, { name: "part_title_series",
                                      partialFilterExpression: { type: "series" } })
```

`db.movies.stats().indexSizes` :

| Index | Documents indexés | Taille | Ratio |
|---|---|---|---|
| `full_title` | 23 539 | **483 328 o** | 100 % |
| `part_title_series` | **254** | **24 576 o** | **5,08 %** |
| **Économie** | | **458 752 o (448 Ko)** | **− 94,92 %** |

L'index partiel n'indexe que **254 documents sur 23 539 (1,1 %)** et pèse **5,08 %** de l'index
complet — le surcoût relatif vient du fait qu'un B-tree a un coût de structure incompressible même
pour peu d'entrées.

Le gain n'est pas que du disque : c'est autant de **RAM** de moins dans le cache WiredTiger, et
surtout **aucune écriture d'index** lors de la modification des 23 285 films `type: "movie"` — ils
ne sont tout simplement pas dans l'index.

**La contrepartie :** MongoDB n'utilisera cet index que si la requête **garantit** le prédicat.
`find({ type: "series", title: "..." })` peut l'utiliser ; `find({ title: "..." })` seul ne le peut
pas, puisque rien ne prouve que le résultat est bien dans l'index. Cas d'usage typique : indexer
seulement les commandes `{status: "pending"}`, ou seulement les documents où le champ existe
(`{$exists: true}` — la version moderne et plus souple de l'index *sparse*).

## B3. Index TTL

```js
db.sessions.createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600, name: "ttl_createdAt" })

db.sessions.insertMany([
  { user: "amani",  token: "tok-frais",  createdAt: new Date() },
  { user: "amani",  token: "tok-30min",  createdAt: new Date(Date.now() - 1800 * 1000) },
  { user: "invite", token: "tok-perime", createdAt: new Date(Date.now() - 7200 * 1000) }
])
// 3 documents insérés
```

Après un passage du `TTLMonitor` :

```js
db.sessions.countDocuments({})   // 2
// [ { token: 'tok-frais', ... }, { token: 'tok-30min', ... } ]
```

**`tok-perime` (créé il y a 7 200 s > 3 600 s) a été supprimé automatiquement.** Aucun code
applicatif, aucun cron, aucune requête de purge.

```js
db.adminCommand({ getParameter: 1, ttlMonitorSleepSecs: 1 })
// { ttlMonitorSleepSecs: 60, ok: 1 }
```

**Le cas d'usage.** Toute donnée dont la valeur **expire d'elle-même** : sessions et jetons
d'authentification (l'exemple ci-dessus), codes OTP à usage unique, paniers d'achat abandonnés, caches
de résultats d'API, logs et données d'audit à durée de rétention légale (RGPD : purge automatique
des données personnelles au bout de N mois), verrous distribués auto-libérés.

**Le bénéfice réel** est autant réglementaire qu'opérationnel : la rétention devient une propriété
**déclarative du schéma**, garantie par le moteur, et non une promesse dans un cron que personne ne
surveille — un cron qui, s'il tombe, laisse silencieusement grossir une collection de sessions
jusqu'à saturer le disque.

**Les précisions à connaître :**
- Le `TTLMonitor` passe **toutes les 60 s** : la suppression est *éventuelle*, pas instantanée. Un
  document peut survivre jusqu'à ~60 s après son expiration. L'application ne doit donc **jamais**
  se reposer sur le TTL pour la sécurité — un jeton expiré doit aussi être rejeté à la lecture.
- Le champ indexé doit être une **`Date`** (ou un tableau de dates) ; sur tout autre type, le
  document n'expire jamais — silencieusement.
- Un index TTL doit être **simple** : `expireAfterSeconds` est refusé sur un index composé.
- Sur un replica set, seul le **primaire** purge ; les secondaires appliquent les suppressions via
  l'oplog, ce qui garantit la cohérence des lectures secondaires.

---

# Récapitulatif des résultats

| Q | Question | Résultat |
|---|---|---|
| **P0** | Films / commentaires importés | **23 539** / **50 304** |
| **Q1** | Films / commentaires / genres distincts | **23 539** / **50 304** / **25** (26 via `distinct` une fois `genres_1` créé — voir Q1) |
| **Q2** | Commentaires orphelins | **9 224** (**18,34 %**) |
| **Q3** | Identifiants de films référencés | **14 245** (dont 7 449 réels) |
| **Q4a** | Films portant `num_mflix_comments` | **15 740 / 23 539 = 66,87 %** |
| **Q4b** | Pelham : compteur / réel | **437** / **161** |
| **Q4c** | Écart | **+276**, **+171,43 %** — sur-estimation |
| **Q5** | `year` en chaîne | **37** (`$gte: 2000` en rate 26) |
| **Q6** | `imdb.rating: ""` | **61** (moyenne à la main faussée : 6,6761 vs 6,6935) |
| **Q7a** | `COLLSCAN` : docs examinés / retournés | **23 539** / **105** |
| **Q7b** | `IXSCAN` : docs examinés / retournés | **105** / **105** (÷ 224) |
| **Q8a** | Films Drama depuis 2000 | **7 761** |
| **Q8b** | Ordre ESR | `genres:1, "imdb.rating":-1, year:1` |
| **Q8c** | Stage `SORT` après index ESR | **absent** ✔ (16 ms) |
| **Q9a** | `$regex /Godfather/` sur `title` | **5** |
| **Q9b** | `$text "godfather"` | **12** |
| **Q9c** | Écart | **+7** (titre seul → titre + `plot`, casse) |
| **Q9d** | `$text "godfathers"` | **12** — identique (stemming) ; `$regex` → 0 |
| **Q9e** | Sous-chaîne `godfat` | `$text` **0** / `$regex` **5** |
| **Q10** | Index non créé par moi / poids du `text` | **`_id_`** / **5,94 Mo (83,7 %)** |
| **Q11** | Top genre | **Drama 13 789** |
| **Q12** | Top décennie | **2000 → 7 749** |
| **Q13** | Moyenne IMDB Drama | **6,8305** sur **13 751** films |
| **Q14** | Top réalisateur | **Woody Allen — 40** |
| **Q15** | Film le plus commenté | **The Taking of Pelham 1 2 3 — 161** |
| **Q16** | Compteurs incohérents | **12 244 / 15 740 = 77,79 %** |
| **Q17** | `modifiedCount` puis re-vérification | **12 244** puis **0 incohérence** ✔ |
| **Q18** | Subset Pattern | **10 films × 3 sous-documents** ✔ |
| **Q19** | Transaction | commit **−1/−1** ✔ · abort **0/0** ✔ · sans transaction **−1/0** ✘ |
| **B1** | Covered query | `PROJECTION_COVERED`, **`totalDocsExamined = 0`** |
| **B2** | Index partiel (254 docs) | **24 576 o** vs 483 328 o — **5,08 %** |
| **B3** | TTL 3 600 s | **3 → 2** documents après le `TTLMonitor` |
