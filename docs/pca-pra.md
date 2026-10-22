# PCA / PRA — continuité et reprise d'activité

## Définitions

- **PCA** : maintenir un service minimum acceptable pendant un incident.
- **PRA** : restaurer le service et les données après interruption.
- **RTO** (*Recovery Time Objective*) : délai cible de reprise.
- **RPO** (*Recovery Point Objective*) : perte de données maximale acceptable exprimée en durée.

Les valeurs ci-dessous sont des objectifs de démonstration, à confirmer par des exercices. Ce ne sont pas des résultats déjà mesurés.

| Composant | Priorité | RTO cible | RPO cible | Preuve |
|---|---|---:|---:|---|
| WAF et front | Haute | 5 min | N/A | /health et test WAF |
| Authentification | Critique | 5 min | 5 min | /auth/health et test login |
| API paiement | Critique | 5 min | 0–1 min pour transactions confirmées | /api/health, /integrity, idempotence |
| PostgreSQL | Critique | 15 min | 5 min après sauvegarde testée | exercice sauvegarde/restauration |
| Détection / remédiation | Haute | 10 min | incidents en mémoire à perte possible documentée | healthchecks et incident de test |
| Observabilité | Moyenne | 30 min | selon rétention configurée | healthchecks et dashboards |
| RAG / Ollama | Basse à moyenne | 60 min | documents réindexables depuis docs/ | /health, /ask et sources |

## Stratégie de continuité

1. **Prévention** : limites de ressources, healthchecks, segmentation réseau, WAF et secrets hors dépôt.
2. **Détection** : métriques Prometheus, logs WAF dans Loki, alertes Grafana.
3. **Confinement** : actions de remédiation limitées à une liste fermée ; blocage seulement d'une IP valide et non protégée.
4. **Reprise** : redémarrage autorisé d'un service dégradé, puis vérification par paiement technique, /health et /integrity.
5. **Escalade** : si la vérification métier échoue, incident FAILED ; les scénarios inconnus sont ESCALATED. Un conteneur redémarré ne suffit pas à déclarer la reprise.
6. **Restauration des données** : tester les sauvegardes PostgreSQL et leur restauration en environnement isolé. Vérifier transactions, soldes et intégrité référentielle.
7. **Retour d'expérience** : consigner chronologie, RTO observé, RPO constaté, écarts et actions correctives.

## Procédure d'exercice locale

1. Noter l'heure de début et l'état des healthchecks.
2. Exécuter tests/restoration-cycles.ps1 dans l'environnement de démonstration.
3. Vérifier chaque statut HTTP et le temps de reprise.
4. Lancer le paiement de contrôle depuis le dashboard et vérifier /integrity.
5. Vérifier les alertes Grafana et journaux Loki.
6. Documenter le RTO observé. Ne pas déclarer de RPO validé sans restauration d'une sauvegarde.
7. Répéter après chaque changement d'architecture ou de procédure.

## Critères de réussite

- Aucun secret dans les logs ou le dépôt.
- Le paiement de contrôle aboutit et l'intégrité reste cohérente.
- Les services critiques reviennent dans le RTO fixé.
- Les incidents non résolus sont explicitement signalés.
- Une restauration PostgreSQL est démontrée séparément : un redémarrage de conteneur ne teste pas la restauration des données.
