
const dbm = db.getSiblingDB("mflix");

function ligne(t) { print("\n" + "-".repeat(66) + "\n" + t + "\n" + "-".repeat(66)); }

// on verifie qu'on est bien sur un replica set
ligne("0. Contexte");
const hello = dbm.adminCommand({ hello: 1 });
print("  setName      : " + hello.setName);
print("  isWritablePrimary : " + hello.isWritablePrimary);
if (!hello.setName) {
  print("  !! pas de replica set : les transactions echoueront.");
}

// --- cible : le film le plus commente (Q15) --------------------------
const FILM_ID = ObjectId("573a13bff29313caabd5e91e");   // The Taking of Pelham 1 2 3

function etat(label) {
  const f = dbm.movies.findOne({ _id: FILM_ID }, { title: 1, num_mflix_comments: 1 });
  const n = dbm.comments.countDocuments({ movie_id: FILM_ID });
  print(`  [${label}] num_mflix_comments = ${f.num_mflix_comments}` +
        `  |  commentaires en base = ${n}  |  ${f.title}`);
  return { compteur: f.num_mflix_comments, reels: n };
}

ligne("1. Etat initial");
const avant = etat("avant");

// on choisit un commentaire reel a supprimer
const cible = dbm.comments.findOne({ movie_id: FILM_ID });
print("  commentaire cible : " + cible._id + "  (" + cible.name + ")");
// sauvegarde pour pouvoir rejouer le script
const sauvegarde = Object.assign({}, cible);


// CAS 1 — transaction qui COMMIT : les deux ecritures sont appliquees
ligne("2. CAS 1 — transaction validee (commitTransaction)");

const session = dbm.getMongo().startSession();
const sDb = session.getDatabase("mflix");

session.startTransaction({
  readConcern:  { level: "snapshot" },      // I : lecture isolee, vue figee
  writeConcern: { w: "majority" }           // D : ack de la majorite = durable
});

try {
  const r1 = sDb.comments.deleteOne({ _id: cible._id });
  print("  deleteOne  -> deletedCount  = " + r1.deletedCount);

  const r2 = sDb.movies.updateOne(
    { _id: FILM_ID },
    { $inc: { num_mflix_comments: -1 } }
  );
  print("  updateOne  -> modifiedCount = " + r2.modifiedCount);

  // preuve de l'ISOLATION : hors session, rien n'est encore visible
  print("  --- pendant la transaction, vu de l'EXTERIEUR (hors session) :");
  etat("exterieur");
  print("  --- vu de l'INTERIEUR de la session :");
  print("      commentaires = " + sDb.comments.countDocuments({ movie_id: FILM_ID }) +
        "  compteur = " +
        sDb.movies.findOne({ _id: FILM_ID }, { num_mflix_comments: 1 }).num_mflix_comments);

  session.commitTransaction();
  print("  >>> commitTransaction() OK");
} catch (e) {
  session.abortTransaction();
  print("  !!! abort : " + e.message);
}

ligne("3. Etat apres COMMIT");
const apres = etat("apres commit");
print("  delta compteur : " + (apres.compteur - avant.compteur) +
      "   delta commentaires : " + (apres.reels - avant.reels));
print("  ATTENDU : -1 et -1  -> " +
      ((apres.compteur - avant.compteur === -1 && apres.reels - avant.reels === -1)
        ? "CONFORME" : "NON CONFORME"));


// CAS 2 — transaction ABORTEE : erreur au milieu -> rien n'est applique

ligne("4. CAS 2 — erreur au milieu (abortTransaction)");

const refAvantAbort = etat("avant abort");
const cible2 = dbm.comments.findOne({ movie_id: FILM_ID });
print("  commentaire cible : " + cible2._id + "  (" + cible2.name + ")");

session.startTransaction({
  readConcern:  { level: "snapshot" },
  writeConcern: { w: "majority" }
});

try {
  const r1 = sDb.comments.deleteOne({ _id: cible2._id });
  print("  deleteOne  -> deletedCount  = " + r1.deletedCount);

  const r2 = sDb.movies.updateOne(
    { _id: FILM_ID },
    { $inc: { num_mflix_comments: -1 } }
  );
  print("  updateOne  -> modifiedCount = " + r2.modifiedCount);

  print("  vu de l'INTERIEUR : commentaires = " +
        sDb.comments.countDocuments({ movie_id: FILM_ID }) + "  compteur = " +
        sDb.movies.findOne({ _id: FILM_ID }, { num_mflix_comments: 1 }).num_mflix_comments);

  throw new Error("PANNE SIMULEE apres les deux ecritures");

} catch (e) {
  print("  exception attrapee : " + e.message);
  session.abortTransaction();
  print("  >>> abortTransaction() appele");
}

ligne("5. Etat apres ABORT — rien ne doit avoir bouge");
const apresAbort = etat("apres abort");
print("  delta compteur : " + (apresAbort.compteur - refAvantAbort.compteur) +
      "   delta commentaires : " + (apresAbort.reels - refAvantAbort.reels));
print("  ATTENDU : 0 et 0  -> " +
      ((apresAbort.compteur === refAvantAbort.compteur &&
        apresAbort.reels === refAvantAbort.reels) ? "ROLLBACK CONFIRME" : "ECHEC"));
print("  le commentaire " + cible2._id + " existe-t-il encore ? " +
      (dbm.comments.findOne({ _id: cible2._id }) !== null));


// CAS 3 — contre-exemple SANS transaction : la meme panne laisse la
// base incoherente. C'est ce que la transaction evite.
ligne("6. CAS 3 — contre-exemple : les memes ecritures SANS transaction");

const refSansTx = etat("avant");
const cible3 = dbm.comments.findOne({ movie_id: FILM_ID });
try {
  print("  deleteOne (hors transaction) -> " +
        dbm.comments.deleteOne({ _id: cible3._id }).deletedCount);
  throw new Error("PANNE SIMULEE : le processus meurt AVANT le $inc");
  // eslint-disable-next-line no-unreachable
  dbm.movies.updateOne({ _id: FILM_ID }, { $inc: { num_mflix_comments: -1 } });
} catch (e) {
  print("  exception : " + e.message + "  (aucun rollback possible)");
}
const apresSansTx = etat("apres panne");
print("  delta compteur : " + (apresSansTx.compteur - refSansTx.compteur) +
      "   delta commentaires : " + (apresSansTx.reels - refSansTx.reels));
print("  >>> INCOHERENCE : le commentaire a disparu mais le compteur n'a pas bouge.");
print("  >>> l'ecart compteur/reel vaut maintenant " +
      (apresSansTx.compteur - apresSansTx.reels) +
      "  — exactement le bug de la Q4.");

dbm.movies.updateOne({ _id: FILM_ID }, { $inc: { num_mflix_comments: -1 } });
print("  (reparation manuelle appliquee)");
etat("apres reparation");

session.endSession();
print("\n-- FIN transaction.js --");
