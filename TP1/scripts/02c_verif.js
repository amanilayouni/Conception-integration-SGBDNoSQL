// Les 13 notes en ecart : score present mais null ?

print("notes avec score = null :");
printjson(db.restaurants.aggregate([
  { $unwind: "$grades" },
  { $match: { "grades.score": null } },
  { $count: "n" }
]).toArray());

print("exemples :");
printjson(db.restaurants.aggregate([
  { $unwind: "$grades" },
  { $match: { "grades.score": null } },
  { $project: { _id: 0, name: 1, grade: "$grades.grade", score: "$grades.score" } },
  { $limit: 3 }
]).toArray());

quit();
