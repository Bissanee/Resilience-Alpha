# Détection ML — contrat du service

## Architecture

Le service de détection est implémenté dans services/detector/server.py. Il collecte les métriques depuis l'API HTTP de Prometheus et les journaux WAF depuis l'API HTTP de Loki. Le modèle Isolation Forest est ajusté sur un historique glissant en mémoire ; aucune donnée de paiement ou information d'identification n'est lue.

## Caractéristiques numériques

| Caractéristique | Source | Interprétation |
|---|---|---|
| request_rate | Prometheus, http_requests_total | Débit agrégé de requêtes applicatives |
| error_rate | Prometheus, statuts 5xx | Débit d'erreurs serveur |
| auth_fail_rate | Prometheus, statuts 401/403 du service auth | Échecs d'authentification |
| api_p95 | Prometheus, histogramme API | Latence p95 estimée |
| auth_p95 | Prometheus, histogramme Auth | Latence p95 estimée |
| cpu_rate | Prometheus/cAdvisor | Débit CPU agrégé disponible dans l'environnement |
| distinct_source_ips | Loki, logs d'accès WAF | Nombre d'IP source distinctes dans la fenêtre récente |
| waf_suspicious_rate | Loki, statuts 403/429 | Réponses WAF suspectes par seconde sur la fenêtre |

Le détecteur expose /health, /score, /anomaly, /model et /metrics. Les métriques exportées commencent par resilience_detector_. Les champs source_ip et attack_type sont des métadonnées, pas des caractéristiques numériques du modèle.

## Apprentissage et alerte

- Période d'observation initiale : 30 échantillons par défaut, avec une cadence de 10 secondes.
- Historique : jusqu'à 600 échantillons en mémoire.
- Isolation Forest : 150 arbres, contamination initiale estimée à 8 %, graine déterministe pour faciliter la reproductibilité.
- Le score retourné est le percentile du score d'anomalie par rapport à l'historique disponible.
- Les seuils opérationnels sur les erreurs, le débit et les réponses WAF complètent le modèle.
- Une alerte peut être transmise à POST /incidents du moteur de remédiation. Le délai anti-répétition est configurable.

L'IP n'est transmise que si les journaux WAF contiennent une adresse IPv4 répétée dans les réponses 403/429. Si les données ne permettent pas de l'attribuer, source_ip reste null. Le détecteur ne doit jamais inventer une IP ou déclencher un blocage sur la base d'une métrique agrégée seule.

## Limites et validation

- Le redémarrage du conteneur efface l'historique en mémoire ; le modèle réapprend au démarrage.
- Un environnement Docker Desktop peut exposer seulement des métriques CPU agrégées, sans attribution fiable à api-paiement.
- Les journaux WAF ne remplacent pas un système de détection de règles ModSecurity ; la classification SQLi est volontairement limitée aux motifs explicites observés dans l'URI.
- Mesurer faux positifs et faux négatifs sur une campagne de test contrôlée avant d'interpréter les alertes comme une preuve de détection en production.
- Lancer tests/person-c-smoke.ps1 pour vérifier le contrat des endpoints après démarrage de la stack.
