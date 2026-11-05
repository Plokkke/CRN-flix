import { TicketOperation, TicketOperationKind } from '@crn-flix/contracts';

const IMDB_PATTERN = /tt\d{7,}/;
const URL_PATTERN = /https?:\/\/\S+/g;

/** A metadata source's page reference found in a text (`MetadataSource.findReference`). */
export type ReferenceFinder = (text: string) => string | null;

/**
 * Free-form admin text → operation, constrained to what the ticket accepts; shared by
 * every text-based admin surface. A download link wins when links are accepted (a grab
 * link may carry a tt... in its query params); IMDb and metadata pages are never links.
 * Otherwise the identity is what the text names: an IMDb id (bare or in an IMDb URL),
 * a metadata page, or both.
 */
export function parseMessageOperation(
  content: string,
  allowed: TicketOperationKind[],
  findReference: ReferenceFinder,
): TicketOperation | null {
  const link = (content.match(URL_PATTERN) ?? []).find((url) => !url.includes('imdb.com') && !findReference(url));
  if (allowed.includes('submitLink') && link) {
    return { kind: 'submitLink', url: link };
  }

  const imdbId = content.match(IMDB_PATTERN)?.[0] ?? null;
  const reference = findReference(content);
  if (allowed.includes('submitIdentity') && (imdbId || reference)) {
    return { kind: 'submitIdentity', imdbId, reference };
  }

  return null;
}

/** Spontaneous (non-reply) admin message → the URL that opens a manual-download ticket. */
export function parseSpontaneousUrl(content: string): string | null {
  return content.match(URL_PATTERN)?.[0] ?? null;
}
