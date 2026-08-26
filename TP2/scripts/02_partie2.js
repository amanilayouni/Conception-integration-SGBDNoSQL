// Partie 2 — Indexation & explain() (Q7 → Q10)
db = db.getSiblingDB("mflix");

// petit utilitaire : n'imprime que ce qui nous intéresse dans executionStats
function stats(label, expl) {
  var e = expl.executionStats;
  var w = expl.queryPlanner.winningPlan;
  // on descend jusqu'au stage le plus profond pour lire le nom de l'index
  function findIx(p) {
    if (!p) return null;
    if (p.indexName) return p.indexName;
    return findIx(p.inputStage) || findIx(p.child) || (p.inputStages ? findIx(p.inputStages[0]) : null);
  }
  print("--- " + label);
  print("  stage racine        : " + w.stage);
  print("  plan complet        : " + JSON.stringify(w).substring(0, 300));
  print("  indexName           : " + findIx(w));
  print("  nReturned           : " + e.nReturned);
  print("  totalKeysExamined   : " + e.totalKeysExamined);
  print("  totalDocsExamined   : " + e.totalDocsExamined);
  print("  executionTimeMillis : " + e.executionTimeMillis);
}

print("########## ETAT INITIAL DES INDEX ##########");
printjson(db.movies.getIndexes());

// ---------------------------------------------------------------- Q7
print("\n########## Q7 — index multi-clés sur genres ##########");
var qNoir = { genres: "Film-Noir" };
stats("Q7a AVANT index", db.movies.find(qNoir).explain("executionStats"));

print("\ncreateIndex({ genres: 1 }) -> " + db.movies.createIndex({ genres: 1 }));
stats("Q7b APRES index", db.movies.find(qNoir).explain("executionStats"));
print("  isMultiKey : " +
  db.movies.getIndexes().filter(i => i.name === "genres_1").length + " index genres_1 present");

// ---------------------------------------------------------------- Q8
print("\n########## Q8 — index composé & règle ESR ##########");
var qESR = { genres: "Drama", year: { $gte: 2000 } };
print("Q8a nombre de films correspondant au filtre : " + db.movies.countDocuments(qESR));

stats("Q8 AVANT index composé (tri imdb.rating desc)",
  db.movies.find(qESR).sort({ "imdb.rating": -1 }).explain("executionStats"));

print("\ncreateIndex({ genres:1, 'imdb.rating':-1, year:1 }) -> " +
  db.movies.createIndex({ genres: 1, "imdb.rating": -1, year: 1 }, { name: "esr_genres_rating_year" }));

stats("Q8c APRES index ESR",
  db.movies.find(qESR).sort({ "imdb.rating": -1 }).explain("executionStats"));

print("\n-- présence d'un stage SORT dans le plan ESR ? --");
var plan = JSON.stringify(db.movies.find(qESR).sort({ "imdb.rating": -1 })
                            .explain("executionStats").queryPlanner.winningPlan);
print("  contient \"SORT\" : " + /"stage":"SORT/.test(plan));

// ---------------------------------------------------------------- Q9
print("\n########## Q9 — index text vs $regex ##########");
print("Q9a $regex /Godfather/ : " + db.movies.countDocuments({ title: { $regex: /Godfather/ } }));
print("  titres :");
printjson(db.movies.find({ title: { $regex: /Godfather/ } }, { title: 1, _id: 0 }).toArray());

print("\ncreateIndex({ title:'text', plot:'text' }) -> " +
  db.movies.createIndex({ title: "text", plot: "text" }, { name: "txt_title_plot" }));

var nText = db.movies.countDocuments({ $text: { $search: "godfather" } });
print("Q9b $text 'godfather' : " + nText);
print("Q9c ecart : " + (nText - db.movies.countDocuments({ title: { $regex: /Godfather/ } })));

print("\n-- films trouvés par $text mais PAS par le $regex sur title --");
printjson(db.movies.find(
  { $text: { $search: "godfather" }, title: { $not: /Godfather/ } },
  { title: 1, plot: 1, _id: 0 }
).limit(5).toArray());

print("\nQ9d $text 'godfathers' (pluriel) : " +
  db.movies.countDocuments({ $text: { $search: "godfathers" } }));
print("Q9d $regex /godfathers/ (pluriel) : " +
  db.movies.countDocuments({ title: { $regex: /godfathers/ } }));
print("Q9d $regex /Godfathers/          : " +
  db.movies.countDocuments({ title: { $regex: /Godfathers/ } }));

print("\nQ9e $text sur une sous-chaine 'father' vs $regex /father/i sur title :");
print("  $text 'father'   : " + db.movies.countDocuments({ $text: { $search: "father" } }));
print("  $regex /father/i : " + db.movies.countDocuments({ title: { $regex: /father/i } }));

// ---------------------------------------------------------------- Q10
print("\n########## Q10 — inventaire des index ##########");
db.movies.getIndexes().forEach(i => print("  " + i.name + "  " + JSON.stringify(i.key)));
print("taille de chaque index (octets) :");
printjson(db.movies.stats().indexSizes);
print("\ndropIndex('txt_title_plot')...");
printjson(db.movies.dropIndex("txt_title_plot"));
print("index restants :");
db.movies.getIndexes().forEach(i => print("  " + i.name));
printjson(db.movies.stats().indexSizes);
