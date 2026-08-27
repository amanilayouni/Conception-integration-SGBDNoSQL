# Résilience applicative — sortie de `writer.py`

## Test Q30 — démarrage nominal

```
URI = mongodb://mongo1:27017,mongo2:27017,mongo3:27017/?replicaSet=rs0&retryWrites=true
write concern = WriteConcern()
02:17:51 | primary=AUCUN | OK | 0.62s
02:17:52 | primary=mongo1:27017 | OK | 0.03s
02:17:53 | primary=mongo1:27017 | OK | 0.01s
02:17:54 | primary=mongo1:27017 | OK | 0.01s
02:17:55 | primary=mongo1:27017 | OK | 0.01s
```

Primary vu par l'application : `mongo1:27017`.

## Test Q31 — `docker kill mongo1` en cours

Sortie complète (commande `python writer.py` dans le conteneur `pylab`, 45 s, `retryWrites=true`) :

```
URI = mongodb://mongo1:27017,mongo2:27017,mongo3:27017/?replicaSet=rs0&retryWrites=true
write concern = WriteConcern()
02:17:51 | primary=AUCUN | OK | 0.62s
02:17:52 | primary=mongo1:27017 | OK | 0.03s
02:17:53 | primary=mongo1:27017 | OK | 0.01s
02:17:54 | primary=mongo1:27017 | OK | 0.01s
02:17:55 | primary=mongo1:27017 | OK | 0.01s
02:17:56 | primary=mongo1:27017 | OK | 0.01s
02:17:57 | primary=mongo1:27017 | OK | 0.01s
02:17:58 | primary=mongo1:27017 | OK | 0.01s
02:17:59 | primary=mongo1:27017 | OK | 0.01s
02:18:00 | primary=mongo1:27017 | OK | 0.01s
02:18:01 | primary=mongo1:27017 | OK | 0.01s
02:18:02 | primary=mongo1:27017 | OK | 0.01s
02:18:03 | primary=mongo1:27017 | OK | 0.01s
02:18:04 | primary=mongo1:27017 | OK | 0.01s
02:18:05 | primary=mongo1:27017 | OK | 0.01s
02:18:06 | primary=mongo1:27017 | FAIL | 5.04s | AutoReconnect: mongo1:27017: [Errno 104] Connection reset by peer ...
02:18:11 | primary=AUCUN | FAIL | 5.39s | ServerSelectionTimeoutError: No primary available for writes, Timeout: 5.0s ...
02:18:18 | primary=AUCUN | OK | 1.44s
02:18:19 | primary=mongo3:27017 | OK | 0.01s
02:18:20 | primary=mongo3:27017 | OK | 0.01s
02:18:21 | primary=mongo3:27017 | OK | 0.01s
02:18:22 | primary=mongo3:27017 | OK | 0.01s
02:18:23 | primary=mongo3:27017 | OK | 0.01s
02:18:24 | primary=mongo3:27017 | OK | 0.01s
02:18:25 | primary=mongo3:27017 | OK | 0.01s
02:18:26 | primary=mongo3:27017 | OK | 0.01s
02:18:27 | primary=mongo3:27017 | OK | 0.01s
02:18:28 | primary=mongo3:27017 | OK | 0.01s
02:18:29 | primary=mongo3:27017 | OK | 0.01s
02:18:30 | primary=mongo3:27017 | OK | 0.01s
02:18:31 | primary=mongo3:27017 | OK | 0.01s
02:18:32 | primary=mongo3:27017 | OK | 0.01s
02:18:33 | primary=mongo3:27017 | OK | 0.01s
02:18:34 | primary=mongo3:27017 | OK | 0.01s


ecritures reussies (vues par le script) : 35
eecritures en echec                      : 2
count_documents reel dans la collection : 35
```

- **Deux secondes d'écritures en échec consécutives** : `#016` (02:18:06) et `#017` (02:18:11).
- **Première écriture OK après la panne** : `#018` (02:18:18) — ~12 s d'indisponibilité pour l'application.
- **Écritures perdues** : 0 (35 réussies = 35 documents en base).
- Le driver s'est reconnecté seul ; le changement de primary est visible à `#019` (`mongo3`).

## Test Q32(a) — `retryWrites=false` même panne

Résumé (sortie complète dans `out_kill_retryfalse.txt`) :

- Échecs : 2 (mêmes lignes `ServerSelectionTimeoutError`).
- Réussies : 30.
- `count_documents` réel : 30.

Écart entre `retryWrites=true` et `retryWrites=false` : **0** dans le cas d'une panne avec aucun primary pendant l'élection.

## Test Q32(c) — `rs.stepDown()` rapide (50 écritures/s)

**Avec `retryWrites=true`** :

```

tentatives                              : 1482
ecritures reussies (vues par le script) : 1482
ecritures en echec                      : 0
count_documents reel dans la collection : 1482
```

**Avec `retryWrites=false`** :

```
02:28:16.765 | #1454 | primary=mongo2:27017 | FAIL | 0.01s | WriteConcernError code=11602: operation was interrupted, full error: {'code': 11602, 'codeName': 'InterruptedDueToReplStateChange', 'errmsg': 'operation was int...'


tentatives                              : 1479
ecritures reussies (vues par le script) : 1478
ecritures en echec                      : 1
count_documents reel dans la collection : 1479
```

- Exception sans `retryWrites` : `InterruptedDueToReplStateChange` (code 11602).
- Le document a bien été écrit (`count` = 1479), mais l'application a reçu une erreur.

Conclusion : `retryWrites` protège contre les rétrogradations de primary (`stepDown`), pas contre les élections sans primary.

## Test Q33(b) — `w: "majority"` avec panne

Commande lancée avec `WC=majority` :

```
URI = mongodb://mongo1:27017,mongo2:27017,mongo3:27017/?replicaSet=rs0&retryWrites=true
write concern = WriteConcern(w='majority')
02:29:50 | primary=mongo1:27017 | OK | 0.01s
...
02:29:51 | primary=AUCUN | FAIL | 5.30s | ServerSelectionTimeoutError ...
02:29:56 | primary=AUCUN | FAIL | 5.22s | ServerSelectionTimeoutError ...
02:30:02 | primary=AUCUN | OK | 4.04s
02:30:06 | primary=mongo2:27017 | OK | 0.01s
...


tentatives                              : 29
ecritures reussies (vues par le script) : 27
ecritures en echec                      : 2
count_documents reel dans la collection : 27
```

Avec `w: "majority"`, le décompte script et le décompte réel coïncident (27 = 27). Les 2 échecs n'ont pas persisté.
