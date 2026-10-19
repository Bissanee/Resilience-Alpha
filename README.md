# Resilience-Alpha

Démonstrateur académique de cyber-résilience pour une plateforme de paiement fictive. Docker Compose orchestre les services applicatifs, la détection, la remédiation et l'observabilité.

## Prérequis

- Windows 10 ou 11 avec Docker Desktop et WSL2
- Docker Compose intégré à Docker Desktop
- Au moins 16 Go de RAM pour la stack sans Ollama

## Premier démarrage

Depuis la racine du dépôt :

```powershell
Copy-Item .env.example .env
```

Remplacer les valeurs `change-me-*` dans `.env`. Ce fichier reste local et ne doit jamais être ajouté à Git.

```powershell
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

Le profil LLM est optionnel :

```powershell
docker compose --profile llm up -d ollama
```

## Accès locaux

| Composant | Adresse | Exposition |
|---|---|---|
| WAF et application | http://localhost | PC Hôte et hotspot |
| Dashboard | http://127.0.0.1:8088 | PC Hôte uniquement |
| Grafana | http://127.0.0.1:3001 | PC Hôte uniquement |

Les identifiants Grafana sont définis dans `.env`.

## Vérifications rapides

```powershell
curl.exe http://127.0.0.1/health
curl.exe http://127.0.0.1:8088/health
curl.exe http://127.0.0.1:3001/api/health
docker compose ps
```

Consulter les erreurs récentes :

```powershell
docker compose logs --since=5m | Select-String -Pattern "error|fatal|panic|denied|unhealthy" -CaseSensitive:$false
```

## Observabilité

Prometheus collecte les métriques applicatives et les métriques des conteneurs fournies par cAdvisor. Grafana provisionne automatiquement Prometheus, Loki et le dashboard `Resilience Alpha - Overview`.

Grafana Alloy découvre les conteneurs via un proxy Docker en lecture seule et transmet leurs journaux à Loki. Le proxy privilégié destiné à la remédiation utilise un réseau séparé.

Sous Docker Desktop/WSL2, cAdvisor expose les métriques de ressources sans les noms ni les labels Docker Compose. Le dashboard affiche donc la consommation cumulée du cgroup Docker. La ventilation par service devra utiliser une source de métadonnées complémentaire ou un environnement Linux natif.

Les panneaux de débit HTTP et de latence p95 restent vides tant que les stubs ne sont pas remplacés par les services instrumentés définitifs.

## Arrêt

```powershell
docker compose down
```

Ne pas utiliser `docker compose down -v` sauf si la suppression des données PostgreSQL, Prometheus, Grafana, Loki et Ollama est réellement souhaitée.

## Sécurité du laboratoire

- Ne jamais ajouter `.env`, une clé privée ou un secret au dépôt.
- Ne lancer les scripts offensifs que contre les machines autorisées du laboratoire.
- Ne pas exposer PostgreSQL, Prometheus, Loki ou les proxies Docker sur le réseau du campus.
- Le service de remédiation doit vérifier `ALLOWED_SERVICES` avant tout appel Docker.

Le contrat dans `docs/contrat.md` reste la source de vérité pour les ports, APIs, métriques et responsabilités.
