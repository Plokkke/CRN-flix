# CRN-Flix Engine

The brain of CRN-Flix. It turns what subscribers watch and want into media available in their library: it reads their intent from a **catalog**, plans what to download and when, searches **indexers** for releases, hands them to a **downloader**, files the result into the **media server** library and tells users when their media is ready. Everything that needs a human becomes a ticket, handled on an **admin channel** or the web dashboard.

The engine owns the logic; every external service sits behind a role. Some roles already have a formal contract, others are still coupled to their only implementation — the goal is for every implementation to become a plugin living outside the engine (see [Implementations](#implementations)).

## How it fits

```
Catalog ──► catalog sync ──► requests (intent) ──► planner ──► Indexers
                                                      │
                                     auto-trigger, or admin launches a link
                                                      ▼
Media server ◄── library refresh ◄── post-download pipeline ◄── Downloader
     │
     └──► library sync ──► request fulfilled ──► user notified (user channels)
```

| Role | Responsibility |
|---|---|
| **Catalog** | Where users express intent: watchlist, shows in progress, ratings, playheads |
| **Metadata provider** | Localized titles (French shown to users), original language, posters |
| **Indexer** | Searches releases for a movie or show and returns scoped candidates (episode, season, series) |
| **Downloader** | Downloads a link, reports progress, echoes the metadata attached to it |
| **Media server** | Hosts the library and the user accounts, tells what is available, gets refreshed after a placement |
| **Admin channel** | Surfaces tickets and receives admin replies/actions |
| **User channels** | Notifications, announcements and login codes, one channel per user |

## Features

- **Catalog sync** — watchlist, in-progress shows and highly rated titles become per-episode requests; per-user playheads drive urgency.
- **Download planner** — labels each missing episode `starved` / `needed` / `deferred`, picks the cheapest set of releases (episode, season or full-series bundles) and triggers the downloader automatically when it can handle the link.
- **Indexer search** — every indexer receives all known titles and picks its own query order. Candidates are filtered by quality, language, host and a runtime-based size cap; rejections are kept to explain why nothing was chosen. Each indexer can store an opaque bookmark per media, handed back on the next search.
- **Titles** — English in database and on disk, French shown to users.
- **Post-download pipeline** — identifies the file (action id → imdb id → filename), renames it to library conventions, refreshes the media server, marks the request fulfilled. Downloads flagged `private=true` go to a separate private tree.
- **Tickets** — user approvals, download actions, identification failures, dead letters, manual downloads. One core, two adapters: the admin channel and `/admin/tickets`.
- **Dashboards** — `/admin` (requests grouped per show, tabs by expected action, release-level forcing, live progress), `/me` (the subscriber's own requests, OTP + magic-link login), `/admin/announce` (outage / restoration notices, each user reached on their own channel).
- **Notifications** — only `fulfilled` / `rejected` reach users, batched per user.
- **Resilient boot** — only PostgreSQL is required to start; the media server and the downloader are reached lazily and their syncs fail per run.

### Download correlation

Links the engine shows to admins carry query params — `crn-flix-request-id` (planner action), `crn-flix-candidate-id` (a release launched by hand from the dashboard) and `imdbid`. Any client that forwards them as download metadata lets the engine match the finished download to its action or release and identify the media without guessing. Auto-triggered downloads carry `crn-flix-planned-download-id` directly.

## Implementations

| Role | Implementation | Code | Contract | Status |
|---|---|---|---|---|
| Catalog | Trakt | `src/modules/trakt/`, `services/trakt-sync.ts`, `trakt-playhead.ts` | none yet | Active, coupled |
| Metadata provider | TMDB | `src/modules/tmdb/`, `services/media-titles*.ts` | none yet | Active, coupled |
| Indexer | Loadix | `src/modules/indexer/loadix/` | `Indexer` (`modules/indexer/contract.ts`) | Active |
| Indexer | Hydracker | removed | `Indexer` | **Obsolete** — the service shut down |
| Downloader | Fetchr | `services/fetchr-sync.ts` | none yet | Active, coupled |
| Media server | Jellyfin | `src/modules/jellyfin/`, `services/jellyfin-sync.ts` | none yet | Active, coupled |
| Admin channel | Discord | `src/modules/discord/`, `services/messaging/admin/` | ticket adapter (`services/tickets/`) | Active |
| User channel | Email (Gmail SMTP) | `services/messaging/user/email/` | `UserMessaging` (`services/messaging/user/index.ts`) | Active |
| User channel | Discord DM | `services/messaging/user/discord.ts` | `UserMessaging` | Active |

Known cross-implementation couplings to remove on the way to plugins:

- Catalog credentials (Trakt tokens) are read from the media server's Trakt plugin configuration, not stored by the engine.
- Indexers are instantiated in `modules/indexer/registry.ts` from engine config, not discovered.
- The downloader's link support (`canHandle`) and its event vocabulary are used directly by the planner and the pipeline.
- Media placement paths are computed from the downloader's download path (`FETCHR_DOWNLOADS_PREFIX`) and the media server's library root.

## Repository layout

npm workspace — there is no top-level `src/`.

```
components/
├── api/          @crn-flix/api — the NestJS engine (all application code)
│   ├── src/controllers/   HTTP surface: /admin, /admin/tickets, /admin/announce, /me, /users, /mailing
│   ├── src/services/      syncs, planner/, tickets/, messaging/, database/ (raw pg repositories)
│   ├── src/modules/       implementations of external services (see Implementations)
│   └── test/              Jest unit tests + Stryker
└── database/     SQL migrations (src/scripts/NNNNN_*.sql) + migration runner image
knowledge/        design briefs (download planner)
terraform/        legacy local stack, not used by the production deploy
```

The SQL migrations and the TypeScript code are the source of truth for the schema. The Prisma schema in `components/database` has drifted and is not used by the API.

## Getting started

Requirements: Node ≥ 18 and a PostgreSQL database with the migrations applied, plus credentials for the implementations you enable.

```bash
npm install                     # from the repo root (workspaces)
cd components/api
# write .env, see Configuration below
npm run start:dev
```

### Commands (from `components/api/`)

| Command | What it does |
|---|---|
| `npm run start:dev` | Watch mode |
| `npm run validate` | Lint + build + unit tests |
| `npm run test:unit` / `test:mut` | Jest / Stryker mutation tests |
| `npm run indexer:find -- <indexer> --imdb tt… --title "…" [--type show --episodes "1:1-10"] [--verbose]` | Query an indexer standalone (no Nest, database or admin channel), handy to debug a search |

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

Production runs as Docker containers next to PostgreSQL and the services behind each role. `../deploy.sh` builds and pushes `antoinecaron/crn-flix` (API) and `antoinecaron/crn-flix-migration`, syncs `../docker-compose.yaml` to the server and restarts the stack. The migration container runs first; the engine only waits on it and on PostgreSQL.

Migrations are applied in filename order and hashed: **never edit an applied migration, add a new one.**

## Further reading

- [`CLAUDE.md`](CLAUDE.md) — detailed architecture: syncs, planner, indexer contract, tickets, read model, schema, NOTIFY channels.
- [`knowledge/download-planner-brief.md`](knowledge/download-planner-brief.md) — planner design.
- `docs/` and `ROADMAP.md` are historical and partly stale.
