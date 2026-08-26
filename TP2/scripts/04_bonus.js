// Pour aller plus loin — B1 (covered query), B2 (index partiel), B3 (TTL)
db = db.getSiblingDB("mflix");

function stats(label, expl) {
  var e = expl.executionStats;
  var w = expl.queryPlanner.winningPlan;
  var s = JSON.stringify(w);
  print("--- " + label);
  print("  stage racine      : " + w.stage);
  print("  FETCH present ?   : " + /"stage":"FETCH"/.test(s));
  print("  PROJECTION_COVERED: " + /PROJECTION_COVERED/.test(s));
  print("  nReturned         : " + e.nReturned);
  print("  totalKeysExamined : " + e.totalKeysExamined);
  print("  totalDocsExamined : " + e.totalDocsExamined);
  print("  executionTimeMillis: " + e.executionTimeMillis);
}

print("########## B1 — covered query ##########");
// on evite genres : un index MULTI-CLES ne peut jamais couvrir une requete.
print("createIndex({ year:1, title:1 }) -> " +
  db.movies.createIndex({ year: 1, title: 1 }, { name: "cov_year_title" }));

print("\n-- tentative 1 : projection SANS exclure _id (echoue) --");
stats("{year:1972} proj {year:1,title:1}",
  db.movies.find({ year: 1972 }, { year: 1, title: 1 }).explain("executionStats"));

print("\n-- tentative 2 : on exclut _id -> la requete est couverte --");
stats("{year:1972} proj {year:1,title:1,_id:0}",
  db.movies.find({ year: 1972 }, { year: 1, title: 1, _id: 0 }).explain("executionStats"));

print("\n-- preuve que la couverture casse si on projette un champ hors index --");
stats("... + plot",
  db.movies.find({ year: 1972 }, { year: 1, title: 1, plot: 1, _id: 0 }).explain("executionStats"));

print("\n-- preuve que la couverture casse avec un index multi-cles --");
stats("{genres:'Film-Noir'} proj {genres:1,_id:0}",
  db.movies.find({ genres: "Film-Noir" }, { genres: 1, _id: 0 }).explain("executionStats"));

printjson(db.movies.dropIndex("cov_year_title"));

print("\n########## B2 — index partiel ##########");
print("repartition du champ type :");
printjson(db.movies.aggregate([{ $group: { _id: "$type", n: { $sum: 1 } } }]).toArray());

print("\ncreateIndex COMPLET  { title:1 } -> " +
  db.movies.createIndex({ title: 1 }, { name: "full_title" }));
print("createIndex PARTIEL  { title:1 } partialFilterExpression {type:'series'} -> " +
  db.movies.createIndex({ title: 1 },
    { name: "part_title_series", partialFilterExpression: { type: "series" } }));

var sizes = db.movies.stats().indexSizes;
print("\ntailles (octets) :");
print("  full_title        : " + sizes.full_title);
print("  part_title_series : " + sizes.part_title_series);
print("  ratio             : " +
  (sizes.part_title_series / sizes.full_title * 100).toFixed(2) + " % du complet");
print("  economie          : " + (sizes.full_title - sizes.part_title_series) + " octets");
print("  nb de docs indexes: " + db.movies.countDocuments({ type: "series" }) +
      " / " + db.movies.countDocuments({}));

print("\n-- l'index partiel n'est utilisable QUE si la requete implique le predicat --");
stats("hint partiel AVEC type:'series'",
  db.movies.find({ type: "series", title: "The Simpsons" })
           .hint("part_title_series").explain("executionStats"));
try {
  db.movies.find({ title: "The Simpsons" }).hint("part_title_series").explain("executionStats");
  print("  (hint sans le predicat : accepte)");
} catch (e) {
  print("  hint sans le predicat -> ERREUR : " + e.message.substring(0, 120));
}

print("\n########## B3 — index TTL ##########");
db.sessions.drop();
print("createIndex({ createdAt:1 }, { expireAfterSeconds: 3600 }) -> " +
  db.sessions.createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600, name: "ttl_createdAt" }));

db.sessions.insertMany([
  { user: "amani",  token: "tok-frais",  createdAt: new Date() },
  { user: "amani",  token: "tok-30min",  createdAt: new Date(Date.now() - 1800 * 1000) },
  { user: "invite", token: "tok-perime", createdAt: new Date(Date.now() - 7200 * 1000) }
]);
print("documents inseres : " + db.sessions.countDocuments({}));
printjson(db.sessions.getIndexes());
print("le document 'tok-perime' (createdAt il y a 7200 s) sera purge par le");
print("thread TTLMonitor, qui passe toutes les 60 s :");
printjson(db.adminCommand({ getParameter: 1, ttlMonitorSleepSecs: 1 }));
printjson(db.sessions.find({}, { token: 1, createdAt: 1, _id: 0 }).toArray());

print("\n-- etat final des index de movies --");
db.movies.getIndexes().forEach(i => print("  " + i.name + " " + JSON.stringify(i.key)));
