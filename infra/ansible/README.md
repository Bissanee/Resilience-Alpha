# Déploiement Ansible

Les playbooks Ansible permettent de valider, démarrer et contrôler la stack Resilience Alpha sur une machine Linux locale ou distante.

## Structure

- `inventories/local.ini` : exécution locale depuis Ubuntu WSL ;
- `inventories/remote.example.ini` : modèle de cible Linux distante ;
- `playbooks/deploy.yml` : validation, démarrage et contrôles de santé ;
- `playbooks/prepare-remote.yml` : récupération du dépôt, copie sécurisée des secrets puis déploiement.

## Déploiement local avec WSL

Depuis PowerShell :

```powershell
wsl bash -lc "cd '/mnt/c/Users/Lion/Documents/Resilience alpha/Resilience-Alpha' && ansible-playbook -i infra/ansible/inventories/local.ini infra/ansible/playbooks/deploy.yml"
```

Le playbook :

1. vérifie le dossier du projet et `docker-compose.yml` ;
2. vérifie la présence de `.env` ;
3. valide Docker et Docker Compose ;
4. valide la configuration Compose ;
5. construit et démarre les services ;
6. contrôle le WAF, le dashboard et Grafana ;
7. affiche l’état final des conteneurs.

## Déploiement distant

La cible doit être une machine Linux autorisée disposant de :

- Python 3 ;
- Git ;
- Docker ;
- Docker Compose v2 ;
- un accès SSH par clé ;
- un utilisateur autorisé à utiliser Docker.

Copier le modèle sans versionner le fichier réel :

```bash
cp infra/ansible/inventories/remote.example.ini infra/ansible/inventories/remote.ini
```

Renseigner l’adresse, l’utilisateur et la clé SSH dans `remote.ini`, puis tester la connexion :

```bash
ansible -i infra/ansible/inventories/remote.ini deployment -m ping
```

Lancer le déploiement :

```bash
ansible-playbook -i infra/ansible/inventories/remote.ini infra/ansible/playbooks/prepare-remote.yml
```

Le playbook distant clone ou actualise le dépôt, copie `.env` avec les permissions `0600`, puis exécute les mêmes contrôles que le déploiement local.

## Vérification syntaxique

```bash
ansible-playbook -i infra/ansible/inventories/local.ini infra/ansible/playbooks/deploy.yml --syntax-check
```

```bash
ansible-playbook -i infra/ansible/inventories/remote.example.ini infra/ansible/playbooks/prepare-remote.yml --syntax-check
```

## Sécurité

- `remote.ini` est ignoré par Git ;
- aucune clé SSH privée n’est placée dans le dépôt ;
- `.env` reste ignoré par Git ;
- les tâches manipulant les secrets utilisent `no_log` ;
- `.env` reçoit les permissions `0600` sur la cible ;
- le dépôt distant n’est jamais mis à jour avec `force: true` ;
- seules les machines explicitement autorisées doivent être ciblées.