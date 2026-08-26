// Partie 0 — contrôle P0 et observation de la structure
db = db.getSiblingDB("mflix");

print("=== P0 movies    :", db.movies.countDocuments({}));
print("=== P0 comments  :", db.comments.countDocuments({}));

print("\n=== un film (champs) ===");
var m = db.movies.findOne({ title: "The Godfather" });
printjson(m);

print("\n=== un commentaire ===");
printjson(db.comments.findOne());
