import { createHash } from 'node:crypto';

import { Logger, OnModuleDestroy } from '@nestjs/common';

import { assessCandidate, Indexer, IndexerTarget, MediaTitles } from '@/modules/indexer/contract';
import { EnginePreferences } from '@/modules/indexer/preferences';
import { MemoryCacheService } from '@/services/cache/memory-cache.service';
import { IndexerBookmarksRepository } from '@/services/database/indexer-bookmarks';
import { displayTitle, MediaType } from '@/services/database/medias';
import {
  ActionAlternative,
  PlannedDownloadEntity,
  PlannedDownloadsRepository,
  PlannedDownloadStatus,
} from '@/services/database/planned-downloads';
import { PlannerFindingsRepository } from '@/services/database/planner-findings';
import { NewRequestState, RequestStatesRepository } from '@/services/database/request-states';
import { PlannerStateRow, RequestsRepository, RequestStatus } from '@/services/database/requests';
import { FetchrSyncService } from '@/services/fetchr-sync';
import { MediaTitlesService } from '@/services/media-titles';
import { truthy } from '@/utils';

import { findAcrossIndexers } from './bookmarks';
import { diffPlan, LiveAction } from './diff';
import { labelEpisodes } from './labels';
import { isMissing, maxLabel, Playhead, PlanLabel, PlannerEpisode, urgencyOf } from './model';
import { ChosenAction, resolvePlan } from './resolve';
import { staleProposals } from './revalidate';
import { AssessedCandidate, assessSourcing } from './sourcing';

export const PLANNED_DOWNLOAD_ID_METADATA_KEY = 'crn-flix-planned-download-id';
export const REQUEST_ID_METADATA_KEY = 'crn-flix-request-id';

/**
 * Fetchr correlation metadata for an action. Packs deliberately omit the request-id
 * fast path so the post-download pipeline identifies every file via imdb + filename;
 * single-media actions keep it (extended with the planned-download id).
 */
export function buildActionDownloadMetadata(action: PlannedDownloadEntity): Record<string, string> {
  const media = action.medias?.[0];
  const metadata: Record<string, string> = {
    [PLANNED_DOWNLOAD_ID_METADATA_KEY]: action.id,
    type: action.scope.kind === 'movie' ? 'movie' : 'episode',
  };
  if (media) {
    metadata.title = displayTitle(media);
  }
  const imdbId = action.showImdbId ?? media?.imdbId;
  if (imdbId) {
    metadata.imdbid = imdbId;
  }
  if (media?.year !== null && media?.year !== undefined) {
    metadata.year = String(media.year);
  }
  if (action.scope.kind === 'season' || action.scope.kind === 'episode') {
    metadata.season = String(action.scope.season);
  }
  if (action.scope.kind === 'episode') {
    metadata.episode = String(action.scope.episode);
  }
  if (action.coveredMediaIds.length === 1) {
    metadata[REQUEST_ID_METADATA_KEY] = action.coveredMediaIds[0];
  }
  return metadata;
}

export type PlannerConfig = {
  needWindowHours: number;
  maxWindowHours: number;
};

export type PlanTarget = { kind: 'show'; imdbId: string } | { kind: 'movie'; mediaId: string };

/** Playheads are observations owned by an external source (Trakt) — read live, never stored. */
export type PlayheadsProvider = {
  getPlayheads(showImdbId: string, userIds: string[]): Promise<Playhead[]>;
};

export function targetKey(target: PlanTarget): string {
  return target.kind === 'show' ? `show:${target.imdbId}` : `movie:${target.mediaId}`;
}

/** Inverse of `targetKey`, for admin requests addressed by key. */
export function parseTargetKey(key: string): PlanTarget | null {
  const [kind, id] = key.split(':', 2);
  if (!id) {
    return null;
  }
  return kind === 'show' ? { kind: 'show', imdbId: id } : kind === 'movie' ? { kind: 'movie', mediaId: id } : null;
}

type Findings = { assessed: AssessedCandidate[]; referenced: boolean };

/** One re-plan per show when a whole season lands, not ten. */
const PASS_DEBOUNCE_MS = 30_000;
const CANDIDATES_CACHE_TTL_SECONDS = 30 * 60;

type TrackedLiveAction = LiveAction & { entity: PlannedDownloadEntity };

export class PlannerService implements OnModuleDestroy {
  private static readonly logger = new Logger(PlannerService.name);

  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly running = new Set<string>();
  private startupReconciled = false;

  constructor(
    private readonly config: PlannerConfig,
    private readonly indexers: Indexer[],
    private readonly prefs: EnginePreferences,
    private readonly requests: RequestsRepository,
    private readonly plannedDownloads: PlannedDownloadsRepository,
    private readonly playheads: PlayheadsProvider,
    private readonly fetchr: FetchrSyncService,
    private readonly cache: MemoryCacheService,
    private readonly bookmarks: IndexerBookmarksRepository,
    private readonly states: RequestStatesRepository,
    private readonly findings: PlannerFindingsRepository,
    private readonly mediaTitles: MediaTitlesService,
  ) {
    this.fetchr.on('liveChanged', () => void this.onFetchrLiveChanged());
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  // --- Scheduling ---

  schedulePass(target: PlanTarget): void {
    const key = targetKey(target);
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        void this.runPass(target).catch((err) =>
          PlannerService.logger.error(`Planner pass failed for ${key}: ${(err as Error).message}`),
        );
      }, PASS_DEBOUNCE_MS),
    );
  }

  schedulePassForMedia(media: { type: MediaType; imdbId: string; id: string }): void {
    if (media.type === MediaType.Episode && media.imdbId) {
      this.schedulePass({ kind: 'show', imdbId: media.imdbId });
    } else if (media.type === MediaType.Movie) {
      this.schedulePass({ kind: 'movie', mediaId: media.id });
    }
  }

  /** Cron entry point: replan every target with open intent or a live action. */
  async runAll(): Promise<void> {
    PlannerService.logger.log('Planner: full pass starting');

    const targets = new Map<string, PlanTarget>();
    for (const imdbId of await this.requests.listPlannerShowImdbIds()) {
      targets.set(`show:${imdbId}`, { kind: 'show', imdbId });
    }
    for (const mediaId of await this.requests.listPlannerMovieMediaIds()) {
      targets.set(`movie:${mediaId}`, { kind: 'movie', mediaId });
    }
    for (const action of await this.plannedDownloads.listLive()) {
      const target = this.actionTarget(action);
      if (target) {
        targets.set(targetKey(target), target);
      }
    }

    PlannerService.logger.log(`Planner: ${targets.size} target(s) to plan`);
    for (const target of targets.values()) {
      try {
        await this.runPass(target);
      } catch (err) {
        PlannerService.logger.error(`Planner pass failed for ${targetKey(target)}: ${(err as Error).message}`);
      }
    }

    PlannerService.logger.log('Planner: full pass completed');
  }

  private actionTarget(action: PlannedDownloadEntity): PlanTarget | null {
    if (action.showImdbId) {
      return { kind: 'show', imdbId: action.showImdbId };
    }
    const mediaId = action.coveredMediaIds[0];
    return mediaId ? { kind: 'movie', mediaId } : null;
  }

  // --- The pass ---

  async runPass(target: PlanTarget): Promise<void> {
    const key = targetKey(target);
    if (this.running.has(key)) {
      this.schedulePass(target);
      return;
    }
    this.running.add(key);
    try {
      await this.pass(target);
    } finally {
      this.running.delete(key);
    }
  }

  private async pass(target: PlanTarget): Promise<void> {
    const key = targetKey(target);
    const state =
      target.kind === 'show'
        ? await this.requests.getShowPlannerState(target.imdbId)
        : [await this.requests.getMoviePlannerState(target.mediaId)].filter(truthy);

    const liveActions = (await this.plannedDownloads.listLive()).filter((action) =>
      this.actionMatchesTarget(action, target),
    );

    if (state.length === 0) {
      for (const action of liveActions) {
        await this.plannedDownloads.updateStatus(action.id, PlannedDownloadStatus.Expired);
      }
      return;
    }

    const episodes = state.map(toPlannerEpisode);
    const episodeById = new Map(episodes.map((e) => [e.mediaId, e]));
    const playheads = target.kind === 'show' ? await this.loadPlayheads(target.imdbId, state) : [];
    const labels = labelEpisodes(episodes, playheads, this.config.needWindowHours);

    // Observed reality first: actions whose coverage is fully settled close now.
    const settledLive: PlannedDownloadEntity[] = [];
    for (const action of liveActions) {
      const covered = action.coveredMediaIds.map((id) => episodeById.get(id)).filter(truthy);
      if (covered.some(isMissing)) {
        settledLive.push(action);
        continue;
      }
      const closing = covered.some((e) => e.available) ? PlannedDownloadStatus.Done : PlannedDownloadStatus.Expired;
      await this.plannedDownloads.updateStatus(action.id, closing);
    }

    // A proposal is re-assessed on every pass: it must not outlive the rules that produced it.
    const prefs = this.prefs;
    const indexerTarget = await this.indexerTargetOf(target, state);
    const stale = indexerTarget ? staleProposals(settledLive, indexerTarget, prefs) : [];
    for (const { action, reasons } of stale) {
      PlannerService.logger.log(`Superseding action ${action.id} (${key}): no longer eligible (${reasons.join(', ')})`);
      await this.plannedDownloads.updateStatus(action.id, PlannedDownloadStatus.Superseded);
    }
    const staleIds = new Set(stale.map((s) => s.action.id));
    const remainingLive = settledLive.filter((action) => !staleIds.has(action.id));

    const missing = episodes.filter(isMissing);
    const wanted = missing.filter((e) => urgencyOf(labels.get(e.mediaId) ?? PlanLabel.Deferred) > 0);
    PlannerService.logger.log(summarizePass(key, episodes, labels, remainingLive.length));

    // Deferred never prevents indexing: every show with a gap gets located and its
    // candidates cached (bookmarks, admin links). Urgency only decides what becomes an action.
    let chosen: ChosenAction[] = [];
    let findings: Findings = { assessed: [], referenced: false };
    if (missing.length > 0 && indexerTarget) {
      findings = await this.findCandidates(indexerTarget, key, prefs);
      await this.findings
        .save(key, findings.assessed, findings.referenced)
        .catch((err: Error) => PlannerService.logger.error(`Could not save findings for ${key}: ${err.message}`));
    } else if (missing.length > 0) {
      PlannerService.logger.warn(`Cannot build indexer target for ${key} (missing imdb id?)`);
    }
    if (findings.assessed.length > 0 && wanted.length > 0) {
      chosen = resolvePlan({
        episodes,
        labels,
        candidates: findings.assessed.filter((a) => a.reasons.length === 0).map((a) => a.candidate),
        maxWindowHours: this.config.maxWindowHours,
        prefs,
      });
    }
    if (wanted.length === 0 && remainingLive.length === 0) {
      await this.snapshotStates(target, episodes, labels, findings, prefs);
      return;
    }

    const stillMissing = new Set(episodes.filter(isMissing).map((e) => e.mediaId));
    const live: TrackedLiveAction[] = remainingLive.map((entity) => ({
      id: entity.id,
      scope: entity.scope,
      status: entity.status as 'proposed' | 'downloading',
      coveredMediaIds: entity.coveredMediaIds,
      entity,
    }));

    const diff = diffPlan(chosen, live, stillMissing);

    for (const action of diff.supersede) {
      PlannerService.logger.log(`Superseding action ${action.id} (${key})`);
      await this.plannedDownloads.updateStatus(action.id, PlannedDownloadStatus.Superseded);
      if (action.status === 'downloading') {
        this.cancelInFlight(action.id);
      }
    }

    for (const { live: liveAction, chosen: chosenAction } of diff.refresh) {
      await this.plannedDownloads.refreshCandidate(
        liveAction.id,
        chosenAction.candidate,
        chosenAction.label,
        toAlternatives(chosenAction.alternatives),
        chosenAction.coveredMediaIds,
      );
    }

    for (const action of diff.keep) {
      const label = action.coveredMediaIds
        .filter((id) => stillMissing.has(id))
        .map((id) => labels.get(id) ?? PlanLabel.Deferred)
        .reduce(maxLabel, PlanLabel.Deferred);
      if (label !== action.entity.label) {
        await this.plannedDownloads.updateLabel(action.id, label);
      }
    }

    for (const action of diff.create) {
      const actionId = await this.plannedDownloads.create({
        showImdbId: target.kind === 'show' ? target.imdbId : null,
        candidate: action.candidate,
        label: action.label,
        alternatives: toAlternatives(action.alternatives),
        coveredMediaIds: action.coveredMediaIds,
      });
      PlannerService.logger.log(`Created action ${actionId} (${key}, ${action.candidate.scope.kind}, ${action.label})`);
    }

    await this.reconcileRequestStatuses(target, state);
    await this.snapshotStates(target, episodes, labels, findings, prefs);
    await this.autoTrigger(target);
  }

  /** Rewrites the read model of the target: one row per missing episode, none otherwise. */
  private async snapshotStates(
    target: PlanTarget,
    episodes: PlannerEpisode[],
    labels: Map<string, PlanLabel>,
    findings: Findings,
    prefs: EnginePreferences,
  ): Promise<void> {
    const live = (await this.plannedDownloads.listLive()).filter((action) => this.actionMatchesTarget(action, target));
    const actionByMediaId = new Map(live.flatMap((action) => action.coveredMediaIds.map((id) => [id, action.id])));

    const states: NewRequestState[] = episodes.filter(isMissing).map((episode) => {
      const { sourcing, best, bestRejected } = assessSourcing(episode, findings.assessed, findings.referenced, prefs);
      return {
        mediaId: episode.mediaId,
        urgency: labels.get(episode.mediaId) ?? PlanLabel.Deferred,
        sourcing,
        bestCandidate: best,
        bestRejected,
        actionId: actionByMediaId.get(episode.mediaId) ?? null,
      };
    });

    try {
      await this.states.replaceForTarget(
        episodes.map((e) => e.mediaId),
        states,
      );
    } catch (err) {
      PlannerService.logger.error(`Could not snapshot states for ${targetKey(target)}: ${(err as Error).message}`);
    }
  }

  /** `pending` means "covered by at least one live action"; flip both ways to match. */
  private async reconcileRequestStatuses(target: PlanTarget, state: PlannerStateRow[]): Promise<void> {
    const liveActions = (await this.plannedDownloads.listLive()).filter((action) =>
      this.actionMatchesTarget(action, target),
    );
    const covered = new Set(liveActions.flatMap((action) => action.coveredMediaIds));

    const toPending = state.filter(
      (row) => row.status === RequestStatus.Missing && row.userIds.length > 0 && covered.has(row.mediaId),
    );
    const toMissing = state.filter(
      (row) => row.status === RequestStatus.Pending && row.userIds.length > 0 && !covered.has(row.mediaId),
    );

    await this.requests.updateStatusesBulk(
      toPending.map((row) => row.mediaId),
      RequestStatus.Pending,
    );
    await this.requests.updateStatusesBulk(
      toMissing.map((row) => row.mediaId),
      RequestStatus.Missing,
    );
  }

  private async autoTrigger(target: PlanTarget): Promise<void> {
    const liveActions = (await this.plannedDownloads.listLive()).filter((action) =>
      this.actionMatchesTarget(action, target),
    );

    for (const action of liveActions) {
      if (action.status !== PlannedDownloadStatus.Proposed || action.label === PlanLabel.Deferred) {
        continue;
      }
      if (!(await this.fetchr.canHandle(action.url))) {
        continue;
      }
      PlannerService.logger.log(`Auto-triggering download for action ${action.id} (${action.url})`);
      this.fetchr.download(action.url, buildActionDownloadMetadata(action));
      await this.plannedDownloads.updateStatus(action.id, PlannedDownloadStatus.Downloading);
    }
  }

  // --- Inputs ---

  /** Indexers get every title the engine knows; the French one is resolved on first need. */
  private async indexerTargetOf(target: PlanTarget, state: PlannerStateRow[]): Promise<IndexerTarget | null> {
    const first = state[0];
    if (!first?.imdbId) {
      return null;
    }
    const titles = await this.mediaTitles.ensure(first.imdbId, first);
    return buildIndexerTarget(target, state, titles);
  }

  private async loadPlayheads(imdbId: string, state: PlannerStateRow[]): Promise<Playhead[]> {
    const intentUserIds = new Set(state.flatMap((row) => row.userIds));
    return this.playheads.getPlayheads(imdbId, [...intentUserIds]);
  }

  private async findCandidates(indexerTarget: IndexerTarget, key: string, prefs: EnginePreferences): Promise<Findings> {
    const fingerprint = createHash('sha1')
      .update(
        indexerTarget.kind === 'show'
          ? indexerTarget.episodes.map((e) => `${e.season}:${e.episode}`).join(',')
          : 'movie',
      )
      .digest('hex')
      .slice(0, 12);

    // Cached unassessed: the same findings serve any preference relaxation the admin applies.
    const findings = await this.cache.withCache(
      `planner:candidates:${key}:${fingerprint}`,
      () => findAcrossIndexers(this.indexers, indexerTarget, prefs, this.bookmarks, PlannerService.logger),
      CANDIDATES_CACHE_TTL_SECONDS,
    );
    return {
      assessed: findings.candidates.map((candidate) => ({
        candidate,
        reasons: assessCandidate(candidate, indexerTarget, prefs),
      })),
      referenced: findings.referenced,
    };
  }

  private actionMatchesTarget(action: PlannedDownloadEntity, target: PlanTarget): boolean {
    if (target.kind === 'show') {
      return action.showImdbId === target.imdbId;
    }
    return action.showImdbId === null && action.coveredMediaIds.includes(target.mediaId);
  }

  // --- Fetchr reconciliation ---

  /** Live downloads correlated to an action, by either the auto-trigger or the grab handshake key. */
  private liveDownloadActionIds(): Set<string> {
    const ids = new Set<string>();
    for (const download of this.fetchr.liveDownloads()) {
      const actionId =
        download.metadata?.[PLANNED_DOWNLOAD_ID_METADATA_KEY] ?? download.metadata?.[REQUEST_ID_METADATA_KEY];
      if (actionId) {
        ids.add(actionId);
      }
    }
    return ids;
  }

  private cancelInFlight(actionId: string): void {
    for (const download of this.fetchr.liveDownloads()) {
      const downloadActionId =
        download.metadata?.[PLANNED_DOWNLOAD_ID_METADATA_KEY] ?? download.metadata?.[REQUEST_ID_METADATA_KEY];
      if (downloadActionId === actionId) {
        PlannerService.logger.log(`Cancelling superseded Fetchr download ${download.id} (action ${actionId})`);
        this.fetchr.cancel(download.id);
      }
    }
  }

  private async onFetchrLiveChanged(): Promise<void> {
    try {
      const actionIds = this.liveDownloadActionIds();
      const live = await this.plannedDownloads.listLive();

      // A grabbed link landed in Fetchr: the admin acted on the proposal.
      for (const action of live) {
        if (action.status === PlannedDownloadStatus.Proposed && actionIds.has(action.id)) {
          PlannerService.logger.log(`Action ${action.id} observed downloading in Fetchr`);
          await this.plannedDownloads.updateStatus(action.id, PlannedDownloadStatus.Downloading);
        }
      }

      // Boot reconciliation: `downloading` claims that the first snapshot does not confirm.
      if (!this.startupReconciled) {
        this.startupReconciled = true;
        for (const action of live) {
          if (action.status === PlannedDownloadStatus.Downloading && !actionIds.has(action.id)) {
            PlannerService.logger.warn(`Action ${action.id} downloading but absent from Fetchr, back to proposed`);
            await this.plannedDownloads.updateStatus(action.id, PlannedDownloadStatus.Proposed);
          }
        }
      }
    } catch (err) {
      PlannerService.logger.error(`Fetchr reconciliation failed: ${(err as Error).message}`);
    }
  }
}

function toPlannerEpisode(row: PlannerStateRow): PlannerEpisode {
  return {
    mediaId: row.mediaId,
    season: row.seasonNumber ?? 0,
    episode: row.episodeNumber ?? 0,
    runtimeMinutes: row.runtimeMinutes,
    available: row.status === RequestStatus.Fulfilled,
    // A request nobody carries (e.g. manual admin download) is not intent to plan for.
    requested: (row.status === RequestStatus.Missing || row.status === RequestStatus.Pending) && row.userIds.length > 0,
  };
}

function buildIndexerTarget(target: PlanTarget, state: PlannerStateRow[], titles: MediaTitles): IndexerTarget {
  const first = state[0];

  if (target.kind === 'movie') {
    return {
      kind: 'movie',
      media: {
        ...titles,
        imdbId: first.imdbId,
        type: MediaType.Movie,
        seasonNumber: null,
        episodeNumber: null,
        runtimeMinutes: first.runtimeMinutes,
      },
    };
  }

  return {
    ...titles,
    kind: 'show',
    imdbId: first.imdbId,
    episodes: state
      .filter((row) => row.seasonNumber !== null && row.episodeNumber !== null)
      .map((row) => ({
        season: row.seasonNumber!,
        episode: row.episodeNumber!,
        runtimeMinutes: row.runtimeMinutes,
      })),
  };
}

/** One line per pass so a show that is never searched (all deferred) is visible in the logs. */
function summarizePass(
  key: string,
  episodes: PlannerEpisode[],
  labels: Map<string, PlanLabel>,
  liveActions: number,
): string {
  const missing = episodes.filter(isMissing);
  const count = (label: PlanLabel): number =>
    missing.filter((e) => (labels.get(e.mediaId) ?? PlanLabel.Deferred) === label).length;
  const urgent = count(PlanLabel.Starved) + count(PlanLabel.Needed);
  const verdict = urgent > 0 ? 'planning' : missing.length > 0 ? 'indexing only (nothing urgent)' : 'nothing to plan';
  return (
    `Planner ${key}: ${episodes.length} episode(s), ${missing.length} missing ` +
    `(${count(PlanLabel.Starved)} starved, ${count(PlanLabel.Needed)} needed, ${count(PlanLabel.Deferred)} deferred), ` +
    `${liveActions} live action(s) → ${verdict}`
  );
}

function toAlternatives(candidates: ChosenAction['alternatives']): ActionAlternative[] {
  return candidates.map((candidate) => ({
    indexerName: candidate.indexerName,
    url: candidate.url,
    scope: candidate.scope,
    quality: candidate.quality,
    language: candidate.language,
    sizeBytes: candidate.sizeBytes,
  }));
}
