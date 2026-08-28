/* Pipelines d'agrégation TP Jour 4 — Partie B */

const db = db.getSiblingDB("citibike");

print("=== Q12 top 5 stations de départ ===");
printjson(db.trips.aggregate([
  { $group: { _id: "$start station name", n: { $sum: 1 } } },
  { $sort: { n: -1 } },
  { $limit: 5 }
]).toArray());

print("=== Q13 usertype : nombre et durée moyenne ===");
printjson(db.trips.aggregate([
  { $group: { _id: "$usertype", n: { $sum: 1 }, dureeMoy: { $avg: "$tripduration" } } }
]).toArray());

print("=== Q14 trajets par jour ===");
printjson(db.trips.aggregate([
  { $group: { _id: { $dateTrunc: { date: "$start time", unit: "day" } }, n: { $sum: 1 } } },
  { $sort: { _id: 1 } }
]).toArray());

print("=== Q15 top 5 heures de départ ===");
printjson(db.trips.aggregate([
  { $group: { _id: { $hour: "$start time" }, n: { $sum: 1 } } },
  { $sort: { n: -1 } },
  { $limit: 5 }
]).toArray());

print("=== Q16 distribution durées (bucket) ===");
printjson(db.trips.aggregate([
  { $bucket: { groupBy: "$tripduration", boundaries: [0, 300, 600, 1800, 3600, 1000000], default: "autre", output: { n: { $sum: 1 } } } }
]).toArray());

print("=== Q17 boucles ===");
printjson(db.trips.aggregate([
  { $match: { $expr: { $eq: ["$start station id", "$end station id"] } } },
  { $count: "trajets_boucle" }
]).toArray());

print("=== Q18 birth year type chaîne vs entier ===");
printjson(db.trips.aggregate([
  { $group: { _id: { $type: "$birth year" }, n: { $sum: 1 } } }
]).toArray());
print("=== Q18 croisé usertype ===");
printjson(db.trips.aggregate([
  { $group: { _id: { ut: "$usertype", type: { $type: "$birth year" } }, n: { $sum: 1 } } }
]).toArray());

print("=== Q19 âge moyen 2016 ===");
printjson(db.trips.aggregate([
  { $match: { "birth year": { $type: "number" } } },
  { $group: { _id: null, moyenne: { $avg: { $subtract: [2016, "$birth year"] } }, effectif: { $sum: 1 }, ageMax: { $max: { $subtract: [2016, "$birth year"] } } } }
]).toArray());

print("=== Q20 valeurs aberrantes ===");
printjson(db.trips.aggregate([
  { $match: { tripduration: { $gt: 3 * 3600 } } },
  { $count: "plus_3h" }
]).toArray());
printjson(db.trips.aggregate([
  { $match: { tripduration: { $gt: 24 * 3600 } } },
  { $count: "plus_24h" }
]).toArray());
printjson(db.trips.aggregate([
  { $sort: { tripduration: -1 } },
  { $limit: 3 },
  { $project: { _id: 0, tripduration: 1, usertype: 1 } }
]).toArray());

print("=== Q21 durée moyenne sans >3h ===");
printjson(db.trips.aggregate([
  { $match: { tripduration: { $lte: 3 * 3600 } } },
  { $group: { _id: "$usertype", moyenne: { $avg: "$tripduration" }, n: { $sum: 1 } } }
]).toArray());

print("=== Q22 $match en premier (plan A) ===");
printjson(db.trips.explain("executionStats").aggregate([
  { $match: { usertype: "Subscriber" } },
  { $group: { _id: "$start station id", n: { $sum: 1 } } }
]));

print("=== Q22 plan B ===");
printjson(db.trips.explain("executionStats").aggregate([
  { $group: { _id: { s: "$start station id", u: "$usertype" }, n: { $sum: 1 } } },
  { $match: { "_id.u": "Subscriber" } }
]));

print("=== Q23 $match après $group ===");
printjson(db.trips.explain("executionStats").aggregate([
  { $group: { _id: "$start station id", n: { $sum: 1 } } },
  { $match: { n: { $gt: 50 } } }
]));

print("=== Q24 création stations ===");
printjson(db.trips.aggregate([
  { $group: { _id: "$start station id", nom: { $first: "$start station name" }, position: { $first: "$start station location" }, departs: { $sum: 1 } } },
  { $merge: { into: "stations", whenMatched: "replace" } }
]));
printjson(db.stations.countDocuments({}));
printjson(db.stations.find().sort({ departs: -1 }).limit(3).toArray());

print("=== Q26 top 5 stations d'arrivée avec $lookup ===");
printjson(db.trips.aggregate([
  { $group: { _id: "$end station id", nom: { $first: "$end station name" }, arrives: { $sum: 1 } } },
  { $sort: { arrives: -1 } },
  { $limit: 5 },
  { $lookup: { from: "stations", localField: "_id", foreignField: "_id", as: "info" } },
  { $project: { _id: 1, arrives: 1, nom: 1, info: { $arrayElemAt: ["$info", 0] } } }
]).toArray());
