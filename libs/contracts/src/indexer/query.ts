export function sanitizeForSearch(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deduplicated search queries from the titles an indexer wants to try, in that order,
 * then the same titles suffixed with the year. Empty and duplicate titles are skipped,
 * so an indexer can list every title it knows and let the data decide.
 */
export function buildSearchQueries(titles: ReadonlyArray<string | null | undefined>, year: number | null): string[] {
  const distinct = [...new Set(titles.map((title) => (title ? sanitizeForSearch(title) : '')).filter(Boolean))];
  const withYear = year ? distinct.map((title) => `${title} ${year}`) : [];
  return [...distinct, ...withYear];
}

/** Whether two titles are the same once accents, punctuation and case are ignored. */
export function isSameTitle(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) {
    return false;
  }
  return sanitizeForSearch(a).toLowerCase() === sanitizeForSearch(b).toLowerCase();
}
