// R2 — le calcul embed vs reference (méthode du Jour 1, R3) + vérif TTL (B3)
db = db.getSiblingDB("mflix");

print("########## B3 — le TTLMonitor est-il passé ? ##########");
print("documents restants dans sessions : " + db.sessions.countDocuments({}));
printjson(db.sessions.find({}, { token: 1, createdAt: 1, _id: 0 }).toArray());

print("\n########## R2 — poids d'un commentaire ##########");
var FILM = ObjectId("573a13bff29313caabd5e91e");  // The Taking of Pelham 1 2 3

var c = db.comments.findOne({ movie_id: FILM });
print("un commentaire isole (document complet)     : " + bsonsize(c) + " octets");
print("le meme sans _id ni movie_id (embarque)     : " +
  bsonsize({ name: c.name, text: c.text, date: c.date }) + " octets");

// moyenne sur les 161 commentaires du film
var tous = db.comments.find({ movie_id: FILM }).toArray();
var sTotal = 0, sEmb = 0;
tous.forEach(function (x) {
  sTotal += bsonsize(x);
  sEmb   += bsonsize({ name: x.name, text: x.text, date: x.date });
});
print("nombre de commentaires du film             : " + tous.length);
print("poids moyen d'un commentaire complet       : " + (sTotal / tous.length).toFixed(1) + " octets");
print("poids moyen d'un commentaire embarque      : " + (sEmb / tous.length).toFixed(1) + " octets");
print("poids du tableau des 161 s'ils etaient tous embarques : " +
  bsonsize({ comments: tous.map(x => ({ name: x.name, text: x.text, date: x.date })) }) + " octets");

var film = db.movies.findOne({ _id: FILM });
print("\ndocument film complet (tel quel)           : " + bsonsize(film) + " octets");
delete film.recent_comments;
print("socle du film sans recent_comments         : " + bsonsize(film) + " octets");

print("\n-- statistiques de collection --");
var sm = db.movies.stats(), sc = db.comments.stats();
print("movies.avgObjSize   : " + sm.avgObjSize + " octets   count=" + sm.count);
print("comments.avgObjSize : " + sc.avgObjSize + " octets   count=" + sc.count);

print("\n-- projection : et si un film devenait viral ? --");
var pMoy = sEmb / tous.length;
[161, 1000, 10000, 100000].forEach(function (n) {
  var t = bsonsize(film) + n * pMoy;
  print("  " + String(n).padStart(7) + " commentaires embarques -> " +
    (t / 1024).toFixed(1).padStart(9) + " Ko   (" +
    (t / 16777216 * 100).toFixed(3) + " % de la limite 16 Mo)");
});
print("  commentaires necessaires pour saturer 16 Mo : " +
  Math.floor((16777216 - bsonsize(film)) / pMoy));

print("\n-- verif Q18 : le Subset Pattern est bien en base --");
var f2 = db.movies.findOne({ _id: FILM }, { title: 1, num_mflix_comments: 1, recent_comments: 1 });
print("titre : " + f2.title + "   num_mflix_comments : " + f2.num_mflix_comments);
print("recent_comments.length : " + (f2.recent_comments || []).length);
printjson(f2.recent_comments);
print("films portant recent_comments : " +
  db.movies.countDocuments({ recent_comments: { $exists: true } }));
