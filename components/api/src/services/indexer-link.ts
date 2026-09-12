import { createHash } from 'node:crypto';

import { appendQueryParams } from '@/helpers/url';
import { IndexerCandidate, scopeKey } from '@/modules/indexer/contract';
import { PlannedDownloadEntity } from '@/services/database/planned-downloads';

/** Query params the fetchr-grab extension carries over to the download it registers. */
export const REQUEST_ID_PARAM = 'crn-flix-request-id';
export const CANDIDATE_ID_PARAM = 'crn-flix-candidate-id';
export const IMDB_ID_PARAM = 'imdbid';

/** Stable identity of a release across passes: same indexer page, scope, quality, language, host, size. */
export function candidateId(candidate: IndexerCandidate): string {
  const key = [
    candidate.indexerName,
    candidate.url,
    scopeKey(candidate.scope),
    candidate.quality,
    candidate.language,
    candidate.host,
    candidate.sizeBytes ?? '',
  ].join('|');
  return createHash('sha1').update(key).digest('hex').slice(0, 16);
}

export const candidateOf = (action: PlannedDownloadEntity): IndexerCandidate => ({
  indexerName: action.indexerName,
  url: action.url,
  scope: action.scope,
  quality: action.quality,
  language: action.language,
  host: action.host,
  sizeBytes: action.sizeBytes,
});

function withParams(url: string, params: Record<string, string>): string {
  try {
    return appendQueryParams(url, params);
  } catch {
    return url;
  }
}

/**
 * View-only link of a release: the persisted url stays clean, the params only ride what we
 * display. The candidate id lets the engine tell which release a Fetchr download is; the
 * imdb id lets the post-download pipeline identify it without any action.
 */
export function candidateDisplayLink(candidate: IndexerCandidate, imdbId: string | null): string {
  const params: Record<string, string> = { [CANDIDATE_ID_PARAM]: candidateId(candidate) };
  if (imdbId) {
    params[IMDB_ID_PARAM] = imdbId;
  }
  return withParams(candidate.url, params);
}

/** Same, for a planner action: the action id rides the legacy param the extension already forwards. */
export function actionDisplayLink(action: PlannedDownloadEntity): string {
  const params: Record<string, string> = {
    [REQUEST_ID_PARAM]: action.id,
    [CANDIDATE_ID_PARAM]: candidateId(candidateOf(action)),
  };
  const imdbId = action.showImdbId ?? action.medias?.[0]?.imdbId;
  if (imdbId) {
    params[IMDB_ID_PARAM] = imdbId;
  }
  return withParams(action.url, params);
}
