// Partie 1 — Modélisation & intégrité référentielle (Q1 → Q6)
db = db.getSiblingDB("mflix");

print("========== Q1 ==========");
print("films            :", db.movies.countDocuments({}));
print("commentaires     :", db.comments.countDocuments({}));
print("genres distincts :", db.movies.distinct("genres").length);
print("liste genres     :", db.movies.distinct("genres").join(", "));

print("\n========== Q2 — commentaires orphelins ==========");
printjson(db.comments.aggregate([
  { $lookup: { from: "movies", localField: "movie_id", foreignField: "_id", as: "film" } },
  { $match: { film: { $eq: [] } } },
  { $count: "orphelins" }
]).toArray());

print("\n========== Q3 — films distincts commentés ==========");
printjson(db.comments.aggregate([
  { $group: { _id: "$movie_id" } },
  { $count: "films_references" }
]).toArray());

print("\n========== Q4a — Computed Pattern : présence du champ ==========");
var total = db.movies.countDocuments({});
var avecChamp = db.movies.countDocuments({ num_mflix_comments: { $exists: true } });
print("films avec num_mflix_comments :", avecChamp, "/", total,
      "=", (avecChamp / total * 100).toFixed(2) + " %");
print("films sans le champ           :", total - avecChamp);

print("\n========== Q4b/c — Pelham 1 2 3 ==========");
var pelham = db.movies.findOne({ title: "The Taking of Pelham 1 2 3" });
print("_id                :", pelham._id);
print("year               :", pelham.year);
print("num_mflix_comments :", pelham.num_mflix_comments);
var reel = db.comments.countDocuments({ movie_id: pelham._id });
print("commentaires reels :", reel);
print("ecart absolu       :", pelham.num_mflix_comments - reel);
print("ecart %            :",
      ((pelham.num_mflix_comments - reel) / reel * 100).toFixed(2) + " %");

print("\n========== Q5 — year en chaine ==========");
print("year type string :", db.movies.countDocuments({ year: { $type: "string" } }));
print("year type int    :", db.movies.countDocuments({ year: { $type: "int" } }));
print("exemples :");
printjson(db.movies.find({ year: { $type: "string" } }, { title: 1, year: 1, _id: 0 })
                   .limit(5).toArray());
print("dont year string >= 2000 (lexicographique) :",
      db.movies.countDocuments({ year: { $type: "string" }, year: { $gte: "2000" } }));
print("films year >= 2000 (requete numerique) :",
      db.movies.countDocuments({ year: { $gte: 2000 } }));

print("\n========== Q6 — imdb.rating vide ==========");
print('imdb.rating === ""     :', db.movies.countDocuments({ "imdb.rating": "" }));
print("imdb.rating numerique  :", db.movies.countDocuments({ "imdb.rating": { $type: "number" } }));
print("imdb.rating absent     :", db.movies.countDocuments({ "imdb.rating": { $exists: false } }));
print("-- moyenne SANS filtrer le type (piege) :");
printjson(db.movies.aggregate([
  { $group: { _id: null, moyenne: { $avg: "$imdb.rating" }, n: { $sum: 1 } } }
]).toArray());
print("-- moyenne EN filtrant le type :");
printjson(db.movies.aggregate([
  { $match: { "imdb.rating": { $type: "number" } } },
  { $group: { _id: null, moyenne: { $avg: "$imdb.rating" }, n: { $sum: 1 } } }
]).toArray());
