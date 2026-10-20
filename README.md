# CRN-Flix

The brain of CRN-Flix. It turns what subscribers watch and want into media available in their library: it reads their intent from a **catalog**, plans what to download and when, searches **indexers** for releases, hands them to a **downloader**, files the result into the **storage** watched by the **player** and tells users when their media is ready. Everything that needs a human becomes a ticket, handled on an **admin channel** or the web dashboard.

The engine owns the logic; every external service sits behind a role whose contract lives in `libs/contracts`. Implementations are plugins under `plugins/<role>/<name>`, packages the engine composes at boot — the goal is to publish the engine on its own and let anyone pick their plugins (see [Implementations](#implementations) and [`knowledge/plugins.md`](knowledge/plugins.md)).

## How it fits

```
Catalog ──► catalog sync ──► requests (intent) ──► planner ──► Indexers
                                                      │
                                     auto-trigger, or admin launches a link
                                                      ▼
Player ◄── library refresh ◄── post-download pipeline (Storage) ◄── Downloader
     │
     └──► library sync ──► request fulfilled ──► user notified (user channels)
```

| Role | Responsibility |
|---|---|
| **Catalog** | Where users reference what they want: watchlist, shows in progress, ratings, playheads |
| **Metadata** | Informs without holding requests: localized titles (French shown to users), original language, posters, file identification |
| **Policy** | Filters requests coming out of the catalogs before planning: accept, reject (user notified) or send to review — *defined, not implemented* |
| **Indexer** | Searches releases for a movie or show and returns scoped candidates (episode, season, series) |
| **Downloader** | Downloads a link, reports progress, echoes the metadata attached to it |
| **Storage** | Where finished files land and how they are named for the player |
| **Player** | Hosts the library and the user accounts, tells what is available, gets refreshed after a placement |
| **Messaging** | Admin channel (tickets, admin replies) and user channels (notifications, announcements, login codes, one per user) |

## Features

- **Catalog sync** — watchlist, in-progress shows and highly rated titles become per-episode requests; per-user playheads drive urgency.
- **Download planner** — labels each missing episode `starved` / `needed` / `deferred`, picks the cheapest set of releases (episode, season or full-series bundles) and triggers the downloader automatically when it can handle the link.
- **Indexer search** — every indexer receives all known titles and picks its own query order. Candidates are filtered by quality, language, host and a runtime-based size cap; rejections are kept to explain why nothing was chosen. Each indexer can store an opaque bookmark per media, handed back on the next search.
- **Titles** — English in database and on disk, French shown to users.
- **Post-download pipeline** — identifies the file (action id → imdb id → filename), renames it to library conventions, refreshes the player, marks the request fulfilled. Downloads flagged `private=true` go to a separate private tree.
- **Tickets** — user approvals, download actions, identification failures, dead letters, manual downloads. One core, two adapters: the admin channel and `/admin/tickets`.
- **Dashboards** — `/admin` (requests grouped per show, tabs by expected action, release-level forcing, live progress), `/me` (the subscriber's own requests, OTP + magic-link login), `/admin/announce` (outage / restoration notices, each user reached on their own channel).
- **Notifications** — only `fulfilled` / `rejected` reach users, batched per user.
- **Resilient boot** — only PostgreSQL is required to start; the player and the downloader are reached lazily and their syncs fail per run.

### Download correlation

Links the engine shows to admins carry query params — `crn-flix-request-id` (planner action), `crn-flix-candidate-id` (a release launched by hand from the dashboard) and `imdbid`. Any client that forwards them as download metadata lets the engine match the finished download to its action or release and identify the media without guessing. Auto-triggered downloads carry `crn-flix-planned-download-id` directly.

## Implementations

| Role | Implementation | Code | Contract | Status |
|---|---|---|---|---|
| Catalog | Trakt | `plugins/catalogs/trakt` (`TraktCatalog`) | `Catalog`, `CatalogAccountSource` (Jellyfin's Trakt plugin) | Plugin; account linking (`UsersController`) still uses the concrete classes |
| Metadata | TMDB | `plugins/metadata/tmdb` (client + titles resolver) + engine `services/media-titles.ts` | `MetadataSource` (draft) | Client extracted |
| Indexer | Loadix | `plugins/indexers/loadix` | `Indexer` | Plugin |
| Downloader | Fetchr | `plugins/downloaders/fetchr` (`FetchrDownloader`) | `Downloader` | Plugin; completions become download jobs in the engine (`services/downloads/intake.ts`) |
| Storage | Local filesystem | engine `services/media-labelizer.ts`, `media-identifier.ts`, `post-download-pipeline.ts` | `Storage` (draft) | Coupled |
| Player | Jellyfin | `plugins/players/jellyfin` (client + Trakt plugin tokens) + engine `services/jellyfin-sync.ts` | `Player` (draft) | Client extracted |
| Messaging (admin) | Discord | engine `modules/discord/`, `services/messaging/admin/` | ticket adapter (`services/tickets/`) | Coupled |
| Messaging (users) | Email, Discord DM | engine `services/messaging/user/` | `UserChannel` (draft) | Coupled |
| Policy | — | — | `Policy` | Defined only |

*Draft* contracts are typed in `libs/contracts` but not implemented by any plugin yet. Couplings left on the way, in order, are listed in [`knowledge/plugins.md`](knowledge/plugins.md).

## Repository layout

pnpm workspace + Turborepo.

```
components/
├── api/          @crn-flix/api — the NestJS engine
│   ├── src/controllers/   HTTP surface: /admin, /admin/tickets, /admin/announce, /me, /users, /mailing
│   ├── src/services/      syncs, planner orchestration, tickets/, messaging/, database/ (raw pg repositories)
│   ├── src/modules/       indexer registry + harness, Discord client (still coupled)
│   └── tests/             Jest unit tests + Stryker
└── database/     SQL migrations (src/scripts/NNNNN_*.sql) + migration runner image
libs/
├── contracts/    @crn-flix/contracts — every role's contract + shared media types
├── planner/      @crn-flix/planner — pure planner core (runway, labels, set cover, diff, sourcing)
├── http/         @crn-flix/http — axios logging, retries, rate limiting for plugins
└── tooling/      @crn-flix/tooling — eslint, tsconfig and jest presets
plugins/
├── catalogs/trakt        @crn-flix/catalog-trakt
├── indexers/loadix       @crn-flix/indexer-loadix
├── metadata/tmdb         @crn-flix/metadata-tmdb
└── players/jellyfin      @crn-flix/player-jellyfin
infrastructure/compose/   production compose file + deploy script
knowledge/        design docs (plugins, policy, download planner)
terraform/        legacy local stack, not used by the production deploy
```

The SQL migrations and the TypeScript code are the source of truth for the schema.

## Getting started

Requirements: Node 26 (`.nvmrc`), pnpm 12 and a PostgreSQL database with the migrations applied, plus credentials for the implementations you enable.

```bash
pnpm install
# write components/api/.env, see Configuration below
pnpm dev
```

### Commands

| Command | What it does |
|---|---|
| `pnpm build` / `lint` / `typecheck` / `test` | Turborepo tasks over every package |
| `pnpm validate` | All of the above |
| `pnpm dev` | Engine in watch mode (libs and plugins are built first) |
| `pnpm -F @crn-flix/api test:mut` | Stryker mutation tests |
| `pnpm -F @crn-flix/api indexer:find <indexer> --imdb tt… --title "…" [--type show --episodes "1:1-10"] [--verbose]` | Query an indexer standalone (no Nest, database or admin channel), handy to debug a search; run `pnpm build` first |

### Configuration

Validated at boot by `components/api/src/environment.ts`.

**Engine**

| Group | Variables |
|---|---|
| Server | `PORT`, `SERVER_URL` (public URL used in links), `SERVICE_NAME`, `LOG_LEVEL` |
| Database | `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USERNAME`, `DATABASE_PASSWORD` |
| Paths | `DOWNLOADS_PATH`, `MEDIAS_PATH`, `MOVIES_FOLDER` / `SERIES_FOLDER` / `PRIVATE_FOLDER` (defaults `movies` / `series` / `private`) |
| Release preferences | `INDEXER_ALLOWED_QUALITIES`, `INDEXER_ALLOWED_LANGUAGES`, `INDEXER_ALLOWED_HOSTS` (comma-separated, empty = any), `INDEXER_SIZE_TOLERANCE`, `INDEXER_BYTES_PER_MIN_JSON` |
| Planner tuning | `SYNC_RATING_THRESHOLD`, `SYNC_NEED_WINDOW_HOURS`, `SYNC_MAX_WINDOW_HOURS`, `SYNC_FULL_INTERVAL_HOURS` (all optional) |

**Implementations**

| Implementation | Variables |
|---|---|
| Trakt | `TRAKT_HOST`, `TRAKT_CLIENT_ID`, `TRAKT_CLIENT_SECRET` |
| TMDB | `TMDB_API_KEY` |
| Loadix | `LOADIX_API_HOST`, `LOADIX_SITE_HOST` (disabled when unset) |
| Fetchr | `FETCHR_URL` (`ws://…`), `FETCHR_API_KEY`, `FETCHR_DOWNLOADS_PREFIX` (its download path, mapped onto `DOWNLOADS_PATH`) |
| Jellyfin | `JELLYFIN_URL`, `JELLYFIN_TOKEN`, `JELLYFIN_LIBRARY_ROOT` (default `/medias`) |
| Discord | `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID` (admin channel), `DISCORD_ADMIN_IDS` (comma-separated) |
| Email | `GMAIL_USER`, `GMAIL_PASSWORD` (app password) |

## Deployment

Production runs as Docker containers next to PostgreSQL and the services behind each role. The API image builds from the repository root (`components/api/Dockerfile`, `pnpm deploy`). `infrastructure/compose/deploy.sh` builds and pushes `antoinecaron/crn-flix` (API) and `antoinecaron/crn-flix-migration`, syncs `infrastructure/compose/docker-compose.yaml` to the server and restarts the stack; the server's `.env` keys are listed in `infrastructure/compose/.env.example`. The compose file in this repository is the source of truth: never edit it on the server. The migration container runs first; the engine only waits on it and on PostgreSQL.

Migrations are applied in filename order and hashed: **never edit an applied migration, add a new one.**

## Further reading

- [`CLAUDE.md`](CLAUDE.md) — detailed architecture: syncs, planner, indexer contract, tickets, read model, schema, NOTIFY channels.
- [`knowledge/plugins.md`](knowledge/plugins.md) — plugin architecture, roles, extraction status.
- [`knowledge/policy.md`](knowledge/policy.md) — the policy role.
- [`knowledge/download-planner-brief.md`](knowledge/download-planner-brief.md) — planner design.
