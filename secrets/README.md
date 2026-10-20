# Gestion des secrets avec SOPS

Les secrets du projet sont chiffrés avec SOPS et `age`.

## Fichiers

- `.sops.yaml` contient uniquement les clés publiques autorisées.
- `resilience-alpha.enc.env` contient les variables chiffrées et peut être versionné.
- `.env` contient les valeurs déchiffrées locales et ne doit jamais être ajouté à Git.
- La clé privée `age` reste hors du dépôt.

## Déchiffrer les secrets

Chaque membre autorisé doit disposer de sa clé privée dans :

```text
%APPDATA%\sops\age\keys.txt