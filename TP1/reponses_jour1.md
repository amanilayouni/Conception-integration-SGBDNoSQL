# TP Jour 1 — Introduction au NoSQL & MongoDB


**Environnement :** Docker Compose (`mongo:7.0` + `mongo-express`), base `nyc`, collection `restaurants`

---

## Partie 0 — Mise en place de l'environnement

### 0.1 Lancer l'infrastructure

```bash
docker compose up -d
docker compose ps
```

Résultat :

```
NAME                  IMAGE                  SERVICE         STATUS          PORTS
mongo-express-ipssi   mongo-express:latest   mongo-express   Up 54 minutes   0.0.0.0:8081->8081/tcp
mongo-ipssi           mongo:7.0              mongo           Up 20 minutes   0.0.0.0:27018->27017/tcp
```

Les deux conteneurs sont bien *running*.

> **Écart assumé par rapport à l'énoncé — le port hôte.**
> L'énoncé publie MongoDB sur `27017`. Sur mon poste, un service MongoDB local écoutait déjà sur
> `127.0.0.1:27017`. Docker ne pouvait donc réserver que le wildcard IPv6, et toute connexion vers
> `localhost:27017` était résolue en `127.0.0.1` → elle atteignait le MongoDB **local**, pas le conteneur.
> Symptôme : `Authentication failed` dans Compass, alors que les identifiants étaient corrects.
> J'ai diagnostiqué avec :
>
> ```powershell
> Get-NetTCPConnection -LocalPort 27017 | Select-Object LocalAddress, State, OwningProcess
> Get-Service | Where-Object { $_.Name -like '*mongo*' }   # -> service "MongoDB" Running
> ```
>
> J'ai donc publié le conteneur sur `27018:27017`. Le port **interne** reste `27017`,
> donc toutes les commandes `docker exec` de l'énoncé fonctionnent sans modification.

### 0.2 Récupérer le jeu de données

```bash
curl -L -o primer-dataset.json \
  https://raw.githubusercontent.com/mongodb/docs-assets/primer-dataset/primer-dataset.json
wc -l primer-dataset.json
```

Sous PowerShell, `curl` est un alias d'`Invoke-WebRequest` (qui n'accepte pas `-L`) et `wc` n'existe pas.
J'ai utilisé les équivalents suivants :

```powershell
curl.exe -L -o primer-dataset.json https://raw.githubusercontent.com/mongodb/docs-assets/primer-dataset/primer-dataset.json
python -c "print(sum(1 for line in open('primer-dataset.json') if line.strip()))"
```

Résultat : **25359** lignes — conforme à l'attendu. Le fichier est du **JSON Lines** (un document par
ligne), et non un tableau JSON : `json.load()` échoue dessus avec `Extra data: line 2 column 1`.
C'est précisément le format attendu par `mongoimport`.

### 0.3 Importer dans MongoDB

```bash
docker cp primer-dataset.json mongo-ipssi:/tmp/primer-dataset.json
docker exec mongo-ipssi mongoimport \
  --username admin --password ipssi2025 --authenticationDatabase admin \
  --db nyc --collection restaurants --drop --file /tmp/primer-dataset.json
```

Résultat :

```
connected to: mongodb://localhost/
dropping: `nyc.restaurants`
25359 document(s) imported successfully. 0 document(s) failed to import.
```

### 0.4 Se connecter — les deux clients

```bash
# Shell
docker exec -it mongo-ipssi mongosh -u admin -p ipssi2025 --authenticationDatabase admin

# Interface graphique : http://localhost:8081  (mongo-express, admin / ipssi2025)
# Compass (port hôte adapté) : mongodb://admin:ipssi2025@localhost:27018/?authSource=admin
```

### Point de contrôle P0

```js
use nyc
db.restaurants.countDocuments({})
```

Résultat : **25359** ✔

Structure d'un document (`db.restaurants.findOne()`) :

```js
{
  _id: ObjectId('6a8c3b5998f7dc2fdc026df9'),
  address: {                          // sous-document
    building: '2206',
    coord: [ -74.1377286, 40.6119572 ],   // tableau [longitude, latitude]
    street: 'Victory Boulevard',
    zipcode: '10314'                   // string, pas un nombre
  },
  borough: 'Staten Island',
  cuisine: 'Jewish/Kosher',
  grades: [                            // tableau de sous-documents
    { date: ISODate('2014-10-06T00:00:00.000Z'), grade: 'A', score: 9 },
    { date: ISODate('2014-05-20T00:00:00.000Z'), grade: 'A', score: 12 },
    { date: ISODate('2013-04-04T00:00:00.000Z'), grade: 'A', score: 12 },
    { date: ISODate('2012-01-24T00:00:00.000Z'), grade: 'A', score: 9 }
  ],
  name: 'Kosher Island',
  restaurant_id: '40356442'
}
```

Deux observations que je réutilise plus loin :

- `address.zipcode` est une **chaîne** : il faudra filtrer avec `"10462"` et non `10462` (Q10).
- `coord` est au format `[longitude, latitude]`, l'ordre GeoJSON (utile pour le bonus B2).

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

Détail par cuisine (contrôle de cohérence) : Japanese 758 + Korean 262 + Thai 285 + Indian 316 = **1623** ✔

### Q9. Le champ de recherche qui ment

**(a) Recherche sensible à la casse**

```js
db.restaurants.countDocuments({ name: /BBQ/ })
```

**Résultat : `0`**

Zéro résultat, alors qu'un usager qui tape « BBQ » s'attend évidemment à en trouver.

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

Autrement dit : en (c) le drapeau `i` **répare une casse erronée** ; en (d) il **élargit la
recherche à des sous-chaînes** de mots différents. Le second cas n'est d'ailleurs pas forcément
souhaitable : un usager qui cherche « House » veut-il vraiment *Firehouse* ? C'est une question de
produit, pas de technique.

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
Sa limite est qu'il fonctionne par **mot entier** : il trouverait `Bbq` mais pas `house` dans
`Steakhouse`. Si la recherche partielle en cours de mot est un vrai besoin produit, il faudra soit
un index n-gram maintenu applicativement, soit un moteur dédié type Atlas Search / Elasticsearch.
Je construirai cette solution au Jour 2.

### Q10. Code postal "10462" (dot-notation)

```js
db.restaurants.countDocuments({ "address.zipcode": "10462" })
```

**Résultat : `150`**

`zipcode` étant stocké en chaîne, la valeur doit être passée entre guillemets ; avec `10462`
(numérique) la requête renvoie `0`.

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

La dot-notation sur un tableau applique le prédicat à **chaque** élément : le document remonte dès
qu'**au moins un** `grades[i].score` dépasse 50.

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

Conclusion :

| Requête | Ce qu'elle mesure réellement | Effectif |
|---|---|---|
| (a) `"grades.grade": "C"` | « a **déjà eu** un C au moins une fois dans son historique » | 2708 |
| (b) `"grades.0.grade": "C"` | « est **actuellement** noté C (dernière inspection) » | 220 |

C'est la requête **(b)** qui répond à « restaurants actuellement mal notés », et c'est donc **220**
que je publierais. Publier 2708 en réponse à la question du journaliste reviendrait à qualifier de
« mal notés » des établissements qui ont eu un C il y a quatre ans et sont notés A aujourd'hui —
c'est exactement le cas de `Mcdonald'S` à l'envers, et c'est un risque juridique autant
qu'une faute méthodologique.

> **Réserve importante.** Cette lecture repose sur une **convention d'ordre du tableau**, pas sur une
> contrainte du moteur : rien dans MongoDB ne garantit que `grades[0]` reste la note la plus récente.
> Un simple `$push` (comme celui de la Q21) ajoute **en fin** de tableau et casse cette convention.
> Une requête robuste devrait trier explicitement sur `grades.date` via un pipeline d'agrégation
> plutôt que se fier à l'index positionnel.

### Q14. Tableaux `grades` vides

```js
db.restaurants.countDocuments({ grades: { $size: 0 } })
```

**Résultat : `738`**

Une inspection peut produire un tableau vide dans plusieurs cas de figure métier : l'établissement
est **enregistré mais pas encore inspecté** (nouvelle ouverture, changement de propriétaire) ; il a
été **fermé ou a déménagé** avant le passage de l'inspecteur ; ou l'inspection a bien eu lieu mais
n'a pas encore été **saisie / validée** dans le système au moment de l'export. Le champ existe donc
structurellement mais n'a pas encore de contenu — ce n'est pas une corruption, c'est un cycle de vie.

### Q15. Au moins 6 notes (index positionnel + `$exists`)

```js
db.restaurants.countDocuments({ "grades.5": { $exists: true } })
```

**Résultat : `3864`**

`grades.5` est le 6ᵉ élément (indices à partir de 0) : tester son existence revient à demander
`length >= 6`, sans avoir à parcourir le tableau.

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

En une phrase : la requête naïve évalue les deux conditions **indépendamment sur l'ensemble du
tableau** (« il existe une note B » **et**, séparément, « il existe une note à plus de 20 »), alors
que `$elemMatch` exige qu'un **seul et même élément** satisfasse les deux conditions à la fois.

J'ai isolé un contre-exemple pour le vérifier :

```js
db.restaurants.findOne({
  "grades.grade": "B",
  "grades.score": { $gt: 20 },
  grades: { $not: { $elemMatch: { grade: "B", score: { $gt: 20 } } } }
}, { name: 1, grades: 1, _id: 0 })
```

```
name : King Yum Restaurant
  grades[0] : grade=B  score=14
  grades[1] : grade=A  score=13
  grades[2] : grade=A  score=10
  grades[3] : grade=A  score=13
  grades[4] : grade=P  score=2
  grades[5] : grade=C  score=36
```

Ce restaurant remonte dans la requête naïve parce qu'il a bien un grade `B` (indice 0) **et** bien un
score > 20 (indice 5, score 36) — mais **jamais sur la même inspection** : son unique note B est à
14, et sa note à 36 est un C. Il n'a donc jamais eu de « B sévère ».

C'est **4280**, le résultat de `$elemMatch`, qui répond à la question métier.

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
infraction relevée). Le fait qu'elles valent toutes `-1` et jamais `-7` ou `-23` est révélateur :
il ne s'agit pas d'une erreur de calcul mais très probablement d'une **valeur sentinelle** utilisée
par le système source pour signifier « non renseigné », transmise brute par l'export au lieu d'être
convertie en `null`.

Cette hypothèse est renforcée par deux autres anomalies que j'ai relevées en passant :

```js
db.restaurants.distinct("grades.grade")
// [ 'A', 'B', 'C', 'Not Yet Graded', 'P', 'Z' ]
```

Le champ `grade` contient des lettres hors barème A/B/C — `P`, `Z`, et la chaîne libre
`Not Yet Graded` — ce qui confirme que ce champ mélange une **note** et un **statut administratif**.

```js
db.restaurants.aggregate([
  { $unwind: "$grades" },
  { $match: { "grades.score": null } },
  { $count: "n" }
])
// [ { n: 13 } ]
```

13 notes supplémentaires portent `score: null` (toutes en `Not Yet Graded`).

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

> **Précision sur le compte de notes.** Le pipeline filtré retourne 93 437 notes, soit **26** de moins
> que les 93 463 initiales, alors que je n'ai identifié que **13** scores négatifs. La différence vient
> de ce que `$gte: 0` exclut aussi les 13 notes à `score: null`. En filtrant strictement les seules
> négatives (`{ $not: { $lt: 0 } }`) on obtient bien **93 450 = 93 463 − 13**, pour une moyenne
> rigoureusement identique — `$avg` ignorant nativement les `null`. J'ai vérifié ce point plutôt que
> de laisser passer un écart de 13 non expliqué.

**(c) Faut-il nettoyer en urgence ?**

**Non, pas en urgence — mais oui, il faut corriger.** Mon argument est le chiffre lui-même :
supprimer ces 13 notes déplace la moyenne de **0,0151 %**, soit **11,4348 → 11,4366**. Sur un score
d'inspection publié à l'unité près, cet écart est **invisible** : il faudrait plus de 4 décimales pour
l'apercevoir. Ces 13 anomalies pèsent **0,0139 %** des 93 463 notes (13 / 93 463) et concernent
**13 restaurants sur 25 359**, soit **0,05 %** de la base.

Mobiliser une astreinte pour un biais de 0,015 % serait disproportionné. En revanche, deux nuances
me font refuser de classer le sujet :

1. **La moyenne globale est l'indicateur le moins sensible qui soit.** Sur une fiche individuelle,
   afficher « score : −1 » à un usager est une anomalie visible à 100 %, pas à 0,015 %. Le risque est
   sur l'affichage unitaire, pas sur l'agrégat.
2. **Une valeur sentinelle non documentée est une dette qui se propage.** Tant que `-1` signifie
   « non renseigné » sans être déclaré comme tel, chaque nouveau calcul en aval réintroduira le biais.

Ma recommandation : pas de correctif à chaud, mais une **règle de validation à l'ingestion**
(`$jsonSchema` avec `score >= 0`, mapping explicite `-1 → null`) au prochain cycle, et un filtre
défensif immédiat côté affichage des fiches.

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

Deux remarques :

- Le schéma flexible de MongoDB a accepté sans broncher `borough: "Montpellier"`, qui n'est pas un
  arrondissement de New York. Aucune contrainte d'intégrité ne s'y oppose — c'est la contrepartie
  directe du *schemaless* : la validation métier doit être portée par l'applicatif ou déclarée
  explicitement via `$jsonSchema`.
- `new Date()` produit une **`ISODate` BSON**, pas une chaîne : c'est un type que JSON ne connaît
  pas nativement et que BSON apporte.

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

Dernière note ajoutée :

```js
{ grade: 'A', score: 3, date: ISODate('2026-08-24T12:43:14.132Z') }
```

**Résultat : ce restaurant (`Morris Park Bake Shop`) a désormais `6` notes.**

> **Effet de bord à signaler.** `$push` ajoute **en fin** de tableau. Or on a établi en Q13c que
> `grades[0]` est la note la **plus récente**. Ma note du jour, la plus récente de toutes, se retrouve
> donc en **dernière** position : le tableau n'est plus trié par date décroissante et la convention
> exploitée en Q13b/Q16 est cassée pour ce document. La bonne opération aurait été
> `$push: { grades: { $each: [nouvelleNote], $position: 0 } }`. C'est l'illustration concrète de la
> réserve que je formulais en Q13c : un ordre de tableau n'est pas une garantie du moteur.
>
> Conséquence mesurable : la Q15 (`grades.5` existe) passe de **3864** à **3865**, ce restaurant
> venant de franchir le seuil des 6 notes.

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

Contrôle : `db.restaurants.countDocuments({ risque: "eleve" })` → **349** ✔

Les deux compteurs sont ici égaux car aucun de ces documents ne possédait déjà le champ `risque`.
Ils auraient divergé si le champ avait déjà porté la valeur `"eleve"` : `matchedCount` compte les
documents **sélectionnés par le filtre**, `modifiedCount` ceux **réellement écrits**. Rejouer la même
commande une seconde fois donnerait d'ailleurs `matched: 349, modified: 0` — l'opération est
idempotente.

On retrouve bien les 349 restaurants de la Q12 : mon restaurant (score 7) n'est pas concerné.

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

> **Attention à la cohérence avec la Q4.** La Q4 comptait **344** restaurants French. On en modifie
> **345**, parce que mon restaurant inséré en Q20 est lui aussi `cuisine: "French"`.
> `344 + 1 = 345`. Vérification :
>
> ```js
> db.restaurants.countDocuments({ label_qualite: true, borough: "Montpellier" })  // 1
> ```

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

À noter : `"Missing"` est une **chaîne littérale**, pas une absence de champ. Une requête
`{ borough: { $exists: false } }` n'aurait rien retourné. L'export a donc encodé l'inconnu par un
marqueur textuel — même logique de valeur sentinelle que le `-1` de la Q18.

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

Contrôle : `db.restaurants.countDocuments({ borough: "Missing" })` → **0** ✔

Vérification arithmétique : `25360 − 51 = 25309` ✔

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

Pour être précise, la distinction tient en trois points :

| | `borough: "Missing"` (51) | `grades: []` (737) |
|---|---|---|
| Nature | Donnée **perdue** à l'export | Donnée **pas encore produite** |
| Réversibilité | Irrécupérable en l'état | Se remplira à la prochaine inspection |
| Conséquence si conservé | Fausse toute analyse géographique | Aucune : un `$size: 0` s'exclut proprement |

Un document sans arrondissement est inexploitable pour le cœur de métier du service — cartographie,
répartition par district, affectation des inspecteurs — et il pollue silencieusement tout `group by
borough`. Un document sans note, lui, reste parfaitement valide : il porte un nom, une adresse, une
cuisine, et il **doit** rester visible, car un établissement non encore inspecté est une information
utile pour l'usager comme pour le planning des inspections. Le supprimer reviendrait à effacer
2,91 % du parc de restaurants de la ville pour un motif purement technique.

Nuance que j'apporte tout de même à ma propre décision : les 51 documents supprimés conservaient un
`address.zipcode` exploitable, et un code postal détermine l'arrondissement à New York. Une
reconstruction par table de correspondance zipcode → borough aurait donc été envisageable. J'ai suivi
la consigne de l'énoncé (suppression), mais en production j'aurais proposé cet enrichissement avant
d'acter la perte de 51 établissements.

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
Genere le : 2026-08-24T12:48:03.601Z
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

======================================================
Fin du rapport.
======================================================
```

> **Détail d'implémentation.** En mode redirection stdin (`< rapport.js`), `mongosh` se comporte comme
> un REPL : il affiche la valeur de retour de **chaque** instruction. Mes premières versions
> polluaient donc la sortie avec le `Map(85)` complet et le tableau des arrondissements bruts, avant
> même le rapport formaté. J'ai encapsulé tout le corps du script dans une **fonction auto-invoquée
> (IIFE)**, qui ne renvoie rien : la sortie est propre. Les invites `nyc>` intercalées restent
> inhérentes au mode stdin ; l'exécution via `--file /tmp/rapport.js` produit exactement la même
> sortie sans ces invites.

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

Vérification : `25 359 + 1 − 51 = 25 309` ✔ — soit un écart net de **−50**.

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

Récupération du fichier sur le poste et comptage des lignes :

```powershell
docker cp mongo-ipssi:/tmp/staten_island.json staten_island.json
python -c "print(sum(1 for l in open('staten_island.json', encoding='utf-8') if l.strip()))"
```

**Résultat : l'export contient `969` lignes** (467 348 octets), une ligne par document — le format de
sortie par défaut de `mongoexport` est du **JSON Lines**, comme le fichier source d'origine.

Ce chiffre est cohérent avec la répartition du rapport Q27 : Staten Island = **969** ✔

> **Sur l'usage de `--queryFile` plutôt que `--query`.** L'option `--query` attend du JSON avec des
> guillemets doubles, que PowerShell ré-interprète avant de transmettre l'argument. J'ai obtenu
> successivement `provide only one MongoDB connection string`, `invalid argument for flag -q` puis
> `query '[123 98 111 ...]' is not valid JSON` selon les échappements tentés. Passer la requête par
> un **fichier** supprime entièrement le problème de *quoting* et rend la commande reproductible
> à l'identique quel que soit le shell — c'est la solution que j'ai retenue.

Un extrait de la première ligne, pour montrer l'`_id` en **JSON étendu** (`$oid`), puisque JSON ne
sait pas représenter un `ObjectId` BSON :

```json
{"_id":{"$oid":"6a8c3b5998f7dc2fdc026df9"},"address":{"building":"2206","coord":[-74.1377286,40.6119572],"street":"Victory Boulevard","zipcode":"10314"},"borough":"Staten Island","cuisine":"Jewish/Kosher", ...}
```

---

## Partie 6 — Réflexion : relier la pratique au cours

### R1. Les 5 V, chiffrés

**Volume.** La collection compte **25 359 documents** (Q1) pour **10,6 Mo** de données et **93 463
notes d'inspection** après `$unwind` (Q18b), soit une moyenne de **419 octets** par document. À
l'échelle d'un seul arrondissement le relationnel tiendrait sans peine ; ce qui change la donne,
c'est que ce jeu n'est qu'un **export figé d'une seule ville** : le vrai flux DOHMH s'incrémente en
continu depuis des années. C'est la **croissance** attendue, pas la taille actuelle, qui justifie une
architecture à scalabilité horizontale.

**Variété.** Le champ `cuisine` porte **85 valeurs distinctes** (Q2), et surtout des valeurs qui ne
sont pas du même ordre : à côté de `French` ou `Italian` on trouve
`Bottled beverages, including water, sodas, juices, etc.` (72 documents) ou
`Not Listed/Not Applicable` (19). Plus révélateur encore, `grades.grade` mélange des notes A/B/C
avec des **statuts administratifs** (`P`, `Z`, `Not Yet Graded`, relevé en Q18a) : un même champ
porte deux natures d'information différentes. Un schéma relationnel strict aurait imposé un `ENUM`
et rejeté ces lignes à l'insertion — le modèle document les a acceptées, ce qui est à la fois
l'avantage (rien n'est perdu à l'ingestion) et le risque (rien n'est validé non plus).

**Véracité.** C'est le V le mieux documenté par ce TP. **13 documents** portent au moins une note à
score négatif (Q18a), toutes exactement à `-1`, ce qui déplace le score moyen de **11,434842 à
11,436572**, soit **+0,0151 %** (Q18b). J'y ajoute **13 notes** à `score: null` (Q18a), **51
arrondissements** encodés `"Missing"` (Q24) et **738 tableaux `grades` vides** (Q14), soit **2,91 %**
de la collection après nettoyage (Q26a). Aucune de ces anomalies n'est détectable « à l'œil » sur un
`findOne()` : il a fallu les **interroger** pour les faire apparaître. L'écart de 0,0151 % montre
d'ailleurs que véracité n'est pas synonyme d'impact — c'est justement pour cela qu'il faut la mesurer
plutôt que la supposer.

**Valeur.** Le TP produit deux chiffres directement actionnables par le service. D'une part, **220
restaurants** sont **actuellement** notés C (Q13b) — contre 2 708 qui l'ont été un jour (Q13a) : c'est
la liste de 220 qui permet de cibler des ré-inspections, la liste de 2 708 n'aurait aucune valeur
opérationnelle et exposerait le service à un contentieux. D'autre part, **349 restaurants** ont été
marqués `risque: "eleve"` (Q22), soit **1,4 %** du parc, ce qui dimensionne une campagne d'inspection
prioritaire réaliste. Le V de Valeur se joue ici entièrement dans le **choix de la bonne requête** :
220 et 2 708 décrivent la même base, mais une seule des deux réponses est exploitable.

### R2. CAP & BASE appliqué à ce service

MongoDB est **CP** par défaut : en cas de partition réseau, un replica set qui perd le quorum
sacrifie la disponibilité en écriture pour préserver la cohérence — le primaire se démet et aucune
écriture n'est acceptée tant que la majorité n'est pas rétablie.

**Le scénario.** Le restaurant de la Q11, **`Morris Park Bake Shop`** (`restaurant_id: "30075445"`),
vient d'être **fermé pour insalubrité** ce matin. Un inspecteur enregistre la fermeture, ce qui écrit
une nouvelle note dans son tableau `grades` — celui-là même que j'ai fait passer de 5 à 6 entrées en
Q21. Dans l'heure qui suit, une partition réseau isole le nœud secondaire qui sert les lectures de
l'application publique. Un usager consulte la fiche depuis son téléphone, devant la porte du
commerce.

**(a) Si l'on a privilégié C.** L'application lit avec `readConcern: "majority"` sur le nœud isolé :
celui-ci ne peut pas confirmer que sa copie reflète la dernière écriture majoritaire, donc il
**refuse de répondre**. L'usager voit un message d'erreur ou un écran de chargement, puis un
« service temporairement indisponible ». Il n'apprend rien — mais il n'apprend **rien de faux**. Il
ira probablement vérifier ailleurs, ou constatera par lui-même que le commerce est fermé.

**(b) Si l'on a privilégié A.** Le nœud isolé répond immédiatement avec sa copie **périmée** : la
fiche affiche les 6 notes d'avant la fermeture, dont un `grade: "A"` récent (Q21, score 3). L'usager
lit **« Morris Park Bake Shop — Note A »** devant un établissement qui vient d'être fermé pour
insalubrité. Le service public certifie activement une information fausse, avec un risque sanitaire
direct et un risque juridique pour la municipalité.

**Je tranche pour C.** En santé publique, l'asymétrie des dommages est totale : une indisponibilité
temporaire est un **inconfort réversible** — l'usager réessaie dans dix minutes — alors qu'un « A »
affiché sur un restaurant insalubre est un **dommage irréversible** qui engage la responsabilité du
service et peut avoir des conséquences sanitaires réelles. Un système qui se tait est frustrant ; un
système qui ment est dangereux.

**Le dommage que j'accepte en tranchant**, et il faut le nommer : une **perte de disponibilité**
pendant la partition, donc des usagers qui n'obtiennent aucune réponse — y compris pour les
**25 308 autres restaurants** (Q25) dont la fiche était pourtant parfaitement à jour. Je sacrifie la
consultation de toute la base pour garantir l'exactitude d'une fiche sur 25 309. C'est un prix élevé,
et il n'est acceptable que parce que le domaine est sanitaire.

Nuance de mise en œuvre : ce compromis n'est heureusement pas binaire en pratique. On peut le
moduler **par type de lecture** — `readConcern: "majority"` sur la fiche détaillée d'un
établissement (là où la fraîcheur engage la responsabilité) et `"local"` sur la recherche par
quartier ou les statistiques agrégées, où lire des données vieilles de trente secondes est sans
conséquence. C'est l'esprit de **BASE** : plutôt qu'une cohérence forte uniforme et coûteuse, une
cohérence *à terme* acceptée là où le métier la tolère, et une cohérence forte réservée aux points
où elle a un vrai enjeu.

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
| Document projeté à 520 notes | **≈ 25 710 octets (25,1 Ko)** |
| **Limite BSON MongoDB** | **16 777 216 octets (16 Mo)** |
| Taux d'occupation de la limite | **0,1532 %** |
| Notes nécessaires pour saturer 16 Mo | **≈ 342 387** |

**Le modèle embarqué tient très largement.** À 25 Ko on occupe un millième et demi de la limite ; il
faudrait environ **342 000 notes**, soit **plus de 6 500 ans** d'inspections hebdomadaires, pour
atteindre 16 Mo. Le plafond BSON n'est absolument pas le facteur limitant dans ce scénario.

**(c) Avantage, limite, et seuil de bascule.**

*Avantage.* Toute l'information d'un restaurant tient dans un **seul document**, donc une seule
lecture disque et **aucune jointure** : la fiche complète s'obtient par un `findOne()`. C'est
exactement l'accès dont a besoin l'application publique. En relationnel il aurait fallu un `JOIN`
entre `restaurants` et `grades` sur chaque affichage. L'atomicité vient en prime : mon `$push` de la
Q21 a modifié le restaurant et ajouté sa note en **une seule opération atomique**, sans transaction.

*Limite.* Le vrai coût n'est pas le plafond des 16 Mo, c'est que **MongoDB relit et réécrit le
document entier** à chaque modification. Ajouter une note de 49 octets à un document de 25 Ko fait
transiter 25 Ko en écriture. S'y ajoutent la fragmentation liée à la croissance des documents, et le
fait qu'une requête ne portant que sur le nom d'un restaurant charge malgré tout tout son historique
en mémoire — d'où l'utilité de la projection. Le modèle embarqué est structurellement inadapté à un
tableau **non borné**.

*Seuil de bascule.* Je ne me fierais pas au plafond de 16 Mo, atteint bien trop tard. Mon critère :
je bascule vers un modèle **référencé** (collection `grades` séparée, avec un champ `restaurant_id`
indexé) dès que le document dépasse **~100 Ko**, soit environ **2 000 notes** — ou plus tôt encore si
le tableau n'a **aucune borne naturelle**. Pour ce cas précis, avec 3,7 notes en moyenne et 25 Ko
projetés à 10 ans, l'embarqué reste le bon choix. L'approche que je retiendrais en production est
**hybride** : embarquer les **10 dernières notes** dans le restaurant (le *pattern* « subset », qui
couvre l'affichage de la fiche sans jointure) et référencer l'historique complet dans une collection
dédiée pour les besoins analytiques.

---

## Pour aller plus loin (facultatif)

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

> **Piège rencontré.** `countDocuments()` échoue ici avec
> `$geoNear, $near, and $nearSphere are not allowed in this context`. La raison : `countDocuments()`
> n'est pas un simple compteur, il encapsule le filtre dans un `$match` d'agrégation — or `$near`
> y est interdit car il impose un tri géospatial que `$match` ne peut pas porter. J'ai donc utilisé
> **`itcount()`**, qui parcourt le curseur ; l'alternative propre en agrégation est l'étage
> **`$geoNear`**, qui doit être le **premier** du pipeline.

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

Deux points de méthode que ce bonus m'a permis de valider :

- Sans index `2dsphere`, la requête `$near` **échoue** — elle ne se contente pas d'être lente : cet
  index n'est pas une optimisation, c'est un **prérequis fonctionnel**.
- `coord` est stocké en `[longitude, latitude]`, l'ordre GeoJSON, **inverse** de la convention
  usuelle « latitude, longitude ». Interverti, on cherche au large de l'Antarctique. Cet ordre était
  visible dès le `findOne()` du point de contrôle P0 (`[-74.13, 40.61]` : la longitude de New York
  est négative, la latitude positive).

État final des index :

```js
db.restaurants.getIndexes()
```

```js
[
  { v: 2, key: { _id: 1 },                    name: '_id_' },
  { v: 2, key: { cuisine: 1 },                name: 'cuisine_1' },
  { v: 2, key: { 'address.coord': '2dsphere' }, name: 'address.coord_2dsphere',
    '2dsphereIndexVersion': 3 }
]
```

---

## Récapitulatif des résultats

| Question | Réponse |
|---|---|
| P0 | 25 359 |
| Q1 | 25 359 |
| Q2 | 85 |
| Q3 | 6 086 |
| Q4 | 344 |
| Q5 | 621 |
| Q6 | 323 |
| Q7 | 421 |
| Q8 | 1 623 |
| Q9a / Q9b | 0 / 73 (écart 73) |
| Q9d | 387 / 503 (écart 116) |
| Q10 | 150 |
| Q11 | Morris Park Bake Shop |
| Q12 | 349 |
| Q13a / Q13b | 2 708 / 220 (écart 2 488) |
| Q14 | 738 |
| Q15 | 3 864 *(3 865 après la Q21)* |
| Q16 | 20 687 |
| Q17a / Q17b | 4 908 / 4 280 (écart 628) |
| Q18a | 13 |
| Q18b | 11,434842 → 11,436572 (**+0,0151 %**) |
| Q19 | Murals On 54/Randolphs'S — score 131 |
| Q20 | +1 document → 25 360 |
| Q21 | 5 → 6 notes |
| Q22 | matched 349 / modified 349 |
| Q23 | 345 modifiés (344 + le mien) |
| Q24 | 51 |
| Q25 | deleted 51 → 25 309 restants |
| Q26a | 737 / 25 309 = 2,91 % |
| Q27 | 25 309 (écart **−50** vs Q1) |
| Q28 | 969 lignes |
| B1 | COLLSCAN → IXSCAN ; docsExamined 25 309 → 345 |
| B2 | 547 restaurants à moins de 500 m de Times Square |

