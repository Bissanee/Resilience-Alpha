# Runbook de remédiation

## 1. Lire un incident

Le moteur reçoit une alerte JSON sur `POST /incidents`, par exemple :

```json
{
  "incident_id": "INC-demo-001",
  "type": "dos",
  "service": "api-paiement",
  "score": 0.93,
  "source_ip": "192.168.137.250",
  "ts": "2026-10-21T10:30:00Z"
}
```

- `GET /incidents` liste les incidents ; `GET /incidents/{incident_id}` donne le détail et les actions.
- Le dashboard est disponible sur `http://127.0.0.1:8088`. Il interroge le moteur via son proxy serveur, toutes les 2 secondes.
- L'IP source et le score sont des indices, pas une preuve suffisante à eux seuls. Le type d'incident doit appartenir à la liste autorisée.

## 2. États et actions

Le déroulement attendu est `DETECTED → DECIDED → ACTING → VERIFYING → RESOLVED`. Les issues terminales alternatives sont `FAILED` et `ESCALATED`.

La liste d'actions autorisées est fermée :
1. `block_ip` : ajouter l'IP à la liste de refus WAF et faire recharger la configuration.
2. `rate_limit` : appliquer une limitation de débit si cette action est disponible et configurée.
3. `restart_service` : redémarrer uniquement un service explicitement autorisé, via le proxy Docker restreint.
4. `verify` : vérifier que le service répond et qu'un paiement de contrôle fictif réussit.

Le moteur ne doit pas exécuter de commande arbitraire issue du JSON d'alerte. Les secrets du compte de contrôle restent dans le conteneur de remédiation ; le dashboard ne reçoit pas `MONITOR_PASSWORD`.

## 3. Contrôle de santé et IP bloquées

- `GET /health` : santé du moteur.
- `GET /blocked-ips` : liste des IP configurées dans le fichier de refus WAF.
- `GET /probe` : lance un paiement de contrôle à la demande et retourne le résultat.
- `GET /probe-status` : retourne le dernier résultat de contrôle connu.
- Depuis le dashboard, le bouton « Lancer un paiement de contrôle » appelle `/api/probe`, proxy interne vers le moteur.

Une IP affichée par le moteur ne prouve pas que le WAF l'applique réellement. Confirmer le rechargement de la configuration côté WAF et tester depuis la machine attaquante.

## 4. Que faire en cas d'échec

### `FAILED`
1. Ouvrir le détail de l'incident et lire l'action qui a échoué ainsi que son message.
2. Vérifier la santé de `api-paiement`, `auth`, `remediation` et du WAF.
3. Vérifier les logs : `docker compose logs --since=10m remediation api-paiement waf`.
4. Confirmer que la configuration WAF est valide et que le fichier d'IP bloquées est monté au bon endroit.
5. Ne pas relancer l'incident en boucle : corriger la cause, puis créer un nouvel identifiant d'incident et relancer le test.

### `ESCALATED`
L'incident est hors politique, ambigu ou nécessite une intervention humaine. Ne pas contourner la liste fermée d'actions. Examiner l'alerte, vérifier l'IP et le service ciblé, puis demander validation à la personne responsable de l'infrastructure.

### Stack indisponible
Consulter `docker compose ps` et `docker compose logs --tail=100 <service>`. Redémarrer uniquement après avoir identifié la cause, sauf si la procédure de démo exige une remise à zéro complète.

## 5. Remise à zéro de la démonstration

> Attention : `docker compose down -v` supprime les volumes de données du projet. À utiliser uniquement sur l'environnement de démonstration, jamais sur un environnement contenant des données à conserver.

Depuis la racine du dépôt, après vérification du contexte Docker :

```sh
docker compose down -v
# Vérifier et vider le fichier de refus WAF selon le chemin monté dans docker-compose.yml.
# Ne pas effacer d'autres règles WAF : ne supprimer que les entrées ajoutées pendant la démo.
docker compose up -d --build
docker compose ps
bash tests/smoke-api.sh
bash tests/remediation-test.sh fake
```

Si l'image du WAF conserve un fichier généré dans un volume ou un bind mount, vider uniquement les IP de test puis faire recharger la configuration par la procédure prévue par l'équipe B. Vérifier ensuite `GET /blocked-ips` et effectuer un paiement de contrôle.

## 6. Vérification de fiabilité

Le scénario de répétition doit être lancé depuis la racine :

```sh
bash tests/remediation-test.sh repeat 5
```

Pour chaque cycle, consigner l'identifiant d'incident, l'état final, les actions réalisées, le résultat du paiement de contrôle et le temps de reprise. Un test est réussi uniquement si le cycle arrive à un état terminal attendu, que le service est sain et que le paiement de contrôle réussit. Compléter le tableau avec les résultats réellement observés ; ne pas remplacer un échec ou un timeout par une valeur estimée.
