# Architecture en plugins

## Objectif

Publier l'engine indépendamment de ses plugins, pour que n'importe qui compose son propre engine avec les plugins qu'il veut (un autre catalog que Trakt, un autre player que Jellyfin…). Chaque implémentation d'un service externe devient un paquet qui ne connaît que les contrats.

## Rôles

| Rôle | Ce qu'il fait | Contrat (`libs/contracts`) | Implémentation | État |
|---|---|---|---|---|
| **catalog** | Là où un utilisateur référence ses demandes (watchlist, séries en cours, notes) et sa position de lecture | `Catalog`, `CatalogAccountSource` | Trakt | **Plugin** (`plugins/catalogs/trakt`, `TraktCatalog`) ; comptes fournis par `player-jellyfin` |
| **metadata** | Informe sans porter de demande : titres dans toutes les langues, affiches, identification d'un fichier | `MetadataSource` | TMDB | **Plugin** (`plugins/metadata/tmdb`) ; l'identification de fichiers appelle encore le client TMDB |
| **policy** | Filtre automatique en sortie de catalog : accepter, refuser, faire relire (voir [policy.md](policy.md)) | `Policy` | — | Défini, pas implémenté |
| **indexer** | Cherche les releases d'un film ou d'une série | `Indexer` | Loadix | **Plugin** (`plugins/indexers/loadix`) |
| **downloader** | Télécharge une URL, rend compte de la progression | `Downloader` | Fetchr | **Plugin** (`plugins/downloaders/fetchr`) |
| **layout** | Règles de nommage et d'organisation de la bibliothèque (en pratique les conventions du player) | `LibraryLayout` | Conventions Jellyfin | **Plugin** (`plugins/layouts/jellyfin`) |
| **player** | Sert la bibliothèque, porte les comptes de visionnage | `Player` | Jellyfin | **Plugin** (`plugins/players/jellyfin`) |
| **messaging-user** | Joindre les abonnés (notifications, annonces, codes de connexion) | `UserChannel` | Email | **Plugin** (`plugins/messaging-user/email`) |
| **messaging-admin** | Canal admin : tickets, réponses, codes de connexion admin | `AdminChannel` | Discord | **Plugin** (`plugins/messaging-admin/discord`, connexion `libs/discord`) |

Tous les contrats sont implémentés et branchés, sauf `Policy` (défini seulement, marqué **DRAFT**).

## Règles

- **DÉCIDÉ (2026-10-20)** — Pas de rôle « storage » : le disque est forcément le volume partagé avec le downloader et l'engine se contente d'y déplacer les fichiers ; ce qui est enfichable, ce sont les règles de nommage et d'organisation (`layout`).
- **DÉCIDÉ (2026-10-20)** — Messaging : deux contrats et deux familles de plugins, `plugins/messaging-user/<nom>` (email seulement ; le DM Discord utilisateur n'est pas réellement implémenté et n'est pas porté) et `plugins/messaging-admin/<nom>` (Discord) ; la connexion Discord vit dans une lib commune avec une instance partagée. Le style est une lib `design-system` utilisée par les pages web et les emails.
- **DÉCIDÉ (2026-10-20)** — Un plugin vit dans `plugins/<rôle au pluriel>/<nom>` (`indexers/loadix`, `catalogs/trakt`…), paquet `@crn-flix/<rôle>-<nom>`. Les paquets sont à la racine du monorepo car externalisables.
- **DÉCIDÉ** — Un plugin dépend de `@crn-flix/contracts` (et au besoin de `@crn-flix/http`), **jamais de l'engine** (pas d'alias `@/`) ni de la base. Ce qu'il veut retenir passe par l'engine : il reçoit des données en entrée et rend ce qu'il faut sauvegarder (voir les mémos d'indexer, `IndexerBookmark`).
- **DÉCIDÉ** — TMDB n'est pas un catalog : il ne permet pas à un utilisateur de référencer ses demandes. C'est une brique **metadata**.
- **DÉCIDÉ** — La policy est une brique à part entière, définie mais pas encore développée.
- Les services que l'engine fournit aux plugins sont des contrats eux aussi (`runtime.ts` : `PluginCache`, `PluginLogger`). Un plugin ne reçoit jamais une classe de l'engine et ne dépend pas de Nest : il crée ses loggers avec `createLogger(contexte)`, et l'engine branche leur sortie au boot (`setPluginLoggerFactory`, voir `services/logger/plugins.ts`).
- Chaque plugin expose son point d'entrée dans `src/index.ts` (schéma de config zod + fabrique, par exemple `createLoadixIndexer`). La composition reste **statique** dans l'engine (`modules/indexer/registry.ts`, providers Nest) tant que l'engine n'est pas publié seul.
- Le cœur pur du planner (`libs/planner`) n'a aucune I/O : il dépend uniquement des contrats.

## Paquets

| Paquet | Rôle |
|---|---|
| `components/api` | L'engine NestJS : synchros, orchestration du planner, tickets, dashboards, persistance |
| `components/database` | Migrations SQL + image du runner |
| `libs/contracts` | Contrats de tous les rôles + types média partagés (`MediaItem`, `MediaTitles`, `Playhead`) |
| `libs/planner` | Runway, labels, set cover, diff, sourcing, scoring |
| `libs/http` | Logs axios, retries, rate limiter, `wait` |
| `libs/tooling` | Presets eslint / tsconfig / jest |

Build : chaque lib et plugin compile vers `dist/` (`tsc`). Turborepo construit les dépendances avant `typecheck`, `test` et `dev`. L'image de l'API se construit depuis la racine (`pnpm deploy --legacy`).

## Couplages restants, dans l'ordre prévu

1. ~~**Logger**~~ — fait (2026-10-20) : `createLogger` / `setPluginLoggerFactory`, plus aucun plugin ne dépend de Nest.
2. ~~**Catalog**~~ — fait (2026-10-20) : `TraktCatalog` (expansion, activités, playheads), `TraktPlugin.listAccounts` implémente `CatalogAccountSource`, l'engine relie comptes et utilisateurs (`services/catalog/`). Reste : la liaison de compte (device auth Trakt + écriture du token, `UsersController`) utilise encore les classes concrètes ; un seul catalog est branché à la fois.
3. ~~**Downloader**~~ — fait (2026-10-20) : `FetchrDownloader` signale les complétions (`onCompleted`, rejouées après reconnexion), l'engine crée les `download_jobs` (`services/downloads/intake.ts`, idempotent). Le vocabulaire d'événements Fetchr (`applyFetchrEvent`) est dans le plugin. Reste : les clés de corrélation (`crn-flix-request-id`…) restent un contrat implicite entre l'engine et « tout client qui les transmet ».
4. ~~**Player**~~ — fait (2026-10-20) : `JellyfinPlayer` (disponibilité, rafraîchissement, comptes via `upsertAccount` / `AccountNameTakenError`, vitrine d'affiches construite depuis l'URL du player au lieu de `jellyfin.crn-tech.fr` en dur). Reste : `naming-audit` lit les chemins de la bibliothèque via `JellyfinMediaService` (relève du storage) ; la colonne `users.jellyfin_id` porte l'id de compte du player.
5. ~~**Metadata**~~ — fait (2026-10-20) : `TmdbMetadataSource.describe` (titres + URL d'affiche complète). Migration 00024 : `medias.poster_url` (rattrapée depuis `poster_path`) ; **`poster_path` est à supprimer dans une release ultérieure** (gardée pour le rollback). Reste : `media-identifier.ts` (identification d'un fichier par recherche TMDB) appelle `TmdbApiService` directement — à porter par une méthode `identify` du contrat au moment du storage.
6. ~~**Messaging**~~ — fait (2026-10-20) : `EmailChannel` (`plugins/messaging-user/email`) et `DiscordAdminChannel` (`plugins/messaging-admin/discord`) sur la connexion partagée `libs/discord`. L'engine garde la répartition et le regroupement des notifications (`services/messaging/user/all.ts`) et toute la logique des tickets côté admin (`services/messaging/admin/relay.ts` : bindings sous le nom du canal, parsing du texte libre, téléchargements manuels). Job `discord-cleanup` renommé `admin-channel-cleanup`.
7. ~~**Layout**~~ (ex-storage) — fait (2026-10-20) : `JellyfinLayout.place` donne section + dossiers + nom de fichier ; l'engine choisit la racine (partagée ou privée) et déplace (`media-labelizer.ts`). Reste : `media-identifier.ts` (identification d'un fichier par recherche TMDB) appelle `TmdbApiService` directement, à porter par une méthode `identify` du contrat metadata ; `naming-audit` lit les chemins de la bibliothèque via `JellyfinMediaService`.
8. **Publication** — l'engine publié seul : la composition des plugins devient de la configuration.

## Reporté

- **DÉCIDÉ (2026-10-20)** — Migration Jest → Vitest, passage à Terraform et refonte des GitHub Actions : après cette réorganisation. Les workflows actuels (`.github/`) supposent encore npm et l'ancienne arborescence.
