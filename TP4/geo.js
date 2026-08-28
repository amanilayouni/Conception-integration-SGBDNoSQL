/* Requêtes géospatiales TP Jour 4 — Partie B4 */

const db = db.getSiblingDB("citibike");
const ts = [-73.9855, 40.7580];

print("=== Q27 $near sans index ===");
try {
  db.trips.find({ "start station location": { $near: { $geometry: { type: "Point", coordinates: ts }, $maxDistance: 500 } } }).limit(1).toArray();
} catch (e) { print("code=" + e.code, "codeName=" + e.codeName, e.errmsg || e.message); }

print("=== Q28 création index + $near ===");
printjson(db.trips.createIndex({ "start station location": "2dsphere" }));
printjson(db.trips.find({ "start station location": { $near: { $geometry: { type: "Point", coordinates: ts }, $maxDistance: 500 } } }).limit(5).toArray().map(d => d["start station name"]));
print("count near:", db.trips.find({ "start station location": { $near: { $geometry: { type: "Point", coordinates: ts }, $maxDistance: 500 } } }).count());

print("=== Q29 countDocuments $near ===");
try {
  print("count 500m:", db.trips.countDocuments({ "start station location": { $near: { $geometry: { type: "Point", coordinates: ts }, $maxDistance: 500 } } }));
} catch (e) { print("code=" + e.code, "codeName=" + e.codeName, e.errmsg || e.message); }

print("=== Q29 $geoWithin ===");
function countWithin(meters) {
  const radians = (meters / 1000) / 6378.1;
  const n = db.trips.countDocuments({ "start station location": { $geoWithin: { $centerSphere: [ts, radians] } } });
  print(meters + " m ->", n);
  return n;
}
countWithin(500);
countWithin(1000);

print("=== Q30 $geoNear sur stations ===");
printjson(db.stations.createIndex({ position: "2dsphere" }));
printjson(db.stations.aggregate([
  { $geoNear: { near: { type: "Point", coordinates: ts }, distanceField: "dist", maxDistance: 1000, spherical: true } },
  { $project: { _id: 0, nom: 1, departs: 1, dist: { $round: ["$dist", 0] } } },
  { $limit: 5 }
]).toArray());
