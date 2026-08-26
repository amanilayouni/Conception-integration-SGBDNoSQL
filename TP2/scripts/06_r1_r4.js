// R1 / R4 — chiffrage complémentaire
db = db.getSiblingDB("mflix");

print("########## R1 — anatomie des orphelins ##########");
var tot = db.comments.countDocuments({});
print("commentaires au total        : " + tot);

var orph = db.comments.aggregate([
  { $lookup: { from: "movies", localField: "movie_id", foreignField: "_id", as: "f" } },
  { $match: { f: { $eq: [] } } },
  { $group: { _id: "$movie_id", n: { $sum: 1 } } }
]).toArray();

var nOrph = orph.reduce(function (a, x) { return a + x.n; }, 0);
print("commentaires orphelins      : " + nOrph);
print("  soit                      : " + (nOrph / tot * 100).toFixed(2) + " % de la collection");
print("movie_id distincts fantomes : " + orph.length);
print("movie_id distincts valides  : " + (14245 - orph.length));
print("moyenne comm./id fantome    : " + (nOrph / orph.length).toFixed(1));
print("3 id fantomes en exemple :");
orph.slice(0, 3).forEach(function (x) { print("  " + x._id + "  -> " + x.n + " commentaires"); });
print("confirmation : ces _id sont bien absents de movies -> " +
  db.movies.countDocuments({ _id: { $in: orph.slice(0, 3).map(function (x) { return x._id; }) } }) +
  " film(s) trouve(s)");

print("\n########## R4 — cout d'un recomptage a la volee ##########");
var ids = db.comments.distinct("movie_id").slice(0, 200);

// sans index sur comments.movie_id
db.comments.dropIndexes();
var t0 = Date.now();
ids.forEach(function (id) { db.comments.countDocuments({ movie_id: id }); });
var sansIx = Date.now() - t0;
print("200 countDocuments SANS index sur movie_id : " + sansIx + " ms   (" +
  (sansIx / 200).toFixed(2) + " ms / film)");
print("  extrapolation aux 14245 films commentes  : " +
  (sansIx / 200 * 14245 / 1000).toFixed(1) + " s");

print("\ncreateIndex({ movie_id: 1 }) -> " + db.comments.createIndex({ movie_id: 1 }));
var t1 = Date.now();
ids.forEach(function (id) { db.comments.countDocuments({ movie_id: id }); });
var avecIx = Date.now() - t1;
print("200 countDocuments AVEC index sur movie_id : " + avecIx + " ms   (" +
  (avecIx / 200).toFixed(2) + " ms / film)");
print("  extrapolation aux 14245 films commentes  : " +
  (avecIx / 200 * 14245 / 1000).toFixed(1) + " s");

var t2 = Date.now();
var n = db.comments.aggregate([{ $group: { _id: "$movie_id", n: { $sum: 1 } } }]).toArray().length;
print("\nUN SEUL $group qui recompte les " + n + " films : " + (Date.now() - t2) + " ms");

print("\nlecture du champ pre-calcule (Computed Pattern) :");
var t3 = Date.now();
db.movies.findOne({ _id: ObjectId("573a13bff29313caabd5e91e") }, { num_mflix_comments: 1 });
print("  1 findOne projete : " + (Date.now() - t3) + " ms");

print("\nindex de comments :");
db.comments.getIndexes().forEach(function (i) { print("  " + i.name + " " + JSON.stringify(i.key)); });
