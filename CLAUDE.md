# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CRN-Flix is a NestJS application that synchronizes media requests between Trakt.tv and Jellyfin media server. It searches indexers for download candidates, drives an admin workflow on Discord, hands downloads to the external Fetchr service, and notifies users when their requests become available.

Sibling repos (each its own git repo, outside this one): `fetchr/` (the downloader, WS + HTTP API), `fetchr-grab/` (browser extension that grabs links from indexer sites), `fetchr-push/`.

## Repo Layout

npm workspace (`workspaces: ["components/*"]`). There is **no** top-level `src/` — all engine code lives in `components/api/src/`.

- `components/api/` — `@crn-flix/api`, the NestJS engine. All application logic.
- `components/database/` — `@crn-flix/database`, raw SQL migrations in `src/scripts/*.sql` (applied in filename order). ⚠️ The Prisma schema in this package has drifted; **the SQL migrations and TS code are the only source of truth**. The API does not use Prisma — it talks to Postgres with raw `pg` queries via repositories in `components/api/src/services/database/`.
- `components/database/migration/` — migration runner.
- `terraform/`, `components/*/terraform/` — infra.
- `knowledge/` — design docs. See `knowledge/download-planner-brief.md` for the approved download-planner refactor (intent/plan separation, runway, starved/needed/deferred labels, set-cover resolution).

## Key Development Commands

Run from `components/api/`:

```bash
npm run build                    # nest build
npm run lint / lint:fix          # ESLint
npm run validate                 # lint + build + tests
npm run test:unit                # Jest (config: test/jest-unit.js)
npm run test:mut                 # Stryker mutation tests
npm run start:dev                # watch mode
npm run once                     # single run (nest start -- --once)
npm run indexer:find -- [indexer] --imdb tt... --title "..." [--type|--season|--episode|--runtime|--verbose]
                                 # standalone indexer harness (no Nest/DB/Discord boot, raw env)
```

## Architecture Overview

### Sync services (registered as cron jobs in `app.service.ts:onModuleInit`)

- **`services/trakt-sync.ts`** (`*/5`, production only) — expands Trakt activity into per-episode requests. Request kinds (`request_users.reasons`): `WATCHLISTED` (watchlist), `PROGRESS` (currently watching, window starts at Trakt `next_episode`), `HIGH_RATED` (rating ≥ threshold — the de-facto "rewatch/keep" signal, always fully expanded). `WATCHLISTED`/`PROGRESS` are currently window-truncated by `bufferedExpansion` (~150 min of viewing time) — this truncation is slated for removal by the planner refactor. Incremental sync gated on Trakt `last_activities`, with a forced full sync every 24h.
- **`services/jellyfin-sync.ts`** (`*/15`) — lists Jellyfin assets, upserts medias, marks requests `fulfilled` (status change fires the NOTIFY trigger).
- **`services/indexer-sync.ts`** (hourly) — re-runs the indexer orchestrator over `missing`/`pending` requests.
- **`services/discord-sync.ts`** (`*/5`) — reconciler that creates missing admin embeds.
- **`services/fetchr-sync.ts`** — WebSocket to Fetchr; mirrors in-flight downloads into an in-memory `Map` only (nothing persisted; the `download::list` snapshot on reconnect is authoritative). `fetchr.download()` is fire-and-forget.

### Indexers (`components/api/src/modules/indexer/`)

- `contract.ts` — `Indexer.find(media, prefs) → IndexerCandidate[]`. Candidates are per-episode; no bundle/pack granularity yet (Loadix fetches `scope`/season info but currently drops it in `toCandidate`).
- Implementations: `loadix/` (candidate URL is the generic media page, not a per-link URL) and `hydracker/` (**abandoned** — the API went paid; slated for deletion in the planner refactor, do not invest in it).
- `preferences.ts` — quality/language/host allow-lists + size cap (size cap no-ops when `runtimeMinutes` is null — movies always have null runtime).
- `services/indexer-orchestrator.ts` — picks the best candidate (`services/indexer-scoring.ts`), stores it on the request, flips `missing → pending`, auto-triggers Fetchr when `fetchr.canHandle(url)`. Called inline from trakt-sync on new requests and from indexer-sync.
- `services/indexer-link.ts` — appends `crn-flix-request-id` + `imdbid` query params to display links; that is the handshake with the `fetchr-grab` extension.

### Admin surface: Discord (NOT ClickUp — no ClickUp code exists)

`services/messaging/admin/discord.ts` — one embed per request (per episode), id stored in `media_requests.discord_message_id`. Reject/restore buttons, reply-with-IMDb-id to resolve identity, reply-with-URL to submit a manual download. A single pinned, silent `📥 Téléchargements` progress message is refreshed every 30s by `services/download-progress.ts`. There is also an admin web dashboard (`controllers/AdminController.ts`, Discord-OTP login, backed by `admin_sessions`).

### User notifications

Event-driven off `media_requests.status` transitions (not a diff). Only `fulfilled` and `rejected` notify users (`pending`/`missing` oscillate by design). Dedup via the `user_notifications` claim ledger. Email is batched per user (60s debounce, `services/messaging/user/email/queue.ts`); Discord DMs are per-request (not batched). Channel chosen by `users.messaging_key`.

### Downloads

- `download_jobs` table = **post-download** processing only (`detected → identifying → completed|failed`), created when Fetchr reports completion. `PostDownloadPipeline` resolves identity via metadata cascade requestId → imdbId → filename. On `completed`: Jellyfin library refresh + `fulfillByJobId` + Fetchr remove.
- Correlation metadata: `buildDownloadMetadata` in `fetchr-sync.ts` (`crn-flix-request-id`, imdbid, type, title, ...), echoed back by Fetchr.
- `StartupRecoveryService` re-drains stuck jobs on boot and on LISTEN reconnect.

### Database schema (per SQL migrations, currently through `00012`)

- `medias` — one row **per episode** (or movie): `imdb_id` (the show's id, repeated per episode), `type IN ('movie','episode')`, `season_number`, `episode_number`, `runtime_minutes`. No show/season-level rows.
- `media_requests` — **PK is `media_id`** (no own id, exactly one request per media). `status IN ('missing','pending','fulfilled','rejected')`, `discord_message_id`, `indexer_name`, `indexer_link`, `download_job_id`.
- `request_users` — who wants it and why (`reasons VARCHAR(64)[]`).
- `user_activities` — Trakt sync bookkeeping per user×kind (NOT watch progress; no playhead is stored anywhere).
- `users`, `download_jobs`, `user_notifications`, `naming_audit_items`, `admin_sessions`.

### PostgreSQL NOTIFY/LISTEN

Channels: `request_created`, `request_status_changed`, `user_joined_request`, `user_left_request`, `download_job_created`, `download_job_status_changed`. Emitted by SQL triggers, consumed via `helpers/sql.ts:listenWithReconnect` (zod-validated payloads, exponential reconnect), fanned out in `app.service.ts`.

## Important Notes

- Admin ticketing is **Discord**; any ClickUp references in older docs are obsolete.
- Sync is activity-based to minimize Trakt API calls; Trakt responses cached keyed on activity timestamps.
- Trakt access tokens live in the **Jellyfin Trakt plugin config**, not in Postgres. Jellyfin scrobbles watch history out to Trakt; the engine reads progress from Trakt only.
- All external API calls have rate limiting and retry logic.
- `trakt-sync.ts` has no test coverage; existing tests cover indexers, download-format/live-state, admin-auth, helpers.
- `docs/` (ARCHITECTURE/WORKFLOWS/SETUP) and `ROADMAP.md` are historical and partly stale — verify against code before trusting them.
