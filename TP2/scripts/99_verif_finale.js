// Vérification finale — on rejoue les chiffres clés cités dans reponses_jour2.md
db = db.getSiblingDB("mflix");

function ok(label, obtenu, attendu) {
  print((obtenu === attendu ? "  OK  " : "  KO  ") +
        label.padEnd(46) + " = " + obtenu + (obtenu === attendu ? "" : "  (attendu " + attendu + ")"));
}

print("########## chiffres du recapitulatif ##########");
ok("P0/Q1 movies", db.movies.countDocuments({}), 23539);
ok("P0/Q1 comments", db.comments.countDocuments({}), 50304);
// NB : distinct() renvoie 26 depuis la creation de genres_1 (DISTINCT_SCAN sur index
// non-sparse -> la cle null des 116 films sans genres remonte). Cf. Q1.
ok("Q1 genres portes par >= 1 film", db.movies.aggregate([
  { $unwind: "$genres" }, { $group: { _id: "$genres" } }]).toArray().length, 25);
ok("Q1 distinct() (biaise par l'index)", db.movies.distinct("genres").length, 26);
ok("Q1 films sans champ genres", db.movies.countDocuments({ genres: { $exists: false } }), 116);

ok("Q2 orphelins", db.comments.aggregate([
  { $lookup: { from: "movies", localField: "movie_id", foreignField: "_id", as: "f" } },
  { $match: { f: { $eq: [] } } }, { $count: "n" }]).toArray()[0].n, 9224);

ok("Q3 movie_id distincts", db.comments.aggregate([
  { $group: { _id: "$movie_id" } }, { $count: "n" }]).toArray()[0].n, 14245);

ok("Q4a films avec le champ", db.movies.countDocuments({ num_mflix_comments: { $exists: true } }), 15740);
ok("Q5 year string", db.movies.countDocuments({ year: { $type: "string" } }), 37);
ok('Q6 imdb.rating ""', db.movies.countDocuments({ "imdb.rating": "" }), 61);
ok("Q7 films Film-Noir", db.movies.countDocuments({ genres: "Film-Noir" }), 105);
ok("Q8a Drama >= 2000", db.movies.countDocuments({ genres: "Drama", year: { $gte: 2000 } }), 7761);
ok("Q9a regex /Godfather/", db.movies.countDocuments({ title: { $regex: /Godfather/ } }), 5);
ok("Q11 films Drama", db.movies.countDocuments({ genres: "Drama" }), 13789);
ok("Q18 films avec recent_comments", db.movies.countDocuments({ recent_comments: { $exists: true } }), 10);

print("\n########## Q17 : le compteur est-il toujours reconcilie ? ##########");
var faux = db.movies.aggregate([
  { $match: { num_mflix_comments: { $exists: true } } },
  { $lookup: { from: "comments", localField: "_id", foreignField: "movie_id", as: "c" } },
  { $project: { stocke: "$num_mflix_comments", reel: { $size: "$c" } } },
  { $match: { $expr: { $ne: [ "$stocke", "$reel" ] } } },
  { $count: "n" }
]).toArray();
ok("Q17 compteurs incoherents restants", faux.length === 0 ? 0 : faux[0].n, 0);

print("\n########## etat final des index ##########");
print("movies :");
db.movies.getIndexes().forEach(i => print("  " + i.name + " " + JSON.stringify(i.key)));
print("comments :");
db.comments.getIndexes().forEach(i => print("  " + i.name + " " + JSON.stringify(i.key)));
