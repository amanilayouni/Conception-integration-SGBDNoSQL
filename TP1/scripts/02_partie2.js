// Partie 2 - Tableaux & sous-documents (Q12 -> Q19)

print("--- Q12 ---");
print(db.restaurants.countDocuments({ "grades.score": { $gt: 50 } }));

print("\n--- Q13 a ---");
print(db.restaurants.countDocuments({ "grades.grade": "C" }));

print("\n--- Q13 b ---");
print(db.restaurants.countDocuments({ "grades.0.grade": "C" }));

print("\n--- Q13 c : ordre des dates dans le tableau grades ---");
var ex = db.restaurants.findOne({ "grades.0.grade": "C" }, { name: 1, grades: 1, _id: 0 });
print("name : " + ex.name);
ex.grades.forEach(function (g, i) {
  print("  grades[" + i + "] : date=" + g.date.toISOString().slice(0, 10) + " grade=" + g.grade + " score=" + g.score);
});

print("\n--- Q14 ---");
print(db.restaurants.countDocuments({ grades: { $size: 0 } }));

print("\n--- Q15 ---");
print(db.restaurants.countDocuments({ "grades.5": { $exists: true } }));

print("\n--- Q16 ---");
print(db.restaurants.countDocuments({ "grades.0.grade": "A" }));

print("\n--- Q17 a (naive) ---");
print(db.restaurants.countDocuments({ "grades.grade": "B", "grades.score": { $gt: 20 } }));

print("\n--- Q17 b (elemMatch) ---");
print(db.restaurants.countDocuments({ grades: { $elemMatch: { grade: "B", score: { $gt: 20 } } } }));

print("\n--- Q17 c : contre-exemple (matche la naive mais pas elemMatch) ---");
var ce = db.restaurants.findOne(
  {
    "grades.grade": "B",
    "grades.score": { $gt: 20 },
    grades: { $not: { $elemMatch: { grade: "B", score: { $gt: 20 } } } }
  },
  { name: 1, grades: 1, _id: 0 }
);
if (ce) {
  print("name : " + ce.name);
  ce.grades.forEach(function (g, i) {
    print("  grades[" + i + "] : grade=" + g.grade + " score=" + g.score);
  });
}

print("\n--- Q18 a ---");
print(db.restaurants.countDocuments({ "grades.score": { $lt: 0 } }));
print("detail des notes negatives :");
printjson(db.restaurants.aggregate([
  { $unwind: "$grades" },
  { $match: { "grades.score": { $lt: 0 } } },
  { $project: { _id: 0, name: 1, score: "$grades.score", grade: "$grades.grade" } }
]).toArray());

print("\n--- Q18 b : moyenne AVEC les notes negatives ---");
var avecNeg = db.restaurants.aggregate([
  { $unwind: "$grades" },
  { $group: { _id: null, moy: { $avg: "$grades.score" }, nb: { $sum: 1 } } }
]).toArray()[0];
printjson(avecNeg);

print("--- Q18 b : moyenne SANS les notes negatives ---");
var sansNeg = db.restaurants.aggregate([
  { $unwind: "$grades" },
  { $match: { "grades.score": { $gte: 0 } } },
  { $group: { _id: null, moy: { $avg: "$grades.score" }, nb: { $sum: 1 } } }
]).toArray()[0];
printjson(sansNeg);
print("ecart absolu : " + (sansNeg.moy - avecNeg.moy));
print("ecart relatif (%) : " + ((sansNeg.moy - avecNeg.moy) / avecNeg.moy * 100));

print("\n--- Q19 ---");
printjson(db.restaurants.find({}, { name: 1, "grades.score": 1, _id: 0 })
  .sort({ "grades.score": -1 })
  .limit(1)
  .toArray());
print("verification par agregation (score max du jeu) :");
printjson(db.restaurants.aggregate([
  { $unwind: "$grades" },
  { $sort: { "grades.score": -1 } },
  { $limit: 1 },
  { $project: { _id: 0, name: 1, score: "$grades.score" } }
]).toArray());

quit();
