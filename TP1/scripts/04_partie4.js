// Partie 4 - Suppression & qualite de donnees (Q24 -> Q26)

print("--- Q24 ---");
print("borough 'Missing' : " + db.restaurants.countDocuments({ borough: "Missing" }));
print("total avant suppression : " + db.restaurants.countDocuments({}));
print("liste des arrondissements avant suppression :");
printjson(db.restaurants.distinct("borough"));

print("\n--- Q25 ---");
var res25 = db.restaurants.deleteMany({ borough: "Missing" });
print("deletedCount : " + res25.deletedCount);
print("total apres suppression : " + db.restaurants.countDocuments({}));
print("controle : borough 'Missing' restants = " + db.restaurants.countDocuments({ borough: "Missing" }));

print("\n--- Q26 a ---");
var vides = db.restaurants.countDocuments({ grades: { $size: 0 } });
var total = db.restaurants.countDocuments({});
print("grades vides : " + vides);
print("effectif actuel : " + total);
print("pourcentage : " + (vides / total * 100).toFixed(2) + " %");
print("rappel Q14 (avant suppression) : les 'Missing' contenaient aussi des grades vides");

quit();
