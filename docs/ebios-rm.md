# EBIOS Risk Manager — cadrage du laboratoire Resilience-Alpha

## Objet et périmètre

Cette analyse est une **étude de risques académique** appliquée à une plateforme de paiement fictive. Elle ne constitue ni une certification, ni un audit réglementaire, ni une analyse exhaustive d'un système réel.

### Valeurs métier et biens essentiels
- Disponibilité du parcours de paiement et de l'authentification.
- Intégrité des soldes, transactions et clés d'idempotence.
- Confidentialité des identifiants, jetons JWT, mots de passe techniques et configurations.
- Traçabilité des transactions, alertes, remédiations et vérifications après incident.

### Événements redoutés
1. Paiements indisponibles pendant une période significative.
2. Altération ou duplication d'une transaction, ou incohérence des soldes.
3. Compromission d'un compte ou secret permettant un accès non autorisé.
4. Perte de visibilité sur une attaque ou sur une action automatisée.
5. Remédiation erronée provoquant auto-blocage ou indisponibilité supplémentaire.

## Sources de risque et scénarios

| Source de risque | Objectif redouté | Scénario |
|---|---|---|
| Acteur externe opportuniste | Saturer le service | Flood HTTP atteignant le WAF ou l'API |
| Automate d'attaque web | Exploiter une entrée | Tentatives XSS/SQLi bloquées ou journalisées par ModSecurity |
| Attaquant ciblant les comptes | Obtenir une session | Rafale d'échecs d'authentification |
| Erreur d'exploitation | Dégrader la reprise | Redémarrage répété ou blocage d'une adresse protégée |
| Compromission interne | Étendre l'accès | Abus du réseau Docker ou du proxy Docker |

## Mesures de sécurité identifiées dans le dépôt

- WAF Nginx/ModSecurity avec OWASP CRS et règles de débit.
- Authentification JWT, PostgreSQL et contrôle d'intégrité des paiements.
- Segmentation des réseaux Docker et ports internes non publiés.
- Limites de ressources, conteneurs non-root et systèmes de fichiers en lecture seule lorsque compatibles.
- Logs JSON, Prometheus, Grafana, Loki et alertes WAF.
- Remédiation à actions fermées, liste de services autorisés, protection d'IP internes, anti-boucle et vérification métier.
- Secrets locaux ignorés par Git et procédure SOPS/age documentée.

## Cotation qualitative

Échelle illustrative : vraisemblance et impact de 1 (faible) à 4 (très fort). Score = produit des deux notes : 1–3 faible, 4–7 modéré, 8–11 élevé, 12–16 critique. Cette cotation doit être revue à partir des tests et hypothèses du cours.

| Scénario | Vraisemblance | Impact | Score initial | Traitement prioritaire |
|---|---:|---:|---:|---|
| Flood HTTP | 3 | 4 | 12 — critique | Rate limiting, WAF, détection de débit, test de restauration |
| Brute force | 3 | 3 | 9 — élevé | Limitation d'authentification, alertes sur échecs, blocage prudent |
| XSS/SQLi | 3 | 3 | 9 — élevé | OWASP CRS, validation API, journaux et tests négatifs |
| Transaction incohérente | 2 | 4 | 8 — élevé | Transactions SQL, idempotence, contrôle /integrity |
| Remédiation dangereuse | 2 | 4 | 8 — élevé | Liste fermée, IP protégées, moindre privilège, escalade humaine |
| Perte d'observabilité | 2 | 3 | 6 — modéré | Healthchecks, métriques et tests de restauration |

## Plan de traitement et preuves attendues

| Action | Preuve à conserver |
|---|---|
| Tester XSS/SQLi et les codes attendus | Sortie de tests/waf-smoke.ps1 |
| Simuler une rafale et examiner les alertes | Sortie de attack/http-flood.ps1 et règle Grafana |
| Vérifier l'apprentissage et le score ML | Endpoints /score, /model et métriques resilience_detector_* |
| Envoyer une alerte vers le moteur | Identifiant d'incident et journal remediation_alert_sent |
| Vérifier la reprise par transaction réelle | Résultat /integrity et tests/restoration-cycles.ps1 |
| Valider le RAG | Question, sources, réponse et état Ollama |
| Exercer le PRA | Chronologie, RTO observé et preuve de restauration |

## Limites à expliciter

- Isolation Forest nécessite un historique représentatif ; au démarrage, le détecteur affiche warming_up.
- Les métriques agrégées ne permettent pas d'attribuer une anomalie à une IP : le détecteur transmet source_ip: null et n'invente pas de source.
- La détection SQLi/XSS s'appuie sur ModSecurity et les journaux WAF ; le détecteur métrique ne prétend pas inspecter le contenu des requêtes.
- Ce document n'est pas une analyse EBIOS RM complète avec ateliers validés, parties prenantes, écosystème et acceptation métier.
