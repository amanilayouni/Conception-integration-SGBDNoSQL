// Pourquoi distinct("genres") renvoie 25 sans index et 26 avec ?
db = db.getSiblingDB("mflix");

var g = db.movies.distinct("genres");
print("distinct('genres').length  : " + g.length);
print("valeurs                    : " + JSON.stringify(g));
print("contient null ?            : " + g.some(function (x) { return x === null; }));

print("\nfilms sans champ genres    : " + db.movies.countDocuments({ genres: { $exists: false } }));
print("films avec genres: null    : " + db.movies.countDocuments({ genres: null }));

print("\nplan de distinct AVEC l'index genres_1 :");
printjson(db.runCommand({ explain: { distinct: "movies", key: "genres" }, verbosity: "queryPlanner" })
            .queryPlanner.winningPlan);

print("\nmeme distinct force en COLLSCAN (hint $natural) :");
var sansIx = db.movies.aggregate([
  { $unwind: "$genres" },
  { $group: { _id: "$genres" } }
], { hint: { $natural: 1 } }).toArray();
print("  via $unwind + $group     : " + sansIx.length + " genres");

print("\ngenres reellement portes par au moins un film :");
printjson(db.movies.aggregate([
  { $unwind: "$genres" },
  { $group: { _id: "$genres", n: { $sum: 1 } } },
  { $sort: { n: -1 } }
]).toArray().map(function (x) { return x._id + " (" + x.n + ")"; }));
