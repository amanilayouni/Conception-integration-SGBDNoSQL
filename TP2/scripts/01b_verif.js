// Partie 1 — vérifications complémentaires Q5 / Q6
db = db.getSiblingDB("mflix");

print("========== Q5 (corrigé : $and, pas de clé dupliquée) ==========");
print("year string                       :", db.movies.countDocuments({ year: { $type: "string" } }));
print("year string ET $gte 2000 (nombre) :",
      db.movies.countDocuments({ $and: [ { year: { $type: "string" } }, { year: { $gte: 2000 } } ] }));
print("year string ET $gte '2000' (chaine):",
      db.movies.countDocuments({ $and: [ { year: { $type: "string" } }, { year: { $gte: "2000" } } ] }));
print("toutes les valeurs year non-int   :");
printjson(db.movies.distinct("year", { year: { $type: "string" } }));
print("films year >= 2000 (int)            :", db.movies.countDocuments({ year: { $gte: 2000 } }));
print("films year >= 2000 avec $expr+$toInt:",
      db.movies.countDocuments({ $expr: { $gte: [ { $toInt: { $substrBytes: [ { $toString: "$year" }, 0, 4 ] } }, 2000 ] } }));

print("\n========== Q6 (le vrai piège : dénominateur) ==========");
printjson(db.movies.aggregate([
  { $group: {
      _id: null,
      somme: { $sum: "$imdb.rating" },   // $sum ignore les non-numériques
      nb_docs: { $sum: 1 },              // ... mais ce compteur, non
      avg_mongo: { $avg: "$imdb.rating" }
  } },
  { $project: {
      _id: 0, somme: 1, nb_docs: 1, avg_mongo: 1,
      moyenne_a_la_main: { $divide: [ "$somme", "$nb_docs" ] }
  } }
]).toArray());
print('exemples de imdb.rating == "" :');
printjson(db.movies.find({ "imdb.rating": "" }, { title: 1, "imdb.rating": 1, _id: 0 }).limit(3).toArray());
print("films avec imdb.rating >= 7 :", db.movies.countDocuments({ "imdb.rating": { $gte: 7 } }));
