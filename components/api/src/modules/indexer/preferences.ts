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
