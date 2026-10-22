# Correspondance pédagogique NIS2 / DORA

Ce tableau relie les capacités techniques du laboratoire à des thèmes de résilience. Il ne constitue pas une déclaration de conformité juridique. L'applicabilité exacte dépend de l'entité, du secteur, de la juridiction et des textes en vigueur.

| Thème | Mise en œuvre / preuve | Écart ou limite |
|---|---|---|
| Gestion des risques cyber | docs/ebios-rm.md : scénarios, impacts et traitements | Cotation illustrative, pas un audit complet |
| Gestion des incidents | Alertes WAF, Loki, incidents et états de remédiation | Ajouter rôles, délais, procédure organisationnelle et notification |
| Continuité et reprise | docs/pca-pra.md et tests de restauration de service | Sauvegarde PostgreSQL et RPO à exercer séparément |
| Sécurité réseau | WAF, OWASP CRS, segmentation Docker, ports internes | Revue d'architecture et tests de configuration requis |
| Contrôle d'accès | JWT, comptes techniques, proxy Docker filtrant, actions fermées | Rotation et gestion des identités à valider en contexte réel |
| Surveillance et détection | Prometheus, Grafana, Loki, règles WAF, Isolation Forest | Mesurer faux positifs/négatifs et qualité des données |
| Vulnérabilités | Tests smoke de sécurité et durcissement conteneurs | Ajouter inventaire/SBOM, scans et processus de correction |
| Chaîne d'approvisionnement | Dépendances et images référencées | Verrouiller les dépendances et images par digest en production |
| Traçabilité | Logs JSON et journaux d'incident | Définir conservation, intégrité et contrôle d'accès |
| Tests de résilience | Flood local contrôlé, cycles de reprise, paiement de contrôle | Conserver résultats et critères d'acceptation |

## Utilisation en présentation

1. Présenter le scénario de risque et le bien essentiel impacté.
2. Montrer les contrôles qui préviennent, détectent, contiennent et restaurent.
3. Démontrer une preuve observable : alerte, incident, action autorisée et vérification métier.
4. Séparer ce qui est implémenté, ce qui a été testé et ce qui reste une recommandation.
