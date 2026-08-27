"""Surveille le primary du Replica Set toutes les 300 ms.

Usage : python watch_primary.py [hote ...]      (defaut : mongo1 mongo2 mongo3)
A lancer dans le reseau du cluster (rslab_default), car le driver decouvre
les membres sous leurs noms mongo1/mongo2/mongo3 (voir Q29).
Affiche un horodatage relatif a chaque changement de primary.
"""
import sys
import time
from datetime import datetime

from pymongo import MongoClient
from pymongo.errors import PyMongoError

HOSTS = sys.argv[1:] or ["mongo1", "mongo2", "mongo3"]
HOSTS = [h if ":" in h else h + ":27017" for h in HOSTS]
URI = "mongodb://" + ",".join(HOSTS) + "/?replicaSet=rs0&serverSelectionTimeoutMS=300"

client = MongoClient(URI)
t0 = time.time()
last = "?"

print(f"[watch] surveillance de {HOSTS} - Ctrl+C pour arreter", flush=True)
try:
    while True:
        try:
            primary = client.primary
            current = f"{primary[0]}:{primary[1]}" if primary else "AUCUN"
        except PyMongoError:
            current = "AUCUN"
        if current != last:
            stamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
            print(f"{stamp}  t+{time.time() - t0:7.2f}s  primary = {current}", flush=True)
            last = current
        time.sleep(0.3)
except KeyboardInterrupt:
    print("[watch] fin")
