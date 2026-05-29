import { IndexerCandidate, passesPreferences } from '@/modules/indexer/contract';
import { EnginePreferences, Host, Language, Quality } from '@/modules/indexer/preferences';
import { MediaInfos, MediaType } from '@/services/database/medias';

const baseMedia: MediaInfos = {
  imdbId: 'tt0000001',
  type: MediaType.Movie,
  title: 'Test',
  originalTitle: 'Test',
  year: 2024,
  seasonNumber: null,
  episodeNumber: null,
  runtimeMinutes: 90,
};

function buildCandidate(overrides: Partial<IndexerCandidate> = {}): IndexerCandidate {
  return {
    indexerName: 'test',
    url: 'https://1fichier.com/?abc',
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
    expect(passesPreferences(buildCandidate(), baseMedia, buildPrefs())).toBe(true);
  });

  it('rejects when quality not in allowedQualities', () => {
    const prefs = buildPrefs({ allowedQualities: [Quality.HD_720P] });
    expect(passesPreferences(buildCandidate({ quality: Quality.HD_1080P }), baseMedia, prefs)).toBe(false);
  });

  it('rejects when host not in allowedHosts', () => {
    const prefs = buildPrefs({ allowedHosts: [Host.ONE_FICHIER] });
    expect(passesPreferences(buildCandidate({ host: Host.UNKNOWN }), baseMedia, prefs)).toBe(false);
  });

  it('rejects when language not in allowedLanguages', () => {
    const prefs = buildPrefs({ allowedLanguages: [Language.TRUEFRENCH] });
    expect(passesPreferences(buildCandidate({ language: Language.ENGLISH }), baseMedia, prefs)).toBe(false);
  });

  it('rejects when size exceeds the cap', () => {
    const prefs = buildPrefs({
      sizePolicy: { bytesPerMinute: { [Quality.HD_1080P]: 50_000_000 }, tolerance: 1 },
    });
    const tooBig = buildCandidate({ sizeBytes: 50_000_000 * 90 + 1 });
    expect(passesPreferences(tooBig, baseMedia, prefs)).toBe(false);
  });

  it('accepts when size is at the cap', () => {
    const prefs = buildPrefs({
      sizePolicy: { bytesPerMinute: { [Quality.HD_1080P]: 50_000_000 }, tolerance: 1 },
    });
    const atCap = buildCandidate({ sizeBytes: 50_000_000 * 90 });
    expect(passesPreferences(atCap, baseMedia, prefs)).toBe(true);
  });

  it('ignores size policy when sizeBytes is null', () => {
    const prefs = buildPrefs({
      sizePolicy: { bytesPerMinute: { [Quality.HD_1080P]: 50_000_000 }, tolerance: 1 },
    });
    expect(passesPreferences(buildCandidate({ sizeBytes: null }), baseMedia, prefs)).toBe(true);
  });

  it('ignores size policy when runtimeMinutes is null', () => {
    const prefs = buildPrefs({
      sizePolicy: { bytesPerMinute: { [Quality.HD_1080P]: 50_000_000 }, tolerance: 1 },
    });
    const noRuntime = { ...baseMedia, runtimeMinutes: null };
    expect(passesPreferences(buildCandidate({ sizeBytes: Number.MAX_SAFE_INTEGER }), noRuntime, prefs)).toBe(true);
  });
});
