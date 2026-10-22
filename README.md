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

## Pare-feu applicatif

Le service `waf` constitue l’unique point d’entrée public de l’application sur le port HTTP 80. Il combine Nginx, ModSecurity et les règles OWASP Core Rule Set.

Son rôle est de :

- transmettre les requêtes légitimes aux services internes ;
- bloquer les attaques web courantes, notamment les injections SQL et XSS ;
- limiter le débit des requêtes sensibles ;
- produire des journaux JSON exploitables par Grafana Alloy et Loki ;
- appliquer la liste d’adresses IP bloquées produite par le service de remédiation.

Les routes exposées sont :

| Route publique | Service interne |
|---|---|
| `/` et `/health` | `front:3000` |
| `/auth/*` | `auth:4001` |
| `/api/*` | `api-paiement:4000` |

Les services applicatifs ne publient aucun port directement sur la machine hôte. Ils sont uniquement accessibles au WAF à travers le réseau Docker interne `app-net`.

### Test automatisé du WAF

Depuis la racine du dépôt :

```powershell
powershell -ExecutionPolicy Bypass -File .\tests\waf-smoke.ps1
```

Le script vérifie :

- l’état de santé de l’application à travers le WAF ;
- le routage vers les services Auth et API Paiement ;
- le blocage d’une tentative XSS ;
- le blocage d’une tentative d’injection SQL.

Les requêtes normales doivent répondre avec le statut HTTP `200`. Les charges malveillantes doivent être interrompues avec le statut HTTP `403`.

Les événements correspondants sont consultables avec :

```powershell
docker compose logs --since=2m waf
```

## Simulation de flood HTTP

Le script `attack/http-flood.ps1` génère une charge HTTP contrôlée afin de vérifier le rate limiting du WAF et d’alimenter les journaux de sécurité.

Par sécurité, le script impose :

- une cible locale par défaut ;
- une durée maximale de 120 secondes ;
- une concurrence maximale de 50 ;
- un maximum de 10 000 requêtes ;
- une confirmation manuelle pour toute cible distante.

Exemple local :

```powershell
powershell -ExecutionPolicy Bypass -File .\attack\http-flood.ps1 -DurationSeconds 10 -Concurrency 5 -MaxRequests 500 -DelayMilliseconds 100
```

Le résultat distingue les réponses :

- `200` : requête acceptée et transmise à l’API ;
- `403` : requête bloquée par ModSecurity ;
- `429` : requête rejetée par le rate limiting ;
- erreurs réseau et autres statuts.

Les événements peuvent être recherchés dans Loki avec :

```logql
{project="resilience-alpha"} |= "Resilience-Alpha-Lab"
```

Le script ne doit être utilisé que contre les machines explicitement autorisées du laboratoire.

## Observabilité

Prometheus collecte les métriques applicatives et les métriques des conteneurs fournies par cAdvisor. Grafana provisionne automatiquement Prometheus, Loki et le dashboard `Resilience Alpha - Overview`.

Grafana Alloy découvre les conteneurs via un proxy Docker en lecture seule et transmet leurs journaux à Loki. Le proxy privilégié destiné à la remédiation utilise un réseau séparé.

Sous Docker Desktop/WSL2, cAdvisor expose les métriques de ressources sans les noms ni les labels Docker Compose. Le dashboard affiche donc la consommation cumulée du cgroup Docker. La ventilation par service devra utiliser une source de métadonnées complémentaire ou un environnement Linux natif.

Les panneaux de débit HTTP et de latence p95 restent vides tant que les stubs ne sont pas remplacés par les services instrumentés définitifs.

### Détection SIEM et alertes

Grafana provisionne automatiquement trois règles fondées sur les journaux Loki du WAF :

- plus de 20 réponses `429` en une minute : rafale de requêtes limitée ;
- plus de 5 réponses `403` en cinq minutes : attaques répétées bloquées ;
- plus de 5 réponses `5xx` en deux minutes : dégradation applicative.

Les règles sont versionnées dans `infra/grafana/provisioning/alerting/rules.yml` et évaluées toutes les dix secondes. Elles sont visibles dans **Grafana > Alerting > Alert rules**, dossier `Resilience Alpha - SIEM`.

Le flood contrôlé permet de valider la première règle. Après son exécution, elle doit passer à l'état `Firing` :

```powershell
powershell -ExecutionPolicy Bypass -File .\attack\http-flood.ps1 -DurationSeconds 10 -Concurrency 5 -MaxRequests 500 -DelayMilliseconds 100
```

### Contrôle des proxies Docker

Deux proxies isolent le socket Docker :

- `docker-proxy-ro` permet à Alloy de découvrir les conteneurs, sans opération d'écriture ;
- `docker-socket-proxy` réserve à la remédiation l'inventaire et le redémarrage, sans accès aux images, volumes ou autres opérations d'administration.

Le contrôle automatisé vérifie les autorisations et les refus attendus :

```powershell
powershell -ExecutionPolicy Bypass -File .\tests\docker-proxy-smoke.ps1
```

### Restauration répétée

Le test suivant redémarre uniquement `api-paiement`, attend son retour à travers le WAF et répète l'opération cinq fois. Il mesure le temps de reprise de chaque cycle et échoue au premier retour incomplet :

```powershell
powershell -ExecutionPolicy Bypass -File .\tests\restoration-cycles.ps1
```

## Gestion des secrets

Les variables sensibles peuvent être stockées dans Git sous forme chiffrée avec SOPS et `age`. Le fichier `.env` en clair reste local et ignoré par Git.

Déchiffrement :

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\decrypt-secrets.ps1
```

Mise à jour du fichier chiffré :

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\encrypt-secrets.ps1
```

La procédure complète d’installation, d’ajout d’un membre et de rotation des clés est décrite dans `secrets/README.md`.

## Déploiement Ansible

Le déploiement local ou distant est automatisé avec Ansible. Le playbook valide Docker Compose, démarre la stack, attend les services et contrôle le WAF, le dashboard et Grafana.

Exécution locale depuis WSL :

```powershell
wsl bash -lc "cd '/mnt/c/Users/Lion/Documents/Resilience alpha/Resilience-Alpha' && ansible-playbook -i infra/ansible/inventories/local.ini infra/ansible/playbooks/deploy.yml"
```

La procédure distante et les prérequis sont documentés dans `infra/ansible/README.md`.

## Durcissement des conteneurs

Les services disposent de limites CPU, mémoire et nombre de processus. Les services applicatifs s'exécutent avec un utilisateur non-root, un système de fichiers en lecture seule, sans capacité Linux et avec `no-new-privileges`.

Le contrôle automatisé s'exécute avec :

```powershell
powershell -ExecutionPolicy Bypass -File .\tests\container-hardening.ps1
```

Les protections, la segmentation réseau et les exceptions nécessaires aux images d'infrastructure sont détaillées dans `docs/securite-conteneurs.md`.

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

## Dashboard de résilience

Ouvrir **http://127.0.0.1:8088** depuis le PC hôte. Le dashboard est servi par le conteneur `dashboard` et son backend relaie les appels internes ; le navigateur n'appelle pas directement `remediation:5000`.

Il affiche l'état HTTP des services `api-paiement`, `auth`, `front`, `remediation` et `detector`, les incidents et leurs actions, les IP remontées par le moteur, le dernier paiement de contrôle, un lien Grafana et le score du détecteur lorsqu'un endpoint de score est disponible. L'actualisation des panneaux se fait toutes les 2 secondes.

### Vérification de la remédiation

Depuis PowerShell, lancer les scénarios prévus par le dépôt :

```powershell
sh tests/remediation-test.sh fake
sh tests/remediation-test.sh unknown
sh tests/remediation-test.sh repeat 5
```

Le scénario `repeat 5` provoque des interruptions contrôlées de l'API : à exécuter uniquement sur la stack locale de démonstration. Il peut laisser le service arrêté en cas d'interruption du test ; vérifier ensuite `docker compose ps` et relancer `docker compose up -d api-paiement` si nécessaire.

### Remise à zéro de la démo

Attention : la commande suivante supprime les volumes du projet et donc les données persistées de démonstration.

```powershell
docker compose down -v
docker compose up -d --build
docker compose ps
```

Vérifier ensuite les routes `/health`, `http://127.0.0.1:8088/health` et l'état du WAF. Le fichier de refus WAF doit être vidé uniquement des IP ajoutées pendant la démo, puis la configuration doit être rechargée selon la procédure du service `waf`. Ne pas supprimer les autres règles de sécurité.

