import { IndexerCandidate } from '@/modules/indexer/contract';
import { EnginePreferences, Host, Language, Quality } from '@/modules/indexer/preferences';
import { scoreOf } from '@/services/indexer-scoring';

function buildCandidate(overrides: Partial<IndexerCandidate> = {}): IndexerCandidate {
  return {
    indexerName: 'test',
    url: 'https://example.com',
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

describe('scoreOf', () => {
  it('returns 0 with empty prefs and no autoTriggerable bonus', () => {
    expect(scoreOf(buildCandidate(), buildPrefs(), false)).toBe(0);
  });

  it('ranks higher-preferred quality above lower-preferred', () => {
    const prefs = buildPrefs({ allowedQualities: [Quality.UHD_4K, Quality.HD_1080P, Quality.HD_720P] });
    const fourK = scoreOf(buildCandidate({ quality: Quality.UHD_4K }), prefs, false);
    const fullHd = scoreOf(buildCandidate({ quality: Quality.HD_1080P }), prefs, false);
    const hd = scoreOf(buildCandidate({ quality: Quality.HD_720P }), prefs, false);
    expect(fourK).toBeGreaterThan(fullHd);
    expect(fullHd).toBeGreaterThan(hd);
  });

  it('autoTriggerable beats non-triggerable at otherwise equal scores', () => {
    const prefs = buildPrefs();
    const candidate = buildCandidate();
    expect(scoreOf(candidate, prefs, true)).toBeGreaterThan(scoreOf(candidate, prefs, false));
  });

  it('quality preference outweighs autoTriggerable bonus', () => {
    const prefs = buildPrefs({ allowedQualities: [Quality.HD_1080P, Quality.HD_720P] });
    const triggerable720 = scoreOf(buildCandidate({ quality: Quality.HD_720P }), prefs, true);
    const manual1080 = scoreOf(buildCandidate({ quality: Quality.HD_1080P }), prefs, false);
    expect(manual1080).toBeGreaterThan(triggerable720);
  });

  it('penalizes larger files slightly', () => {
    const prefs = buildPrefs();
    const small = scoreOf(buildCandidate({ sizeBytes: 1024 ** 3 }), prefs, false);
    const big = scoreOf(buildCandidate({ sizeBytes: 5 * 1024 ** 3 }), prefs, false);
    expect(small).toBeGreaterThan(big);
  });
});
