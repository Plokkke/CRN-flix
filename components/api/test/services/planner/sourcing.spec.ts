import { IndexerCandidate, RejectReason } from '@/modules/indexer/contract';
import { EnginePreferences, Host, Language, Quality } from '@/modules/indexer/preferences';
import { PlannerEpisode } from '@/services/planner/model';
import { assessSourcing, Sourcing } from '@/services/planner/sourcing';

const PREFS: EnginePreferences = {
  allowedQualities: [Quality.HD_1080P, Quality.HD_720P],
  allowedLanguages: [Language.MULTI],
  allowedHosts: [Host.ONE_FICHIER],
  sizePolicy: { bytesPerMinute: {}, tolerance: 1 },
};

const episode: PlannerEpisode = {
  mediaId: 'm1',
  season: 1,
  episode: 3,
  runtimeMinutes: 45,
  available: false,
  requested: true,
};

function candidate(overrides: Partial<IndexerCandidate> = {}): IndexerCandidate {
  return {
    indexerName: 'loadix',
    url: 'https://loadix.test/media/1',
    scope: { kind: 'season', season: 1 },
    quality: Quality.HD_1080P,
    language: Language.MULTI,
    host: Host.ONE_FICHIER,
    sizeBytes: null,
    ...overrides,
  };
}

describe('assessSourcing', () => {
  it('is available with the best eligible covering candidate', () => {
    const better = candidate({ quality: Quality.HD_1080P });
    const worse = candidate({ quality: Quality.HD_720P });

    const result = assessSourcing(
      episode,
      [
        { candidate: worse, reasons: [] },
        { candidate: better, reasons: [] },
      ],
      true,
      PREFS,
    );

    expect(result).toEqual({ sourcing: Sourcing.Available, best: better, bestRejected: null });
  });

  it('ignores candidates that do not cover the episode', () => {
    const otherSeason = candidate({ scope: { kind: 'season', season: 2 } });

    const result = assessSourcing(episode, [{ candidate: otherSeason, reasons: [] }], true, PREFS);

    expect(result.sourcing).toBe(Sourcing.NotIndexed);
  });

  it('is non-compliant when the closest rejected candidate fails only on quality or size', () => {
    const tooBig = { candidate: candidate({ sizeBytes: 9e9 }), reasons: [RejectReason.SizeExceeded] };
    const wrongHost = { candidate: candidate({ host: Host.UNKNOWN }), reasons: [RejectReason.HostNotAllowed] };

    const result = assessSourcing(episode, [wrongHost, tooBig], true, PREFS);

    expect(result).toEqual({ sourcing: Sourcing.NonCompliant, best: null, bestRejected: tooBig });
  });

  it('is unavailable when every covering candidate fails on host or language', () => {
    const vostfr = {
      candidate: candidate({ language: Language.VOSTFR }),
      reasons: [RejectReason.LanguageNotAllowed],
    };
    const both = {
      candidate: candidate({ language: Language.VOSTFR, quality: Quality.SD }),
      reasons: [RejectReason.LanguageNotAllowed, RejectReason.QualityNotAllowed],
    };

    const result = assessSourcing(episode, [both, vostfr], true, PREFS);

    expect(result).toEqual({ sourcing: Sourcing.Unavailable, best: null, bestRejected: vostfr });
  });

  it('distinguishes a known show without the episode from an unknown show', () => {
    expect(assessSourcing(episode, [], true, PREFS).sourcing).toBe(Sourcing.NotIndexed);
    expect(assessSourcing(episode, [], false, PREFS).sourcing).toBe(Sourcing.NotReferenced);
  });
});
