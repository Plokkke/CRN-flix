# CRN-Flix

The brain of CRN-Flix. It turns what subscribers watch and want into media available in their library: it reads their intent from a **catalog**, plans what to download and when, searches **indexers** for releases, hands them to a **downloader**, files the result into the **storage** watched by the **player** and tells users when their media is ready. Everything that needs a human becomes a ticket, handled on an **admin channel** or the web dashboard.

The engine owns the logic; every external service sits behind a role whose contract lives in `libs/contracts`. Implementations are plugins under `plugins/<role>/<name>`, packages the engine composes at boot — the goal is to publish the engine on its own and let anyone pick their plugins (see [Implementations](#implementations) and [`knowledge/plugins.md`](knowledge/plugins.md)).

## How it fits

```
Catalog ──► catalog sync ──► requests (intent) ──► planner ──► Indexers
                                                      │
                                     auto-trigger, or admin launches a link
                                                      ▼
Player ◄── library refresh ◄── post-download pipeline (Layout) ◄── Downloader
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
| **Layout** | The library's naming and organisation rules (usually the player's conventions); the engine moves the files on the volume it shares with the downloader |
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
| Metadata | TMDB | `plugins/metadata/tmdb` (`TmdbMetadataSource`) | `MetadataSource` | Plugin (titles, artwork, file identification) |
| Indexer | Loadix | `plugins/indexers/loadix` | `Indexer` | Plugin |
| Downloader | Fetchr | `plugins/downloaders/fetchr` (`FetchrDownloader`) | `Downloader` | Plugin; completions become download jobs in the engine (`services/downloads/intake.ts`) |
| Layout | Jellyfin conventions | `plugins/layouts/jellyfin` (`JellyfinLayout`) | `LibraryLayout` | Plugin; file identification and moves stay in the engine |
| Player | Jellyfin | `plugins/players/jellyfin` (`JellyfinPlayer`, Trakt plugin tokens) | `Player`, `CatalogAccountSource` | Plugin; the naming audit still reads library paths from the client directly |
| Messaging (admin) | Discord | `plugins/messaging-admin/discord` (`DiscordAdminChannel`) on `libs/discord` | `AdminChannel` | Plugin; tickets, bindings and text parsing stay in the engine (`services/messaging/admin/relay.ts`) |
| Messaging (users) | Email | `plugins/messaging-user/email` (`EmailChannel`) | `UserChannel` | Plugin; batching and dispatch stay in the engine (`services/messaging/user/all.ts`) |
| Policy | — | — | `Policy` | Defined only |

*Draft* contracts are typed in `libs/contracts` but not implemented by any plugin yet. Couplings left on the way, in order, are listed in [`knowledge/plugins.md`](knowledge/plugins.md).

## Repository layout

pnpm workspace + Turborepo.

```
components/
├── api/          @crn-flix/api — the NestJS engine
│   ├── src/controllers/   HTTP surface: /admin, /admin/tickets, /admin/announce, /me, /users, /mailing
│   ├── src/services/      syncs, planner orchestration, tickets/, messaging/, database/ (raw pg repositories)
│   ├── src/modules/       indexer registry + harness
│   ├── src/web/templates/ every web page (dashboards, tickets, /me, login, guide)
│   └── tests/             Jest unit tests + Stryker
└── database/     SQL migrations (src/scripts/NNNNN_*.sql) + migration runner image
libs/
├── contracts/    @crn-flix/contracts — every role's contract + shared media types
├── planner/      @crn-flix/planner — pure planner core (runway, labels, set cover, diff, sourcing)
├── http/         @crn-flix/http — axios logging, retries, rate limiting for plugins
├── design-system/ @crn-flix/design-system — tokens, components, page and email layouts
├── discord/      @crn-flix/discord — the shared Discord bot connection
└── tooling/      @crn-flix/tooling — eslint, tsconfig and jest presets
plugins/
├── catalogs/trakt        @crn-flix/catalog-trakt
├── indexers/loadix       @crn-flix/indexer-loadix
├── metadata/tmdb         @crn-flix/metadata-tmdb
├── layouts/jellyfin      @crn-flix/layout-jellyfin
├── downloaders/fetchr    @crn-flix/downloader-fetchr
├── messaging-user/email  @crn-flix/messaging-user-email
├── messaging-admin/discord @crn-flix/messaging-admin-discord
└── players/jellyfin      @crn-flix/player-jellyfin
infrastructure/terraform/ the deployment stack · secrets/ (sops) · scripts/ (cutover) · compose/ (legacy, Jellyfin until it moves)
knowledge/        design docs (plugins, policy, download planner)
```

The SQL migrations and the TypeScript code are the source of truth for the schema.

## Getting started

Requirements: Node 26 (`.nvmrc`), pnpm 12, Docker. The engine runs locally only on the sandbox below (no `.env` file); production is configured by `infrastructure/terraform`.

```bash
pnpm install
pnpm infra:up
pnpm dev
```

### Commands

| Command | What it does |
|---|---|
| `pnpm build` / `lint` / `typecheck` / `test` | Turborepo tasks over every package |
| `pnpm validate` | All of the above |
| `pnpm dev` | Engine in watch mode on the local sandbox (libs and plugins are built first) |
| `pnpm -F @crn-flix/api test:mut` | Stryker mutation tests |
| `pnpm -F @crn-flix/api indexer:find <indexer> --imdb tt… --title "…" [--type show --episodes "1:1-10"] [--verbose]` | Query an indexer standalone (no Nest, database or admin channel), handy to debug a search; settings in `components/api/indexer.env` (production preferences, no secret); run `pnpm build` first |

### Local sandbox

A local instance with no external service and no real library: Postgres and Jellyfin in Docker, a fake library of one-second videos, the admin channel in the terminal.

```bash
pnpm install
pnpm infra:up          # Postgres (127.0.0.1:55432) + migrations, Jellyfin (127.0.0.1:8096, same release as production)
pnpm sandbox:library   # fake library in .sandbox/medias: real titles and imdb ids, 2 KB per file
pnpm sandbox:jellyfin  # first-run wizard (admin / sandbox), Films + Séries libraries, the engine's API key
pnpm sandbox:users     # subscribers papa and leo (engine + Jellyfin accounts) and .sandbox/catalog.json, their requests
pnpm dev              # engine on http://localhost:3000 (Touch ID for the TMDB key)
pnpm infra:down        # stop (database and Jellyfin volumes are kept)
```

`pnpm dev` reads its settings from `components/api/sandbox.env` (versioned, no secret) and fetches the only two values that are not local, passed to the engine through its environment, never written nor printed: the Jellyfin API key from the sandbox Jellyfin, the read-only TMDB key from `infrastructure/secrets/production.sops.yaml` (Touch ID; without it the engine runs with a placeholder and TMDB calls fail). No `.env` file is needed. A variable set in the shell wins, e.g. `FAKE_DOWNLOADER_DURATION_MS=2000 pnpm dev`.

With `ADMIN_CHANNEL=console`, the admin login code and every ticket are printed in the engine's terminal (log line `To admin local-admin: …`); tickets are answered on `/admin/tickets`. With `USER_MESSAGING_OUTBOX`, every email to a subscriber is written to `.sandbox/outbox/` (`.html` to open in a browser, `.txt` with the login code) instead of being sent. The engine refuses both when `NODE_ENV=production`. With `CATALOG=file`, the subscribers' requests and playheads come from `.sandbox/catalog.json` (re-read on every sync: edit it, then run `catalog-sync` from `/admin`). With `DOWNLOADER=fake`, every download takes `FAKE_DOWNLOADER_DURATION_MS` (default 10 s) and drops a copy of the sample video named after the link into `.sandbox/downloads/`; start one from the « Téléchargement manuel » form on `/admin/tickets`, e.g. `https://example.invalid/Inception.2010.1080p.mkv`. Both are refused in production too. Identifying what was downloaded needs a real TMDB key. A real TMDB key (read-only) makes titles and posters work.

### Configuration

Validated at boot by `components/api/src/environment.ts`.

**Engine**

| Group | Variables |
|---|---|
| Server | `PORT`, `SERVER_URL` (public URL used in links), `SERVICE_NAME`, `LOG_LEVEL` |
| Database | `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USERNAME`, `DATABASE_PASSWORD` |
| Paths | `DOWNLOADS_PATH`, `MEDIAS_PATH`, `MOVIES_FOLDER` / `SERIES_FOLDER` (defaults `movies` / `series`) |
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
| Admin channel | `ADMIN_CHANNEL` (`discord` default, or `console` for the local sandbox), `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID` (required with `discord`), `DISCORD_ADMIN_IDS` (comma-separated admin ids) |
| Email | `GMAIL_USER`, `GMAIL_PASSWORD` (app password; not needed with `USER_MESSAGING_OUTBOX`, the local sandbox's folder for emails) |

## Deployment

Production runs on the home server, deployed by its deployer from `infrastructure/terraform` (engine + one-shot migration; the database lives on the shared Postgres). A squash-merged PR on `main` releases (semantic-release), publishes `ghcr.io/plokkke/crn-flix/{api,migration}:<version>` and requests the deployment; a push touching `infrastructure/**` redeploys the current version. Secrets: `infrastructure/secrets/production.sops.yaml`. The cutover from the old compose stack and the rollback procedure: [`knowledge/deploiement.md`](knowledge/deploiement.md).

Migrations are applied in filename order and hashed: **never edit an applied migration, add a new one**, and keep it compatible with the previous version (rollback).

## Further reading

- [`CLAUDE.md`](CLAUDE.md) — detailed architecture: syncs, planner, indexer contract, tickets, read model, schema, NOTIFY channels.
- [`knowledge/deploiement.md`](knowledge/deploiement.md) — deployment, cutover and rollback.
- [`knowledge/plugins.md`](knowledge/plugins.md) — plugin architecture, roles, extraction status.
- [`knowledge/policy.md`](knowledge/policy.md) — the policy role.
- [`knowledge/download-planner-brief.md`](knowledge/download-planner-brief.md) — planner design.
