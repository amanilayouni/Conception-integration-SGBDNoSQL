// Verification fine sur les notes exclues par $match { score: { $gte: 0 } }

print("notes totales (unwind) :");
printjson(db.restaurants.aggregate([{ $unwind: "$grades" }, { $count: "n" }]).toArray());

print("notes avec score < 0 :");
printjson(db.restaurants.aggregate([
  { $unwind: "$grades" },
  { $match: { "grades.score": { $lt: 0 } } },
  { $count: "n" }
]).toArray());

print("notes sans champ score (ou null) :");
printjson(db.restaurants.aggregate([
  { $unwind: "$grades" },
  { $match: { "grades.score": { $exists: false } } },
  { $count: "n" }
]).toArray());

print("exemple de note sans score :");
printjson(db.restaurants.aggregate([
  { $unwind: "$grades" },
  { $match: { "grades.score": { $exists: false } } },
  { $project: { _id: 0, name: 1, grades: 1 } },
  { $limit: 3 }
]).toArray());

print("moyenne en excluant SEULEMENT les negatives (score < 0) :");
printjson(db.restaurants.aggregate([
  { $unwind: "$grades" },
  { $match: { "grades.score": { $not: { $lt: 0 } } } },
  { $group: { _id: null, moy: { $avg: "$grades.score" }, nb: { $sum: 1 } } }
]).toArray());

print("lettres de grade distinctes (anomalies de qualite) :");
printjson(db.restaurants.distinct("grades.grade"));

quit();
