#!/usr/bin/env python3
"""
TP Jour 2 — Partie 4 : Drivers PyMongo (Q16 -> Q18)

"""

import os
from collections import Counter

from pymongo import MongoClient, UpdateOne


URI = os.environ.get(
    "MFLIX_URI",
    "mongodb://admin:ipssi2025@localhost:27018/?authSource=admin",
)
client = MongoClient(URI)
db = client["mflix"]

LARGEUR = 70


def titre(txt: str) -> None:
    print("\n" + "=" * LARGEUR)
    print(txt)
    print("=" * LARGEUR)



# Q16 — Computed Pattern : combien de compteurs sont incoherents ?

def vrais_compteurs() -> Counter:
    """Nombre reel de commentaires par movie_id, en UNE seule requete.

    On ne boucle pas sur 23 539 films avec un count_documents() : ce
    serait 23 539 allers-retours reseau. Un seul $group cote serveur
    ramene ~14 245 lignes que l'on charge dans un dict Python.
    """
    pipeline = [{"$group": {"_id": "$movie_id", "n": {"$sum": 1}}}]
    return Counter(
        {d["_id"]: d["n"] for d in db.comments.aggregate(pipeline)}
    )


def q16_reconcilier(verbeux: bool = True):
    reels = vrais_compteurs()

    # projection minimale : on ne rapatrie que les 2 champs utiles
    curseur = db.movies.find({}, {"_id": 1, "num_mflix_comments": 1})

    total = 0
    avec_champ = 0
    incoherents = []          # (id, stocke, reel)
    surestime = sous_estime = 0
    champ_absent_mais_commente = 0
    somme_stockee = somme_reelle = 0

    for film in curseur:
        total += 1
        reel = reels.get(film["_id"], 0)
        somme_reelle += reel

        if "num_mflix_comments" not in film:
            if reel > 0:
                champ_absent_mais_commente += 1
            continue

        avec_champ += 1
        stocke = film["num_mflix_comments"]
        somme_stockee += stocke

        if stocke != reel:
            incoherents.append((film["_id"], stocke, reel))
            if stocke > reel:
                surestime += 1
            else:
                sous_estime += 1

    if verbeux:
        print(f"films au total                          : {total}")
        print(f"films portant num_mflix_comments        : {avec_champ}")
        print(f"films SANS le champ mais commentes      : {champ_absent_mais_commente}")
        print(f"--> COMPTEURS INCOHERENTS               : {len(incoherents)}")
        pct = len(incoherents) / avec_champ * 100 if avec_champ else 0
        print(f"    soit {pct:.2f} % des films portant le champ")
        print(f"    dont sur-estimations                : {surestime}")
        print(f"    dont sous-estimations               : {sous_estime}")
        print(f"films avec un compteur JUSTE            : {avec_champ - len(incoherents)}")
        print(f"somme des compteurs stockes             : {somme_stockee}")
        print(f"somme des commentaires reellement lies  : {somme_reelle}")
        print(f"total de commentaires en base           : {db.comments.count_documents({})}")
        print(f"  (ecart = orphelins + doubles comptages): {somme_stockee - somme_reelle}")

        print("\n5 exemples d'ecarts (id, stocke, reel, delta) :")
        for _id, stocke, reel in incoherents[:5]:
            print(f"  {_id}  stocke={stocke:>4}  reel={reel:>4}  delta={stocke - reel:>+5}")

        pelham = db.movies.find_one({"title": "The Taking of Pelham 1 2 3"})
        print("\ncontrole Q4b — The Taking of Pelham 1 2 3 :")
        print(f"  num_mflix_comments = {pelham['num_mflix_comments']}"
              f"   reel = {reels.get(pelham['_id'], 0)}")

    return reels, incoherents


# Q17 — Correction du compteur via bulk_write / UpdateOne
def q17_corriger(reels: Counter, incoherents) -> int:
    """Un seul aller-retour reseau pour N mises a jour.

    ordered=False : les operations sont independantes, on autorise le
    serveur a les paralleliser et a poursuivre malgre une erreur isolee.
    """
    if not incoherents:
        print("rien a corriger.")
        return 0

    operations = [
        UpdateOne({"_id": _id}, {"$set": {"num_mflix_comments": reels.get(_id, 0)}})
        for _id, _stocke, _reel in incoherents
    ]
    print(f"operations UpdateOne preparees : {len(operations)}")

    resultat = db.movies.bulk_write(operations, ordered=False)
    print(f"matchedCount  : {resultat.matched_count}")
    print(f"modifiedCount : {resultat.modified_count}")
    return resultat.modified_count


# Q18 — Subset Pattern : les 3 commentaires les plus recents
def q18_subset(k_films: int = 10, k_comments: int = 3):
    # 1) les k films les plus commentes, cote serveur
    top = list(db.comments.aggregate([
        {"$group": {"_id": "$movie_id", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": k_films},
    ]))
    ids = [d["_id"] for d in top]

    # 2) pour ces films seulement, les k_comments derniers commentaires.
    #    $sort + $group + $push + $slice : un seul aller-retour serveur
    #    au lieu de 10 requetes find().sort().limit().
    recents = {
        d["_id"]: d["derniers"]
        for d in db.comments.aggregate([
            {"$match": {"movie_id": {"$in": ids}}},
            {"$sort": {"movie_id": 1, "date": -1}},
            {"$group": {
                "_id": "$movie_id",
                "derniers": {"$push": {
                    "name": "$name", "text": "$text", "date": "$date"
                }},
            }},
            {"$project": {"derniers": {"$slice": ["$derniers", k_comments]}}},
        ])
    }

    operations = [
        UpdateOne({"_id": mid}, {"$set": {"recent_comments": recents[mid]}})
        for mid in ids if mid in recents
    ]
    resultat = db.movies.bulk_write(operations, ordered=False)
    print(f"films cibles  : {len(ids)}")
    print(f"modifiedCount : {resultat.modified_count}")

    # 3) verification : un film, sa taille de tableau, son contenu
    print("\nverification sur les 10 films :")
    for mid, nb in [(d["_id"], d["n"]) for d in top]:
        film = db.movies.find_one({"_id": mid}, {"title": 1, "recent_comments": 1})
        if film is None:
            print(f"  {mid}  <film inexistant : movie_id orphelin>")
            continue
        taille = len(film.get("recent_comments", []))
        print(f"  {taille} sous-doc(s) | {nb:>3} commentaires au total | {film.get('title')}")

    print("\ndetail du 1er film :")
    film = db.movies.find_one({"_id": ids[0]}, {"title": 1, "recent_comments": 1, "_id": 0})
    print(f"  titre : {film['title']}")
    print(f"  len(recent_comments) = {len(film['recent_comments'])}")
    for c in film["recent_comments"]:
        print(f"    - {c['date']} | {c['name']} | {c['text'][:60]}...")
        print(f"      cles du sous-document : {sorted(c.keys())}")

    # 4) le cout du pattern, mesure
    from bson import BSON
    doc = db.movies.find_one({"_id": ids[0]})
    poids_doc = len(BSON.encode(doc))
    poids_subset = len(BSON.encode({"recent_comments": doc["recent_comments"]}))
    n_total = db.comments.count_documents({"movie_id": ids[0]})
    poids_moyen_com = poids_subset / len(doc["recent_comments"])
    print("\npourquoi 3 et pas 161 ? — le calcul :")
    print(f"  document complet avec 3 commentaires embarques : {poids_doc} octets")
    print(f"  le seul tableau recent_comments (3 sous-doc)   : {poids_subset} octets")
    print(f"  cout moyen d'un commentaire embarque           : {poids_moyen_com:.0f} octets")
    print(f"  si l'on embarquait les {n_total} commentaires      : "
          f"~{poids_doc - poids_subset + int(poids_moyen_com * n_total)} octets "
          f"({(poids_doc - poids_subset + poids_moyen_com * n_total) / 1024:.1f} Ko)")
    print(f"  soit x{(poids_doc - poids_subset + poids_moyen_com * n_total) / poids_doc:.1f} "
          f"le poids actuel, relu ET reecrit a chaque modification du film.")


if __name__ == "__main__":
    print(f"connecte a : {URI.replace('ipssi2025', '****')}")
    print(f"serveur    : MongoDB {client.server_info()['version']}")

    titre("Q16 — Computed Pattern : reconciliation AVANT correction")
    reels, incoherents = q16_reconcilier()

    titre("Q17 — Correction du compteur (bulk_write / UpdateOne)")
    modifies = q17_corriger(reels, incoherents)

    titre("Q17 — Re-verification : on relance exactement Q16")
    reels2, incoherents2 = q16_reconcilier()
    print(f"\n>>> incoherences restantes : {len(incoherents2)}")
    assert len(incoherents2) == 0, "il reste des compteurs faux !"
    print(">>> OK : 0 incoherence.")

    titre("Q18 — Subset Pattern : recent_comments (3 derniers)")
    q18_subset()

    client.close()
    print("\n-- FIN patterns.py --")
