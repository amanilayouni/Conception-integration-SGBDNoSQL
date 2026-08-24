// R3 - Mesures BSON (embarque vs reference)

var doc = db.restaurants.findOne({ restaurant_id: "30075445" });
var tailleDoc = bsonsize(doc);
var nbNotes = doc.grades.length;

print("document analyse : " + doc.name + " (restaurant_id 30075445)");
print("nombre de notes : " + nbNotes);
print("bsonsize(document) : " + tailleDoc + " octets");

var tailleTableau = bsonsize({ grades: doc.grades });
print("bsonsize({grades: [...]}) : " + tailleTableau + " octets");
print("taille moyenne d'une note (tableau / nb notes) : " + (tailleTableau / nbNotes).toFixed(1) + " octets");

var uneNote = bsonsize(doc.grades[0]);
print("bsonsize(grades[0]) seule : " + uneNote + " octets");

var socle = tailleDoc - tailleTableau;
print("socle du document hors grades : " + socle + " octets");

var projection520 = socle + 520 * (tailleTableau / nbNotes);
print("\nprojection a 520 notes (1 inspection/semaine pendant 10 ans) :");
print("  taille estimee : " + Math.round(projection520) + " octets (~" + (projection520 / 1024).toFixed(1) + " Ko)");

var limite = 16 * 1024 * 1024;
print("  limite BSON MongoDB : " + limite + " octets (16 Mo)");
print("  taux d'occupation de la limite : " + (projection520 / limite * 100).toFixed(4) + " %");
print("  nombre de notes theorique pour saturer 16 Mo : " + Math.floor((limite - socle) / (tailleTableau / nbNotes)));

print("\nrappel Q15 : restaurants ayant au moins 6 notes = " + db.restaurants.countDocuments({ "grades.5": { $exists: true } }));
print("taille moyenne d'un document de la collection :");
printjson(db.restaurants.aggregate([
  { $group: { _id: null, moyenneOctets: { $avg: { $bsonSize: "$$ROOT" } }, maxOctets: { $max: { $bsonSize: "$$ROOT" } } } }
]).toArray());

print("statistiques de la collection :");
var st = db.restaurants.stats();
print("  count : " + st.count);
print("  size (octets) : " + st.size);
print("  avgObjSize (octets) : " + st.avgObjSize);

quit();
