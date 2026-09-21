# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CRN-Flix is a NestJS application that synchronizes media requests between Trakt.tv and Jellyfin media server. It searches indexers for download candidates, drives an admin workflow on Discord, hands downloads to the external Fetchr service, and notifies users when their requests become available.

Sibling repos (each its own git repo, outside this one): `fetchr/` (the downloader, WS + HTTP API), `fetchr-grab/` (browser extension that grabs links from indexer sites), `fetchr-push/`.

## Repo Layout

npm workspace (`workspaces: ["components/*"]`). There is **no** top-level `src/` — all engine code lives in `components/api/src/`.

- `components/api/` — `@crn-flix/api`, the NestJS engine. All application logic.
- `components/database/` — `@crn-flix/database`, raw SQL migrations in `src/scripts/*.sql` (applied in filename order; **the runner hashes applied files and refuses a modified one — never edit an applied migration, add a new one**). ⚠️ The Prisma schema in this package has drifted; **the SQL migrations and TS code are the only source of truth**. The API does not use Prisma — it talks to Postgres with raw `pg` queries via repositories in `components/api/src/services/database/`.
- `components/database/migration/` — migration runner.
- `terraform/`, `components/*/terraform/` — infra.
- `knowledge/` — design docs. See `knowledge/download-planner-brief.md` for the download-planner design (intent/plan separation, runway, starved/needed/deferred labels, set-cover resolution) — **implemented** as of migration `00013`.

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
npm run indexer:find -- [indexer] --imdb tt... --title "..." [--type movie|show|--episodes "1:1-10"|--runtime|--verbose]
                                 # standalone indexer harness (no Nest/DB/Discord boot, raw env)
```

## Architecture Overview

### Sync services (registered as cron jobs in `app.service.ts:onModuleInit`)

- **`services/trakt-sync.ts`** (`*/5`, production only) — expands Trakt activity into per-episode requests (**full intent**, never window-truncated). Request kinds (`request_users.reasons`): `WATCHLISTED` (watchlist), `PROGRESS` (currently watching), `HIGH_RATED` (rating ≥ threshold — the de-facto "rewatch/keep" signal). `PROGRESS` also persists the per-user playhead into `user_show_progress` (NULL = completed/dropped). Request creation only writes intent; the planner reacts to NOTIFY events. Incremental sync gated on Trakt `last_activities`, with a forced full sync every 24h.
- **`services/jellyfin-sync.ts`** (`*/15`) — lists Jellyfin assets, upserts medias, marks requests `fulfilled` (status change fires the NOTIFY trigger).
- **`services/planner/`** (hourly cron + event-driven, 30s per-show debounce) — the download planner. Pure core (`runway.ts`, `labels.ts`, `resolve.ts`, `diff.ts` — no I/O, heavily unit-tested) + `planner.ts` orchestrator. Derives `starved`/`needed`/`deferred` labels from runway + viewing-time windows (`needWindowHours` 5h / `maxWindowHours` 25h soft ceiling). **Indexers are queried for every target with a missing episode, whatever the label** (so bookmarks/admin links exist for deferred shows too — decided 2026-09-07); the label only decides what becomes an action: the weighted set cover runs over urgent (`starved`/`needed`) episodes only, deferred ones covered by a chosen bundle are a free bonus. Resolves the set cover over bundle-aware candidates, and materializes the plan into `planned_downloads` (statuses `proposed → downloading → done`, plus `superseded`/`expired`). Owns that table exclusively; cancels superseded in-flight downloads via Fetchr `download::cancel`; auto-triggers `starved`/`needed` actions when `fetchr.canHandle(url)`.
- **`services/tickets/reconciler.ts`** (`*/5`, job `ticket-sync`) — re-materializes every open ticket without a Discord root binding (60s grace vs the created-event race).
- **`services/fetchr-sync.ts`** — WebSocket to Fetchr; mirrors in-flight downloads into an in-memory `Map` only (nothing persisted; the `download::list` snapshot on reconnect is authoritative). `fetchr.download()` is fire-and-forget.

### Indexers (`components/api/src/modules/indexer/`)

- `contract.ts` — `Indexer.find(target, prefs, bookmark) → { candidates, bookmark }`. One search per **show** (target carries the full episode intent); candidates are bundle-aware via `CandidateScope` (`movie` | `episode` | `season` | `series`). Size cap aggregates runtimes over the scope.
- **Titles** (`contract.ts:MediaTitles`, decided 2026-09-21): the target carries every name the engine knows — `title` (English, canonical for database and disk), `originalTitle`, `frenchTitle`, `originalLanguage` (ISO 639-1), `year` — and **the indexer picks its own query order** (Loadix, a French catalogue: French → original → English, then the same with the year; a foreign or anime-only indexer may bail out on `originalLanguage`). `query.ts:buildSearchQueries(titles, year)` dedupes/sanitizes; `isSameTitle` compares titles accent/punctuation-insensitively. Loadix passes the release year as a server-side window (`year_from`/`year_to`, ±1 — `YEAR_TOLERANCE`, decided 2026-09-21; the same window goes on the manual `searchUrl`) instead of "title year" query variants, ranks the hits carrying one of our titles before look-alikes and spends at most 2 detail lookups per query on look-alikes (global cap 5), so the French query's noise never starves the original-title query. Syncs only know the English title (Trakt): `services/media-titles.ts:MediaTitlesService` resolves the rest from TMDB (`media-titles-resolver.ts`, en-US + fr-FR `/find`, memoised) — on demand in the planner before an indexer search (`ensure`), and hourly for every row still without a French title (`media-titles-job`, 200 imdb ids per run) — persisting on every row of the imdb id (`medias.updateTitles`). **Users see the French title** (`medias.ts:displayTitle` = `frenchTitle ?? title`): request groups (admin + `/me`), Discord DMs, request-update emails, ticket titles, Fetchr download labels. File naming stays English (`MediaLabelizerService` re-canonicalizes through the same resolver). `indexer:find` takes `--french-title` / `--original-title` / `--language`. The same resolution stores the TMDB `poster_path` (00023, French artwork preferred): `medias.ts:posterUrl(media, size)` builds `https://image.tmdb.org/t/p/<size><path>` with no extra call (public CDN) — the request-update email shows it; no Jellyfin fallback by decision (2026-09-21).
- **Bookmarks** (`IndexerBookmark`, table `indexer_bookmarks`, migration 00016): what an indexer wants remembered per `(indexer_name, imdb_id)`. The engine (`services/planner/bookmarks.ts:findAcrossIndexers`) stores what `find` returns (only when it differs, null = forget) and hands it back next time — it **never interprets `state`** and applies **no expiry policy**; the indexer alone decides what to do with it (Loadix: skips search+detail with a remembered media id + season ids, refreshes the detail when the intent reaches an unknown season, falls back to search on 404 / imdb mismatch, validates `state` with its own zod schema). `pageUrl` / `searchUrl` are the only generic fields: the admin dashboard shows them per indexer under each show/movie. `indexer:find -- --bookmark '<json>'` replays one.
- Implementation: `loadix/` only (candidate URL is the generic media page, not a per-link URL — candidates are deduped by scope/quality/language/host). Listings are **unfiltered** (no server-side quality/language/provider filters, links endpoint paginated up to 5 pages) so the engine can explain rejections. Hydracker was deleted (API went paid).
- `preferences.ts` — quality/language/host allow-lists + size cap; `relaxPreferences` applies an admin override.
- **Size cap never fails open**: `assessCandidate` uses `estimatedScopeRuntimeMinutes` — the known runtime, else 120 min per movie / 45 min per episode (`DEFAULT_*_RUNTIME_MINUTES` in `contract.ts`). Movies get their runtime from Trakt during sync (`TraktApi.requestMovieDetails`, or the `extended=full` watchlist item); `medias.upsert` keeps a known runtime (`COALESCE`), so old NULL rows heal on the next sync. The admin fold flags « durée inconnue, N min supposées ».
- `services/indexer-scoring.ts` — preference-order scoring, used by the planner as a deterministic tie-break.
- `services/indexer-link.ts` — `actionDisplayLink` appends `crn-flix-request-id` (= **action id**) + `imdbid` query params to display links; that is the handshake with the `fetchr-grab` extension (it only forwards those exact param names). The engine correlates Fetchr downloads to actions via both `crn-flix-planned-download-id` (auto-trigger) and `crn-flix-request-id` (grab handshake).

### Admin surface: the ticket system (channel-agnostic core, Discord + web adapters)

**Core** (`services/tickets/`): every process that needs a human opens a **ticket** (`tickets` + `ticket_events` timeline + `ticket_bindings` adapter refs — see `services/database/tickets.ts`). Categories: `user-approval`, `download-action` (one per live planner action), `identification-failure`, `pipeline-failure` (**dead-letter**: manual resolution only), `manual-download` (spontaneous admin link), `missing-imdb` (Trakt title without imdb id, opened by trakt-sync). One OPEN ticket per (category, subject) — enforced by a partial unique index; `TicketService.applyOperation(id, op, actor)` is the single entry point for every adapter (ops per category in `model.ts:OPERATIONS_BY_CATEGORY`); category resume logic lives in `ticket-handlers.ts` (registered at boot — adapters never touch business services). Failed attempts keep the ticket open with an `attempt-failed` event; auto-resolution rules are pure (`auto-resolve.ts`). `presenter.ts` builds the shared view-model (title/tone/fields/operations) for both adapters.

**Discord adapter** (`services/messaging/admin/ticket-adapter.ts` + `channel.ts`/`embeds.ts`/`parse.ts`): ticket created → root embed in the admin channel + attached thread (a thread started from a message **shares its id**, so the single `root` binding resolves replies AND thread messages); timeline events → messages in the thread; resolution → **thread deleted and root embed deleted** (the channel only shows open tickets; a manual-download root is the admin's own message and stays, its thread still goes; events on a closed ticket are not posted, that would recreate the thread). Replies are parsed against the ticket's allowed ops (`tt…` → submitImdb, URL → submitLink); buttons `ticket-approve/reject/restore/resolve`. A spontaneous admin message with a URL opens a manual-download ticket bound to that very message. The pinned silent `📥 Téléchargements` board lives in `downloads-board.ts` (refreshed every 30s by `services/download-progress.ts`). Manual job `discord-cleanup` (`channel-cleanup.ts`, dashboard Jobs): deletes every thread and every non-pinned message of the admin channel (bulk for < 14 days, one by one beyond), drops all `discord` bindings, then runs the reconciler so open tickets come back as fresh embeds.

**Web adapter** (`controllers/TicketsAdminController.ts`, `/admin/tickets`): list (open / dead-letter / recently closed), detail with timeline, and forms driven by `OPERATIONS_BY_CATEGORY` — full parity with Discord. Uses the existing Discord-OTP admin auth; `AdminAuthService.validateSession` returns `{subjectId}` (the admin's Discord id) so operations are attributed (`dashboard:<id>` vs `discord:<id>` actors). The requests dashboard is `controllers/AdminController.ts` — requests are **grouped per show/movie** (`services/request-groups.ts`, shared table view in `templates/request-groups-view.ts`).

### Subscriber space (`controllers/MeController.ts`, `/me`)

Read-only view of the logged-in user's own requests, grouped per show. Auth is **OTP + magic link** delivered through the user's own messaging channel (`users.messaging_key`: email or Discord DM) — deliberately **not** the Jellyfin password (it would transit in clear through the engine). Shared session machinery in `services/auth/` (`SessionAuthService` base, `otp.ts` helpers) + `services/database/sessions.ts` (generic repo; `admin_sessions` and `user_sessions` are subclasses); guards/filters generic in `guards/session.guard.ts` + `filters/session-auth-redirect.filter.ts`. Pending challenge lives in the memory cache keyed per user (6-digit code + link token, 10 min, 5 attempts); the `crn_user_login` cookie remembers which user is mid-challenge. Login by **pseudo** (`users.name`), active users only.

### Unified requests dashboard (`/admin`, `controllers/AdminController.ts`)

Read model + UI decided 2026-09-07 (see memory `crn-flix-request-states`). Four orthogonal axes, never merged into one status field:
1. **Intent** — `media_requests` (`fulfilled`/`rejected` close it; `missing`/`pending` are kept only as a mirror of execution for notifications and `/me`).
2. **Urgency** — `starved`/`needed`/`deferred` from playheads (informational only; deferred never blocks indexing).
3. **Sourcing** — `services/planner/sourcing.ts:assessSourcing`: `available` | `non-compliant` (fails only quality/size → forceable) | `unavailable` (host/language → nothing to do) | `not-indexed` (indexer has the show, not the episode) | `not-referenced` (no indexer page). Requires unfiltered indexer listings (`assessCandidate` returns the reject reasons).
4. **Execution** — `planned_downloads` + Fetchr live state + `download_jobs`.

The planner writes the **snapshot** `media_request_states` (00017) at the end of every pass: one row per missing episode (urgency, sourcing, best candidate, best rejected + reasons, action id). Nothing else is derived at display time. `services/admin/requests-view.ts:buildDashboard` is the pure view builder (tabs *À télécharger / À forcer / Sans solution / Système / Clos* at **episode granularity** — a show appears in every tab where it has an episode; sort = urgency, then oldest snapshot, then requester count). Each row folds open to a **release-centric** view (decided 2026-09-07): the best eligible releases covering every missing episode, deferred included (`resolvePlan` over all missing, computed at render time from `planner_findings`), each with what it spans, what it would fill, and a `Télécharger` link; then, **one line per closest rejected release** (its scope, non-compliant properties in yellow text, no label, what it would fill) that the admin can launch anyway, then bare uncovered ranges; all fold lines sorted by urgency then first episode (`ReleaseLine`) — that **is** the forcing, no per-target override exists anymore. Then the planner's live actions with their ticket operations (posted to `/admin/tickets/:id/op` with `returnTo`). Execution (`services/admin/execution.ts`: proposed → downloading → extracting (a `download_jobs` row correlated by Fetchr metadata) → failed) is polled from `GET /admin/requests/progress` every 30s. **States describe, tickets summon a human** — never turn a state into a ticket. A hand launch from the fold creates **no action and no ticket**: its link carries `crn-flix-candidate-id` (sha1 of indexer|url|scope|quality|language|host|size, `services/indexer-link.ts:candidateId`) + `imdbid`; the fetchr-grab extension forwards both (`CRN_FLIX_PARAMS` in its three scripts), Fetchr echoes them, the post-download pipeline identifies via imdb, and the dashboards correlate the download/job to the release by candidate id (`launches` on the row, tracks `candidate:<id>` / `action:<id>` in `GET …/progress`).

The subscriber space `/me` renders the **same read model** (`buildDashboard` restricted to the user's requests, `templates/user-space.ts`) with less detail: sourcing collapsed to *Source trouvée / Introuvable*, urgency shown including `deferred` (« Plus tard »), execution visible, tabs *En attente / Disponible / Refusé*, `GET /me/progress` limited to the user's own actions. Shared tab/fold/polling JS and layout CSS live in `templates/dashboard-shared.ts`.

No `discord_message_id` column exists anywhere anymore — `ticket_bindings` is the only Discord↔state mapping. `users.status` (`pending`/`active`) makes the approval state explicit (reject = DELETE, audited by the resolved ticket).

### User notifications

Event-driven off `media_requests.status` transitions (not a diff). Only `fulfilled` and `rejected` notify users (`pending`/`missing` oscillate by design). Dedup via the `user_notifications` claim ledger. Email **and** Discord DMs are batched per user (60s debounce via the shared `services/messaging/user/notification-queue.ts`; Discord groups episodes per show into one embed). Channel chosen by `users.messaging_key`.

### Announcements (`/admin/announce`)

One-off notices to subscribers (outage, restoration). `ServiceNotice` (`services/messaging/user/index.ts`) is rendered by every channel through `UserMessaging.announce` (email template `templates/service-notice.ts`, Discord embed) — each user is reached on their own `messaging_key`, never email-only. Presets in `services/announcements/presets.ts` (`outage`, `restored`); `AnnouncementService.send` delivers sequentially to the selected **active** users and returns per-user outcomes. `AnnounceAdminController` = form (preset tabs, editable fields, recipient checkboxes, `Prévisualiser` opens the HTML in a new tab, `Envoyer` confirms) + result page. No persistence: nothing is stored about an announcement beyond the logs. Public preview: `GET /mailing/service-notice/:preset`.

### Downloads

- `download_jobs` table = **post-download** processing only (`detected → identifying → completed|failed`), created when Fetchr reports completion. `PostDownloadPipeline` resolves identity via metadata cascade requestId → imdbId → filename. On `completed`: Jellyfin library refresh + `fulfillByJobId` + Fetchr remove.
- Correlation metadata: `buildDownloadMetadata` in `fetchr-sync.ts` (`crn-flix-request-id`, imdbid, type, title, ...), echoed back by Fetchr.
- `StartupRecoveryService` re-drains stuck jobs on boot and on LISTEN reconnect.

### Database schema (per SQL migrations, currently through `00021`)

- `medias` — one row **per episode** (or movie): `imdb_id` (the show's id, repeated per episode), `type IN ('movie','episode')`, `season_number`, `episode_number`, `runtime_minutes`. No show/season-level rows.
- `media_requests` — **PK is `media_id`** (no own id, exactly one request per media). `status IN ('missing','pending','fulfilled','rejected')` (`pending` = covered by at least one live action), `download_job_id`. The intent store — never truncated.
- `request_users` — who wants it and why (`reasons VARCHAR(64)[]`).
- `user_show_progress` — playhead observation per user×show (`next_season`/`next_episode`, NULL = completed/dropped), fed by trakt-sync.
- `planned_downloads` + `planned_download_medias` — the materialized plan (actions + coverage). Owned exclusively by the planner; `alternatives JSONB` carries the runner-up candidates for the admin embed. **Every pass re-assesses `proposed` actions against the current effective preferences** (`services/planner/revalidate.ts:staleProposals`) and supersedes the stale ones — a proposal never outlives the rules that produced it (`downloading` ones are left alone, the admin acted). `diffPlan`'s `keep` only protects proposals that still pass.
- `tickets` + `ticket_events` + `ticket_bindings` — the admin-action ledger (00014). `subject_type`/`subject_id` without FK (a ticket survives its subject); partial unique index = one open ticket per subject; bindings map `(adapter, external_id)` → ticket (unique both ways).
- `user_activities` — Trakt sync bookkeeping per user×kind (NOT watch progress).
- `users` (with `status` pending/active), `download_jobs`, `user_notifications`, `naming_audit_items`, `admin_sessions`, `user_sessions` (00015, subscriber space), `indexer_bookmarks` (00016), `media_request_states` + `planner_overrides` (00017). `planned_downloads.host` (00018) keeps the release host so proposals can be re-assessed. `planner_findings` (00020) keeps every assessed release per target (the dashboards' release lists); `planner_overrides` (created by 00017, dropped by 00021) is gone. `medias.french_title` + `original_language` (00022) and `poster_path` (00023) hold the TMDB-resolved names and artwork (see Indexers › Titles). `medias.trakt_slug` (00019) feeds the direct Trakt links (`app.trakt.tv/shows|movies/<slug>`), filled by trakt-sync from Trakt ids (`MediaInfos.traktSlug` is engine metadata, not part of the indexer contract).

### PostgreSQL NOTIFY/LISTEN

Channels: `request_created`, `request_status_changed`, `user_joined_request`, `user_left_request`, `download_job_created`, `download_job_status_changed`, `planned_download_created`, `planned_download_status_changed`, `planned_download_label_changed`, `user_show_progress_changed`, `ticket_created`, `ticket_status_changed`, `ticket_event_created`. Emitted by SQL triggers, consumed via `helpers/sql.ts:listenWithReconnect` (zod-validated payloads, exponential reconnect). `app.service.ts` fans out request/progress events into planner passes and planned_download/download_job events into ticket openings/resolutions; the Discord adapter renders straight off the ticket_* events (so dashboard-made changes render too).

## Important Notes

- Admin ticketing is **Discord**; any ClickUp references in older docs are obsolete.
- Sync is activity-based to minimize Trakt API calls; Trakt responses cached keyed on activity timestamps.
- Trakt access tokens live in the **Jellyfin Trakt plugin config**, not in Postgres. Jellyfin scrobbles watch history out to Trakt; the engine reads progress from Trakt only.
- All external API calls have rate limiting and retry logic.
- **The engine boots without Jellyfin and without Fetchr** (decided 2026-09-13, disk incident): `TraktPlugin` resolves the Jellyfin plugin lazily on first use (retried after a failure), Fetchr WS reconnects forever, readiness only gates on Postgres (`fetchr-ws` is a logging-only liveness check), and the compose file has no `depends_on` from the engine to `jellyfin`/`fetchr`. Only `JELLYFIN_TOKEN` must be set (no boot-time auth call). Syncs that need them fail per run and are logged.
- Tests cover the planner pure core (canonical cases from the brief), the ticket core (service/auto-resolve/presenter/handlers/parse), indexers, trakt-sync expansion/playhead/missing-imdb, download-format/live-state, admin-auth, helpers.
- `docs/` (ARCHITECTURE/WORKFLOWS/SETUP) and `ROADMAP.md` are historical and partly stale — verify against code before trusting them.
