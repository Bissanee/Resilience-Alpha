# Durcissement des conteneurs

## Objectif

La stack applique une defense en profondeur : une compromission d'un service ne doit pas donner automatiquement acces a l'hote, aux donnees ou aux autres composants.

## Protections communes

Tous les services disposent de limites CPU, memoire et nombre de processus. L'option `no-new-privileges` interdit l'acquisition de privileges supplementaires apres le demarrage du conteneur. Les journaux Docker utilisent une rotation de 10 Mio et trois fichiers afin d'eviter une saturation du disque.

Les services applicatifs construits par le projet appliquent en plus :

- un utilisateur non-root defini dans leur Dockerfile (`node` ou `nobody`) ;
- un systeme de fichiers racine en lecture seule ;
- la suppression de toutes les capacites Linux ;
- un `tmpfs` borne pour `/tmp` ;
- aucun port publie directement sur l'hote ;
- des healthchecks permettant de detecter une panne.

## Segmentation reseau

Le WAF est le seul point d'entree applicatif public. PostgreSQL, Prometheus, Loki et les proxies Docker ne publient aucun port. Les reseaux internes separent les flux applicatifs, les donnees, l'observabilite, l'IA et la remediation.

Deux proxies distincts filtrent l'acces au socket Docker :

- `docker-proxy-ro` autorise uniquement la lecture necessaire a Alloy ;
- `docker-socket-proxy` autorise les redemarrages controles demandes par la remediation.

Le socket Docker n'est jamais monte directement dans un service applicatif.

## Exceptions justifiees

Les images d'infrastructure ne sont pas toutes forcees en lecture seule ou sans capacite Linux. Leur processus d'initialisation doit parfois creer des fichiers, ajuster les permissions d'un volume ou changer d'utilisateur.

- PostgreSQL ecrit dans `pgdata` et initialise le schema au premier demarrage.
- Prometheus, Loki, Grafana et Alloy ecrivent dans leurs volumes de donnees.
- Le WAF genere sa configuration Nginx au demarrage.
- cAdvisor lit plusieurs pseudo-systemes de fichiers de l'hote pour collecter les metriques.
- Ollama conserve les modeles dans un volume et dispose de limites plus larges lorsqu'il est active par son profil.

Ces exceptions conservent `no-new-privileges`, des limites de ressources, des volumes explicitement declares et des reseaux minimaux.

## Limites de la demonstration

Les variables injectees par Docker Compose restent visibles aux utilisateurs autorises a inspecter le moteur Docker. SOPS protege les secrets au repos dans Git, mais ne remplace pas un gestionnaire de secrets de production tel que Vault ou un service KMS.

cAdvisor necessite une visibilite importante sur l'hote. Il est isole sur le reseau d'observabilite, ne publie aucun port et ne recoit que des montages en lecture seule.

## Verification

Depuis PowerShell :

```powershell
powershell -ExecutionPolicy Bypass -File .\tests\container-hardening.ps1
```

Le test analyse la configuration Compose rendue et verifie les limites de ressources, `no-new-privileges`, les restrictions des services applicatifs et la liste fermee des services autorises a publier un port.
