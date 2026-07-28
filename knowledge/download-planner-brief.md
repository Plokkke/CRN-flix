# Brief — Download Planner refactor

Status: approved design, ready to implement.
Scope: `crn-flix-engine` (component `api` + `database`). Fetchr itself is out of scope except for one API check (see Investigations).

## 1. Problem

Today the back-pressure window is applied **at catalogue level**: `bufferedExpansion`
(`components/api/src/services/trakt-sync.ts:392-415`) truncates a show request to
`ceil(150min / runtime)` episodes at Trakt-sync time. This conflates the user's
**intent** ("watch the whole series") with the **plan** ("download the next ~3 episodes"),
which causes:

- drip-feed notifications: when the admin provisions a full season, the user is notified
  episode by episode as the window advances, instead of "S1E1-10 available" at once;
- per-episode indexer resolution: `IndexerOrchestrator.runForRequest` resolves one episode
  at a time, so a season pack covering E1-E10 can never beat 10 individual links, and
  Loadix pack information is fetched then discarded (`modules/indexer/loadix/indexer.ts:108-119`);
- no global resolution: wanting E6,E7,E8 with candidates {E6, E8, S1-pack} yields three
  downloads instead of one pack;
- no priority signal for the admin: every pending request looks equally urgent.

## 2. Target architecture

Three layers, one source of truth per nature of information:

```
┌────────────┐   full intent    ┌────────────┐   candidates    ┌────────────┐
│ CATALOGUE  │ ───────────────► │  INDEXERS  │ ──────────────► │  PLANNER   │
│ (trakt-sync)│                 │ (per show) │                 │ (new)      │
└────────────┘                  └────────────┘                 └─────┬──────┘
  stores INTENT                  stateless                     writes PLAN
  (media_requests,               (bundle-aware                 (planned_downloads,
   per episode,                   candidates)                   labeled actions)
   NOT truncated)                                                    │
                                                                     ▼
Observed state: Jellyfin library (fulfilled), Fetchr live downloads,   Discord admin
Trakt playhead (persisted per user×show).                              (1 embed / action)
```

Rules:
- **Intent and observations are stored. Everything else is derived and recomputed** on each
  planner pass. The only persisted derived state is the plan itself (the admin worklist),
  and the planner owns its lifecycle — it must invalidate/supersede stale actions.
- The planner is **level-based, not edge-based**: labels and plans are pure functions of
  the current state (playhead, availability, intent, candidates), never state-machine
  transitions. Missed intermediate states are irrelevant by construction.

## 3. Core concepts and vocabulary

### Intent
The full set of episodes the user asked for. Stored as today: one `medias` row +
one `media_requests` row per episode + `request_users.reasons`. The change is that show
expansion is **always complete** (all aired episodes), never window-truncated.
`HIGH_RATED` (de-facto rewatch signal) already expands fully — unchanged.

### Runway
For user `u` on show `s`: hours of **consecutively available, unwatched** content ahead of
the playhead. Formally: walk episodes from the user's `next_episode`; sum
`runtime_minutes` while episodes are available (fulfilled in Jellyfin); stop at the first
missing episode. Multi-user: compute per user, merge by **min runway** (most urgent wins).

### Labels (per missing episode, then aggregated per action)
Derived from runway + a viewing-time window. Uniform naming, past-participle:

| Label      | Rule                                                                 |
|------------|----------------------------------------------------------------------|
| `starved`  | first missing episode when runway = 0 — the user is stalled          |
| `needed`   | missing episode within the first `needWindowHours` (default **5h**) of unwatched viewing time from the playhead |
| `deferred` | missing episode beyond the window — in the intent, not urgent        |

`starved` is an upgrade of the first missing episode only; episodes behind it keep their
window-based label (matches: intent 1-10, nothing available → E1 `starved`, E2-E4 `needed`,
E5-E10 `deferred`; once E1 is downloaded but unwatched → E2-E4 `needed`, nobody starved).
An **action's label = max urgency among the missing episodes it covers**
(candidates 1-2 / 3-7 / 8-10 → `starved` / `needed` / `deferred`).

### Plan resolution (weighted set cover)
Input: `wanted` = missing episodes labeled `starved` or `needed` (per show);
`available` = fulfilled episodes; `candidates` = bundle-aware indexer results.
Output: a set of candidate releases covering `wanted`, minimizing:

```
cost = α · (number of actions)              // admin effort — favors packs
     + β · (redundant bytes)               // overlap with already-available episodes
     + γ · (viewing-hours beyond maxWindowHours)   // soft ceiling, default 25h
```

- `deferred` episodes covered by a chosen bundle are free bonus (never penalized) — this
  is what makes a season pack win when only 3 episodes are `needed`.
- The ceiling is **soft**: Daredevil complete (~33h) can still win as a single action;
  SG-1 series-pack (~160h) cannot.
- Dominated candidates (episodes ⊆ another chosen release) are excluded by construction —
  this is the global-resolution property ({E6,E8,S1-pack} with E7 missing → {S1-pack} only).
- Instances are tiny (tens of candidates): greedy by cost/coverage ratio, or exhaustive
  over small candidate subsets. No ILP needed.
- `sizeBytes` may be null: estimate via `maxSizeBytes(quality, totalRuntime, sizePolicy)`
  (`modules/indexer/preferences.ts:29-35`) as fallback so β stays meaningful.
- Downloads are **DDL only** — no partial-file selection; overlap is real wasted bytes.

### Plan lifecycle
Actions persisted in `planned_downloads`, statuses:

```
proposed ──► downloading ──► done
   │              │
   └──────────────┴──► superseded        (a re-plan dominated or invalidated it)
   └──► expired                          (intent gone: user left / rejected)
```

On each pass the planner re-resolves and diffs against live actions:
- action no longer in the optimal plan and strictly dominated → `superseded`
  (+ Fetchr cancel if `downloading` — cancelling is always profitable in DDL since the
  superseding bundle delivers those files anyway);
- labels on surviving actions are **refreshed in place** (they are current-value caches,
  not history);
- admin free-will is absorbed, never contradicted: if the admin downloads 3 seasons while
  only S1 was `needed`, the next Jellyfin sync marks episodes fulfilled, actions close as
  `done`, notifications fire on the full intent. The plan reconciles with reality, not the
  other way around.
- Links are re-validated at execution time by the regular indexer re-scan; the action
  carries the current best candidate, refreshed on re-plan.

## 4. Database changes (new migration `00013`)

```sql
-- observation: playhead per user × show (fed by trakt-sync progress fetch)
CREATE TABLE user_show_progress (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  show_imdb_id VARCHAR(32) NOT NULL,
  next_season INT,          -- NULL = show completed by this user
  next_episode INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, show_imdb_id)
);

-- the materialized plan
CREATE TABLE planned_downloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_imdb_id VARCHAR(32),               -- NULL for movies
  scope VARCHAR(16) NOT NULL CHECK (scope IN ('movie','episode','season','series')),
  season_number INT,
  indexer_name TEXT NOT NULL,
  url TEXT NOT NULL,
  quality VARCHAR(16) NOT NULL,
  language VARCHAR(16) NOT NULL,
  size_bytes BIGINT,
  label VARCHAR(16) NOT NULL CHECK (label IN ('starved','needed','deferred')),
  status VARCHAR(16) NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','downloading','done','superseded','expired')),
  discord_message_id VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- coverage: which intent episodes/movies an action satisfies
CREATE TABLE planned_download_medias (
  planned_download_id UUID NOT NULL REFERENCES planned_downloads(id) ON DELETE CASCADE,
  media_id UUID NOT NULL REFERENCES medias(id) ON DELETE CASCADE,
  PRIMARY KEY (planned_download_id, media_id)
);
```

Add NOTIFY triggers on `planned_downloads` (created / status_changed / label_changed)
mirroring the existing pattern (`00001_initial_schema.sql:162-249`).

Dropped in the same migration (fix-forward, no rollback path):
- `media_requests.indexer_name`, `media_requests.indexer_link` — the winning link now
  lives on the action;
- `media_requests.discord_message_id` — per-episode admin embeds are replaced by
  per-action embeds (see §6). Legacy embeds are cleaned by a one-off purge of the admin
  channel (delete request embeds, keep the pinned `📥 Téléchargements` message), so the
  stored ids are not needed. Movies also go through the planner (scope `movie`,
  single-media coverage), so the model is uniform.

`media_requests` statuses are unchanged (`missing/pending/fulfilled/rejected`); `pending`
now means "covered by at least one live action".
Also update the Prisma schema (`components/database/src/schema.prisma`) — it has drifted
(still references `jdownloaderPackageId`, `canceled` status); re-introspect after migrating.

## 5. Module changes

### 5.1 Indexer contract — bundle-aware candidates
`modules/indexer/contract.ts`:

```ts
export type CandidateScope =
  | { kind: 'movie' }
  | { kind: 'episode'; season: number; episode: number }
  | { kind: 'season'; season: number }
  | { kind: 'series' };

export type IndexerCandidate = {
  indexerName: string;
  url: string;
  scope: CandidateScope;          // NEW
  quality: Quality;
  language: Language;
  host: Host;
  sizeBytes: number | null;
};

export type IndexerTarget =
  | { kind: 'movie'; media: IndexerMedia }
  | { kind: 'show'; imdbId: string; title: string; originalTitle: string | null;
      year: number | null; episodes: ReadonlyArray<{ season: number; episode: number;
      runtimeMinutes: number | null }> };

export interface Indexer {
  readonly name: string;
  find(target: IndexerTarget, prefs: EnginePreferences): Promise<IndexerCandidate[]>;
}
```

One search per **show** (not per episode) — this removes the O(episodes × indexers)
serialized HTTP pattern of `indexer-orchestrator.ts`.

- **Loadix** (`modules/indexer/loadix/`): stop dropping data. `LoadixLink` already carries
  `scope`, `seasonNumber`, `episodeNumber`, `releaseGroup` (`loadix/schemas.ts:31-43`);
  map them into `CandidateScope` in `toCandidate` (`loadix/indexer.ts:108-119`).
  Known issue: the emitted `url` is the generic media page (`${siteHost}/media/${id}`) —
  investigate whether a per-link URL exists; if not, dedupe candidates by
  (scope, quality, language) and keep the page URL (the `fetchr-grab` handshake already
  works off the page URL + `crn-flix-request-id` query params, `services/indexer-link.ts:9-24`).
- **Hydracker: delete the module** (`modules/indexer/hydracker/`, its specs, registry
  entry, env config) — the API went paid, the plugin is abandoned. Loadix is the only
  indexer for now; the contract stays multi-indexer, and mixed granularity (an indexer
  emitting only `episode`-scoped candidates) remains supported by the planner.
- **dev-cli** (`modules/indexer/dev-cli.ts`, `npm run indexer:find`): extend to accept a
  show target with an episode list and print scoped candidates. Keep the no-DB/no-Nest
  boot property.

### 5.2 Catalogue — full intent (`services/trakt-sync.ts`)
- Delete `bufferedExpansion` and the `buffering` flag: `WATCHLISTED` and `PROGRESS` use
  `expandShow`/`expandSeason` (aired-filtered) like `HIGH_RATED`. `PROGRESS` expansion
  starts from season 1 episode 1? No — full show; watched episodes are simply already
  fulfilled or not wanted. Keep `filterAiredEpisodes`.
- Persist the playhead: `expandProgressShows` (`trakt-sync.ts:315-327`) already fetches
  `next_episode` per show — upsert it into `user_show_progress` there. Also record
  `next_season/next_episode = NULL` when a show disappears from the watching list
  (completed/dropped) so runway computation degrades gracefully.
- **Remove the inline `indexerOrchestrator.runForRequest` call** from `processNewRequest`
  (`trakt-sync.ts:220-241`). Request creation only writes intent; the planner reacts to
  the `request_created` NOTIFY (or the next planner pass).
- Config: replace `bufferDuration` with `needWindowHours` (default 5) and
  `maxWindowHours` (default 25) in `syncConfigSchema`; delete the dead `ratedLimit`,
  `wantedLimit`, `progressLimit`; wire the config through env (`app.module.ts:97`
  currently passes `sync: {}` so nothing is configurable — fix that).

### 5.3 Planner — new module (replaces `IndexerOrchestrator` + `IndexerSyncService`)
New `services/planner/` with a **pure core** and a thin orchestrator:

```
services/planner/
  runway.ts        computeRunway(episodes, availability, playheads) → per-episode hours
  labels.ts        labelEpisodes(runway, needWindowHours) → Map<mediaId, Label>
  resolve.ts       resolvePlan(wanted, available, candidates, weights) → chosen releases
  diff.ts          diffPlan(chosen, liveActions) → {create, refresh, supersede, expire}
  planner.ts       PlannerService — orchestrates per show: load state, call core, persist
```

`runway/labels/resolve/diff` are pure functions (no I/O) — unit-test and mutation-test
them heavily; this is where all the design subtlety lives.

PlannerService pass (per show with ≥1 non-rejected missing/pending request; movies are a
degenerate single-media case):
1. Load intent (requests+reasons), availability (fulfilled), playheads
   (`user_show_progress`), live actions, live Fetchr downloads.
2. Compute runway per user → min-merge → labels.
3. If `wanted` (starved+needed) is empty and no live action → nothing to do.
4. Query indexers via the new contract (respect existing rate limits; cache per show
   keyed on the intent fingerprint + a TTL, reusing the memory-cache helper).
5. `resolvePlan` → `diffPlan` → persist: create/refresh/supersede actions, cancel
   superseded in-flight downloads via Fetchr, update `media_requests.status`
   (`missing` ↔ `pending` = covered by a live action).
6. Auto-trigger: if the chosen candidate is `fetchr.canHandle(url)` and label is
   `starved` or `needed`, fire the download and mark `downloading` (keep the
   `buildDownloadMetadata` correlation, extended with `planned-download-id`).

Triggers: cron (replace `indexer-sync-job`, hourly is fine), plus event-driven passes on
`request_created`, `request_status_changed` (fulfilled), `user_left_request`, and Trakt
progress change (playhead moved → runway shrank). Debounce per show (e.g. 30s) so a
season arriving in Jellyfin causes one re-plan, not ten.

### 5.4 Discord admin surface (`services/messaging/admin/discord.ts`)
- One embed per **action**, not per episode: title
  `"{show} — S{n} pack"` / `"{show} S{n}E{m}"` / `"{title} (movie)"`, fields: label
  (with color: starved=red, needed=orange, deferred=grey), covered episodes, users,
  quality/language/size, link (via `indexerDisplayLink` — keep the fetchr-grab
  handshake, pass the action id instead of the request id).
- Embed lifecycle mirrors action status: `done` → delete message; `superseded`/`expired`
  → delete; label change → edit in place (reuse the existing edit patterns).
- Keep the reject flow but move it to actions: "Rejeter" on an action rejects the
  covered `media_requests` rows (cascade), which the next planner pass observes.
- Alternative candidates: include the top 2-3 runners-up as a compact field
  ("ou : pack série complet — 1 action") so the admin can arbitrate the α term himself.
- The pinned `📥 Téléchargements` progress message and `DownloadProgressService` are
  unchanged.
- Add a reconciler query equivalent to `findRequestsWithoutDiscordMessage`
  (`database/requests.ts:486-563`) for actions.

### 5.5 Notifications — verify only, minimal change
The current mechanism (jellyfin-sync → `upsertFulfilled` → status trigger →
claim-gated fan-out → 60s email batch) already produces "S1E1-10 available" in one email
**once intent is complete** — the drip-feed was caused by window truncation, not by the
notifier. Actions:
- verify batch behavior with a full-season arrival (one jellyfin-sync pass →
  one email per user);
- Discord user DMs are per-episode (`services/messaging/user/discord.ts`) — add the same
  batching the email queue has (extract the debounce/upsert queue into a shared helper,
  DRY with `email/queue.ts`).

### 5.6 AppService wiring (`app.service.ts`)
- Register the planner job; remove `indexer-sync-job`.
- Route the new `planned_download_*` NOTIFY events to the Discord admin surface.
- The `request_created` handler no longer creates per-episode admin embeds.
- `StartupRecoveryService`: on boot, reconcile `downloading` actions against the Fetchr
  `download::list` snapshot (action downloading but absent from Fetchr → back to
  `proposed`).

## 6. Implementation sequence (fix-forward, single release)

No feature flag, no adapter, no rollback path — the refactor ships as one release. The
order below is a **build order** for the implementing agent, not a deployment order:

1. **Contract**: bundle-aware indexer contract + Loadix scope mapping + dev-cli.
   **Delete the Hydracker module** (API went paid).
2. **Migration `00013`**: new tables + drop the deprecated `media_requests` columns.
3. **Planner**: pure core + `PlannerService` + Discord action surface. Delete
   `IndexerOrchestrator`, `IndexerSyncService`, and per-episode embed creation.
4. **Full intent**: remove `bufferedExpansion`; persist `user_show_progress` from
   trakt-sync. The next 24h full sync (`fullSyncIntervalHours`) expands every partial
   show intent automatically — no manual backfill needed.
5. **At deploy**: one-off purge of legacy per-episode embeds in the admin channel (keep
   the pinned `📥 Téléchargements` message); update `docs/`/`ROADMAP.md` if touched.

The constraint "admin action surface must exist before full-intent expansion" (otherwise
one embed per episode — SG-1 = 214) is satisfied by shipping everything at once; never
deploy step 4 without step 3.

## 7. Testing

- Pure core (`runway`, `labels`, `resolve`, `diff`): exhaustive unit tests + Stryker.
  Canonical cases to encode as tests:
  - intent 1-10, nothing available → E1 starved, window needed, rest deferred;
  - E1 downloaded, unwatched → nobody starved, E2-E4 needed;
  - candidates {E6, E8, S1-pack}, wanted {6,7,8} → plan = {S1-pack}, E6/E8 dominated;
  - in-flight E6+E8 downloads superseded when the plan switches to the pack;
  - Daredevil 3 seasons ≈ 33h → series-pack wins despite soft ceiling;
    SG-1 ≈ 160h → season packs win;
  - multi-user min-runway merge;
  - user leaves show → actions expired;
  - admin over-provisions S1-S3 → actions done, no complaint.
- Indexer specs: extend the Loadix suite for scoped candidates; delete the Hydracker specs.
- `trakt-sync.ts` currently has **zero test coverage** — add tests for full expansion +
  playhead persistence while touching it.

## 8. Investigations to run during implementation (not blockers)

1. Loadix: per-link URL vs generic media page (affects dedupe strategy, §5.1)
2. Fetchr: confirm a cancel command exists on the WS API (`download::canceled` events are
   already consumed, `services/fetchr-sync.ts:59-67`; emitting a cancel is what needs
   checking). If absent, superseded in-flight downloads are left to finish and the files
   deduped post-download — acceptable fallback.
3. Rewatch refinement (deliberately out of scope): `HIGH_RATED` intents could get softer
   thresholds (never `starved`). Design ready — a per-reason threshold offset — do not
   implement now.

## 9. Design invariants (do not violate)

1. Never persist derived state outside `planned_downloads`, and the planner alone owns
   that table's content.
2. Labels are recomputed from scratch each pass — no label transition logic anywhere.
3. Resolution is always global per show — never resolve a single episode in isolation.
4. The plan reconciles with observed reality (Jellyfin, Fetchr, admin actions); it never
   assumes its recommendations were executed.
5. Notifications compare availability to **intent**, never to the window.
