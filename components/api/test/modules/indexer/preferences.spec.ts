import { Host, Language, Quality, SizePolicy, maxSizeBytes, preferencesFromEnv } from '@/modules/indexer/preferences';

describe('maxSizeBytes', () => {
  const policy: SizePolicy = {
    bytesPerMinute: {
      [Quality.HD_1080P]: 50_000_000,
      [Quality.HD_720P]: 25_000_000,
    },
    tolerance: 1.25,
  };

  it('computes cap = bytesPerMinute * minutes * tolerance', () => {
    expect(maxSizeBytes(Quality.HD_1080P, 90, policy)).toBe(Math.round(50_000_000 * 90 * 1.25));
    expect(maxSizeBytes(Quality.HD_720P, 60, policy)).toBe(Math.round(25_000_000 * 60 * 1.25));
  });

  it('returns null when bytesPerMinute is missing for the quality', () => {
    expect(maxSizeBytes(Quality.UHD_4K, 90, policy)).toBeNull();
    expect(maxSizeBytes(Quality.SD, 90, policy)).toBeNull();
    expect(maxSizeBytes(Quality.UNKNOWN, 90, policy)).toBeNull();
  });

  it('returns null when minutes is zero or negative', () => {
    expect(maxSizeBytes(Quality.HD_1080P, 0, policy)).toBeNull();
    expect(maxSizeBytes(Quality.HD_1080P, -5, policy)).toBeNull();
  });
});

describe('preferencesFromEnv', () => {
  it('parses the INDEXER_* variables', () => {
    expect(
      preferencesFromEnv({
        INDEXER_ALLOWED_QUALITIES: 'hd-1080p',
        INDEXER_ALLOWED_LANGUAGES: 'truefrench,multi,french',
        INDEXER_ALLOWED_HOSTS: '1fichier',
        INDEXER_SIZE_TOLERANCE: '1.25',
        INDEXER_BYTES_PER_MIN_JSON: '{"hd-1080p":50000000,"bogus":1,"sd":-2}',
      }),
    ).toEqual({
      allowedQualities: [Quality.HD_1080P],
      allowedLanguages: [Language.TRUEFRENCH, Language.MULTI, Language.FRENCH],
      allowedHosts: [Host.ONE_FICHIER],
      sizePolicy: { bytesPerMinute: { [Quality.HD_1080P]: 50_000_000 }, tolerance: 1.25 },
    });
  });

  it('drops unknown enum values and defaults to allow-all when unset', () => {
    expect(preferencesFromEnv({ INDEXER_ALLOWED_QUALITIES: 'cam,hd-1080p' }).allowedQualities).toEqual([
      Quality.HD_1080P,
    ]);
    expect(preferencesFromEnv({})).toEqual({
      allowedQualities: [],
      allowedLanguages: [],
      allowedHosts: [],
      sizePolicy: { bytesPerMinute: {}, tolerance: 1 },
    });
  });
});
