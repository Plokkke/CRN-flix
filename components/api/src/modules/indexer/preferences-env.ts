import { EnginePreferences, Host, Language, Quality, SizePolicy } from '@crn-flix/contracts';

function parseCsv<T extends string>(value: string, allowed: readonly T[]): T[] {
  if (!value.trim()) {
    return [];
  }
  const allowedSet = new Set<string>(allowed);
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && allowedSet.has(s)) as T[];
}

function parseBytesPerMinute(json: string): SizePolicy['bytesPerMinute'] {
  if (!json.trim()) {
    return {};
  }
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null) {
    return {};
  }
  const result: SizePolicy['bytesPerMinute'] = {};
  const validQualities = new Set<string>(Object.values(Quality));
  for (const [key, value] of Object.entries(parsed)) {
    if (validQualities.has(key) && typeof value === 'number' && value > 0) {
      result[key as Quality] = value;
    }
  }
  return result;
}

type PreferencesEnv = {
  INDEXER_ALLOWED_QUALITIES?: string;
  INDEXER_ALLOWED_LANGUAGES?: string;
  INDEXER_ALLOWED_HOSTS?: string;
  INDEXER_SIZE_TOLERANCE?: string | number;
  INDEXER_BYTES_PER_MIN_JSON?: string;
};

/** Preferences from the INDEXER_* env vars; an unset allow-list means "allow everything". */
export function preferencesFromEnv(env: PreferencesEnv): EnginePreferences {
  const tolerance = Number(env.INDEXER_SIZE_TOLERANCE ?? 1);

  return {
    allowedQualities: parseCsv(String(env.INDEXER_ALLOWED_QUALITIES ?? ''), Object.values(Quality)),
    allowedLanguages: parseCsv(String(env.INDEXER_ALLOWED_LANGUAGES ?? ''), Object.values(Language)),
    allowedHosts: parseCsv(String(env.INDEXER_ALLOWED_HOSTS ?? ''), Object.values(Host)),
    sizePolicy: {
      bytesPerMinute: parseBytesPerMinute(String(env.INDEXER_BYTES_PER_MIN_JSON ?? '')),
      tolerance: tolerance > 0 ? tolerance : 1,
    },
  };
}
