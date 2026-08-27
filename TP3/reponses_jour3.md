# Réponses TP Jour 3 — Replication & haute disponibilité



## Partie 0 — Monter le Replica Set

### Q1. État intermédiaire non initialisé

```bash
docker exec mongo1 mongosh --quiet --eval 'printjson(db.hello())'
```

résultat : `isWritablePrimary: false`, pas de champ `primary`, `info: "Does not have a valid replica set config"`.

```bash
docker exec -i mongo1 mongosh --quiet --file /dev/stdin <<'JS'
try { db.test.insertOne({ a: 1 }) } catch(e) { print("code=" + e.code, "codeName=" + e.codeName, "errmsg=" + e.errmsg) }
JS
```

Sortie : `code=10107 codeName=NotWritablePrimary errmsg=not primary`.

Conclusion : mongod lancé avec `--replSet` mais non initialisé n'est ni primary ni secondary.

### Q2. Initialisation

```bash
docker exec -i mongo1 mongosh --quiet < init-rs.js

docker exec -i mongo1 mongosh --quiet --file /dev/stdin <<'JS'
print(rs.status().members.map(m => m.name + " " + m.stateStr).join(" | "))
JS
```

Sortie : `mongo1:27017 PRIMARY | mongo2:27017 SECONDARY | mongo3:27017 SECONDARY`.

Le primary est `mongo1`. Dans `init-rs.js`, c'est le champ `priority: 2` (contre 1 pour les autres) qui l'éluit (départage par `_id` si égalité).

### Q3. verification du contenu

```bash
docker exec mongo1 mongoimport --db census --collection zips --drop --file /tmp/zips.json
```

`29470 document(s) imported successfully`.

```bash
docker exec -i mongo1 mongosh --quiet --file /dev/stdin <<'JS'
db = db.getSiblingDB("census");
print("documents:", db.zips.countDocuments({}));
print("états:", db.zips.distinct("state").length);
printjson(db.zips.aggregate([{ $group: { _id: null, popTotale: { $sum: "$pop" } } }]).toArray());
JS
```

- documents : 29470
- États distincts : 51
- population totale : 248709873

Le nombre d'États (51) surprend car on oublie Washington DC : la collection le compte comme un État.

### Q4. Qualité de données

```bash
docker exec -i mongo1 mongosh --quiet --file /dev/stdin <<'JS'
db = db.getSiblingDB("census");
print("zip distincts:", db.zips.distinct("zip").length);
printjson(db.zips.aggregate([
  { $group: { _id: "$zip", n: { $sum: 1 } } },
  { $match: { n: { $gt: 1 } } },
  { $sort: { _id: 1 } }
]).toArray());
JS
```

- 29467 `zip` distincts pour 29 470 documents.
- Duplicatas : `32350`, `42223`, `63673`.

On ne peut donc pas créer d'index unique sur `zip` :

```bash
docker exec -i mongo1 mongosh --quiet --file /dev/stdin <<'JS'
try { db.getSiblingDB("census").zips.createIndex({ zip: 1 }, { unique: true }) }
catch(e) { print("code=" + e.code, "codeName=" + e.codeName, e.errmsg) }
JS
```

Sortie : `code=11000 codeName=DuplicateKey ... dup key: { zip: "32350" }`.

Conclusion : `zip` ressemble à une clé mais n'est pas unique.

### Q5. Population nulle

- 67 documents ont `pop: 0`.
- Ce n'est pas forcément une erreur : certains codes postaux correspondent à des zones non habitées, boîtes postales ou routes sans résidents.

---

## Partie 1 — Anatomie du Replica Set et de l'oplog

### Q6. Configuration

```bash
docker exec -i mongo1 mongosh --quiet --file /dev/stdin <<'JS'
printjson(rs.conf().settings);
JS
```

Valeurs relevées : `electionTimeoutMillis: 10000`, `heartbeatIntervalMillis: 2000`.

Signification : un secondary déclare le primary mort au bout de **10 s** d'absence, alors qu'il l'interroge toutes les **2 s**.

### Q7. État des membres

```bash
docker exec -i mongo1 mongosh --quiet --file /dev/stdin <<'JS'
rs.status().members.forEach(m =>
  print(m.name, "|", m.stateStr, "| health=" + m.health, "| lastHeartbeat=" + (m.lastHeartbeat || "n/a")))
JS
```

Tous `health: 1`, `stateStr` PRIMARY/SECONDARY. En production, `lastHeartbeat` manquant ou ancien indique un nœud injoignable.

### Q8. Taille de l'oplog

```bash
docker exec -i mongo1 mongosh --quiet --file /dev/stdin <<'JS'
const l = db.getSiblingDB("local");
print("maxSize:", l.oplog.rs.stats().maxSize);
print("total:", l.oplog.rs.countDocuments({}));
JS
```

- `maxSize` : 134 217 728 octets = 128 Mo.
- Cette valeur vient de `--oplogSize 128` dans `docker-compose.rs.yml`.
- Sans cette option, MongoDB prend 5% du disque, plafonné à 50 Go.

### Q9. Granularité de l'oplog

```bash
docker exec -i mongo1 mongosh --quiet --file /dev/stdin <<'JS'
print(db.getSiblingDB("local").oplog.rs.countDocuments({ op: "i", ns: "census.zips" }));
JS
```

Sortie : `29470`, soit exactement le nombre de documents importés.

Conclusion : le `mongoimport` envoie des lots, mais l'oplog enregistre **une opération d'insertion par document**.

### Q10. Une entrée d'insertion

```bash
docker exec -i mongo1 mongosh --quiet --file /dev/stdin <<'JS'
printjson(db.getSiblingDB("local").oplog.rs.findOne({ op: "i", ns: "census.zips" }));
JS
```

Champs vus : `op: "i"`, `ns: "census.zips"`, `o` (document complet avec `_id`), `o2` (`_id`), `ts` (Timestamp), `wall` (heure réelle).

L'opération est idempotente car elle contient l'`_id` dans `o` et `o2` : la rejouer une deuxième fois écrase le même document, sans doublon.

### Q11. Une entrée de mise à jour

```bash
docker exec -i mongo1 mongosh --quiet --file /dev/stdin <<'JS'
db = db.getSiblingDB("census");
printjson(db.zips.updateMany({ state: "TX" }, { $inc: { pop: 1 } }));
printjson(db.getSiblingDB("local").oplog.rs.findOne({ op: "u", ns: "census.zips" }));
JS
```

`updateMany` a modifié 1 676 documents. Dans l'oplog, le champ `o` ne contient **pas** `$inc` mais `diff: { u: { pop: 16863 } }`, c'est-à-dire **la valeur résultante**.

Pourquoi : `$inc { pop: 1 }` n'est pas idempotent ; en le remplaçant par la valeur finale, on peut appliquer l'opération 2 fois sans incrémenter 2 fois.

### Q12. Dimensionnement de l'oplog

```bash
docker exec -i mongo1 mongosh --quiet --file /dev/stdin <<'JS'
const s = db.getSiblingDB("local").oplog.rs.stats();
print("size:", s.size);
print("count:", s.count);
print("moyenne octets/op:", (s.size / s.count).toFixed(1));
print("ops possibles dans 128 Mo:", Math.round(134217728 / (s.size / s.count)));
print("fenetre a 300 w/s (h):", (134217728 / (s.size / s.count) / 300 / 3600).toFixed(2));
JS
```

Mesures (après import et update TX) :
- `size` : 12 019 998 octets
- `count` : 31 183
- moyenne : **385,5 octets/op**
- 128 Mo peuvent stocker environ **348 196 opérations**
- à 300 écritures/s, fenêtre ≈ **0,32 h** (~19 min)

Conclusion : un secondary arrêté vendredi 18 h ne peut pas rattraper lundi 9 h (63 h) par l'oplog. Il devra faire une **resynchronisation complète** (initial sync).

---

## Partie 2 — Lire et écrire dans un replica set 

### Q13. Lire sur un secondary 

```bash
docker exec mongo2 mongosh --quiet census --eval 'db.zips.countDocuments({})'
```

Sortie : `29470`.

Avec `mongosh` récent, `rs.secondaryOk()` n'est plus nécessaire : la session en mode directe positionne automatiquement `readConcern: available`/`secondaryOk`.

### Q14. Écriture sur un secondary

```bash
docker exec -i mongo2 mongosh --quiet --file /dev/stdin <<'JS'
try { db.getSiblingDB("census").zips.insertOne({ test: 1 }) }
catch(e) { print("code=" + e.code, "codeName=" + e.codeName, e.errmsg) }
JS
```

Sortie : `code=10107 codeName=NotWritablePrimary not primary`.

Lecture autorisée, écriture interdite car seul le primary accepte les écritures.

### Q15. Retard de réplication

```bash
docker exec mongo1 mongosh --quiet --eval 'rs.printSecondaryReplicationInfo()'
```

Sortie initiale : retard `0 secs`.

Après `insertMany` de 1 000 documents : retard `7 secs`, puis retour à `0` quelques secondes plus tard.

La réplication est **asynchrone**.

### Q16. Read Preference

```bash
docker exec -i mongo1 mongosh --quiet --file /dev/stdin <<'JS'
db = db.getSiblingDB("census");
db.getMongo().setReadPref("primary");
print("primary:", db.zips.countDocuments({ state: "NY" }));
db.getMongo().setReadPref("secondary");
print("secondary:", db.zips.countDocuments({ state: "NY" }));
JS
```

Les deux retournent `1596`.

- Lire sur secondary est acceptable pour des statistiques / tableaux de bord (tolérance au `stale`).
- C'est dangereux pour des transactions financières ou des réservations, où on veut la dernière valeur confirmée.

---

## Partie 3 — Failover

### Q17. Panne propre

```bash
python watch_primary.py

docker stop mongo1
```

Mesure `watch_primary.py` :

```
t+   0.30s  primary = mongo1:27017
t+  10.21s  primary = mongo2:27017
```

Délai : **~10,2 s**.
Nœud élu : **mongo2**.

### Q18. État de mongo1 après l'arrêt

```bash
docker exec -i mongo2 mongosh --quiet --file /dev/stdin <<'JS'
rs.status().members.forEach(m =>
  print(m.name, "|", m.stateStr, "| health=" + m.health, "|", (m.lastHeartbeatMessage || "")))
JS
```

Sortie : `mongo1:27017 | (not reachable/healthy) | health=0 | Error connecting to mongo1...`.

### Q19. Retour du nœud

```bash
docker start mongo1
```

Immédiatement : `myState: 2` (SECONDARY). Puis redevient PRIMARY au bout de **~12,4 s** (priority takeover).

```bash
docker exec -i mongo1 mongosh --quiet --file /dev/stdin <<'JS'
print("priority mongo1:", rs.conf().members[0].priority);
JS
```

`priority: 2` explique la reprise. Le cluster a subi **2 bascules**. Les priorités asymétriques provoquent des mouvements inutiles et des coupures d'écriture supplémentaires.

### Q20. Rattrapage par l'oplog

Avant de redémarrer mongo1, insertion sur le nouveau primary :

```bash
docker exec -i mongo2 mongosh --quiet --file /dev/stdin <<'JS'
db.getSiblingDB("census").pendant_panne.insertMany([{ n: 1 }, { n: 2 }, { n: 3 }]);
JS
```

Après retour de mongo1 :

```bash
docker exec -i mongo1 mongosh --quiet --file /dev/stdin <<'JS'
print("docs vus:", db.getSiblingDB("census").pendant_panne.countDocuments({}));
JS
```

Sortie : `3`. Les écritures ont été récupérées via l'**oplog** (Partie 1).

### Q21. Panne brutale

```bash
docker kill mongo1
```

`watch_primary.py` :

```
02:11:24.183  t+   0.00s  primary = AUCUN
02:11:35.290  t+  11.46s  primary = mongo3:27017
```

Délai : **~11,5 s**, nœud élu : **mongo3**.

`electionTimeoutMillis` = 10 000 ms. Le délai mesuré est **légèrement supérieur** : le timeout démarre au **dernier heartbeat reçu** (au plus 2 s avant le kill, période heartbeatIntervalMillis), puis l'élection elle-même prend quelques ms.

### Q22. Synthèse

| Scénario         | Commande        | Délai mesuré | Nœud élu  | Écritures perdues ? |
|------------------|-----------------|--------------|-----------|---------------------|
| Arrêt propre     | `docker stop`   | ~10,2 s      | mongo2    | non                 |
| Panne brutale    | `docker kill`   | ~11,5 s      | mongo3    | non (dans nos tests)|
| Retour du nœud   | `docker start`  | ~12,4 s      | mongo1    | -                   |

Annonce DSI : avec 3 nœuds, une panne serveur entraîne environ **10–12 s d'indisponibilité en écriture**, bien en dessous du SLA 99,9 % (43 min/mois). Il faut cependant activer `retryWrites` et utiliser `w: "majority"` pour éviter les pertes.

### Q23. Le quorum

**3 nœuds, 1 panne** (tuer mongo3) : le primary reste en place, écritures possibles.

**3 nœuds, 2 pannes** (tuer mongo2 + mongo3) :

```bash
docker kill mongo2 mongo3
# immédiatement
# +15 s
```

- Immédiatement : `isWritablePrimary: true`, `myState: 1` (le primary n'a pas encore détecté la perte).
- +15 s : `isWritablePrimary: false`, `myState: 2`.
- Lecture : possible (`count` retourne `29470`).
- Écriture : impossible, `NotWritablePrimary`.

Avec **4 nœuds + 2 pannes** : idem, plus de primary éligible (`isWritablePrimary: false` au bout de quelques secondes).

Explication : un set de 3 a besoin de **2 votes** (majorité de 3), un set de 4 a besoin de **3 votes** (majorité de 4). Ajouter un 4e nœud n'améliore donc pas la tolérance aux pannes.

---

## Partie 4 — Write Concern & Read Concern

### Q24. `w: 1` vs `w: "majority"`

```bash
docker exec -i mongo1 mongosh --quiet --file /dev/stdin <<'JS'
db = db.getSiblingDB("census");
printjson(db.demo.insertOne({ a: 1 }, { writeConcern: { w: 1 } }));
printjson(db.demo.insertOne({ b: 1 }, { writeConcern: { w: "majority" } }));
JS
```

Les deux passent. `w: 1` n'attend qu'une seule confirmation (le primary). `w: "majority"` attend qu'une majorité de nœuds ait reçu l'opération. Dans la Partie 3, si le primary meurt avant d'avoir répliqué, `w: 1` peut perdre l'écriture.

### Q25. Write concern impossible

```bash
docker exec -i mongo1 mongosh --quiet --file /dev/stdin <<'JS'
const t0 = Date.now();
try { db.getSiblingDB("census").demo.insertOne({ a: 1 }, { writeConcern: { w: 4, wtimeout: 3000 } }) }
catch(e) { print("duree:", Date.now() - t0, "ms"); print("codeName=" + e.codeName); print(e.errmsg) }
JS
```

Sortie : `duree: 14 ms codeName=UnsatisfiableWriteConcern Not enough data-bearing nodes`.

MongoDB refuse immédiatement car `w: 4` est impossible avec un set de 3 nœuds ; il ne respecte même pas `wtimeout`.

### Q26. Échec de write concern

Avec `mongo3` arrêté :

```bash
docker exec -i mongo1 mongosh --quiet --file /dev/stdin <<'JS'
db = db.getSiblingDB("census");
try { db.demo.insertOne({ b: 1 }, { writeConcern: { w: "majority", wtimeout: 3000 } }); print("majority OK") }
catch(e) { print("majority FAIL", e.codeName) }
try { db.demo.insertOne({ c: 1 }, { writeConcern: { w: 3, wtimeout: 3000 } }); print("w:3 OK") }
catch(e) { print("w:3 FAIL", e.codeName) }
print("count:", db.demo.countDocuments({}));
JS
```

Sortie :
- `w: "majority"` passe.
- `w: 3` échoue (`WriteConcernFailed`) après ~3 s.
- `count` : **5** documents (au lieu de 4 attendus).

L'échec d'un write concern **n'annule pas** l'opération : le document `{ c: 1 }` a été écrit localement mais n'est pas majoritaire. Si l'application rejoue l'insertion après l'erreur, elle crée un doublon.

### Q27. `j: true`

`j: true` exige que l'opération soit écrite dans le journal (journal) avant de répondre. Cela protège contre une perte de courant générale, au coût d'un fsync supplémentaire. Avec `w: "majority"`, MongoDB 7 active `j: true` par défaut (`writeConcernMajorityJournalDefault: true`).

### Q28. Read Concern `majority` vs `local`

```bash
db.demo.find().readConcern("local").itcount()     // 7
db.demo.find().readConcern("majority").itcount()  // 7
```

`readConcern: "majority"` ne retourne que les données confirmées par une majorité de nœuds, donc jamais des écritures `w: 1` qui pourraient être annulées. `readConcern: "local"` voit tout ce qui est sur le primary, y compris le document `{ c: 1 }` de Q26 qui n'a pas atteint `w: "majority"`.

---

## Partie 5 — Résilience applicative

### Q29. Le piège de l'URI

```bash
python writer.py "mongodb://localhost:27017,localhost:27018,localhost:27019/?replicaSet=rs0"
```

Sortie (extraits) :

```
ServerSelectionTimeoutError: ...
Topology Description: <TopologyDescription ... servers:
  <ServerDescription ('mongo1', 27017) ...
  <ServerDescription ('mongo2', 27017) ...
  <ServerDescription ('mongo3', 27017) ...
```

(a) Noms d'hôtes essayés : `mongo1:27017`, `mongo2:27017`, `mongo3:27017`.

(b) On a écrit `localhost` trois fois, mais le driver a remplacé la liste par les hôtes déclarés dans `rs.conf()`.

(c) Sans `?replicaSet=rs0`, la connexion locale à un seul nœud n'échoue pas toujours, mais dès qu'un nœud se déclare membre d'un Replica Set, le driver lance la découverte et remplace la seed list.

(d) Option pour forcer la connexion directe : `directConnection=true`.

Exécution depuis le conteneur `pylab` :

```bash
docker exec -i pylab mongosh --quiet --file /dev/stdin <<'JS'
// non, on lance python
JS
```

```bash
python writer.py "mongodb://mongo1:27017/?directConnection=true"
```

Résultat : `topology_type_name = Single`, `client.primary = None`, l'insertion fonctionne mais on perd la découverte du set.

### Q30. Premier lancement dans le réseau

```bash
docker exec pylab python writer.py "mongodb://mongo1:27017,mongo2:27017,mongo3:27017/?replicaSet=rs0&retryWrites=true" 60
```

5 premières lignes :

```
02:17:51  | primary=AUCUN | OK | 0.62s
02:17:52  | primary=mongo1:27017 | OK | 0.03s
02:17:53  | primary=mongo1:27017 | OK | 0.01s
02:17:54  | primary=mongo1:27017 | OK | 0.01s
02:17:55  | primary=mongo1:27017 | OK | 0.01s
```

Le script voit `mongo1:27017` comme primary.

### Q31. Kill du primary pendant l'application

Pendant l'écriture :

```bash
docker kill mongo1
```

Extrait du journal complet (voir `resilience.md`) :

```
02:18:06  | primary=mongo1:27017 | FAIL | 5.04s | ServerSelectionTimeoutError: ...
02:18:11  | primary=AUCUN | FAIL | 5.39s | ServerSelectionTimeoutError: ...
02:18:18  | primary=AUCUN | OK | 1.44s
02:18:19  | primary=mongo3:27017 | OK | 0.01s
```

(a) **2 secondes d'écritures en échec consécutives** (`#016` et `#017`). Première ligne en échec : `#016` à 02:18:06 ; première ligne redevenue OK : `#018` à 02:18:18.
(b) 35 réussies, 2 échouées.
(c) Oui, le driver s'est reconnecté seul. Le changement de primary apparaît à la ligne `#019` (`primary=mongo3:27017`).
(d) Le cluster a élu un nouveau primary en ~11,5 s (Q21). L'application a été indisponible ~12 s (de 02:18:06 à 02:18:18) car le driver attend `serverSelectionTimeoutMS` (5 s) avant d'échouer une ligne.

### Q32. `retryWrites`

(a) Même scénario avec `retryWrites=false` : 2 échecs identiques. Écart avec `retryWrites=true` : **0** dans ce cas.

(b) L'exception est la même (`ServerSelectionTimeoutError`). Pendant une bascule il n'y a **zéro primary** pendant ~10–12 s. Le driver attend le `serverSelectionTimeoutMS` de 5 s, puis échoue. `retryWrites` ne peut pas rejouer s'il n'y a aucun primary à qui parler.

(c) **Preuve avec `rs.stepDown()`** :

- `retryWrites=true`, 1 482 écritures à 50/s : **0 échec**.
- `retryWrites=false`, 1 479 écritures à 50/s : **1 échec**.

Exception sans `retryWrites` :

```
WriteConcernError code=11602: operation was interrupted
```

Cette erreur (`InterruptedDueToReplStateChange`) est différente du `ServerSelectionTimeoutError` du (a).

Conclusion : `retryWrites` protège contre une **rétrogradation du primary qui reste joignable** (`stepDown`), mais il **ne peut rien** contre une élection complète sans primary.

(d) `retryWrites` peut rejouer une insertion sans risque de doublon grâce au champ `_id` (idempotence, vu en Q10). `updateMany` et `deleteMany` ne sont pas rejoués automatiquement car ils touchent plusieurs documents et ne sont pas idempotents de manière sûre.

### Q33. Décompte final

(a) Sans `w: "majority"` (run par défaut) :
- script : 35 écritures réussies
- `count_documents` réel : 35
- Écart : 0

(b) Avec `w: "majority"` :
- 29 tentatives, 27 réussies, 2 échecs
- `count_documents` réel : 27
- Écart : 0 (les échecs n'ont pas persisté)

(c) Phrase DSI :

> Lors d'une panne serveur brutale, notre service est indisponible en écriture pendant environ **10 à 12 secondes** et ne perd **aucune écriture**, à condition d'utiliser `retryWrites=true` et de connecter l'application à l'ensemble du Replica Set. Avec `w: "majority"`, une écriture non confirmée reste non persistée, ce qui limite aussi le risque de doublon en cas de retry.

---

## Partie 6 — Réflexion

### R1. Le collègue qui veut un 4e nœud

Ajout de `mongo4` :

```bash
docker run -d --name mongo4 --network rslab_default mongo:7.0 \
  mongod --replSet rs0 --bind_ip_all --port 27017 --oplogSize 128
docker exec -i mongo1 mongosh --quiet --file /dev/stdin <<'JS'
rs.add("mongo4:27017")
JS
```

**4 nœuds + 2 pannes** (`docker stop mongo2 mongo3`) : au bout de quelques secondes, `isWritablePrimary: false`, `myState: 2`, écritures impossibles.

**3 nœuds + 1 panne** (Q23) : `isWritablePrimary: true`, écritures toujours possibles.

Réponse au collègue : un 4e nœud n'améliore pas la tolérance aux pannes car un set de 4 a toujours besoin de 3 votes. Si le budget est de 4 machines, mieux vaut un **Replica Set à 3 nœuds + 1 arbitre** (coût disque moindre), en sachant que l'arbitre ne stocke aucune donnée et qu'il ne peut pas aider en `w: "majority"`.

### R2. Réplication vs Sharding

- **Réplication** : assurer la haute disponibilité et la redondance des données en cas de panne d'un nœud.
- **Sharding** : répartir les données sur plusieurs machines pour monter en charge et en volume.

Un cluster shardé non répliqué est plus fragile qu'un simple Replica Set : chaque shard possède un seul point de défaillance (son primary), donc la perte d'un shard rend une partie des données inaccessible.

### R3. Régler `electionTimeoutMillis`

Passage à 2 000 ms :

```bash
docker exec -i mongo1 mongosh --quiet --file /dev/stdin <<'JS'
cfg = rs.conf(); cfg.settings.electionTimeoutMillis = 2000; rs.reconfig(cfg);
JS
```

Mesure :

- Avant (10 000 ms) : **~11,5 s** de bascule.
- Après (2 000 ms) : **~7,5 s** de bascule.

Rapport : 11,5 / 7,5 ≈ 1,5. Ce n'est pas 5 fois plus rapide car une partie du délai (heartbeat, détection de panne, élection proprement dite) ne dépend pas de ce timeout.

Risque d'un timeout trop bas : un hoquet réseau de 3 s peut déclencher une élection inutile, avec un coût en indisponibilité.

Recommandation : garder **10 000 ms** par défaut. Sur un réseau très stable, on pourrait descendre à 5 000 ms. Argument : mes 11,5 s mesurés restent très inférieurs à 43 min/mois autorisés par le SLA 99,9 %.

### R4. Le chiffre honnête

Phrase à la DSI :

> Lors d'une panne brutale, le Replica Set élit un nouveau primary en ~11,5 s, mais l'application constate environ 10–12 s d'indisponibilité effective et aucune perte si `retryWrites=true` ; avec `w: 1`, une écriture peut exister sans être confirmée par une majorité, donc le seul chiffre de Q21 masque le risque réel de données non durables et de pertes clients.

Annoncer uniquement le 11,5 s serait malhonnête car :
1. L'indisponibilité vue par l'application est plus longue (timeout de sélection).
2. Une écriture `w: 1` peut être annulée si le primary meurt avant réplication.
3. Le nombre d'écritures perdues dépend de `retryWrites` et du `WriteConcern`, pas seulement du temps d'élection.
