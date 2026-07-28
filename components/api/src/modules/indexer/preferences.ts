export enum Quality {
  UHD_4K = 'uhd-4k',
  HD_1080P = 'hd-1080p',
  HD_720P = 'hd-720p',
  SD = 'sd',
  UNKNOWN = 'unknown',
}

export enum Language {
  TRUEFRENCH = 'truefrench',
  MULTI = 'multi',
  FRENCH = 'french',
  ENGLISH = 'english',
  VOSTFR = 'vostfr',
  UNKNOWN = 'unknown',
}

// Only 1fichier is supported today. Add values when a new indexer brings them in.
export enum Host {
  ONE_FICHIER = '1fichier',
  UNKNOWN = 'unknown',
}

export type SizePolicy = {
  bytesPerMinute: Partial<Record<Quality, number>>;
  tolerance: number;
};

export function maxSizeBytes(quality: Quality, minutes: number, policy: SizePolicy): number | null {
  const bpm = policy.bytesPerMinute[quality];
  if (bpm === undefined || minutes <= 0) {
    return null;
  }
  return Math.round(bpm * minutes * policy.tolerance);
}

export type EnginePreferences = {
  allowedQualities: Quality[];
  allowedLanguages: Language[];
  allowedHosts: Host[];
  sizePolicy: SizePolicy;
};

/** An empty allow-list means "allow everything". */
export function isAllowed<T>(allowed: T[], value: T): boolean {
  return allowed.length === 0 || allowed.includes(value);
}

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
