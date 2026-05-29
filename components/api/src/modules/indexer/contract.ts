import { MediaInfos } from '@/services/database/medias';

import { EnginePreferences, Host, Language, Quality, maxSizeBytes } from './preferences';

export type IndexerCandidate = {
  indexerName: string;
  url: string;
  quality: Quality;
  language: Language;
  host: Host;
  sizeBytes: number | null;
};

export interface Indexer {
  readonly name: string;
  find(media: MediaInfos, prefs: EnginePreferences): Promise<IndexerCandidate[]>;
}

export function passesPreferences(candidate: IndexerCandidate, media: MediaInfos, prefs: EnginePreferences): boolean {
  if (prefs.allowedQualities.length > 0 && !prefs.allowedQualities.includes(candidate.quality)) {
    return false;
  }
  if (prefs.allowedHosts.length > 0 && !prefs.allowedHosts.includes(candidate.host)) {
    return false;
  }
  if (prefs.allowedLanguages.length > 0 && !prefs.allowedLanguages.includes(candidate.language)) {
    return false;
  }
  if (candidate.sizeBytes !== null && media.runtimeMinutes !== null) {
    const cap = maxSizeBytes(candidate.quality, media.runtimeMinutes, prefs.sizePolicy);
    if (cap !== null && candidate.sizeBytes > cap) {
      return false;
    }
  }
  return true;
}

export const INDEXERS = Symbol('Indexers');
