"""Ecrit un document par seconde dans census.heartbeat et journalise le resultat.

Usage : python writer.py "<uri>" [duree_secondes]

Variables d'environnement :
  WC=majority   -> insertions en writeConcern { w: "majority" }   (Q33 b)
  INTERVAL=0.02 -> cadence d'ecriture en secondes (defaut 1.0)    (Q32 c)
                   si INTERVAL < 1, seules les lignes FAIL sont affichees
                   pour ne pas noyer le journal.
"""
import os
import sys
import time
from datetime import datetime

from pymongo import MongoClient
from pymongo.errors import PyMongoError
from pymongo.write_concern import WriteConcern

URI = sys.argv[1] if len(sys.argv) > 1 else "mongodb://localhost:27017/?replicaSet=rs0"
DURATION = int(sys.argv[2]) if len(sys.argv) > 2 else 60
INTERVAL = float(os.environ.get("INTERVAL", "1"))
VERBOSE = INTERVAL >= 1

client = MongoClient(URI, serverSelectionTimeoutMS=5000)
coll = client["census"]["heartbeat"]
if os.environ.get("WC") == "majority":
    coll = coll.with_options(write_concern=WriteConcern(w="majority"))

print(f"URI = {URI}")
print(f"write concern = {coll.write_concern} | interval = {INTERVAL}s")

ok = 0
ko = 0
i = 0
t_end = time.time() + DURATION

while time.time() < t_end:
    i += 1
    started = time.time()
    stamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    try:
        primary = client.primary
        primary = f"{primary[0]}:{primary[1]}" if primary else "AUCUN"
    except PyMongoError:
        primary = "AUCUN"
    try:
        coll.insert_one({"i": i, "ts": datetime.now()})
        ok += 1
        status, detail = "OK", ""
    except PyMongoError as exc:
        ko += 1
        status = "FAIL"
        code = getattr(exc, "code", None)
        detail = f" | {type(exc).__name__} code={code}: {str(exc)[:130]}"
    if VERBOSE or status == "FAIL":
        elapsed = time.time() - started
        print(f"{stamp} | #{i:04d} | primary={primary} | {status} | {elapsed:.2f}s{detail}", flush=True)
    time.sleep(max(0, INTERVAL - (time.time() - started)))

print("\n--- RESUME ---")
print(f"tentatives                              : {i}")
print(f"ecritures reussies (vues par le script) : {ok}")
print(f"ecritures en echec                      : {ko}")
try:
    print(f"count_documents reel dans la collection : {coll.count_documents({})}")
except PyMongoError as exc:
    print(f"count_documents impossible : {exc}")
