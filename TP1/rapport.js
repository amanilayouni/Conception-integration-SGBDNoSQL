// rapport.js — TP Jour 1, Partie 5 (Q27)



(function genererRapport() {
  const SEP = "=".repeat(54);

  print(SEP);
  print("RAPPORT - Inspections d'hygiene NYC (base nyc.restaurants)");
  print("Genere le : " + new Date().toISOString());
  print(SEP);

  // ----------------------------------------------------------
  // 1. Nombre total de restaurants
  // ----------------------------------------------------------
  const totalRestaurants = db.restaurants.countDocuments({});

  print("");
  print("[1] EFFECTIF TOTAL");
  print("    Nombre de restaurants : " + totalRestaurants);

  // ----------------------------------------------------------
  // 2. Top 5 des cuisines les plus frequentes
  //    Boucle JS sur distinct("cuisine") + countDocuments()
  // ----------------------------------------------------------
  const cuisines = db.restaurants.distinct("cuisine");
  const compteurCuisines = new Map();

  for (const cuisine of cuisines) {
    compteurCuisines.set(cuisine, db.restaurants.countDocuments({ cuisine: cuisine }));
  }

  const topCuisines = Array.from(compteurCuisines.entries()).sort(function (a, b) {
    return b[1] - a[1];
  });

  print("");
  print("[2] TOP 5 DES CUISINES");
  print("    (" + cuisines.length + " types de cuisine distincts au total)");

  for (let i = 0; i < 5; i++) {
    const nom = topCuisines[i][0];
    const nb = topCuisines[i][1];
    const part = ((nb / totalRestaurants) * 100).toFixed(1);
    print("    " + (i + 1) + ". " + nom.padEnd(22) + String(nb).padStart(6) + "   (" + part + " %)");
  }

  // ----------------------------------------------------------
  // 3. Nombre de restaurants par arrondissement
  //    Boucle JS sur distinct("borough")
  // ----------------------------------------------------------
  const boroughs = db.restaurants.distinct("borough");
  const compteurBoroughs = [];

  for (const borough of boroughs) {
    compteurBoroughs.push({
      borough: borough,
      nb: db.restaurants.countDocuments({ borough: borough })
    });
  }

  compteurBoroughs.sort(function (a, b) {
    return b.nb - a.nb;
  });

  print("");
  print("[3] REPARTITION PAR ARRONDISSEMENT");
  print("    (" + boroughs.length + " arrondissements distincts)");

  let cumul = 0;
  for (const ligne of compteurBoroughs) {
    const part = ((ligne.nb / totalRestaurants) * 100).toFixed(1);
    print("    " + ligne.borough.padEnd(22) + String(ligne.nb).padStart(6) + "   (" + part + " %)");
    cumul += ligne.nb;
  }
  print("    " + "-".repeat(38));
  print("    " + "TOTAL".padEnd(22) + String(cumul).padStart(6));

  // Controle de coherence : la somme par arrondissement doit valoir le total
  if (cumul !== totalRestaurants) {
    print("    /!\\ Ecart de " + (totalRestaurants - cumul) + " document(s) sans champ borough.");
  } else {
    print("    Controle de coherence : OK (somme = effectif total)");
  }

  print("");
  print(SEP);
  print("Fin du rapport.");
  print(SEP);
})();
