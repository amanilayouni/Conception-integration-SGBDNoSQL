# TP Jour 2 — Modélisation, Indexation & Drivers

Base `mflix` · MongoDB 7.0.40 · PyMongo 4.17.0. 

> Ports : `mongo-ipssi` publié sur `27018` , `mongo-rs` sur `27019`.


**Contrôle P0 :** `db.movies.countDocuments({})` = **23539**  · `db.comments.countDocuments({})` = **50304** 

---

## Q1

```js
db.movies.countDocuments({})
db.comments.countDocuments({})
db.movies.distinct("genres").length
```

```
23539
50304
25
```

**23 539 films · 50 304 commentaires · 25 genres distincts.**

## Q2

```js
db.comments.aggregate([
  { $lookup: { from: "movies", localField: "movie_id", foreignField: "_id", as: "film" } },
  { $match: { film: { $eq: [] } } },
  { $count: "orphelins" }
])
```

```js
[ { orphelins: 9224 } ]
```

**9 224 commentaires orphelins**

## Q3

```js
db.comments.aggregate([
  { $group: { _id: "$movie_id" } },
  { $count: "films_references" }
])
```

```js
[ { films_references: 14245 } ]
```

**14 245 films distincts référencés.**

## Q4

### (a)

```js
db.movies.countDocuments({ num_mflix_comments: { $exists: true } })
db.movies.countDocuments({})
```

```
15740
23539
```

**15 740 films sur 23 539, soit 66,87 %.**

### (b)

```js
var pelham = db.movies.findOne({ title: "The Taking of Pelham 1 2 3" });
pelham.num_mflix_comments
db.comments.countDocuments({ movie_id: pelham._id })
```

```
437
161
```

**Compteur stocké : 437. Commentaires réels : 161.**

### (c)

**Écart absolu : +276. Écart relatif : +171,43 %.** Le compteur **sur-estime** — il annonce 2,71 fois
le nombre réel.

### (d)

La fiche affiche « 437 commentaires ». L'utilisateur clique et la page en charge **161** : il ne voit
aucune erreur, juste 276 messages manquants, et conclut que le site les a perdus ou censurés. Si la
pagination est calculée sur le compteur (437 / 20 = 22 pages), les pages 9 à 22 sont **vides** — un
bug qui ne lève aucune exception et ne remplit aucun log.

Ce que cela révèle sur les compteurs dénormalisés en général : **ce n'est pas une donnée, c'est un
cache**, et il devient faux dès qu'une écriture échappe au chemin qui le met à jour. Ici, des
commentaires ont été supprimés sans décrémentation : le compteur n'a jamais été **transactionnel**
avec la collection qu'il résume. Un tel champ n'est donc acceptable que si son écriture est atomique
avec la source (Q19) ou si un job de réconciliation le recalcule (Q17).

## Q5

```js
db.movies.countDocuments({ year: { $type: "string" } })
```

```
37
```

**37 films** ont un `year` en chaîne (des séries : `'2006–2012'`, `'2015–'`…).

**Pourquoi `{ year: { $gte: 2000 } }` les ignore silencieusement :**

```js
db.movies.countDocuments({ $and: [ { year: { $type: "string" } }, { year: { $gte: 2000 } } ] })
```

```
0
```

MongoDB applique le **type bracketing** : un opérateur de comparaison ne compare qu'à l'intérieur du
même type BSON. `2000` étant un `int`, seules les valeurs numériques sont testées ; les 37 chaînes
sont écartées d'office, **sans erreur ni avertissement**. L'ordre BSON global rendrait toute
comparaison inter-types arbitraire, MongoDB refuse donc de l'inventer.


## Q6

```js
db.movies.countDocuments({ "imdb.rating": "" })
```

```
61
```

**61 films** ont `imdb.rating: ""`. Le champ n'est jamais absent, il est **présent et vide**.

Le piège apparaît dès qu'on calcule la moyenne à la main : `$sum` saute les chaînes vides mais `$sum: 1`
compte les documents. **Numérateur et dénominateur ne portent alors pas sur la même population**
(23 478 contre 23 539), et la moyenne passe de **6,6935** à **6,6761**. Second effet : `{"imdb.rating":
{$gte: 7}}` écarte ces 61 films par type bracketing — ils ne sont jamais ni bien ni mal notés, ils
disparaissent de tous les histogrammes.

## Q7

### (a) Avant tout index

```js
db.movies.find({ genres: "Film-Noir" }).explain("executionStats")
```

**`COLLSCAN` · `totalDocsExamined` = 23 539 · `nReturned` = 105.**

### (b) Après l'index

```js
db.movies.createIndex({ genres: 1 })          // -> "genres_1"
db.movies.find({ genres: "Film-Noir" }).explain("executionStats")
```


**Stage `IXSCAN` + `FETCH`.** `totalDocsExamined` passe de **23 539 à 105** (÷ 224). `genres` étant un
tableau, l'index est automatiquement **multi-clés**.

## Q8

### (a)

```js
db.movies.countDocuments({ genres: "Drama", year: { $gte: 2000 } })
```

```
7761
```

### (b)

| Champ | Rôle | Position ESR |
|---|---|---|
| `genres: "Drama"` | Égalité | 1 — **E** |
| `imdb.rating: -1` | Sort | 2 — **S** |
| `year: { $gte: 2000 }` | Range | 3 — **R** |

```js
db.movies.createIndex({ genres: 1, "imdb.rating": -1, year: 1 },
                      { name: "esr_genres_rating_year" })
```

**Justification.** Un index composé est un B-tree trié lexicographiquement, champ après champ.
L'**égalité** en premier fixe un préfixe exact : elle isole une **plage contiguë** en un seul *seek*
et préserve l'ordre des champs suivants. Dans cette plage, les clés sont donc **déjà triées par
`imdb.rating`** : MongoDB parcourt l'index dans l'ordre et le tri devient gratuit. Le **range** vient
en dernier parce qu'il « ouvre » l'intervalle — tout champ placé après lui n'est plus contigu et ne
peut plus servir au tri. En résumé : l'égalité conserve l'ordre, le tri le consomme, le range le
détruit.

### (c)

```js
db.movies.find({ genres: "Drama", year: { $gte: 2000 } })
         .sort({ "imdb.rating": -1 }).explain("executionStats")
```

```
stage               : FETCH
  inputStage        : IXSCAN (esr_genres_rating_year)
nReturned           : 7761
totalKeysExamined   : 7834
totalDocsExamined   : 7761
executionTimeMillis : 16

/"stage":"SORT/.test(JSON.stringify(winningPlan))   ->  false
```

**Aucun stage `SORT`**  — le tri est entièrement couvert par l'index.

## Q9

### (a)

```js
db.movies.countDocuments({ title: { $regex: /Godfather/ } })
```

```
5
```

### (b)

```js
db.movies.createIndex({ title: "text", plot: "text" }, { name: "txt_title_plot" })
db.movies.countDocuments({ $text: { $search: "godfather" } })
```

```
12
```

### (c)

**Écart : +7.** Trois films que seule la version (b) trouve :

| Titre | Pourquoi |
|---|---|
| *Jane Austen's Mafia!* | `plot` : « Takeoff on the **Godfather**… » |
| *The Nutcracker in 3D* | `plot` : « …whose **godfather** gives her a special doll… » |
| *C(r)ook* | `plot` : « The mafia **godfather** suspects treason. » |

Ils sortent pour deux raisons : le `$regex` ne portait que sur `title`, alors que l'index text couvre
**`title` et `plot`** — ces films n'ont « Godfather » que dans leur résumé ; et `$text` normalise en
**minuscules**, là où `/Godfather/` est sensible à la casse.

### (d)

**Oui, exactement le même nombre qu'en (b) : 12.** Le *stemming* a réduit `godfathers` → `godfather`
avant la recherche, comme il avait indexé `Godfathers` sous le même radical.

**J'en déduis** que `$text` n'indexe pas des chaînes de caractères mais des **radicaux lexicaux** :
minuscules → tokenisation → stop words → stemming, appliqué **deux fois**, à l'indexation et à la
requête, ce qui garantit qu'elles se rencontrent.

**Un `$regex` aurait donné 0** (`/godfathers/`, casse) ou **1** (`/Godfathers/` : seulement *Tokyo
Godfathers*). Il compare des octets : il faudrait écrire `/[Gg]odfathers?/` à la main, et recommencer
pour chaque irrégularité.

### (e)

**Le `$regex` reste préférable quand on cherche une sous-chaîne qui n'est pas un mot entier :**

```js
db.movies.countDocuments({ $text: { $search: "godfat" } })   // 0
db.movies.countDocuments({ title: { $regex: /Godfat/ } })    // 5
```

L'unité atomique de `$text` est le **mot** : `"godfat"` n'en est pas un, donc **0 résultat**, alors
que `$regex` travaille au caractère et en trouve **5**. C'est décisif pour un numéro de série ou un
fragment de code (`A7X-9` dans `REF-A7X-9931-B` : `$text` tokeniserait sur les tirets), pour
l'autocomplétion par préfixe (`/^Star Wars/`, en plus **indexable**) et pour une correspondance
sensible à la casse.

## Q10

```js
db.movies.getIndexes()
```

L’index que je n’ai pas créé est _id_. MongoDB le crée automatiquement pour chaque collection, il est unique et ne peut pas être supprimé.

```js
db.movies.stats().indexSizes
db.movies.dropIndex("txt_title_plot")
```

Un index inutilisé est un coût inutile : il ralentit les écritures, utilise de la RAM, prend de la place sur le disque et peut compliquer le choix du meilleur plan d’exécution. Donc, s’il n’est jamais utilisé, il vaut mieux le supprimer.

## Q11

```js
db.movies.aggregate([
  { $unwind: "$genres" },
  { $group: { _id: "$genres", nb_films: { $sum: 1 } } },
  { $sort: { nb_films: -1 } },
  { $limit: 5 }
])
```

```js
[ { _id: 'Drama',    nb_films: 13789 },
  { _id: 'Comedy',   nb_films: 7024 },
  { _id: 'Romance',  nb_films: 3665 },
  { _id: 'Crime',    nb_films: 2678 },
  { _id: 'Thriller', nb_films: 2658 } ]
```

## Q12

```js
db.movies.aggregate([
  { $match: { year: { $type: "int" } } },
  { $project: { decennie: { $subtract: [ "$year", { $mod: [ "$year", 10 ] } ] } } },
  { $group: { _id: "$decennie", nb_films: { $sum: 1 } } },
  { $sort: { nb_films: -1 } },
  { $limit: 3 }
])
```

```js
[ { _id: 2000, nb_films: 7749 },
  { _id: 2010, nb_films: 5972 },
  { _id: 1990, nb_films: 3773 } ]
```

## Q13

```js
db.movies.aggregate([
  { $match: { genres: "Drama", "imdb.rating": { $type: "number" } } },
  { $group: { _id: null, moyenne: { $avg: "$imdb.rating" }, nb_films: { $sum: 1 } } },
  { $project: { _id: 0, nb_films: 1, moyenne_4_dec: { $round: [ "$moyenne", 4 ] } } }
])
```

```js
[ { nb_films: 13751, moyenne_4_dec: 6.8305 } ]
```

**Moyenne : 6,8305 · 13 751 films comptés.**

## Q14

```js
db.movies.aggregate([
  { $unwind: "$directors" },
  { $group: { _id: "$directors", nb_films: { $sum: 1 } } },
  { $sort: { nb_films: -1, _id: 1 } },
  { $limit: 3 }
])
```

```js
[ { _id: 'Woody Allen', nb_films: 40 },
  { _id: 'John Ford',   nb_films: 35 },
  { _id: 'John Huston', nb_films: 34 } ]
```

## Q15

```js
db.comments.aggregate([
  { $group: { _id: "$movie_id", nb_commentaires: { $sum: 1 } } },
  { $sort:  { nb_commentaires: -1 } },
  { $limit: 5 },
  { $lookup: { from: "movies", localField: "_id", foreignField: "_id", as: "film" } },
  { $project: { _id: 0, nb_commentaires: 1, titre: { $first: "$film.title" } } }
])
```

```js
[ { nb_commentaires: 161, titre: 'The Taking of Pelham 1 2 3' },
  { nb_commentaires: 158, titre: '50 First Dates' },
  { nb_commentaires: 158, titre: "Ocean's Eleven" },
  { nb_commentaires: 158, titre: 'About a Boy' },
  { nb_commentaires: 158, titre: 'Terminator Salvation' } ]
```

## Q16

```python
pipeline = [{"$group": {"_id": "$movie_id", "n": {"$sum": 1}}}]
reels = Counter({d["_id"]: d["n"] for d in db.comments.aggregate(pipeline)})

for film in db.movies.find({}, {"_id": 1, "num_mflix_comments": 1}):
    if "num_mflix_comments" in film and film["num_mflix_comments"] != reels.get(film["_id"], 0):
        incoherents.append((film["_id"], film["num_mflix_comments"], reels.get(film["_id"], 0)))
```

```
films portant num_mflix_comments        : 15740
--> COMPTEURS INCOHERENTS               : 12244
    soit 77.79 % des films portant le champ
    dont sur-estimations                : 12244
    dont sous-estimations               : 0
somme des compteurs stockes             : 122595
somme des commentaires reellement lies  : 41080
```

**12 244 films ont un compteur incohérent** (77,79 % de ceux qui portent le champ).

## Q17

```python
operations = [UpdateOne({"_id": _id}, {"$set": {"num_mflix_comments": reels.get(_id, 0)}})
              for _id, _s, _r in incoherents]
resultat = db.movies.bulk_write(operations, ordered=False)
```

```
operations UpdateOne preparees : 12244
matchedCount  : 12244
modifiedCount : 12244
```

**`modifiedCount` = 12 244.**

Re-vérification (Q16 relancée à l'identique) :

```
films portant num_mflix_comments        : 15740
--> COMPTEURS INCOHERENTS               : 0
somme des compteurs stockes             : 41080
somme des commentaires reellement lies  : 41080
controle Pelham : num_mflix_comments = 161   reel = 161
>>> OK : 0 incoherence.
```

**0 incohérence** 

## Q18

```python
recents = {d["_id"]: d["derniers"] for d in db.comments.aggregate([
    {"$match": {"movie_id": {"$in": ids}}},
    {"$sort":  {"movie_id": 1, "date": -1}},
    {"$group": {"_id": "$movie_id",
                "derniers": {"$push": {"name": "$name", "text": "$text", "date": "$date"}}}},
    {"$project": {"derniers": {"$slice": ["$derniers", 3]}}},
])}
db.movies.bulk_write([UpdateOne({"_id": m}, {"$set": {"recent_comments": recents[m]}})
                      for m in ids], ordered=False)
```

```
films cibles  : 10
modifiedCount : 10

verification sur les 10 films :
  3 sous-doc(s) | 161 commentaires au total | The Taking of Pelham 1 2 3
  3 sous-doc(s) | 158 | 50 First Dates          3 sous-doc(s) | 158 | Terminator Salvation
  3 sous-doc(s) | 158 | Ocean's Eleven          3 sous-doc(s) | 158 | About a Boy
  3 sous-doc(s) | 157 | The Mummy               3 sous-doc(s) | 157 | Sherlock Holmes
  3 sous-doc(s) | 155 | Hellboy II              3 sous-doc(s) | 154 | Anchorman
  3 sous-doc(s) | 154 | The Mummy Returns

detail du 1er film : The Taking of Pelham 1 2 3
  len(recent_comments) = 3
    - 2017-06-28 | Robert Baratheon  | Asperiores fugit doloribus ipsum...
    - 2016-12-18 | Shireen Baratheon | Perspiciatis deserunt saepe id nisi...
    - 2016-09-22 | Deborah Kennedy   | Provident omnis excepturi aliquid...
  cles du sous-document : ['date', 'name', 'text']
```

**Vérification : le tableau contient bien 3 sous-documents** 

Pourquoi seulement 3 et pas les 161 ? Avec bson.BSON.encode, le film avec 3 commentaires pèse 2 902 octets et un commentaire environ 235 octets. Avec 161 commentaires, le document ferait environ 40 032 octets (39,1 Ko), soit ×13,8. Ce n’est pas la limite des 16 Mo qui pose problème, mais le coût d’écriture : MongoDB doit réécrire le document entier à chaque modification. Le tableau serait aussi non borné et pourrait continuer à grossir. Comme l’interface n’affiche que 2 ou 3 commentaires, on embarque ceux qui sont affichés et on référence les autres.

## Q19

```js
const session = db.getMongo().startSession();
const sDb = session.getDatabase("mflix");

session.startTransaction({ readConcern:  { level: "snapshot" },
                           writeConcern: { w: "majority" } });
try {
  sDb.comments.deleteOne({ _id: cible._id });
  sDb.movies.updateOne({ _id: FILM_ID }, { $inc: { num_mflix_comments: -1 } });
  session.commitTransaction();
} catch (e) {
  session.abortTransaction();
}
```
**CAS 1 — commit** : le compteur passe de 437 à 436 et les commentaires de 161 à 160. Après
`commitTransaction()`, les deux changements sont conservés : delta -1 / -1 → conforme.

**CAS 2 — erreur** : les deux écritures réussissent dans la session, puis une erreur est simulée.
`abortTransaction()` annule tout : le compteur revient à 436, les commentaires à 160, et le
commentaire existe à nouveau. → Rollback confirmé.

**CAS 3 — sans transaction** : si le commentaire est supprimé mais que le processus plante avant le
`$inc`, il n'y a aucun rollback. On obtient alors un écart entre le compteur et le nombre réel de
commentaires : c'est le bug de la Q4.

### Ce que garantit ACID

- **A — Atomicité** : les deux opérations sont une seule unité : tout est appliqué ou tout est annulé.
- **C — Cohérence** : l'invariant `num_mflix_comments == countDocuments({movie_id})` reste correct.
  C'est le code qui garantit cette règle.
- **I — Isolation** : avec `readConcern: "snapshot"`, la transaction travaille sur une vue figée et ses
  changements restent invisibles à l'extérieur jusqu'au commit.
- **D — Durabilité** : `writeConcern: { w: "majority" }` garantit que le commit est confirmé par la
  majorité du replica set. Même si le primaire tombe juste après, le commit peut être conservé par un
  secondaire devenu primaire.
---

# Partie 6 — Réflexion

## R1. Ce que le SGBD ne fait plus pour vous

**Ce qui bascule : l'intégrité référentielle.** Pas de `FOREIGN KEY` en MongoDB — `movie_id` est un
`ObjectId` comme un autre, le serveur ignore que c'est une référence. La validation passe
**intégralement dans le code applicatif**.

**Chiffrage :** **Q2** → **9 224** orphelins sur **50 304** commentaires (**Q1**), soit **18,34 % de
ma table pointe dans le vide**. Sur les **14 245** identifiants référencés (**Q3**), seuls **7 449**
existent.

**Stratégie 1 — valider à l'écriture** (`$jsonSchema` + `findOne` de contrôle avant `insertOne`).
*Coût :* une lecture de plus par publication, et **couverture partielle** — vérification et insertion
non atomiques, et `$jsonSchema` ne vérifie que le type, jamais l'existence de la cible. Elle n'aurait
d'ailleurs rien empêché ici : ce sont les suppressions de films qui ont créé les 9 224 orphelins.

**Stratégie 2 — cascade transactionnelle + réconciliation périodique** (**Q19** + le job de la
**Q17**, qui a corrigé **12 244** compteurs).
*Coût :* la transaction verrouille le film et tous ses commentaires — au-delà de 60 s
(`transactionLifetimeLimitSeconds`) il faut découper en lots et **reperdre l'atomicité** ; replica set
obligatoire ; et la réconciliation est *a posteriori*, donc elle **réduit la durée du problème, pas
son existence**.

MongoDB échange l'intégrité garantie contre la scalabilité horizontale. Troc rationnel — à condition
de budgéter le code qui remplace le moteur. Ici, personne ne l'a fait : **18,34 %**.

## R2. Embed vs reference — la borne

**Q15** : le film le plus commenté porte **161 commentaires**.

**Calcul** (`bsonsize()`, méthode du Jour 1 R3) : un commentaire embarqué = **203,9 octets**, socle du
film = 2 202 octets → **2 202 + 161 × 203,9 ≈ 34,2 Ko**, soit **0,209 %** des 16 Mo. Il faudrait
**82 258** commentaires pour saturer le plafond.

**Ce n'est donc pas la limite des 16 Mo qui tranche** (511 fois le maximum du catalogue), **c'est
l'amplification d'écriture** : MongoDB réécrit le document **entier**, donc ajouter 204 octets à un
film de 34,2 Ko fait transiter 34,2 Ko — facteur **× 172**. S'y ajoutent l'absence de **borne
naturelle**, la contention de 161 commentateurs sur le même document, et le fait que les commentaires
sont une entité indépendante (modération, cycle de vie propre). Le cours : 1:beaucoup + entités
indépendantes + écritures fréquentes ⇒ **référencer**.

**On imbriquerait quand même** si le tableau est **borné par le domaine** et lu à chaque affichage :
c'est le **Subset Pattern de la Q18** (3 commentaires, nombre fixé par l'UI et non par les
utilisateurs), ou un tableau structurellement borné comme `genres` (**Q1**) et `directors` (**Q14**).

## R3. ESR — vérifié par l'expérience

**Pourquoi cet ordre.** L'index est un B-tree trié lexicographiquement. L'**égalité** fixe un préfixe
exact : plage contiguë en un seul *seek*, ordre des champs suivants **préservé**. Le **tri** vient
ensuite car dans cette plage les clés sont **déjà ordonnées** par ce champ — le tri devient gratuit.
Le **range** en dernier car il « ouvre » l'intervalle et éparpille tout ce qui le suit. En résumé :
**l'égalité conserve l'ordre, le tri le consomme, le range le détruit.**

**Manipulation :**

```js
db.movies.createIndex({ genres: 1, year: 1, "imdb.rating": -1 }, { name: "mauvais_ordre_ERS" })
db.movies.find({ genres: "Drama", year: { $gte: 2000 } }).sort({ "imdb.rating": -1 })
         .hint("mauvais_ordre_ERS").explain("executionStats")
```

### (a) / (b)

| Index forcé par `.hint()` | `SORT` ? | `totalKeysExamined` | `totalDocsExamined` | ms |
|---|---|---|---|---|
| **E S R** `esr_genres_rating_year` | **non** | 7 834 | 7 761 | **16** |
| **E R S** `mauvais_ordre_ERS` | **oui** | 7 761 | 7 761 | **50** |
| écart | | −73 pour le mauvais | identique | **× 3,1 pour le bon** |

**Le mauvais ordre est 3,1 fois plus lent.** Contre-intuitif : il examine **73 clés de moins** et
autant de documents, donc il paraît meilleur sur la sélectivité. Le surcoût est dans le **`SORT`
bloquant**, invisible pour `totalDocsExamined` : il doit tout matérialiser en mémoire et ne peut rien
renvoyer avant d'avoir tout reçu, là où l'index ESR *streame*.

### (c)

MongoDB **échoue** (`QueryExceededMemoryLimitNoDiskUseAllowed: Sort exceeded memory limit…`), ce n'est
pas un ralentissement.

> Sur mon serveur 7.0.40, `internalQueryMaxBlockingSortMemoryUsageBytes` vaut **104857600** : la
> limite par défaut est **100 Mo**, pas 32 Mo (valeur d'avant MongoDB 4.4).

Issues : **le bon index** (avec ESR, pas de `SORT`, donc limite inatteignable) ; sinon
**`allowDiskUse`**, qui fait déborder le tri sur disque — cela transforme une erreur en lenteur, ce
n'est pas une correction.

## R4. Patterns — le bénéfice et sa facture

**Le bénéfice.** **Q3 : 14 245** films concernés. Recompter à chaque affichage coûte **1,41 ms/film**
avec index (**28,05 ms** sans), soit **≈ 20,1 s** cumulées sur le catalogue (399,5 s sans index). Avec
le compteur, la valeur arrive **dans le document déjà lu** : coût marginal nul, zéro requête
supplémentaire — et en O(1) quel que soit le nombre de commentaires.

**Le risque.** **Q16 : 12 244 compteurs faux** sur **15 740** films portant le champ (**Q4a**), soit
**77,79 %**, dont **100 % de sur-estimations**. Pire cas (**Q4b**) : 437 annoncés pour **161** réels.
Et l'erreur **n'a jamais levé une seule exception**.

**Conditions d'acceptabilité en production :**

1. **Écriture atomique avec la source** (**Q19**) — mon CAS 3 le prouve par l'absurde : une panne fait
   passer l'écart de 276 à **277**.
2. **Job de réconciliation périodique** comme filet (**Q17** : 12 244 corrections, recomptage complet
   en **188 ms**).
3. **Écart mesuré et alerté** — seule une mesure délibérée révèle un bug qui ne lève rien.
4. **Donnée tolérant l'approximation** : un compteur de commentaires oui, un solde bancaire non.

**Conclusion.** Le pattern échange de la justesse contre de la vitesse : **20,1 s** gagnées, **77,79 %**
de valeurs fausses. Le pattern n'est pas en cause — on en a pris le bénéfice sans assumer le coût. En
NoSQL, la dénormalisation est payable en code, et le SGBD n'enverra jamais la facture.
