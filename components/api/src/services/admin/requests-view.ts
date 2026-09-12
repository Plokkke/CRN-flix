import { IndexerCandidate, RejectReason } from '@/modules/indexer/contract';
import { EnginePreferences } from '@/modules/indexer/preferences';
import {
  actionTrack,
  candidateTrack,
  downloadActionId,
  downloadCandidateId,
  downloadImdbId,
  executionOf,
  ExecutionView,
  isFailedDownload,
  jobActionId,
  jobCandidateId,
  jobImdbId,
} from '@/services/admin/execution';
import { DownloadJobEntity } from '@/services/database/download-jobs';
import { IndexerBookmarkEntity } from '@/services/database/indexer-bookmarks';
import { PlannedDownloadEntity } from '@/services/database/planned-downloads';
import { PlannerFindingEntity } from '@/services/database/planner-findings';
import { RequestStateEntity } from '@/services/database/request-states';
import { RequestEntity, RequestStatus } from '@/services/database/requests';
import { LiveDownload } from '@/services/download-live-state';
import { candidateDisplayLink, candidateId } from '@/services/indexer-link';
import { IndexerLinkView } from '@/services/messaging/user/email/templates/request-widgets';
import { PlanLabel, PlannerEpisode, urgencyOf } from '@/services/planner/model';
import { resolvePlan } from '@/services/planner/resolve';
import { AssessedCandidate, Sourcing } from '@/services/planner/sourcing';
import { episodeRangesBySeason, formatSeasonRanges, groupRequests, RequestGroup } from '@/services/request-groups';
import { isDeadLetter, TicketCategory, TicketEntity, TicketPayloadMap, TicketView } from '@/services/tickets/model';
import { buildTicketView } from '@/services/tickets/presenter';

export { downloadActionId } from '@/services/admin/execution';

/** Tabs named after what the admin is expected to do. */
export type DashboardTab = 'download' | 'force' | 'unavailable' | 'system' | 'closed';

export const TABS: { key: DashboardTab; label: string }[] = [
  { key: 'download', label: 'À télécharger' },
  { key: 'force', label: 'À forcer' },
  { key: 'unavailable', label: 'Sans solution' },
  { key: 'system', label: 'Système' },
  { key: 'closed', label: 'Clos' },
];

export type SourcingKey = Sourcing | 'unknown';

export const SOURCING_LABELS: Record<SourcingKey, string> = {
  [Sourcing.Available]: 'Disponible',
  [Sourcing.NonCompliant]: 'Non conforme',
  [Sourcing.Unavailable]: 'Indisponible',
  [Sourcing.NotIndexed]: 'Non indexé',
  [Sourcing.NotReferenced]: 'Non référencé',
  unknown: 'Non analysé',
};

export const REASON_LABELS: Record<RejectReason, string> = {
  [RejectReason.QualityNotAllowed]: 'qualité',
  [RejectReason.LanguageNotAllowed]: 'langue',
  [RejectReason.HostNotAllowed]: 'hébergeur',
  [RejectReason.SizeExceeded]: 'taille',
};

export const URGENCY_LABELS: Record<PlanLabel, string> = {
  [PlanLabel.Starved]: 'starved',
  [PlanLabel.Needed]: 'needed',
  [PlanLabel.Deferred]: 'deferred',
};

const TAB_BY_SOURCING: Record<SourcingKey, DashboardTab> = {
  [Sourcing.Available]: 'download',
  [Sourcing.NonCompliant]: 'force',
  [Sourcing.Unavailable]: 'unavailable',
  [Sourcing.NotIndexed]: 'unavailable',
  [Sourcing.NotReferenced]: 'unavailable',
  unknown: 'unavailable',
};

export type EpisodeView = {
  mediaId: string;
  media: NonNullable<RequestEntity['media']>;
  requestStatus: RequestStatus;
  missing: boolean;
  state: RequestStateEntity | null;
  sourcing: SourcingKey | null;
};

export type ActionView = {
  action: PlannedDownloadEntity;
  ticket: TicketEntity | null;
  ticketView: TicketView | null;
  download: LiveDownload | null;
  job: DownloadJobEntity | null;
  execution: ExecutionView;
  track: string;
};

/** A release the admin can launch: what it covers, what it would actually fill. */
export type ReleaseView = {
  candidate: IndexerCandidate;
  candidateId: string;
  track: string;
  link: string;
  reasons: RejectReason[];
  /** Episodes of the show the release spans, e.g. "S01 E1-E8"; "Film" for a movie. */
  covers: string;
  /** Missing episodes it would fill, e.g. "S01 E3, E7-E8". */
  fills: string;
  fillCount: number;
  execution: ExecutionView | null;
};

/**
 * One line of the fold: a release (eligible, or the closest rejected one) with what it
 * would fill, or a range nothing known covers. Sorted by urgency, then by episode.
 */
export type ReleaseLine = {
  release: ReleaseView | null;
  /** Episodes the line is about: what the release fills, or the uncovered range. */
  ranges: string;
  count: number;
  /** Verdict of those episodes; null when an eligible release covers them. */
  sourcing: SourcingKey | null;
  urgency: PlanLabel | null;
  /** Sort key: first episode (season * 1000 + episode). */
  order: number;
};

/** A download the admin started by hand (no action): tracked through its candidate id or imdb id. */
export type LaunchView = { track: string; label: string; execution: ExecutionView };

export type RequestRowView = {
  key: string;
  group: RequestGroup;
  urgency: PlanLabel | null;
  tabs: DashboardTab[];
  sourcingCounts: Partial<Record<SourcingKey, number>>;
  episodes: EpisodeView[];
  actions: ActionView[];
  lines: ReleaseLine[];
  launches: LaunchView[];
  indexerLinks: IndexerLinkView[];
  plannedAt: Date | null;
  findingsAt: Date | null;
};

export type SystemTicketView = { ticket: TicketEntity; view: TicketView };

export type Dashboard = {
  rows: RequestRowView[];
  counts: Record<DashboardTab, number>;
  systemTickets: SystemTicketView[];
  alerts: { deadLetters: number; failedDownloads: number };
  lastPassAt: Date | null;
};

export type DashboardInput = {
  requests: RequestEntity[];
  states: RequestStateEntity[];
  bookmarks: IndexerBookmarkEntity[];
  actions: PlannedDownloadEntity[];
  tickets: TicketEntity[];
  downloads: LiveDownload[];
  jobs: DownloadJobEntity[];
  findings: PlannerFindingEntity[];
  prefs: EnginePreferences;
  lastPassAt: Date | null;
};

/** Subscribers see one answer only: the engine found a source, or it did not. */
export type SubscriberSourcing = 'found' | 'not-found';

export const subscriberSourcing = (key: SourcingKey): SubscriberSourcing =>
  key === Sourcing.Available ? 'found' : 'not-found';

const isOpenRequest = (status: RequestStatus): boolean =>
  status === RequestStatus.Missing || status === RequestStatus.Pending;

export const rowKey = (group: RequestGroup): string =>
  group.kind === 'show' ? `show:${group.imdbId}` : `movie:${group.key}`;

type Context = {
  stateById: Map<string, RequestStateEntity>;
  bookmarksByImdbId: Map<string, IndexerBookmarkEntity[]>;
  findingsByKey: Map<string, PlannerFindingEntity>;
  actions: PlannedDownloadEntity[];
  ticketByActionId: Map<string, TicketEntity>;
  downloads: LiveDownload[];
  jobs: DownloadJobEntity[];
  prefs: EnginePreferences;
};

// --- Episodes ---

function episodeView(request: RequestEntity, stateById: Map<string, RequestStateEntity>): EpisodeView {
  const missing = isOpenRequest(request.status);
  const state = stateById.get(request.mediaId) ?? null;
  return {
    mediaId: request.mediaId,
    media: request.media!,
    requestStatus: request.status,
    missing,
    state,
    sourcing: missing ? (state?.sourcing ?? 'unknown') : null,
  };
}

const countBy = <K extends string>(keys: K[]): Partial<Record<K, number>> =>
  keys.reduce<Partial<Record<K, number>>>((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {});

function maxUrgency(episodes: EpisodeView[]): PlanLabel | null {
  return episodes.reduce<PlanLabel | null>((max, e) => {
    const label = e.state?.urgency ?? null;
    return label && (!max || urgencyOf(label) > urgencyOf(max)) ? label : max;
  }, null);
}

function tabsOf(episodes: EpisodeView[], actions: ActionView[]): DashboardTab[] {
  const tabs = new Set<DashboardTab>(episodes.flatMap((e) => (e.sourcing ? [TAB_BY_SOURCING[e.sourcing]] : [])));
  if (actions.length > 0) {
    tabs.add('download');
  }
  return tabs.size > 0 ? [...tabs] : ['closed'];
}

// --- Actions ---

function actionsOf(group: RequestGroup, context: Context): ActionView[] {
  const mediaIds = new Set(group.requests.map((r) => r.mediaId));
  return context.actions
    .filter((action) =>
      group.kind === 'show'
        ? action.showImdbId === group.imdbId
        : action.coveredMediaIds.some((id) => mediaIds.has(id)),
    )
    .map((action) => {
      const ticket = context.ticketByActionId.get(action.id) ?? null;
      const download = context.downloads.find((d) => downloadActionId(d) === action.id) ?? null;
      const job = context.jobs.find((j) => jobActionId(j) === action.id) ?? null;
      return {
        action,
        ticket,
        ticketView: ticket ? buildTicketView(ticket, { action }) : null,
        download,
        job,
        execution: executionOf(action.status, download, job),
        track: actionTrack(action.id),
      };
    });
}

// --- Plan: the best releases covering every missing episode, deferred included ---

const toPlannerEpisode = (e: EpisodeView): PlannerEpisode => ({
  mediaId: e.mediaId,
  season: e.media.seasonNumber ?? 0,
  episode: e.media.episodeNumber ?? 0,
  runtimeMinutes: e.media.runtimeMinutes,
  available: e.requestStatus === RequestStatus.Fulfilled,
  requested: e.missing,
});

const rangesOf = (group: RequestGroup, episodes: EpisodeView[]): string =>
  group.kind === 'movie' ? 'Film' : formatSeasonRanges(episodeRangesBySeason(episodes.map((e) => e.media)));

const coversEpisode = (candidate: IndexerCandidate, e: EpisodeView): boolean => {
  const { scope } = candidate;
  return (
    scope.kind === 'movie' ||
    scope.kind === 'series' ||
    (scope.kind === 'season' && scope.season === e.media.seasonNumber) ||
    (scope.kind === 'episode' && scope.season === e.media.seasonNumber && scope.episode === e.media.episodeNumber)
  );
};

function releaseView(
  group: RequestGroup,
  episodes: EpisodeView[],
  assessed: AssessedCandidate,
  context: Context,
  fillIds?: Set<string>,
): ReleaseView {
  const id = candidateId(assessed.candidate);
  const covered = episodes.filter((e) => coversEpisode(assessed.candidate, e));
  const fills = covered.filter((e) => (fillIds ? fillIds.has(e.mediaId) : e.missing));
  return {
    candidate: assessed.candidate,
    candidateId: id,
    track: candidateTrack(id),
    link: candidateDisplayLink(assessed.candidate, group.imdbId),
    reasons: assessed.reasons,
    covers: rangesOf(group, covered),
    fills: rangesOf(group, fills),
    fillCount: fills.length,
    execution: launchExecution(id, context),
  };
}

function launchExecution(id: string, context: Context): ExecutionView | null {
  const download = context.downloads.find((d) => downloadCandidateId(d) === id) ?? null;
  const job = context.jobs.find((j) => jobCandidateId(j) === id) ?? null;
  return download || job ? executionOf(null, download, job) : null;
}

const orderOf = (episodes: EpisodeView[]): number =>
  Math.min(...episodes.map((e) => (e.media.seasonNumber ?? 0) * 1000 + (e.media.episodeNumber ?? 0)), Infinity);

const compareLines = (a: ReleaseLine, b: ReleaseLine): number =>
  (b.urgency ? urgencyOf(b.urgency) : -1) - (a.urgency ? urgencyOf(a.urgency) : -1) || a.order - b.order;

/** Eligible releases chosen by the planner over every missing episode, deferred included. */
function planLines(group: RequestGroup, episodes: EpisodeView[], context: Context): ReleaseLine[] {
  const findings = context.findingsByKey.get(rowKey(group));
  const missing = episodes.filter((e) => e.missing);
  if (!findings || missing.length === 0) {
    return [];
  }
  const chosen = resolvePlan({
    episodes: episodes.map(toPlannerEpisode),
    labels: new Map(missing.map((e) => [e.mediaId, PlanLabel.Needed])),
    candidates: findings.candidates.filter((a) => a.reasons.length === 0).map((a) => a.candidate),
    maxWindowHours: Number.POSITIVE_INFINITY,
    prefs: context.prefs,
  });
  return chosen.map((action) => {
    const fillIds = new Set(action.coveredMediaIds);
    const filled = episodes.filter((e) => fillIds.has(e.mediaId));
    const release = releaseView(group, episodes, { candidate: action.candidate, reasons: [] }, context, fillIds);
    return {
      release,
      ranges: release.fills,
      count: release.fillCount,
      sourcing: null,
      urgency: maxUrgency(filled),
      order: orderOf(filled),
    };
  });
}

/** What no eligible release covers: one line per closest rejected release, then bare ranges. */
function uncoveredLines(
  group: RequestGroup,
  episodes: EpisodeView[],
  plan: ReleaseLine[],
  context: Context,
): ReleaseLine[] {
  const coveredIds = new Set(
    plan.flatMap((line) =>
      episodes.filter((e) => e.missing && coversEpisode(line.release!.candidate, e)).map((e) => e.mediaId),
    ),
  );
  let left = episodes.filter((e) => e.missing && !coveredIds.has(e.mediaId));
  const lines: ReleaseLine[] = [];

  const rejected = new Map<string, AssessedCandidate>();
  for (const e of left) {
    const best = e.state?.bestRejected;
    if (best) {
      rejected.set(candidateId(best.candidate), best);
    }
  }
  for (const best of rejected.values()) {
    const filled = left.filter((e) => coversEpisode(best.candidate, e));
    if (filled.length === 0) {
      continue;
    }
    const release = releaseView(group, episodes, best, context, new Set(filled.map((e) => e.mediaId)));
    lines.push({
      release,
      ranges: release.fills,
      count: release.fillCount,
      sourcing: filled[0].sourcing,
      urgency: maxUrgency(filled),
      order: orderOf(filled),
    });
    const filledIds = new Set(filled.map((e) => e.mediaId));
    left = left.filter((e) => !filledIds.has(e.mediaId));
  }

  const bySourcing = new Map<SourcingKey, EpisodeView[]>();
  for (const e of left) {
    const key = e.sourcing ?? 'unknown';
    bySourcing.set(key, [...(bySourcing.get(key) ?? []), e]);
  }
  for (const [sourcing, eps] of bySourcing) {
    lines.push({
      release: null,
      ranges: rangesOf(group, eps),
      count: eps.length,
      sourcing,
      urgency: maxUrgency(eps),
      order: orderOf(eps),
    });
  }
  return lines;
}

function linesOf(group: RequestGroup, episodes: EpisodeView[], context: Context): ReleaseLine[] {
  const plan = planLines(group, episodes, context);
  return [...plan, ...uncoveredLines(group, episodes, plan, context)].sort(compareLines);
}

/** Hand launches tied to the row: a known release id, or the imdb id when the release is unknown. */
function launchesOf(group: RequestGroup, known: ReleaseView[], context: Context): LaunchView[] {
  const knownIds = new Set(known.map((r) => r.candidateId));
  const launches: LaunchView[] = [];
  const seen = new Set<string>();
  const consider = (
    releaseId: string | null,
    imdbId: string | null,
    actionId: string | null,
    exec: () => ExecutionView,
  ): void => {
    if (actionId) {
      return;
    }
    const mine = (releaseId && knownIds.has(releaseId)) || (!releaseId && imdbId === group.imdbId);
    const track = releaseId ? candidateTrack(releaseId) : `imdb:${group.imdbId}`;
    if (mine && !seen.has(track)) {
      seen.add(track);
      launches.push({ track, label: releaseId ? 'release lancée' : 'lancé par imdb', execution: exec() });
    }
  };
  for (const d of context.downloads) {
    consider(downloadCandidateId(d), downloadImdbId(d), downloadActionId(d), () => executionOf(null, d, null));
  }
  for (const j of context.jobs) {
    consider(jobCandidateId(j), jobImdbId(j), jobActionId(j), () => executionOf(null, null, j));
  }
  return launches;
}

// --- Rows ---

/** Urgent first, then the situations known for longest, then the most requested. */
function compareRows(a: RequestRowView, b: RequestRowView): number {
  const urgency = (row: RequestRowView): number => (row.urgency ? urgencyOf(row.urgency) : -1);
  const planned = (row: RequestRowView): number => row.plannedAt?.getTime() ?? Infinity;
  return (
    urgency(b) - urgency(a) ||
    planned(a) - planned(b) ||
    b.group.users.length - a.group.users.length ||
    a.group.title.localeCompare(b.group.title, 'fr', { sensitivity: 'base' })
  );
}

function buildRow(group: RequestGroup, context: Context): RequestRowView {
  const episodes = group.requests.map((r) => episodeView(r, context.stateById));
  const actions = actionsOf(group, context);
  const lines = linesOf(group, episodes, context);
  const known = lines.flatMap((line) => (line.release ? [line.release] : []));
  const plannedDates = episodes.map((e) => e.state?.plannedAt.getTime()).filter((t): t is number => t !== undefined);
  return {
    key: rowKey(group),
    group,
    urgency: maxUrgency(episodes),
    tabs: tabsOf(episodes, actions),
    sourcingCounts: countBy(episodes.flatMap((e) => (e.sourcing ? [e.sourcing] : []))),
    episodes,
    actions,
    lines,
    launches: launchesOf(group, known, context),
    indexerLinks: (context.bookmarksByImdbId.get(group.imdbId) ?? []).map((b) => ({
      indexerName: b.indexerName,
      pageUrl: b.pageUrl,
      searchUrl: b.searchUrl,
    })),
    plannedAt: plannedDates.length > 0 ? new Date(Math.min(...plannedDates)) : null,
    findingsAt: context.findingsByKey.get(rowKey(group))?.foundAt ?? null,
  };
}

const groupByKey = <T>(items: T[], keyOf: (item: T) => string | null): Map<string, T[]> =>
  items.reduce((map, item) => {
    const key = keyOf(item);
    if (key !== null) {
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, new Map<string, T[]>());

function buildContext(input: DashboardInput): Context {
  const downloadActions = input.tickets.filter(
    (t): t is TicketEntity<TicketCategory.DownloadAction> => t.category === TicketCategory.DownloadAction,
  );
  return {
    stateById: new Map(input.states.map((s) => [s.mediaId, s])),
    bookmarksByImdbId: groupByKey(input.bookmarks, (b) => b.imdbId),
    findingsByKey: new Map(input.findings.map((f) => [f.targetKey, f])),
    actions: input.actions,
    ticketByActionId: new Map(
      downloadActions.map((t) => [(t.payload as TicketPayloadMap[TicketCategory.DownloadAction]).actionId, t]),
    ),
    downloads: input.downloads,
    jobs: input.jobs,
    prefs: input.prefs,
  };
}

/** Everything the requests dashboard shows, from raw repository rows. Pure. */
export function buildDashboard(input: DashboardInput): Dashboard {
  const context = buildContext(input);
  const rows = groupRequests(input.requests)
    .map((group) => buildRow(group, context))
    .sort(compareRows);

  const liveActionIds = new Set(input.actions.map((a) => a.id));
  const systemTickets = input.tickets
    .filter((ticket) => {
      if (ticket.category !== TicketCategory.DownloadAction) {
        return true;
      }
      const { actionId } = ticket.payload as TicketPayloadMap[TicketCategory.DownloadAction];
      return !liveActionIds.has(actionId);
    })
    .map((ticket) => ({ ticket, view: buildTicketView(ticket, {}) }));

  const counts = Object.fromEntries(
    TABS.map(({ key }) => [
      key,
      key === 'system' ? systemTickets.length : rows.filter((r) => r.tabs.includes(key)).length,
    ]),
  ) as Record<DashboardTab, number>;

  return {
    rows,
    counts,
    systemTickets,
    alerts: {
      deadLetters: input.tickets.filter(isDeadLetter).length,
      failedDownloads: input.downloads.filter(isFailedDownload).length,
    },
    lastPassAt: input.lastPassAt,
  };
}
