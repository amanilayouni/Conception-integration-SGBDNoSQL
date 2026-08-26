// R3 — ESR prouvé par l'expérience + compléments Q8 / Q9e
db = db.getSiblingDB("mflix");

function stats(label, expl) {
  var e = expl.executionStats;
  var w = expl.queryPlanner.winningPlan;
  print("--- " + label);
  print("  stage racine        : " + w.stage);
  print("  contient SORT       : " + /"stage":"SORT/.test(JSON.stringify(w)));
  print("  nReturned           : " + e.nReturned);
  print("  totalKeysExamined   : " + e.totalKeysExamined);
  print("  totalDocsExamined   : " + e.totalDocsExamined);
  print("  executionTimeMillis : " + e.executionTimeMillis);
}

var q = { genres: "Drama", year: { $gte: 2000 } };
var tri = { "imdb.rating": -1 };

print("########## Q8 — vraie baseline SANS aucun index utilisable (hint $natural) ##########");
stats("hint({$natural:1})",
  db.movies.find(q).sort(tri).hint({ $natural: 1 }).explain("executionStats"));

print("\n########## R3 — index dans le MAUVAIS ordre (E, R, S) ##########");
print("createIndex({ genres:1, year:1, 'imdb.rating':-1 }) -> " +
  db.movies.createIndex({ genres: 1, year: 1, "imdb.rating": -1 }, { name: "mauvais_ordre_ERS" }));

stats("BON ordre  ESR : genres:1, imdb.rating:-1, year:1",
  db.movies.find(q).sort(tri).hint("esr_genres_rating_year").explain("executionStats"));

stats("MAUVAIS ordre ERS : genres:1, year:1, imdb.rating:-1",
  db.movies.find(q).sort(tri).hint("mauvais_ordre_ERS").explain("executionStats"));

print("\n-- quel index l'optimiseur choisit-il spontanément ? --");
var libre = db.movies.find(q).sort(tri).explain("executionStats");
print("  winningPlan indexName : " +
  JSON.stringify(libre.queryPlanner.winningPlan).match(/"indexName":"[^"]+"/));
print("  plans rejetes         : " + libre.queryPlanner.rejectedPlans.length);

print("\n-- limite mémoire du stage SORT annoncée par le plan --");
var p = db.movies.find(q).sort(tri).hint("mauvais_ordre_ERS").explain("executionStats");
print("  memLimit : " + JSON.stringify(p.queryPlanner.winningPlan).match(/"memLimit":\d+/));
print("  internalQueryMaxBlockingSortMemoryUsageBytes :");
printjson(db.adminCommand({ getParameter: 1, internalQueryMaxBlockingSortMemoryUsageBytes: 1 }));

print("\n########## Q9e — sous-chaîne qui n'est pas un mot entier ##########");
db.movies.createIndex({ title: "text", plot: "text" }, { name: "txt_tmp" });
print("  $text 'godfat'    : " + db.movies.countDocuments({ $text: { $search: "godfat" } }));
print("  $regex /Godfat/   : " + db.movies.countDocuments({ title: { $regex: /Godfat/ } }));
print("  $text 'part'      : " + db.movies.countDocuments({ $text: { $search: "part" } }));
print("  $regex /Part II/  : " + db.movies.countDocuments({ title: { $regex: /Part II/ } }));
print("  $text 'Part II' (phrase) : " +
  db.movies.countDocuments({ $text: { $search: "\"Part II\"" } }));
printjson(db.movies.dropIndex("txt_tmp"));

print("\n########## nettoyage R3 : on garde le mauvais index pour la trace, on l'affiche ##########");
db.movies.getIndexes().forEach(i => print("  " + i.name + " " + JSON.stringify(i.key)));
