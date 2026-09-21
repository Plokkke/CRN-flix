import {
  assessCandidate,
  IndexerCandidate,
  IndexerTarget,
  isForceable,
  passesPreferences,
  RejectReason,
} from '@/modules/indexer/contract';
import { EnginePreferences, Host, Language, Quality } from '@/modules/indexer/preferences';
import { MediaInfos, MediaType } from '@/services/database/medias';

const baseMedia: MediaInfos = {
  imdbId: 'tt0000001',
  type: MediaType.Movie,
  title: 'Test',
  originalTitle: 'Test',
  frenchTitle: null,
  originalLanguage: null,
  year: 2024,
  seasonNumber: null,
  episodeNumber: null,
  runtimeMinutes: 90,
};

const baseTarget: IndexerTarget = { kind: 'movie', media: baseMedia };

function buildCandidate(overrides: Partial<IndexerCandidate> = {}): IndexerCandidate {
  return {
    indexerName: 'test',
    url: 'https://1fichier.com/?abc',
    scope: { kind: 'movie' },
    quality: Quality.HD_1080P,
    language: Language.TRUEFRENCH,
    host: Host.ONE_FICHIER,
    sizeBytes: null,
    ...overrides,
  };
}

function buildPrefs(overrides: Partial<EnginePreferences> = {}): EnginePreferences {
  return {
    allowedQualities: [],
    allowedLanguages: [],
    allowedHosts: [],
    sizePolicy: { bytesPerMinute: {}, tolerance: 1 },
    ...overrides,
  };
}

describe('passesPreferences', () => {
  it('accepts everything when filters are empty', () => {
    expect(passesPreferences(buildCandidate(), baseTarget, buildPrefs())).toBe(true);
  });

  it('rejects when quality not in allowedQualities', () => {
    const prefs = buildPrefs({ allowedQualities: [Quality.HD_720P] });
    expect(passesPreferences(buildCandidate({ quality: Quality.HD_1080P }), baseTarget, prefs)).toBe(false);
  });

  it('rejects when host not in allowedHosts', () => {
    const prefs = buildPrefs({ allowedHosts: [Host.ONE_FICHIER] });
    expect(passesPreferences(buildCandidate({ host: Host.UNKNOWN }), baseTarget, prefs)).toBe(false);
  });

  it('rejects when language not in allowedLanguages', () => {
    const prefs = buildPrefs({ allowedLanguages: [Language.TRUEFRENCH] });
    expect(passesPreferences(buildCandidate({ language: Language.ENGLISH }), baseTarget, prefs)).toBe(false);
  });

  it('rejects when size exceeds the cap', () => {
    const prefs = buildPrefs({
      sizePolicy: { bytesPerMinute: { [Quality.HD_1080P]: 50_000_000 }, tolerance: 1 },
    });
    const tooBig = buildCandidate({ sizeBytes: 50_000_000 * 90 + 1 });
    expect(passesPreferences(tooBig, baseTarget, prefs)).toBe(false);
  });

  it('accepts when size is at the cap', () => {
    const prefs = buildPrefs({
      sizePolicy: { bytesPerMinute: { [Quality.HD_1080P]: 50_000_000 }, tolerance: 1 },
    });
    const atCap = buildCandidate({ sizeBytes: 50_000_000 * 90 });
    expect(passesPreferences(atCap, baseTarget, prefs)).toBe(true);
  });

  it('ignores size policy when sizeBytes is null', () => {
    const prefs = buildPrefs({
      sizePolicy: { bytesPerMinute: { [Quality.HD_1080P]: 50_000_000 }, tolerance: 1 },
    });
    expect(passesPreferences(buildCandidate({ sizeBytes: null }), baseTarget, prefs)).toBe(true);
  });

  it('assumes 120 minutes for a movie without runtime instead of skipping the cap', () => {
    const target: IndexerTarget = { kind: 'movie', media: { ...baseMedia, runtimeMinutes: null } };
    const prefs = buildPrefs({ sizePolicy: { bytesPerMinute: { [Quality.HD_1080P]: 24_000_000 }, tolerance: 1 } });

    expect(passesPreferences(buildCandidate({ sizeBytes: 120 * 24_000_000 }), target, prefs)).toBe(true);
    expect(passesPreferences(buildCandidate({ sizeBytes: 7.9 * 1024 ** 3 }), target, prefs)).toBe(false);
  });
});

describe('assessCandidate', () => {
  it('lists every failing dimension at once', () => {
    const reasons = assessCandidate(
      buildCandidate({ quality: Quality.SD, host: Host.UNKNOWN, sizeBytes: 10 * 1024 ** 3 }),
      baseTarget,
      buildPrefs({
        allowedQualities: [Quality.HD_1080P],
        allowedHosts: [Host.ONE_FICHIER],
        sizePolicy: { bytesPerMinute: { [Quality.SD]: 1024 ** 2 }, tolerance: 1 },
      }),
    );

    expect(reasons).toEqual([RejectReason.QualityNotAllowed, RejectReason.HostNotAllowed, RejectReason.SizeExceeded]);
  });

  it('is empty for an eligible candidate', () => {
    expect(assessCandidate(buildCandidate(), baseTarget, buildPrefs())).toEqual([]);
  });
});

describe('isForceable', () => {
  it('holds only for quality and size rejections', () => {
    expect(isForceable([RejectReason.QualityNotAllowed, RejectReason.SizeExceeded])).toBe(true);
    expect(isForceable([RejectReason.SizeExceeded, RejectReason.HostNotAllowed])).toBe(false);
    expect(isForceable([])).toBe(false);
  });
});
