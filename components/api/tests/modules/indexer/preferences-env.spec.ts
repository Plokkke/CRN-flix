import { Host, Language, Quality } from '@crn-flix/contracts';

import { preferencesFromEnv } from '@/modules/indexer/preferences-env';

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
