# Contrat d'interface — Project Resilience-Alpha

> Source de vérité commune. Toute modification passe par une PR labellisée `contrat`, approuvée par les 3 membres.
> Version : 0.1 (lundi) — Statut : à valider ensemble.

## 0. Responsables

| Domaine | Responsable | Services concernés |
|---|---|---|
| Dev + remédiation | A | `front`, `auth`, `api-paiement`, `postgres`, `remediation`, `dashboard` |
| Infra + cyber | B | `waf`, `prometheus`, `grafana`, `loki`, `promtail`, `cadvisor`, `docker-socket-proxy`, `/infra`, `/attack` |
| IA + gouvernance | C | `detector`, `rag`, `ollama`, `/ml`, `/rag`, docs EBIOS / PCA-PRA / NIS2-DORA |

## 1. Réseau et services

Réseau Docker interne unique : `resilience-net`. **Seuls les services marqués « publié » sont accessibles depuis le réseau du hotspot (192.168.137.1).**

| Service | Port interne | Publié (hôte) | Rôle |
|---|---|---|---|
| `waf` | 80 | **80** | nginx + ModSecurity (OWASP CRS), seul point d'entrée vers `front` et `api-paiement` |
| `front` | 3000 | non | Interface web de paiement (React) |
| `auth` | 4001 | non | Authentification (JWT) |
| `api-paiement` | 4000 | non | API métier |
| `postgres` | 5432 | non | Base de données |
| `remediation` | 5000 | non | Moteur de remédiation |
| `detector` | 5100 | non | Détection ML (AIOps) |
| `rag` | 5200 | non | Assistant opérateur (LangChain) |
| `ollama` | 11434 | non | LLM local (≤ 8B) |
| `dashboard` | 8088 | **8088** | Interface de supervision (React/Tailwind) |
| `prometheus` | 9090 | non | Métriques |
| `grafana` | 3000 | **3001** | Visualisation + alertes |
| `loki` | 3100 | non | Logs |
| `promtail` | — | non | Collecte des logs Docker vers Loki |
| `cadvisor` | 8080 | non | Métriques conteneurs |
| `docker-socket-proxy` | 2375 | non | Accès restreint au socket Docker (uniquement pour `remediation`) |

Noms DNS = noms de service Docker (ex. `http://api-paiement:4000`).

## 2. API d'authentification (`auth`)

- `POST /auth/login`
  - Requête : `{"username": "alice", "password": "***"}`
  - Réponse 200 : `{"token": "<jwt>", "expires_in": 900}`
  - Réponse 401 : `{"error": "invalid_credentials"}`
- `GET /auth/verify` (header `Authorization: Bearer <jwt>`) → `{"valid": true, "sub": "alice", "role": "user"}`
- Rôles : `user`, `monitor` (compte utilisé par la vérification post-remédiation).
- Comptes de test fictifs créés au démarrage ; mots de passe fournis via SOPS, **jamais dans ce dépôt en clair**.

## 3. API de paiement (`api-paiement`)

Tous les endpoints (sauf `/health` et `/metrics`) exigent `Authorization: Bearer <jwt>`.

- `GET /health` → `{"status": "ok", "db": "ok", "ts": "2026-10-20T09:00:00Z"}`
  - `status` ∈ `ok | degraded | down`, HTTP 200 si `ok`, 503 sinon.
- `POST /transactions`
  - Requête :
    ```json
    {
      "from_account": "ACC-001",
      "to_account": "ACC-002",
      "amount": 25.50,
      "currency": "EUR",
      "idempotency_key": "uuid-v4"
    }
    ```
  - Réponse 201 : `{"id": "TX-123", "status": "COMPLETED", "ts": "..."}`
  - Erreurs : `400 invalid_request`, `401`, `402 insufficient_funds`, `409 duplicate`, `503 unavailable`
- `GET /transactions/{id}` → détail d'une transaction
- `GET /accounts/{id}/balance` → `{"account": "ACC-001", "balance": 974.50, "currency": "EUR"}`
- `GET /integrity` → `{"consistent": true, "total_balance": 100000.00, "expected_total": 100000.00}`
  - Sert à prouver l'absence de données incohérentes après reprise.
- `GET /metrics` → format Prometheus.

Données : comptes et montants **entièrement fictifs**.

## 4. Logs (tous les services)

JSON sur stdout, une ligne par événement :

```json
{"ts": "2026-10-20T09:00:00Z", "level": "info", "service": "api-paiement",
 "event": "transaction_created", "request_id": "uuid", "ip": "192.168.137.20", "status": 201}
```

- `level` ∈ `debug | info | warn | error`
- Labels Loki : `service`, `level`.
- Le `waf` journalise IP source, URL, code HTTP et règle déclenchée.

## 5. Métriques Prometheus

| Métrique | Type | Labels |
|---|---|---|
| `http_requests_total` | counter | `service`, `route`, `status` |
| `http_request_duration_seconds` | histogram | `service`, `route` |
| `transactions_total` | counter | `status` (`completed`, `failed`) |
| `db_up` | gauge | — |
| `container_cpu_usage_seconds_total`, `container_memory_usage_bytes` | cAdvisor | `name` |
| `remediation_incidents_total` | counter | `type`, `state` |

Caractéristiques utilisées par le détecteur (fenêtre glissante) : débit de requêtes, latence p95, taux d'erreurs 5xx, CPU du conteneur `api-paiement`, nombre d'IP distinctes.

## 6. Alerte détecteur → remédiation

`POST http://remediation:5000/incidents`

```json
{
  "incident_id": "INC-20261020-001",
  "type": "dos",
  "service": "api-paiement",
  "score": 0.93,
  "source_ip": "192.168.137.20",
  "features": {"req_rate": 850, "p95_latency": 2.4, "error_rate": 0.31},
  "ts": "2026-10-20T09:05:12Z"
}
```

- `type` ∈ `dos | bruteforce | sqli | unknown`
- `source_ip` peut être `null`.
- Réponse : `202 {"incident_id": "...", "state": "DETECTED"}`

## 7. Moteur de remédiation (`remediation`)

États : `DETECTED → DECIDED → ACTING → VERIFYING → RESOLVED | FAILED`

Endpoints :
- `GET /incidents` : liste (utilisé par le dashboard)
- `GET /incidents/{id}` : détail + journal d'actions
- `GET /events` : flux SSE des événements (pour le dashboard)
- `GET /health`

Politique (liste fermée d'actions) :

| Type d'incident | Actions, dans l'ordre |
|---|---|
| `dos` | `block_ip` → `rate_limit` → `restart_service` (si toujours dégradé) → `verify` |
| `bruteforce` | `block_ip` → `verify` |
| `sqli` | `block_ip` → `verify` |
| `unknown` | Aucune action automatique, incident remonté au dashboard |

Actions :
- `block_ip` : ajoute l'IP à la liste de refus du `waf`, puis recharge nginx.
- `rate_limit` : active une limite de débit sur le `waf`.
- `restart_service` : redémarre uniquement un service de la liste blanche (`api-paiement`, `auth`, `front`).
- `verify` : login avec le compte `monitor`, `POST /transactions` fictif, `GET /health`, `GET /integrity`. **Seule une vérification réussie passe l'incident à `RESOLVED`.**

## 8. Règles de sécurité (non négociables)

- `remediation` est le seul service qui parle à `docker-socket-proxy`. Verbes autorisés : lister et redémarrer des conteneurs de la liste blanche. Tout le reste est refusé.
- `detector`, `rag`, `front` : **aucun accès** au socket Docker.
- `rag` : lecture seule sur le volume `/docs`, pas d'accès à la BDD ni aux secrets, aucune action sur le système.
- Pas d'interface d'administration accessible depuis tous les composants.
- Secrets : SOPS uniquement. Un fichier `.env.example` est versionné ; les vraies valeurs ne le sont **jamais**. Vérifier le zip avant remise.
- Conteneurs : utilisateur non-root, système de fichiers en lecture seule quand c'est possible, pas de port inutile publié.
- Attaques : uniquement depuis le PC Attaquant vers le PC Hôte (192.168.137.0/24). Rien vers le campus ni Internet.

## 9. Variables d'environnement (nommage)

`POSTGRES_HOST`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` (SOPS), `JWT_SECRET` (SOPS), `AUTH_URL`, `API_URL`, `PROMETHEUS_URL`, `LOKI_URL`, `REMEDIATION_URL`, `DETECTOR_URL`, `OLLAMA_URL`, `OLLAMA_MODEL`.

## 10. Conventions Git

- Branches : `feat/<domaine>-<sujet>`, `fix/...`, `docs/...`. Jamais de commit direct sur `main`.
- Commits : `feat(api): ...`, `fix(infra): ...`, `docs(ebios): ...`, `test(...)`.
- PR : 1 relecture par un autre membre avant merge. `docker compose up` doit toujours fonctionner sur `main`.
- Gel du code : **jeudi 17h**. Après : packaging et remise uniquement.

## 11. Décisions ouvertes (à trancher lundi)

- [ ] Langage de l'API : Node.js
- [ ] Modèle Ollama retenu (≤ 8B) et hébergement (PC Hôte ou PC de délestage)
- [ ] Format exact du jeu de données d'entraînement du détecteur
- [ ] Numéro d'équipe `G<n>` pour le nom du dossier de rendu
