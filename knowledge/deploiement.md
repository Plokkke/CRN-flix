# Déploiement

La pile `infrastructure/terraform` déploie le moteur (migration ponctuelle + API) sur le serveur de la maison ; la base vit sur le Postgres partagé (rôle et base `crn_flix`, mot de passe généré). Jellyfin reste pour l'instant dans l'ancien compose (`infrastructure/compose/`) ; il rejoindra la pile ensuite. Fetchr a sa propre pile (`Plokkke/fetchr`).

- **Livraison** : PR (titre conventionnel) → squash sur `main` → `release.yml` : CI, semantic-release, images `ghcr.io/plokkke/crn-flix/{api,migration}:<version>`, puis `deploy.yml` → le deployer applique la pile et vérifie `health_url`.
- **Infrastructure seule** : un push qui ne touche **que** `infrastructure/**` redéploie la version en place. Un push qui change aussi le code n'est déployé que par la release (image et infrastructure ensemble) : l'ancienne image ne tourne jamais sur la nouvelle configuration. **DÉCIDÉ (2026-10-21)**, après l'incident du 21/10 (la `v2.3.0` redéployée avec `USER_MESSAGING=send` sans connaître les quiet hours a envoyé 3 mails à 1h). Conséquence : un commit mixte sans release (`chore`, `docs`…) n'est pas déployé — séparer le changement d'infra, ou lancer `deploy.yml` à la main.
- **Rollback** : `gh workflow run deploy -R Plokkke/CRN-flix -f version=<précédente>` (les migrations sont toujours compatibles avec la version précédente).
- **Secrets** : `infrastructure/secrets/production.sops.yaml` (édition : `SOPS_AGE_KEY_FILE=~/.config/sops/age/se-identity.txt sops infrastructure/secrets/production.sops.yaml`). Configuration non secrète : `infrastructure/terraform/variables.tf`.
- **Messages aux abonnés** : `user_messaging` (`send` | `dry-run`). En `dry-run` rien ne part et rien n'est marqué envoyé : les notifications attendent dans `user_notifications` et partent au retour en `send`.
- **Heures calmes** : `user_messaging_quiet_hours` (`00:00-07:00` par défaut) dans `user_messaging_timezone` (`Europe/Paris`). Rien ne part pendant cette plage sauf le code de connexion, le mail de bienvenue et le refus ou l'erreur d'inscription (décision de l'admin, annoncée tout de suite) : les notifications de la nuit partent groupées au premier passage après 7h ; une annonce ne peut pas être programmée dans la plage (refusée, jamais décalée ; « maintenant » la nuit propose 7h à confirmer).

## Bascule depuis le compose (une fois)

**DÉCIDÉ (2026-10-20)** : refactor et infra basculent ensemble, en production (pas d'environnement de test) ; Jellyfin reste en service tout du long ; aucun message aux abonnés tant que la bascule n'est pas validée (`dry-run`). Échec au démarrage ou de configuration → la pile ; erreur dans les logs → le code.

Répétée en local le 2026-10-20 (PG 17 → PG 18, rôle non superutilisateur, runner de la nouvelle image : seules 00024 et 00025 s'appliquent).

### Prérequis

1. **Secrets** : `infrastructure/scripts/import-secrets.sh` (lit le `.env` du Pi par ssh et le chiffre directement, sans rien afficher) ; versionner `production.sops.yaml`.
2. **Configuration** : `infrastructure/scripts/show-config.sh` affiche les réglages non secrets du `.env` du Pi ; les comparer aux valeurs par défaut de `variables.tf`.
3. **GitHub** : règle de branche sur `main` (PR, CI verte, squash uniquement), suppression des branches fusionnées ; GitHub App `plokkke-home-deployer` installée sur le dépôt.
4. **home-platform** : ajouter `- repo: Plokkke/CRN-flix` à `deployer_projects` (`ansible/inventory/group_vars/all/main.yml`) et appliquer le playbook.
5. `terraform plan` depuis le poste (`ssh -N -L 5432:127.0.0.1:5432 pi`, puis `PG_CONN_STR` du rôle `terraform`).

### Étapes

1. **Base seule** — fusionner la PR (`start_engine = false`). La release publie les images ; **rendre publics** les paquets GHCR `crn-flix/api` et `crn-flix/migration` à la première publication (sinon le deployer ne peut pas les tirer : relancer `deploy.yml`). Le déploiement crée le rôle et la base vides ; sa santé est celle de Jellyfin.
2. **Arrêter le moteur** : `ssh pi 'cd /srv/docker/crn-flix && docker compose stop crn-flix-engine'` (Jellyfin et `crn-flix-postgres` restent).
3. **Transférer la base** : `infrastructure/scripts/transfer-database.sh` (refuse si le moteur tourne ou si la base cible n'est pas vide ; compare les comptes de lignes).
4. **Libérer le compose** : `ssh pi 'cd /srv/docker/crn-flix && docker compose rm -sf crn-flix-engine crn-flix-migration && docker compose stop postgres'` — le conteneur `crn-flix-postgres` et son volume sont **gardés** pour le rollback.
5. **Démarrer le moteur** — PR `feat(infra): start the engine on the shared database` (`start_engine = true`). Le déploiement lance la migration (00024, 00025) puis l'API en `dry-run`.
6. **Vérifier** : `/health` donne la version ; logs (`DRY-RUN` attendus, pas d'erreur de connexion) ; tableau des téléchargements et tickets dans Discord ; `/admin` ; jobs `catalog-sync` et `player-sync` ; un téléchargement de bout en bout (Fetchr → bibliothèque → Jellyfin).
7. **Ouvrir les messages** — PR `user_messaging = "send"` : les notifications accumulées partent.

### Rollback de la bascule

- Avant l'étape 5 : `docker compose start crn-flix-engine` (l'ancienne base n'a pas bougé).
- Après : PR `start_engine = false`, puis `docker compose start postgres crn-flix-engine` sur le Pi. Les changements faits depuis la bascule sur `crn_flix` sont perdus ; le moteur est idempotent et la synchro catalogue les retrouve.

### Après (une semaine sans incident et une sauvegarde valide)

- Basculer Jellyfin dans la pile (config et cache en bind sous `/srv/docker/crn-flix/volumes/jellyfin/`, médias en `rslave`), puis supprimer le compose du Pi et `infrastructure/compose/` du dépôt.
- Supprimer `crn-flix-postgres` et `volumes/postgres` du Pi, le `.env` du Pi et du poste, et l'ancien `terraform/` du poste (son `tfstate` contient des secrets en clair).
- Migration ultérieure : supprimer `medias.poster_path` (gardée pour le rollback, remplacée par `poster_url`).
