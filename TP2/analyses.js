// =====================================================================
// TP Jour 2 — Partie 3 : Agrégation analytique (Q11 → Q15)
// Base : mflix   Collections : movies, comments
//
// Exécution :
//   docker cp analyses.js mongo-ipssi:/tmp/analyses.js
//   docker exec mongo-ipssi mongosh -u admin -p ipssi2025 \
//       --authenticationDatabase admin --quiet --file /tmp/analyses.js
// =====================================================================

db = db.getSiblingDB("mflix");

function titre(t) { print("\n" + "=".repeat(64) + "\n" + t + "\n" + "=".repeat(64)); }

// ---------------------------------------------------------------------
// Q11 — Top 5 des genres par nombre de films
// genres est un TABLEAU : il faut le $unwind avant de grouper,
// sinon on grouperait sur la combinaison de genres, pas sur un genre.
// ---------------------------------------------------------------------
titre("Q11 — Top 5 des genres par nombre de films");

printjson(db.movies.aggregate([
  { $unwind: "$genres" },
  { $group: { _id: "$genres", nb_films: { $sum: 1 } } },
  { $sort: { nb_films: -1 } },
  { $limit: 5 }
]).toArray());

// ---------------------------------------------------------------------
// Q12 — Nombre de films par décennie, trié décroissant
// $match { year: { $type: "int" } } écarte les 37 années stockées en
// chaîne (Q5) : sans ce filtre, $mod lèverait une erreur de type.
// décennie = year - (year % 10)
// ---------------------------------------------------------------------
titre("Q12 — Films par décennie (top 3 puis classement complet)");

var parDecennie = [
  { $match: { year: { $type: "int" } } },
  { $project: {
      decennie: { $subtract: [ "$year", { $mod: [ "$year", 10 ] } ] }
  } },
  { $group: { _id: "$decennie", nb_films: { $sum: 1 } } },
  { $sort: { nb_films: -1 } }
];

print("-- TOP 3 --");
printjson(db.movies.aggregate(parDecennie.concat([ { $limit: 3 } ])).toArray());
print("-- classement complet --");
printjson(db.movies.aggregate(parDecennie).toArray());

// ---------------------------------------------------------------------
// Q13 — Note IMDB moyenne des films Drama
// $type: "number" écarte les 61 imdb.rating égaux à "" (Q6). Sans ce
// filtre, $avg les ignore mais tout $sum/$count manuel serait faussé.
// ---------------------------------------------------------------------
titre("Q13 — Note IMDB moyenne des films Drama (notes numériques)");

printjson(db.movies.aggregate([
  { $match: { genres: "Drama", "imdb.rating": { $type: "number" } } },
  { $group: {
      _id: null,
      moyenne: { $avg: "$imdb.rating" },
      nb_films: { $sum: 1 },
      note_min: { $min: "$imdb.rating" },
      note_max: { $max: "$imdb.rating" }
  } },
  { $project: {
      _id: 0, nb_films: 1, note_min: 1, note_max: 1,
      moyenne_brute: "$moyenne",
      moyenne_4_dec: { $round: [ "$moyenne", 4 ] }
  } }
]).toArray());

// contrôle : combien de films Drama sont exclus par le filtre de type ?
print("films Drama au total          : " + db.movies.countDocuments({ genres: "Drama" }));
print("films Drama a note non-numerique : " +
  db.movies.countDocuments({ genres: "Drama", "imdb.rating": { $not: { $type: "number" } } }));

// ---------------------------------------------------------------------
// Q14 — Top 3 réalisateurs par nombre de films
// directors est un tableau (co-réalisations) -> $unwind.
// ---------------------------------------------------------------------
titre("Q14 — Top 3 réalisateurs par nombre de films");

printjson(db.movies.aggregate([
  { $match: { directors: { $exists: true, $ne: null } } },
  { $unwind: "$directors" },
  { $group: { _id: "$directors", nb_films: { $sum: 1 } } },
  { $sort: { nb_films: -1, _id: 1 } },
  { $limit: 3 }
]).toArray());

// ---------------------------------------------------------------------
// Q15 — $lookup inversé : top 5 des films les plus commentés
// On part de comments (le côté « many ») : on agrège d'abord, on ne
// joint QUE les 5 lignes survivantes. Joindre avant de grouper aurait
// déclenché 50 304 recherches d'index au lieu de 5.
// ---------------------------------------------------------------------
titre("Q15 — Top 5 des films les plus commentés ($lookup inversé)");

printjson(db.comments.aggregate([
  { $group: { _id: "$movie_id", nb_commentaires: { $sum: 1 } } },
  { $sort: { nb_commentaires: -1 } },
  { $limit: 5 },
  { $lookup: {
      from: "movies",
      localField: "_id",
      foreignField: "_id",
      as: "film"
  } },
  { $project: {
      _id: 0,
      movie_id: "$_id",
      nb_commentaires: 1,
      titre: { $ifNull: [ { $first: "$film.title" }, "<<< FILM INEXISTANT (orphelin) >>>" ] },
      annee: { $first: "$film.year" },
      compteur_stocke: { $first: "$film.num_mflix_comments" }
  } },
  { $sort: { nb_commentaires: -1 } }
]).toArray());

print("\n-- FIN analyses.js --");
