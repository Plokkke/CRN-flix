import { IndexerCandidate } from '@/modules/indexer/contract';
import { EnginePreferences, Host, Language, Quality } from '@/modules/indexer/preferences';
import { PlanLabel, PlannerEpisode } from '@/services/planner/model';
import { resolvePlan } from '@/services/planner/resolve';

const PREFS: EnginePreferences = {
  allowedQualities: [],
  allowedLanguages: [],
  allowedHosts: [],
  sizePolicy: { bytesPerMinute: {}, tolerance: 1 },
};

function episode(season: number, number: number, available = false, runtimeMinutes = 60): PlannerEpisode {
  return {
    mediaId: `s${season}e${number}`,
    season,
    episode: number,
    runtimeMinutes,
    available,
    requested: !available,
  };
}

function candidate(scope: IndexerCandidate['scope'], overrides: Partial<IndexerCandidate> = {}): IndexerCandidate {
  return {
    indexerName: 'loadix',
    url: 'https://loadix.test/media/x',
    scope,
    quality: Quality.HD_1080P,
    language: Language.MULTI,
    host: Host.ONE_FICHIER,
    sizeBytes: 3_000_000_000,
    ...overrides,
  };
}

function labelsOf(entries: [string, PlanLabel][]): Map<string, PlanLabel> {
  return new Map(entries);
}

describe('resolvePlan', () => {
  it('canonical: wanted {E6,E7,E8} with candidates {E6, E8, S1-pack} → the pack alone', () => {
    const episodes = Array.from({ length: 10 }, (_, i) => episode(1, i + 1, i + 1 < 6));
    const labels = labelsOf([
      ['s1e6', PlanLabel.Starved],
      ['s1e7', PlanLabel.Needed],
      ['s1e8', PlanLabel.Needed],
      ['s1e9', PlanLabel.Deferred],
      ['s1e10', PlanLabel.Deferred],
    ]);
    const candidates = [
      candidate({ kind: 'episode', season: 1, episode: 6 }),
      candidate({ kind: 'episode', season: 1, episode: 8 }),
      candidate({ kind: 'season', season: 1 }, { sizeBytes: 30_000_000_000 }),
    ];

    const plan = resolvePlan({ episodes, labels, candidates, maxWindowHours: 25, prefs: PREFS });

    expect(plan).toHaveLength(1);
    expect(plan[0].candidate.scope).toEqual({ kind: 'season', season: 1 });
    // Deferred episodes covered by the pack come along as free bonus.
    expect(plan[0].coveredMediaIds).toEqual(expect.arrayContaining(['s1e6', 's1e7', 's1e8', 's1e9', 's1e10']));
    expect(plan[0].label).toBe(PlanLabel.Starved);
  });

  it('never plans an action for deferred-only coverage', () => {
    const episodes = [episode(1, 1)];
    const labels = labelsOf([['s1e1', PlanLabel.Deferred]]);
    const candidates = [candidate({ kind: 'episode', season: 1, episode: 1 })];

    expect(resolvePlan({ episodes, labels, candidates, maxWindowHours: 25, prefs: PREFS })).toEqual([]);
  });

  it('canonical: Daredevil (~33h) — the series pack beats 3 season packs despite the soft ceiling', () => {
    // 3 seasons × 13 episodes × 51 min ≈ 33h, all missing, all wanted.
    const episodes = [1, 2, 3].flatMap((s) => Array.from({ length: 13 }, (_, i) => episode(s, i + 1, false, 51)));
    const labels = new Map(episodes.map((e) => [e.mediaId, PlanLabel.Needed]));
    const candidates = [
      candidate({ kind: 'series' }, { sizeBytes: 100_000_000_000 }),
      candidate({ kind: 'season', season: 1 }, { sizeBytes: 33_000_000_000 }),
      candidate({ kind: 'season', season: 2 }, { sizeBytes: 33_000_000_000 }),
      candidate({ kind: 'season', season: 3 }, { sizeBytes: 33_000_000_000 }),
    ];

    const plan = resolvePlan({ episodes, labels, candidates, maxWindowHours: 25, prefs: PREFS });

    expect(plan).toHaveLength(1);
    expect(plan[0].candidate.scope).toEqual({ kind: 'series' });
  });

  it('canonical: SG-1 (~160h) — season packs beat the series pack', () => {
    // 10 seasons × 22 episodes × 44 min ≈ 161h.
    const seasons = Array.from({ length: 10 }, (_, s) => s + 1);
    const episodes = seasons.flatMap((s) => Array.from({ length: 22 }, (_, i) => episode(s, i + 1, false, 44)));
    const labels = new Map(episodes.map((e) => [e.mediaId, PlanLabel.Needed]));
    const candidates = [
      candidate({ kind: 'series' }, { sizeBytes: 500_000_000_000 }),
      ...seasons.map((s) => candidate({ kind: 'season', season: s }, { sizeBytes: 50_000_000_000 })),
    ];

    const plan = resolvePlan({ episodes, labels, candidates, maxWindowHours: 25, prefs: PREFS });

    expect(plan).toHaveLength(10);
    expect(plan.every((a) => a.candidate.scope.kind === 'season')).toBe(true);
  });

  it('penalizes redundant bytes: a pack overlapping the whole season loses to one single', () => {
    // Only E13 missing; the pack re-downloads 12 available episodes.
    const episodes = Array.from({ length: 13 }, (_, i) => episode(1, i + 1, i + 1 < 13));
    const labels = labelsOf([['s1e13', PlanLabel.Needed]]);
    const candidates = [
      candidate({ kind: 'episode', season: 1, episode: 13 }),
      candidate({ kind: 'season', season: 1 }, { sizeBytes: 60_000_000_000 }),
    ];

    const plan = resolvePlan({ episodes, labels, candidates, maxWindowHours: 25, prefs: PREFS });

    expect(plan).toHaveLength(1);
    expect(plan[0].candidate.scope).toEqual({ kind: 'episode', season: 1, episode: 13 });
  });

  it('estimates the size from the size policy when sizeBytes is null', () => {
    const prefs: EnginePreferences = {
      ...PREFS,
      sizePolicy: { bytesPerMinute: { [Quality.HD_1080P]: 100_000_000 }, tolerance: 1 },
    };
    const episodes = Array.from({ length: 13 }, (_, i) => episode(1, i + 1, i + 1 < 13));
    const labels = labelsOf([['s1e13', PlanLabel.Needed]]);
    const candidates = [
      candidate({ kind: 'episode', season: 1, episode: 13 }, { sizeBytes: null }),
      candidate({ kind: 'season', season: 1 }, { sizeBytes: null }),
    ];

    const plan = resolvePlan({ episodes, labels, candidates, maxWindowHours: 25, prefs });

    expect(plan).toHaveLength(1);
    expect(plan[0].candidate.scope).toEqual({ kind: 'episode', season: 1, episode: 13 });
  });

  it('reports runners-up covering the same wanted episodes as alternatives', () => {
    const episodes = Array.from({ length: 3 }, (_, i) => episode(1, i + 1));
    const labels = new Map(episodes.map((e) => [e.mediaId, PlanLabel.Needed]));
    const candidates = [
      candidate({ kind: 'season', season: 1 }),
      candidate({ kind: 'series' }, { sizeBytes: 4_000_000_000 }),
    ];

    const plan = resolvePlan({ episodes, labels, candidates, maxWindowHours: 25, prefs: PREFS });

    expect(plan).toHaveLength(1);
    expect(plan[0].alternatives).toHaveLength(1);
    expect(plan[0].alternatives[0].scope.kind).not.toBe(plan[0].candidate.scope.kind);
  });

  it('prefers the better-ranked quality at equal cost', () => {
    const prefs: EnginePreferences = { ...PREFS, allowedQualities: [Quality.UHD_4K, Quality.HD_1080P] };
    const episodes = [episode(1, 1)];
    const labels = labelsOf([['s1e1', PlanLabel.Starved]]);
    const candidates = [
      candidate({ kind: 'episode', season: 1, episode: 1 }, { quality: Quality.HD_1080P }),
      candidate({ kind: 'episode', season: 1, episode: 1 }, { quality: Quality.UHD_4K }),
    ];

    const plan = resolvePlan({ episodes, labels, candidates, maxWindowHours: 25, prefs });

    expect(plan).toHaveLength(1);
    expect(plan[0].candidate.quality).toBe(Quality.UHD_4K);
  });

  it('leaves uncoverable wanted episodes without an action', () => {
    const episodes = [episode(1, 1), episode(1, 2)];
    const labels = labelsOf([
      ['s1e1', PlanLabel.Starved],
      ['s1e2', PlanLabel.Needed],
    ]);
    const candidates = [candidate({ kind: 'episode', season: 1, episode: 1 })];

    const plan = resolvePlan({ episodes, labels, candidates, maxWindowHours: 25, prefs: PREFS });

    expect(plan).toHaveLength(1);
    expect(plan[0].coveredMediaIds).toEqual(['s1e1']);
  });

  it('handles the degenerate movie case', () => {
    const movie: PlannerEpisode = {
      mediaId: 'movie-1',
      season: 0,
      episode: 0,
      runtimeMinutes: 120,
      available: false,
      requested: true,
    };
    const labels = labelsOf([['movie-1', PlanLabel.Starved]]);
    const candidates = [candidate({ kind: 'movie' })];

    const plan = resolvePlan({ episodes: [movie], labels, candidates, maxWindowHours: 25, prefs: PREFS });

    expect(plan).toHaveLength(1);
    expect(plan[0].coveredMediaIds).toEqual(['movie-1']);
  });
});
