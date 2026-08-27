# Mesures de bascule — TP Jour 3

## Tableau des scénarios

| Scénario         | Commande exécutée  | Délai mesuré | Nœud élu  | Écritures perdues ? |
|------------------|--------------------|--------------|-----------|---------------------|
| Arrêt propre     | `docker stop mongo1` | **~10,2 s**  | `mongo2`  | Non                 |
| Panne brutale    | `docker kill mongo1` | **~11,5 s**  | `mongo3`  | Non                 |
| Retour du nœud   | `docker start mongo1` | **~12,4 s**  | `mongo1`  | -                   |
| Timeout 2 000 ms | `docker kill mongo1` après `electionTimeoutMillis=2000` | **~7,5 s** | `mongo3`  | -                   |

## Commentaire DSI

Sur cette machine, une panne d'un nœud entraîne environ **10 à 12 s d'indisponibilité en écriture** avec la configuration par défaut. Cela reste très en-deçà du SLA 99,9 % (43 min/mois). Abaisser `electionTimeoutMillis` à 2 000 ms gagne ~4 s mais augmente le risque d'élections parasites en cas de hoquets réseau.
