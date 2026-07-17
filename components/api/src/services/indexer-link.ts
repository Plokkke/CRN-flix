import { appendQueryParams } from '@/helpers/url';
import { RequestEntity } from '@/services/database/requests';

/**
 * View-only: enrich the stored indexer link with CRN-Flix correlation params so the
 * fetchr-grab browser extension can carry them over to the download link the admin picks.
 * The persisted `indexerLink` stays clean; these params live only in what we display.
 */
export function indexerDisplayLink(request: RequestEntity): string | null {
  if (!request.indexerLink) {
    return null;
  }

  const params: Record<string, string> = { 'crn-flix-request-id': request.mediaId };
  if (request.media?.imdbId) {
    params.imdbid = request.media.imdbId;
  }

  try {
    return appendQueryParams(request.indexerLink, params);
  } catch {
    return request.indexerLink;
  }
}
