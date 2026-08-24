// B1 - Index sur cuisine : plan d'execution avant / apres

function resume(plan, titre) {
  var st = plan.executionStats;
  print(titre);
  print("  stage           : " + (st.executionStages.stage === "FETCH" ? st.executionStages.inputStage.stage : st.executionStages.stage));
  print("  nReturned       : " + st.nReturned);
  print("  totalKeysExamined  : " + st.totalKeysExamined);
  print("  totalDocsExamined  : " + st.totalDocsExamined);
  print("  executionTimeMillis: " + st.executionTimeMillis);
}

print("index existants avant :");
printjson(db.restaurants.getIndexes());

var avant = db.restaurants.find({ cuisine: "French" }).explain("executionStats");
resume(avant, "\n=== AVANT createIndex ===");

print("\ncreation de l'index :");
print(db.restaurants.createIndex({ cuisine: 1 }));

var apres = db.restaurants.find({ cuisine: "French" }).explain("executionStats");
resume(apres, "\n=== APRES createIndex ===");

print("\nindex existants apres :");
printjson(db.restaurants.getIndexes());

quit();
