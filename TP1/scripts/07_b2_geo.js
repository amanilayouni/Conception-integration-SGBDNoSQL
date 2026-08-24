// B2 - Index 2dsphere sur address.coord + recherche $near a moins de 500 m

print("creation de l'index 2dsphere :");
print(db.restaurants.createIndex({ "address.coord": "2dsphere" }));

// Point de reference : Times Square, Manhattan
var point = [-73.9855, 40.7580];
print("\npoint de reference (Times Square) : [" + point[0] + ", " + point[1] + "]");

var filtre = {
  "address.coord": {
    $near: {
      $geometry: { type: "Point", coordinates: point },
      $maxDistance: 500
    }
  }
};

// Remarque : countDocuments() encapsule le filtre dans un $match d'agregation,
// or $near y est interdit (il impose un tri geospatial). On utilise donc itcount().
print("restaurants a moins de 500 m : " + db.restaurants.find(filtre).itcount());

print("\nles 10 plus proches :");
printjson(db.restaurants.find(filtre, { name: 1, cuisine: 1, "address.street": 1, _id: 0 }).limit(10).toArray());

print("distances exactes des 5 plus proches (via $geoNear) :");
printjson(db.restaurants.aggregate([
  {
    $geoNear: {
      near: { type: "Point", coordinates: point },
      distanceField: "distance_m",
      maxDistance: 500,
      spherical: true
    }
  },
  { $limit: 5 },
  { $project: { _id: 0, name: 1, cuisine: 1, distance_m: { $round: ["$distance_m", 1] } } }
]).toArray());

print("\nindex de la collection :");
printjson(db.restaurants.getIndexes());

quit();
