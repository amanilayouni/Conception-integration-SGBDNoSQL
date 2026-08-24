// Partie 1 - Lecture & operateurs (Q1 -> Q11)

print("--- P0 : verification import ---");
print("countDocuments : " + db.restaurants.countDocuments({}));
print("findOne (structure du document) :");
printjson(db.restaurants.findOne());

print("\n--- Q1 ---");
print(db.restaurants.countDocuments({}));

print("\n--- Q2 ---");
print(db.restaurants.distinct("cuisine").length);

print("\n--- Q3 ---");
print(db.restaurants.countDocuments({ borough: "Brooklyn" }));

print("\n--- Q4 ---");
print(db.restaurants.countDocuments({ cuisine: "French" }));

print("\n--- Q5 ---");
print(db.restaurants.countDocuments({ borough: "Manhattan", cuisine: "Italian" }));

print("\n--- Q6 ---");
print(db.restaurants.countDocuments({ borough: "Bronx", cuisine: "Chinese" }));

print("\n--- Q7 ---");
print("count : " + db.restaurants.countDocuments({ name: "Subway" }));
printjson(db.restaurants.find({ name: "Subway" }, { name: 1, borough: 1, _id: 0 }).limit(3).toArray());

print("\n--- Q8 ---");
print(db.restaurants.countDocuments({ cuisine: { $in: ["Japanese", "Korean", "Thai", "Indian"] } }));

print("\n--- Q9 a/b ---");
print("/BBQ/  : " + db.restaurants.countDocuments({ name: /BBQ/ }));
print("/BBQ/i : " + db.restaurants.countDocuments({ name: /BBQ/i }));

print("\n--- Q9 c : noms trouves seulement par /BBQ/i ---");
// Attention : ecrire { name: /BBQ/i, name: { $not: /BBQ/ } } ne fonctionne pas,
// la seconde cle "name" ecrase la premiere en JavaScript. Il faut combiner
// les deux conditions dans un seul objet, avec $regex et $not.
printjson(db.restaurants.find({ name: { $regex: /BBQ/i, $not: /BBQ/ } }, { name: 1, _id: 0 }).limit(5).toArray());

print("\n--- Q9 d ---");
print("/House/  : " + db.restaurants.countDocuments({ name: /House/ }));
print("/House/i : " + db.restaurants.countDocuments({ name: /House/i }));
print("noms trouves seulement par /House/i (10 premiers) :");
printjson(db.restaurants.find({ name: { $regex: /House/i, $not: /House/ } }, { name: 1, _id: 0 }).limit(10).toArray());

print("\n--- Q10 ---");
print(db.restaurants.countDocuments({ "address.zipcode": "10462" }));

print("\n--- Q11 ---");
printjson(db.restaurants.findOne({ restaurant_id: "30075445" }, { name: 1, _id: 0 }));

quit();
