import { Quality, SizePolicy, maxSizeBytes } from '@/modules/indexer/preferences';

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
