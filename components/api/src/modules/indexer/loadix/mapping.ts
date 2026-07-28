import { Host, Language, Quality } from '@/modules/indexer/preferences';

/**
 * Surjective mappings from Loadix's free-form labels to the contract enums.
 * Several Loadix values collapse onto one engine value on purpose.
 */

const RESOLUTION_PATTERNS: [RegExp, Quality][] = [
  [/2160|4k|uhd/i, Quality.UHD_4K],
  [/1080/, Quality.HD_1080P],
  [/720/, Quality.HD_720P],
  [/dvd|480|\bsd\b/i, Quality.SD],
];

/** Falls back to the release filename when the quality label carries no resolution (e.g. "REMUX BLURAY"). */
export function mapQuality(quality: string, releaseGroup: string | null): Quality {
  for (const source of [quality, releaseGroup ?? '']) {
    const match = RESOLUTION_PATTERNS.find(([pattern]) => pattern.test(source));
    if (match) {
      return match[1];
    }
  }
  return Quality.UNKNOWN;
}

export function mapLanguage(raw: string): Language {
  const normalized = raw.toUpperCase();

  if (normalized.includes('MULTI')) {
    return Language.MULTI;
  }
  if (normalized.includes('TRUEFRENCH') || normalized.includes('VFF')) {
    return Language.TRUEFRENCH;
  }
  if (normalized.includes('VOSTFR')) {
    return Language.VOSTFR;
  }
  if (normalized.includes('VFQ') || normalized.includes('FRENCH') || /\bVF\b/.test(normalized)) {
    return Language.FRENCH;
  }
  if (/\bVO\b/.test(normalized) || normalized.includes('ENGLISH')) {
    return Language.ENGLISH;
  }
  return Language.UNKNOWN;
}

export function mapHost(provider: string): Host {
  return provider.toLowerCase() === '1fichier' ? Host.ONE_FICHIER : Host.UNKNOWN;
}
