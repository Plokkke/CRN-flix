import { IndexerMedia } from './contract';

export function sanitizeForSearch(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Deduplicated search queries derived from titles and year, most specific last. */
export function buildSearchQueries(media: IndexerMedia): string[] {
  const seen = new Set<string>();
  const queries: string[] = [];

  const addQuery = (raw: string | null | undefined): void => {
    if (!raw) {
      return;
    }
    const sanitized = sanitizeForSearch(raw);
    if (sanitized && !seen.has(sanitized)) {
      seen.add(sanitized);
      queries.push(sanitized);
    }
  };

  addQuery(media.title);
  addQuery(media.originalTitle);

  if (media.year) {
    addQuery(`${media.title} ${media.year}`);
    if (media.originalTitle) {
      addQuery(`${media.originalTitle} ${media.year}`);
    }
  }

  return queries;
}
