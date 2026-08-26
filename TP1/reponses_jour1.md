# TP Jour 1 — Introduction au NoSQL & MongoDB


**Environnement :** Docker Compose (`mongo:7.0` + `mongo-express`), base `nyc`, collection `restaurants`

---

## Partie 1 — Lecture & opérateurs

### Q1. Combien de restaurants au total ?

```js
db.restaurants.countDocuments({})
```

**Résultat : `25359`**

### Q2. Combien de types de cuisine distincts ?

```js
db.restaurants.distinct("cuisine").length
```

**Résultat : `85`**

### Q3. Combien de restaurants dans l'arrondissement Brooklyn ?

```js
db.restaurants.countDocuments({ borough: "Brooklyn" })
```

**Résultat : `6086`**

### Q4. Combien de restaurants de cuisine French (exactement) ?

```js
db.restaurants.countDocuments({ cuisine: "French" })
```

**Résultat : `344`**

### Q5. Manhattan ET cuisine Italian ?

```js
db.restaurants.countDocuments({ borough: "Manhattan", cuisine: "Italian" })
```

**Résultat : `621`**

### Q6. Bronx ET cuisine Chinese ?

```js
db.restaurants.countDocuments({ borough: "Bronx", cuisine: "Chinese" })
```

**Résultat : `323`**

### Q7. Restaurants nommés exactement "Subway"

```js
db.restaurants.countDocuments({ name: "Subway" })
```

**Résultat : `421`**

Les 3 premiers, avec projection (`_id` masqué) :

```js
db.restaurants.find({ name: "Subway" }, { name: 1, borough: 1, _id: 0 }).limit(3)
```

```js
[
  { borough: 'Manhattan', name: 'Subway' },
  { borough: 'Queens',    name: 'Subway' },
  { borough: 'Manhattan', name: 'Subway' }
]
```

> Sans `sort()`, l'ordre renvoyé est l'ordre naturel de la collection : il n'est pas garanti stable
> entre deux imports. C'est bien « 3 documents parmi les 421 », pas « les 3 premiers » au sens d'un tri.

### Q8. Cuisines japonaise, coréenne, thaïe ou indienne (`$in`)

```js
db.restaurants.countDocuments({ cuisine: { $in: ["Japanese", "Korean", "Thai", "Indian"] } })
```

**Résultat : `1623`**

Détail par cuisine (contrôle de cohérence) : Japanese 758 + Korean 262 + Thai 285 + Indian 316 = **1623** 

### Q9. Le champ de recherche qui ment

**(a) Recherche sensible à la casse**

```js
db.restaurants.countDocuments({ name: /BBQ/ })
```

**Résultat : `0`**


**(b) Recherche insensible à la casse**

```js
db.restaurants.countDocuments({ name: /BBQ/i })
```

**Résultat : `73`**

**(c) L'écart et son explication**

Écart : **73 − 0 = 73** résultats, soit **100 %** des résultats pertinents perdus par la version (a).

```js
db.restaurants.find({ name: /BBQ/i }, { name: 1, _id: 0 }).limit(5)
```

```js
[
  { name: 'Dallas Bbq' },
  { name: 'Dallas Bbq' },
  { name: "Virgil'S Bbq" },
  { name: 'E-Dah Korean Bbq Lounge' },
  { name: "Goody'S Bbq" }
]
```

Dans la base, l'acronyme n'est **jamais** stocké en capitales : il est écrit **`Bbq`**. Le jeu de
données a été normalisé en *Title Case* (première lettre de chaque mot en majuscule, le reste en
minuscules), ce qui a détruit la casse propre aux acronymes. `BBQ` n'existe littéralement pas dans
le champ `name`, d'où le `0` de la question (a).

**(d) Le même test avec `House`**

```js
db.restaurants.countDocuments({ name: /House/ })    // 387
db.restaurants.countDocuments({ name: /House/i })   // 503
```

**Résultats : `387` et `503`**, écart de **116**.

Les noms que seule la version insensible ramène :

```js
db.restaurants.find({ name: { $regex: /House/i, $not: /House/ } }, { name: 1, _id: 0 }).limit(10)
```

```js
[
  { name: 'Peter Luger Steakhouse' },
  { name: 'Roadhouse Restaurant' },
  { name: "Sammy'S Steakhouse" },
  { name: 'Keens Steakhouse' },
  { name: 'The Clubhouse' },
  { name: 'Frankie & Johnnies Steakhouse' },
  { name: 'Townhouse Of Ny' },
  { name: 'Arirang Hibachi Steakhouse' },
  { name: "Morton'S Steakhouse" },
  { name: 'Firehouse' }
]
```

**La cause est différente de celle de la Q9c.** En (c), `Bbq` est un **mot isolé** dont seule la
capitalisation diffère de la saisie utilisateur. Ici, `House` en tant que mot isolé existe bien
(387 occurrences : *Waffle House*, *Ale House*…). Les 116 documents supplémentaires sont ceux où
`house` est **soudé à l'intérieur d'un mot composé** — `Steak·house`, `Road·house`, `Club·house`,
`Fire·house`, `Town·house` — et se retrouve donc en minuscules du fait de la normalisation *Title Case*.


**(e) Que livrer en production ?**

Je livrerais la version (b) plutôt que la (a) : la (a) renvoie zéro résultat sur un terme courant,
c'est un bug fonctionnel. Mais **aucune des deux n'est acceptable en production**, pour une raison
de performance :

- un `$regex` **non ancré** (sans `^`) ne peut pas exploiter un index sous forme de recherche par
  préfixe : le moteur est contraint de balayer toutes les clés ;
- le drapeau `i` aggrave le problème, car un index standard est construit avec un ordre de collation
  sensible à la casse — il devient inutilisable et l'on retombe sur un `COLLSCAN`.

J'ai mesuré ce coût au bonus B1 : sur cette collection, un `COLLSCAN` examine **25 309** documents
là où un `IXSCAN` n'en examine que **345**.

Ma proposition pour la mise en production : un **index texte** (`db.restaurants.createIndex({ name: "text" })`)
interrogé par `$text: { $search: "BBQ" }`. Il est insensible à la casse et aux accents *par
construction*, il est indexé donc rapide, et il ajoute la lemmatisation et le scoring de pertinence.


### Q10. Code postal "10462" (dot-notation)

```js
db.restaurants.countDocuments({ "address.zipcode": "10462" })
```

**Résultat : `150`**


### Q11. Nom du restaurant `restaurant_id: "30075445"`

```js
db.restaurants.findOne({ restaurant_id: "30075445" }, { name: 1, _id: 0 })
```

```js
{ name: 'Morris Park Bake Shop' }
```

**Résultat : `Morris Park Bake Shop`**

---

## Partie 2 — Tableaux & sous-documents

### Q12. Au moins une note de score > 50

```js
db.restaurants.countDocuments({ "grades.score": { $gt: 50 } })
```

**Résultat : `349`**


### Q13. « Mal noté » — mais quand ?

**(a) Au moins un grade "C" dans tout l'historique**

```js
db.restaurants.countDocuments({ "grades.grade": "C" })
```

**Résultat : `2708`**

**(b) Première entrée du tableau égale à "C"**

```js
db.restaurants.countDocuments({ "grades.0.grade": "C" })
```

**Résultat : `220`**

**(c) L'écart et son interprétation**

Écart : **2708 − 220 = 2488** restaurants, soit un facteur **12,3×**.

J'ouvre le tableau `grades` d'un restaurant concerné pour trancher :

```js
db.restaurants.findOne({ "grades.0.grade": "C" }, { name: 1, grades: 1, _id: 0 })
```

```
name : Mcdonald'S
  grades[0] : date=2014-10-30  grade=C  score=37
  grades[1] : date=2014-05-30  grade=A  score=13
  grades[2] : date=2013-04-30  grade=A  score=2
  grades[3] : date=2012-11-19  grade=A  score=12
  grades[4] : date=2012-06-12  grade=A  score=12
  grades[5] : date=2012-01-31  grade=A  score=5
```

Les dates sont **décroissantes** : 2014-10-30 → 2012-01-31. L'entrée d'indice **0 est donc la plus
récente**, c'est-à-dire la dernière inspection en date.


### Q14. Tableaux `grades` vides

```js
db.restaurants.countDocuments({ grades: { $size: 0 } })
```

**Résultat : `738`**


### Q15. Au moins 6 notes (index positionnel + `$exists`)

```js
db.restaurants.countDocuments({ "grades.5": { $exists: true } })
```

**Résultat : `3864`**


### Q16. Première note égale à "A"

```js
db.restaurants.countDocuments({ "grades.0.grade": "A" })
```

**Résultat : `20687`**

Soit **81,6 %** de la collection (20687 / 25359) actuellement notés A — à rapprocher des 220 notés C
de la Q13b.

### Q17. Le piège `$elemMatch`

**(a) Requête naïve**

```js
db.restaurants.countDocuments({ "grades.grade": "B", "grades.score": { $gt: 20 } })
```

**Résultat : `4908`**

**(b) Requête correcte avec `$elemMatch`**

```js
db.restaurants.countDocuments({ grades: { $elemMatch: { grade: "B", score: { $gt: 20 } } } })
```

**Résultat : `4280`**

**(c) Pourquoi les deux nombres diffèrent**

Écart : **4908 − 4280 = 628** faux positifs (**14,7 %** de sur-comptage).

la requête naïve évalue les deux conditions **indépendamment sur l'ensemble du
tableau** (« il existe une note B » **et**, séparément, « il existe une note à plus de 20 »), alors
que `$elemMatch` exige qu'un **seul et même élément** satisfasse les deux conditions à la fois.


### Q18. Anomalies de qualité, et ce qu'elles coûtent

**(a) Scores négatifs**

```js
db.restaurants.countDocuments({ "grades.score": { $lt: 0 } })
```

**Résultat : `13`**

Le détail de ces notes :

```js
db.restaurants.aggregate([
  { $unwind: "$grades" },
  { $match: { "grades.score": { $lt: 0 } } },
  { $project: { _id: 0, name: 1, score: "$grades.score", grade: "$grades.grade" } }
])
```

```js
[
  { name: 'Cafe Bella Vita',                        score: -1, grade: 'B' },
  { name: 'Mercury Bar',                            score: -1, grade: 'B' },
  { name: "Vincent & Andre'S Pizzeria Restaurant",  score: -1, grade: 'B' },
  { name: 'Peace Food Cafe',                        score: -1, grade: 'B' },
  { name: 'Jane Street Hotel',                      score: -1, grade: 'B' },
  { name: 'The Bedford',                            score: -1, grade: 'C' },
  { name: "Goodfella'S",                            score: -1, grade: 'B' },
  { name: 'Maoz Vegetarian',                        score: -1, grade: 'B' },
  { name: 'Taste Of India',                         score: -1, grade: 'C' },
  { name: 'Delhi Heights',                          score: -1, grade: 'Z' },
  { name: 'Jade Garden',                            score: -1, grade: 'Z' },
  { name: 'Tonel Restaurant & Lounge',              score: -1, grade: 'B' },
  { name: 'Caffebene',                              score: -1, grade: 'B' }
]
```

Les 13 valent toutes exactement **−1**. Un score négatif **n'a aucun sens métier** : le score
d'inspection du DOHMH est un nombre de points de pénalité, donc positif ou nul (0 = aucune
infraction relevée). 


**(b) Impact chiffré sur la moyenne**

Moyenne **avec** les notes négatives :

```js
db.restaurants.aggregate([
  { $unwind: "$grades" },
  { $group: { _id: null, moy: { $avg: "$grades.score" }, nb: { $sum: 1 } } }
])
// [ { _id: null, moy: 11.434842161583735, nb: 93463 } ]
```

Moyenne **sans** les notes négatives :

```js
db.restaurants.aggregate([
  { $unwind: "$grades" },
  { $match: { "grades.score": { $gte: 0 } } },
  { $group: { _id: null, moy: { $avg: "$grades.score" }, nb: { $sum: 1 } } }
])
// [ { _id: null, moy: 11.436572235838051, nb: 93437 } ]
```

| Mesure | Valeur |
|---|---|
| Moyenne **avec** les scores négatifs | **11,434842161583735** |
| Moyenne **sans** les scores négatifs | **11,436572235838051** |
| Écart absolu | **+0,001730074** point |
| **Écart relatif** | **+0,0151 %** |


**(c) Faut-il nettoyer en urgence ?**

**Non, pas en urgence — mais oui, il faut corriger.** Mon argument est le chiffre lui-même :
supprimer ces 13 notes déplace la moyenne de **0,0151 %**, soit **11,4348 → 11,4366**. Sur un score
d'inspection publié à l'unité près, cet écart est **invisible** : il faudrait plus de 4 décimales pour
l'apercevoir. Ces 13 anomalies pèsent **0,0139 %** des 93 463 notes (13 / 93 463) et concernent
**13 restaurants sur 25 359**, soit **0,05 %** de la base.


### Q19. Le score le plus élevé de tout le jeu

```js
db.restaurants.find({}, { name: 1, "grades.score": 1, _id: 0 })
  .sort({ "grades.score": -1 })
  .limit(1)
```

```js
[
  {
    grades: [ { score: 11 }, { score: 131 }, { score: 11 }, { score: 25 }, { score: 11 }, { score: 13 } ],
    name: "Murals On 54/Randolphs'S"
  }
]
```

**Résultat : `Murals On 54/Randolphs'S`, score maximal `131`.**

Le tri décroissant sur un champ tableau classe les documents d'après la **valeur maximale** du
tableau : le document arrive donc en tête grâce à son `131`, même si ses autres notes sont basses
(11, 11, 13…). J'ai contrôlé le résultat par un pipeline d'agrégation, qui ne dépend pas de cette
subtilité de tri :

```js
db.restaurants.aggregate([
  { $unwind: "$grades" },
  { $sort: { "grades.score": -1 } },
  { $limit: 1 },
  { $project: { _id: 0, name: 1, score: "$grades.score" } }
])
// [ { name: "Murals On 54/Randolphs'S", score: 131 } ]
```

Les deux méthodes concordent. À titre de repère, 131 points face à une moyenne de 11,43 (Q18b),
c'est **11,5 fois** la moyenne.

---

## Partie 3 — Création & mise à jour

> À partir d'ici la base est modifiée. Je note chaque opération et son effet sur les effectifs
> pour pouvoir reconstituer le total final en Q27.

### Q20. CREATE — insertion de mon restaurant

```js
db.restaurants.insertOne({
  name: "Le Petit Bistrot AL",
  borough: "Montpellier",
  cuisine: "French",
  address: {
    building: "12",
    street: "Place de la Comedie",
    zipcode: "34000",
    coord: [3.8767, 43.6108]
  },
  grades: [
    { grade: "A", score: 7, date: new Date() }
  ],
  restaurant_id: "34000001"
})
```

Résultat :

```
acknowledged : true
insertedId : 6a8c3c62122f036267d16cb6
```

Vérification :

```js
db.restaurants.findOne({ name: "Le Petit Bistrot AL" })
```

```js
{
  _id: ObjectId('6a8c3c62122f036267d16cb6'),
  name: 'Le Petit Bistrot AL',
  borough: 'Montpellier',
  cuisine: 'French',
  address: {
    building: '12',
    street: 'Place de la Comedie',
    zipcode: '34000',
    coord: [ 3.8767, 43.6108 ]
  },
  grades: [ { grade: 'A', score: 7, date: ISODate('2026-08-24T12:43:14.068Z') } ],
  restaurant_id: '34000001'
}
```

> **Effet sur les effectifs : +1 document → total `25360`.**


### Q21. UPDATE ciblé — ajout d'une note avec `$push`

```js
db.restaurants.updateOne(
  { restaurant_id: "30075445" },
  { $push: { grades: { grade: "A", score: 3, date: new Date() } } }
)
```

Résultat :

```
notes avant     : 5
matchedCount    : 1
modifiedCount   : 1
notes après     : 6
```

### Q22. UPDATE de masse — champ `risque`

```js
db.restaurants.updateMany(
  { "grades.score": { $gt: 50 } },
  { $set: { risque: "eleve" } }
)
```

Résultat :

```
matchedCount  : 349
modifiedCount : 349
```

**Résultat : `matchedCount = 349`, `modifiedCount = 349`.**


### Q23. UPDATE conditionnel — champ `label_qualite`

```js
db.restaurants.updateMany(
  { cuisine: "French" },
  { $set: { label_qualite: true } }
)
```

Résultat :

```
matchedCount  : 345
modifiedCount : 345
```

**Résultat : `345` documents modifiés.**


---

## Partie 4 — Suppression & qualité de données

### Q24. Compter les documents `borough: "Missing"`

```js
db.restaurants.countDocuments({ borough: "Missing" })
```

**Résultat : `51`**

État de la collection juste avant suppression :

```js
db.restaurants.countDocuments({})        // 25360
db.restaurants.distinct("borough")
// [ 'Bronx', 'Brooklyn', 'Manhattan', 'Missing', 'Montpellier', 'Queens', 'Staten Island' ]
```


### Q25. Supprimer avec `deleteMany`

```js
db.restaurants.deleteMany({ borough: "Missing" })
```

Résultat :

```
deletedCount : 51
```

Re-comptage :

```js
db.restaurants.countDocuments({})
```

**Résultat : `25309` documents restants.**


### Q26. Décision de gouvernance

**(a) Poids des tableaux `grades` vides dans l'effectif actuel**

```js
db.restaurants.countDocuments({ grades: { $size: 0 } })   // 737
db.restaurants.countDocuments({})                          // 25309
```

`737 / 25309 = ` **`2,91 %`** de la collection.

> **Pourquoi 737 et non 738 ?** La Q14 en comptait **738** avant la suppression. Exactement **un**
> des 51 documents `borough: "Missing"` supprimés en Q25 avait aussi un tableau `grades` vide : il
> cumulait les deux anomalies. `738 − 1 = 737`. Ce genre de détail est précisément ce qui rend un
> comptage non reproductible si on ne le trace pas.

**(b) Pourquoi supprimer une anomalie et conserver l'autre**

Parce que l'une est **irrécupérable** et l'autre **simplement en attente** : un `borough: "Missing"`
a **perdu une information au moment de l'export** et rien dans le document ne permet de la
reconstituer de façon fiable, alors qu'un `grades: []` n'a **rien perdu du tout** — l'inspection
n'a simplement pas encore eu lieu ou pas encore été saisie, et la prochaine collecte la remplira.


---

## Partie 5 — Automatisation : script `.js` + export

### Q27. Le script `rapport.js`

Le script est livré à la racine du rendu (`rapport.js`). Exécution demandée :

```bash
docker exec -i mongo-ipssi mongosh -u admin -p ipssi2025 --authenticationDatabase admin nyc < rapport.js
```

Sortie obtenue :

```
======================================================
RAPPORT - Inspections d'hygiene NYC (base nyc.restaurants)
======================================================

[1] EFFECTIF TOTAL
    Nombre de restaurants : 25309

[2] TOP 5 DES CUISINES
    (85 types de cuisine distincts au total)
    1. American                6173   (24.4 %)
    2. Chinese                 2412   (9.5 %)
    3. Café/Coffee/Tea         1210   (4.8 %)
    4. Pizza                   1162   (4.6 %)
    5. Italian                 1069   (4.2 %)

[3] REPARTITION PAR ARRONDISSEMENT
    (6 arrondissements distincts)
    Manhattan              10259   (40.5 %)
    Brooklyn                6086   (24.0 %)
    Queens                  5656   (22.3 %)
    Bronx                   2338   (9.2 %)
    Staten Island            969   (3.8 %)
    Montpellier                1   (0.0 %)
    --------------------------------------
    TOTAL                  25309
    Controle de coherence : OK (somme = effectif total)


```


#### Écart du total par rapport à la Q1

Total Q1 : **25359**. Total du rapport : **25309**. **Écart : −50 documents.**

Reconstitution opération par opération :

| Étape | Opération | Effet | Effectif après |
|---|---|---|---|
| Q1 | État initial après `mongoimport` | — | **25 359** |
| Q20 | `insertOne` de mon restaurant | **+1** | 25 360 |
| Q21 | `updateOne` + `$push` (ajout d'une note) | 0 *(modifie un document, n'en crée aucun)* | 25 360 |
| Q22 | `updateMany` + `$set risque` sur 349 docs | 0 *(mise à jour, pas d'insertion)* | 25 360 |
| Q23 | `updateMany` + `$set label_qualite` sur 345 docs | 0 *(idem)* | 25 360 |
| Q25 | `deleteMany({ borough: "Missing" })` | **−51** | **25 309** |

Vérification : `25 359 + 1 − 51 = 25 309`  — soit un écart net de **−50**.

Seules deux questions font varier l'effectif : la **Q20** (+1) et la **Q25** (−51). Les Q21 à Q23
modifient le **contenu** de documents existants sans en créer ni en supprimer : c'est bien pour cela
que `updateMany` renvoie un `modifiedCount` et non un `insertedCount`.

#### La valeur d'arrondissement qui n'existait pas au départ

La liste des arrondissements en compte **6** au lieu des 5 arrondissements réels de New York :

```
Manhattan · Brooklyn · Queens · Bronx · Staten Island · Montpellier
```

**`Montpellier` (1 document)** provient de mon `insertOne` de la **Q20**. Il n'existait pas dans le
jeu importé.

À l'inverse, `Missing` — qui figurait bien dans le `distinct("borough")` avant la Q25 — a **disparu**
de la liste, ses 51 documents ayant été supprimés. La liste initiale comptait donc 6 valeurs
(5 arrondissements + `Missing`), elle en compte toujours 6, mais ce ne sont pas les mêmes :
`Missing` est sorti, `Montpellier` est entré.

C'est le contrôle de cohérence intégré au script (somme des arrondissements = effectif total) qui
garantit qu'aucun document n'échappe au comptage.

### Q28. Export de l'arrondissement Staten Island

```bash
docker exec mongo-ipssi mongoexport \
  --username admin --password ipssi2025 --authenticationDatabase admin \
  --db nyc --collection restaurants \
  --queryFile /tmp/query.json \
  --out /tmp/staten_island.json
```

avec `query.json` (copié dans le conteneur via `docker cp`) :

```json
{ "borough": "Staten Island" }
```

Résultat :

```
connected to: mongodb://localhost/
exported 969 records
```

---

## Partie 6 — Réflexion : relier la pratique au cours

### R1. Les 5 V, chiffrés

**Volume :** La base contient **25 359 restaurants** (Q1) et **93 463 notes d’inspection** (Q18b). Même si le volume actuel reste raisonnable, la croissance continue des inspections justifie une solution capable de monter en charge.

**Variété :** Il existe **85 cuisines différentes** (Q2). Les documents contiennent aussi des champs simples, des sous-documents (`address`) et des tableaux (`grades`), ce qui montre la variété des données.

**Véracité :** **13 restaurants** ont au moins un score négatif (Q18a). La moyenne passe de **11,434842 à 11,436572**, soit **+0,0151 %** (Q18b). On trouve également **51 boroughs `"Missing"`** (Q24) et **738 tableaux `grades` vides** (Q14).

**Valeur :** **220 restaurants** ont actuellement une première note C (Q13b), contre **2 708** ayant déjà eu un C (Q13a). Ces résultats permettent au service de cibler les restaurants nécessitant une nouvelle inspection.

### R2. CAP & BASE

MongoDB privilégie la **cohérence (CP)** en cas de partition réseau.

Prenons le restaurant **Morris Park Bake Shop** de la Q11. S'il vient d'être fermé pour insalubrité, un système privilégiant la **cohérence (C)** peut devenir temporairement indisponible plutôt que d'afficher une information ancienne. L'usager voit alors une erreur, mais aucune information fausse.

Avec la **disponibilité (A)**, l'application pourrait afficher une ancienne information, par exemple une note A, alors que le restaurant vient d'être fermé. En santé publique, ce risque est trop important.

Je privilégie donc **C** : j'accepte une **indisponibilité temporaire** plutôt qu'une information incorrecte pouvant avoir des conséquences sanitaires et juridiques.

### R3. Embarqué vs référencé — le calcul

**(a) Taille d'une note.** Je mesure sur le restaurant de la Q21, dont je connais exactement le
nombre de notes après mon `$push` — **6 notes** :

```js
var doc = db.restaurants.findOne({ restaurant_id: "30075445" });
bsonsize(doc);                    // 524 octets  (document complet)
bsonsize({ grades: doc.grades }); // 294 octets  (le seul tableau grades)
bsonsize(doc.grades[0]);          //  43 octets  (une note isolée)
```

> Note : dans `mongosh` la fonction s'appelle **`bsonsize()`** ; `Object.bsonsize()` mentionné dans
> l'énoncé était la syntaxe de l'ancien shell `mongo`, et lève un `TypeError: Object.bsonsize is not
> a function` sur MongoDB 7.

Décomposition :

| Élément | Taille |
|---|---|
| Document complet (6 notes) | **524 octets** |
| Tableau `grades` seul | **294 octets** |
| **Coût moyen par note** (294 / 6) | **≈ 49 octets** |
| Socle du document hors `grades` | **230 octets** |

Une note isolée pèse 43 octets ; le surcoût à 49 correspond à l'indexation du tableau BSON (chaque
élément est préfixé par sa clé `"0"`, `"1"`, …). Je retiens **49 octets** comme coût réel d'une note
embarquée. Ordre de grandeur cohérent avec la moyenne de la collection : **`avgObjSize = 419
octets`** (`db.restaurants.stats()`), pour une médiane de 3,7 notes par restaurant (93 463 notes /
25 309 documents).

Rappel de la **Q15** : **3 864** restaurants (**15,2 %** de la base) ont déjà au moins 6 notes —
**3 865** après mon `$push` de la Q21. L'accumulation n'est donc pas un cas théorique.

**(b) Projection à 520 notes (1 inspection/semaine pendant 10 ans).**

```
taille ≈ socle + 520 × 49
       ≈ 230 + 25 480
       ≈ 25 710 octets  ≈ 25,1 Ko
```

| | Valeur |
|---|---|
| Document à 520 notes | **≈ 25 710 octets (25,1 Ko)** |
| Limite BSON | **16 Mo** |
| Notes pour atteindre 16 Mo | **≈ 342 000** |

Le modèle embarqué tient donc largement dans la limite BSON. À 520 notes, le document ne fait que **25,1 Ko**.

**(c) Avantage, limite et seuil de bascule.**

*Avantage :* toutes les informations sont dans un **seul document**, sans jointure. Le `$push` de la Q21 permet aussi une mise à jour atomique.

*Limite :* le document grossit à chaque inspection et devient coûteux à modifier s'il devient très volumineux. Le modèle embarqué est donc moins adapté à un tableau **non borné**.


---



### B1. Index sur `cuisine` et plan d'exécution

État initial — un seul index, celui sur `_id` :

```js
db.restaurants.getIndexes()
// [ { v: 2, key: { _id: 1 }, name: '_id_' } ]
```

**Avant création de l'index :**

```js
db.restaurants.find({ cuisine: "French" }).explain("executionStats")
```

```
stage               : COLLSCAN
nReturned           : 345
totalKeysExamined   : 0
totalDocsExamined   : 25309
executionTimeMillis : 23
```

**Création de l'index :**

```js
db.restaurants.createIndex({ cuisine: 1 })
// cuisine_1
```

**Après création de l'index :**

```
stage               : IXSCAN
nReturned           : 345
totalKeysExamined   : 345
totalDocsExamined   : 345
executionTimeMillis : 14
```

**Synthèse :**

| Métrique | Avant | Après | Gain |
|---|---|---|---|
| `stage` | **COLLSCAN** | **IXSCAN** | — |
| `totalDocsExamined` | **25 309** | **345** | **÷ 73,4** |
| `totalKeysExamined` | 0 | 345 | — |
| `nReturned` | 345 | 345 | identique ✔ |
| `executionTimeMillis` | 23 | 14 | −39 % |

Le stage passe bien de **`COLLSCAN`** (balayage intégral de la collection) à **`IXSCAN`** (parcours
de l'index). `totalDocsExamined` chute de **25 309 à 345** : le moteur n'examine plus que les
documents effectivement retournés, soit un **ratio d'efficacité de 1,0** (345 examinés pour 345
renvoyés) contre **0,0136** auparavant. C'est le critère à surveiller — plus que le temps d'exécution,
qui reste bruité sur un jeu de cette taille tenant entièrement en cache.

`totalKeysExamined` passe de 0 à 345 : le coût s'est déplacé du parcours de documents vers le
parcours de clés d'index, bien plus léger. À noter que le gain en temps (−39 %) est bien moins
spectaculaire que le gain en documents examinés (÷73) : sur 25 000 documents en mémoire un
`COLLSCAN` reste rapide. L'écart deviendrait décisif sur plusieurs millions de documents ne tenant
plus en RAM.

### B2. Index géospatial `2dsphere` et recherche `$near`

```js
db.restaurants.createIndex({ "address.coord": "2dsphere" })
// address.coord_2dsphere
```

Recherche des restaurants à moins de **500 m** de Times Square (`[-73.9855, 40.7580]`) :

```js
db.restaurants.find({
  "address.coord": {
    $near: {
      $geometry: { type: "Point", coordinates: [-73.9855, 40.7580] },
      $maxDistance: 500
    }
  }
}).itcount()
```

**Résultat : `547` restaurants dans un rayon de 500 m.**



Les 5 plus proches, avec leur distance exacte via `$geoNear` :

```js
db.restaurants.aggregate([
  { $geoNear: {
      near: { type: "Point", coordinates: [-73.9855, 40.7580] },
      distanceField: "distance_m",
      maxDistance: 500,
      spherical: true
  }},
  { $limit: 5 },
  { $project: { _id: 0, name: 1, cuisine: 1, distance_m: { $round: ["$distance_m", 1] } } }
])
```

```js
[
  { cuisine: 'American', name: 'Cbre-1540',            distance_m: 40.4 },
  { cuisine: 'American', name: 'Planet Hollywood',     distance_m: 40.4 },
  { cuisine: 'Italian',  name: 'Buca Di Beppo',        distance_m: 40.4 },
  { cuisine: 'American', name: 'Minskoff Theater',     distance_m: 46.5 },
  { cuisine: 'American', name: "Junior'S Restaurant",  distance_m: 48.4 }
]
```

Les trois premiers sont à une distance **rigoureusement identique** (40,4 m) : ils partagent la même
adresse `Broadway` et donc les mêmes coordonnées — plusieurs établissements dans un même immeuble.
Le géocodage est fait au bâtiment, pas au local.

---

