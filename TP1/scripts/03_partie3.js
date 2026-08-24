// Partie 3 - Creation & mise a jour (Q20 -> Q23)

print("--- Q20 : CREATE ---");
var res20 = db.restaurants.insertOne({
  name: "Le Petit Bistrot AL",
  borough: "Montpellier",
  cuisine: "French",
  address: {
    building: "12",
    street: "Place de la Comedie",
    zipcode: "34000",
    coord: [3.8767, 43.6108]
  },
  grades: [
    { grade: "A", score: 7, date: new Date() }
  ],
  restaurant_id: "34000001"
});
print("acknowledged : " + res20.acknowledged);
print("insertedId : " + res20.insertedId);
print("verification findOne :");
printjson(db.restaurants.findOne({ name: "Le Petit Bistrot AL" }));
print("total apres insertion : " + db.restaurants.countDocuments({}));

print("\n--- Q21 : UPDATE cible ($push) ---");
print("notes avant : " + db.restaurants.findOne({ restaurant_id: "30075445" }).grades.length);
var res21 = db.restaurants.updateOne(
  { restaurant_id: "30075445" },
  { $push: { grades: { grade: "A", score: 3, date: new Date() } } }
);
print("matchedCount : " + res21.matchedCount + " / modifiedCount : " + res21.modifiedCount);
var doc21 = db.restaurants.findOne({ restaurant_id: "30075445" }, { name: 1, grades: 1, _id: 0 });
print("notes apres : " + doc21.grades.length);
print("derniere note ajoutee :");
printjson(doc21.grades[doc21.grades.length - 1]);

print("\n--- Q22 : UPDATE de masse ($set risque) ---");
var res22 = db.restaurants.updateMany(
  { "grades.score": { $gt: 50 } },
  { $set: { risque: "eleve" } }
);
print("matchedCount : " + res22.matchedCount);
print("modifiedCount : " + res22.modifiedCount);
print("controle countDocuments({risque:'eleve'}) : " + db.restaurants.countDocuments({ risque: "eleve" }));

print("\n--- Q23 : UPDATE conditionnel ($set label_qualite) ---");
var res23 = db.restaurants.updateMany(
  { cuisine: "French" },
  { $set: { label_qualite: true } }
);
print("matchedCount : " + res23.matchedCount);
print("modifiedCount : " + res23.modifiedCount);
print("controle countDocuments({label_qualite:true}) : " + db.restaurants.countDocuments({ label_qualite: true }));
print("dont mon restaurant (borough Montpellier) : " + db.restaurants.countDocuments({ label_qualite: true, borough: "Montpellier" }));

quit();
