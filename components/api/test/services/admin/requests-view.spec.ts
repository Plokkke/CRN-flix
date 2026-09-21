import { IndexerCandidate, RejectReason } from '@/modules/indexer/contract';
import { Host, Language, Quality } from '@/modules/indexer/preferences';
import { buildDashboard, DashboardInput } from '@/services/admin/requests-view';
import { DownloadJobStatus } from '@/services/database/download-jobs';
import { MediaType } from '@/services/database/medias';
import { PlannedDownloadEntity, PlannedDownloadStatus } from '@/services/database/planned-downloads';
import { RequestStateEntity } from '@/services/database/request-states';
import { RequestEntity, RequestStatus } from '@/services/database/requests';
import { LiveDownload } from '@/services/download-live-state';
import { CANDIDATE_ID_PARAM, candidateId } from '@/services/indexer-link';
import { PlanLabel } from '@/services/planner/model';
import { PLANNED_DOWNLOAD_ID_METADATA_KEY } from '@/services/planner/planner';
import { Sourcing } from '@/services/planner/sourcing';
import { TicketCategory, TicketEntity, TicketStatus } from '@/services/tickets/model';

const now = new Date('2026-09-07T10:00:00Z');
let seq = 0;

function request(
  imdbId: string,
  title: string,
  status: RequestStatus,
  season?: number,
  episode?: number,
): RequestEntity {
  seq += 1;
  const id = `m${seq}`;
  return {
    mediaId: id,
    status,
    createdAt: now,
    updatedAt: now,
    media: {
      id,
      imdbId,
      type: season === undefined ? MediaType.Movie : MediaType.Episode,
      title,
      originalTitle: null,
      frenchTitle: null,
      originalLanguage: null,
      year: 2020,
      seasonNumber: season ?? null,
      episodeNumber: episode ?? null,
      runtimeMinutes: null,
      traktSlug: null,
      createdAt: now,
      updatedAt: now,
    },
    userRequests: [],
  };
}

function state(mediaId: string, urgency: PlanLabel, sourcing: Sourcing, plannedAt = now): RequestStateEntity {
  return { mediaId, urgency, sourcing, bestCandidate: null, bestRejected: null, actionId: null, plannedAt };
}

function action(id: string, showImdbId: string | null, coveredMediaIds: string[]): PlannedDownloadEntity {
  return {
    id,
    showImdbId,
    scope: { kind: 'season', season: 1 },
    indexerName: 'loadix',
    url: 'https://loadix.test/media/1',
    quality: Quality.HD_1080P,
    language: Language.MULTI,
    host: Host.ONE_FICHIER,
    sizeBytes: null,
    label: PlanLabel.Needed,
    status: PlannedDownloadStatus.Proposed,
    alternatives: [],
    createdAt: now,
    updatedAt: now,
    coveredMediaIds,
    coveredStatuses: [],
  };
}

function ticket(category: TicketCategory, payload: Record<string, unknown>, attempts = 0): TicketEntity {
  seq += 1;
  return {
    id: `t${seq}`,
    category,
    subjectType: null,
    subjectId: null,
    status: TicketStatus.Open,
    title: `ticket ${seq}`,
    summary: null,
    payload: payload as never,
    attempts,
    resolution: null,
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
  };
}

function download(actionId: string, error: string | null = null): LiveDownload {
  return {
    id: `d-${actionId}`,
    status: error ? 'failed' : 'downloading',
    fileName: 'file.mkv',
    filePaths: [],
    size: 100,
    downloaded: 50,
    progress: 50,
    speed: 1,
    eta: 10,
    error,
    source: 'x',
    metadata: { [PLANNED_DOWNLOAD_ID_METADATA_KEY]: actionId },
    downloadedAt: null,
    completedAt: null,
  };
}

const empty: DashboardInput = {
  requests: [],
  states: [],
  bookmarks: [],
  actions: [],
  tickets: [],
  downloads: [],
  jobs: [],
  findings: [],
  prefs: {
    allowedQualities: [],
    allowedLanguages: [],
    allowedHosts: [],
    sizePolicy: { bytesPerMinute: {}, tolerance: 1 },
  },
  lastPassAt: now,
};

function candidate(scope: IndexerCandidate['scope'], overrides: Partial<IndexerCandidate> = {}): IndexerCandidate {
  return {
    indexerName: 'loadix',
    url: 'https://loadix.test/media/1',
    scope,
    quality: Quality.HD_1080P,
    language: Language.MULTI,
    host: Host.ONE_FICHIER,
    sizeBytes: null,
    ...overrides,
  };
}

describe('buildDashboard', () => {
  it('files a show in every tab where it has an episode, at episode granularity', () => {
    const e1 = request('tt1', 'Show', RequestStatus.Missing, 1, 1);
    const e2 = request('tt1', 'Show', RequestStatus.Missing, 1, 2);
    const e3 = request('tt1', 'Show', RequestStatus.Fulfilled, 1, 3);

    const { rows, counts } = buildDashboard({
      ...empty,
      requests: [e1, e2, e3],
      states: [
        state(e1.mediaId, PlanLabel.Needed, Sourcing.Available),
        state(e2.mediaId, PlanLabel.Deferred, Sourcing.NonCompliant),
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].tabs.sort()).toEqual(['download', 'force']);
    expect(rows[0].sourcingCounts).toEqual({ available: 1, 'non-compliant': 1 });
    expect(rows[0].urgency).toBe(PlanLabel.Needed);
    expect(rows[0].episodes.map((e) => e.sourcing)).toEqual([Sourcing.Available, Sourcing.NonCompliant, null]);
    expect(counts).toMatchObject({ download: 1, force: 1, unavailable: 0, closed: 0 });
  });

  it('marks a missing episode the planner never saw as not analysed, under "sans solution"', () => {
    const e1 = request('tt1', 'Show', RequestStatus.Missing, 1, 1);

    const { rows } = buildDashboard({ ...empty, requests: [e1] });

    expect(rows[0].tabs).toEqual(['unavailable']);
    expect(rows[0].sourcingCounts).toEqual({ unknown: 1 });
    expect(rows[0].plannedAt).toBeNull();
  });

  it('closes a media with no open request', () => {
    const movie = request('tt9', 'Movie', RequestStatus.Fulfilled);

    const { rows, counts } = buildDashboard({ ...empty, requests: [movie] });

    expect(rows[0].tabs).toEqual(['closed']);
    expect(counts.closed).toBe(1);
  });

  it('sorts urgent rows first, then the oldest situations', () => {
    const old = request('tt1', 'Old deferred', RequestStatus.Missing, 1, 1);
    const fresh = request('tt2', 'Fresh deferred', RequestStatus.Missing, 1, 1);
    const starved = request('tt3', 'Starved', RequestStatus.Missing, 1, 1);
    const yesterday = new Date(now.getTime() - 86_400_000);

    const { rows } = buildDashboard({
      ...empty,
      requests: [fresh, old, starved],
      states: [
        state(old.mediaId, PlanLabel.Deferred, Sourcing.NotIndexed, yesterday),
        state(fresh.mediaId, PlanLabel.Deferred, Sourcing.NotIndexed, now),
        state(starved.mediaId, PlanLabel.Starved, Sourcing.NotIndexed, now),
      ],
    });

    expect(rows.map((r) => r.group.title)).toEqual(['Starved', 'Old deferred', 'Fresh deferred']);
  });

  it('attaches live actions, their ticket and their Fetchr download to the show row', () => {
    const e1 = request('tt1', 'Show', RequestStatus.Pending, 1, 1);
    const a1 = action('a1', 'tt1', [e1.mediaId]);
    const t1 = ticket(TicketCategory.DownloadAction, { actionId: 'a1' });

    const { rows, systemTickets } = buildDashboard({
      ...empty,
      requests: [e1],
      actions: [a1],
      tickets: [t1],
      downloads: [download('a1')],
    });

    expect(rows[0].tabs).toContain('download');
    expect(rows[0].actions).toHaveLength(1);
    expect(rows[0].actions[0].ticket?.id).toBe(t1.id);
    expect(rows[0].actions[0].ticketView?.operations).toContain('submitLink');
    expect(rows[0].actions[0].download?.progress).toBe(50);
    expect(rows[0].actions[0].execution).toMatchObject({ phase: 'downloading', progress: 50 });
    expect(systemTickets).toEqual([]);
  });

  it('reports the extraction phase once a post-download job carries the action id', () => {
    const e1 = request('tt1', 'Show', RequestStatus.Pending, 1, 1);
    const a1 = action('a1', 'tt1', [e1.mediaId]);
    const job = {
      id: 'j1',
      sourceId: 'd-a1',
      packageName: 'pack.rar',
      saveTo: '/x',
      status: DownloadJobStatus.Identifying,
      sourcePaths: [],
      errorMessage: null,
      metadata: { [PLANNED_DOWNLOAD_ID_METADATA_KEY]: 'a1' },
      createdAt: now,
      updatedAt: now,
    };

    const { rows } = buildDashboard({ ...empty, requests: [e1], actions: [a1], jobs: [job] });

    expect(rows[0].actions[0].execution).toMatchObject({ phase: 'extracting', fileName: 'pack.rar' });
  });

  it('routes tickets without a live action to the system tab and counts alerts', () => {
    const approval = ticket(TicketCategory.UserApproval, { userId: 'u1' });
    const dead = ticket(TicketCategory.PipelineFailure, {
      jobId: 'j',
      fileNames: '',
      failedStep: '',
      errorMessage: '',
    });
    const orphan = ticket(TicketCategory.DownloadAction, { actionId: 'gone' });

    const { systemTickets, counts, alerts } = buildDashboard({
      ...empty,
      tickets: [approval, dead, orphan],
      downloads: [download('x', 'disk full')],
    });

    expect(systemTickets.map((s) => s.ticket.id)).toEqual([approval.id, dead.id, orphan.id]);
    expect(counts.system).toBe(3);
    expect(alerts).toEqual({ deadLetters: 1, failedDownloads: 1 });
  });

  it('exposes indexer links of the row', () => {
    const e1 = request('tt1', 'Show', RequestStatus.Missing, 1, 1);

    const { rows } = buildDashboard({
      ...empty,
      requests: [e1],
      bookmarks: [
        {
          indexerName: 'loadix',
          imdbId: 'tt1',
          pageUrl: 'https://l/media/1',
          searchUrl: null,
          state: null,
          updatedAt: now,
        },
      ],
    });

    expect(rows[0].key).toBe('show:tt1');
    expect(rows[0].indexerLinks).toEqual([{ indexerName: 'loadix', pageUrl: 'https://l/media/1', searchUrl: null }]);
  });

  it('plans the best eligible releases over every missing episode and lists what stays uncovered', () => {
    const eps = [1, 2, 3, 4].map((n) =>
      request('tt1', 'Show', n === 2 ? RequestStatus.Fulfilled : RequestStatus.Missing, 1, n),
    );
    const s2 = request('tt1', 'Show', RequestStatus.Missing, 2, 1);
    const pack = candidate({ kind: 'season', season: 1 });
    const tooBig = {
      candidate: candidate({ kind: 'episode', season: 2, episode: 1 }, { sizeBytes: 9e9 }),
      reasons: [RejectReason.SizeExceeded],
    };

    const { rows } = buildDashboard({
      ...empty,
      requests: [...eps, s2],
      states: [
        ...eps
          .filter((e) => e.status === RequestStatus.Missing)
          .map((e) => state(e.mediaId, PlanLabel.Deferred, Sourcing.Available)),
        { ...state(s2.mediaId, PlanLabel.Deferred, Sourcing.NonCompliant), bestRejected: tooBig },
      ],
      findings: [
        {
          targetKey: 'show:tt1',
          candidates: [{ candidate: pack, reasons: [] }, tooBig],
          referenced: true,
          foundAt: now,
        },
      ],
    });

    const [first, second] = rows[0].lines;
    expect(rows[0].lines).toHaveLength(2);
    expect(first.release).toMatchObject({ covers: 'S01 E1-E4', fills: 'S01 E1, E3-E4', fillCount: 3, reasons: [] });
    expect(first.release?.link).toContain('crn-flix-candidate-id=');
    expect(first.release?.link).toContain('imdbid=tt1');
    expect(second).toMatchObject({ ranges: 'S02 E1', count: 1, sourcing: Sourcing.NonCompliant });
    expect(second.release?.reasons).toEqual([RejectReason.SizeExceeded]);
  });

  it('orders fold lines by urgency, then by episode, mixing eligible and rejected releases', () => {
    const s1 = request('tt1', 'Show', RequestStatus.Missing, 1, 1);
    const s2 = request('tt1', 'Show', RequestStatus.Missing, 2, 1);
    const s3 = request('tt1', 'Show', RequestStatus.Missing, 3, 1);
    const pack2 = candidate({ kind: 'season', season: 2 });
    const big1 = {
      candidate: candidate({ kind: 'season', season: 1 }, { sizeBytes: 9e9 }),
      reasons: [RejectReason.SizeExceeded],
    };

    const { rows } = buildDashboard({
      ...empty,
      requests: [s1, s2, s3],
      states: [
        { ...state(s1.mediaId, PlanLabel.Deferred, Sourcing.NonCompliant), bestRejected: big1 },
        state(s2.mediaId, PlanLabel.Deferred, Sourcing.Available),
        state(s3.mediaId, PlanLabel.Starved, Sourcing.NotIndexed),
      ],
      findings: [
        {
          targetKey: 'show:tt1',
          candidates: [{ candidate: pack2, reasons: [] }, big1],
          referenced: true,
          foundAt: now,
        },
      ],
    });

    expect(rows[0].lines.map((l) => [l.urgency, l.ranges, l.release?.reasons ?? null, l.sourcing])).toEqual([
      [PlanLabel.Starved, 'S03 E1', null, Sourcing.NotIndexed],
      [PlanLabel.Deferred, 'S01 E1', [RejectReason.SizeExceeded], Sourcing.NonCompliant],
      [PlanLabel.Deferred, 'S02 E1', [], null],
    ]);
  });

  it('tracks a hand launch through its candidate id', () => {
    const e1 = request('tt1', 'Show', RequestStatus.Missing, 1, 1);
    const pack = candidate({ kind: 'season', season: 1 });
    const launched = download('unused');
    launched.metadata = { [CANDIDATE_ID_PARAM]: candidateId(pack) };

    const { rows } = buildDashboard({
      ...empty,
      requests: [e1],
      states: [state(e1.mediaId, PlanLabel.Deferred, Sourcing.Available)],
      findings: [
        { targetKey: 'show:tt1', candidates: [{ candidate: pack, reasons: [] }], referenced: true, foundAt: now },
      ],
      downloads: [launched],
    });

    expect(rows[0].lines[0].release?.execution).toMatchObject({ phase: 'downloading', progress: 50 });
    expect(rows[0].launches).toEqual([expect.objectContaining({ track: `candidate:${candidateId(pack)}` })]);
  });
});
