import { LibrarySection } from '@crn-flix/contracts';
import { Placement } from '@crn-flix/policy';

import { ShelfOverride } from '@/services/database/library';

/** The shared shelves the admin can choose, plus `none`: off the shared shelves, personal shelves only. */
export const SHELF_CHOICES = ['standard', 'kids', 'none'] as const;
export type ShelfChoice = (typeof SHELF_CHOICES)[number];

export const SHELF_LABELS: Record<string, string> = {
  standard: 'Standard',
  kids: 'Kids',
  none: 'Aucune étagère partagée',
};

export type LibraryRow = {
  imdbId: string;
  title: string;
  section: LibrarySection;
  /** What the rules alone decide, and why when they restrict it. */
  computed: { label: string; reasons: string[] };
  /** The admin's choice, which prevails over the rules. */
  choice: { shelf: string; origin: ShelfOverride['origin'] } | null;
  /** Where the title actually is: its shared shelf, and who was granted it personally. */
  shared: string | null;
  personal: { userId: string; name: string }[];
  /** On no shelf at all: the file sits in the store, nobody sees it. */
  unplaced: boolean;
};

export type LibraryViewInput = {
  titles: { imdbId: string; section: LibrarySection }[];
  titleOf: (imdbId: string) => string;
  computedOf: (imdbId: string) => Placement | null;
  overrides: ShelfOverride[];
  /** The shared shelf the title is on now, null when on none. */
  sharedOf: (imdbId: string) => string | null;
  /** Users granted the title (it is on their personal shelf, unless they see it on a shared one). */
  grantsOf: (imdbId: string) => string[];
  userNameOf: (userId: string) => string;
};

function computedLabel(placement: Placement | null): LibraryRow['computed'] {
  switch (placement?.kind) {
    case undefined:
      return { label: 'Pas encore évalué', reasons: [] };
    case 'restricted':
      return {
        label: 'Restreint',
        reasons: placement.refusals.map((refusal) => `${refusal.ruleName} : ${refusal.summary}`),
      };
    case 'held':
      return { label: SHELF_LABELS.none, reasons: [] };
    case 'shelf':
      return { label: SHELF_LABELS[placement.shelf] ?? placement.shelf, reasons: [] };
  }
}

/** One row per title of the store, in no particular order (see `selectRows`). */
export function buildLibraryView(input: LibraryViewInput): LibraryRow[] {
  const choices = new Map(input.overrides.map((override) => [override.imdbId, override]));
  return input.titles.map(({ imdbId, section }): LibraryRow => {
    const shared = input.sharedOf(imdbId);
    const personal = input.grantsOf(imdbId);
    const choice = choices.get(imdbId);
    return {
      imdbId,
      title: input.titleOf(imdbId),
      section,
      computed: computedLabel(input.computedOf(imdbId)),
      choice: choice ? { shelf: choice.shelf, origin: choice.origin } : null,
      shared,
      personal: personal.map((userId) => ({ userId, name: input.userNameOf(userId) })),
      unplaced: shared === null && personal.length === 0,
    };
  });
}

export const LIBRARY_SORTS = ['attention', 'title', 'shelf', 'rules'] as const;
export const LIBRARY_STATES = ['unplaced', 'anomaly', 'restricted', 'imposed', 'personal'] as const;
export const LIBRARY_SHELF_FILTERS = ['standard', 'kids', 'none'] as const;

export type LibraryFilter = {
  q?: string;
  type?: LibrarySection;
  shelf?: (typeof LIBRARY_SHELF_FILTERS)[number];
  state?: (typeof LIBRARY_STATES)[number];
  sort: (typeof LIBRARY_SORTS)[number];
  page: number;
};

export const PAGE_SIZE = 100;

const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const isRestricted = (row: LibraryRow): boolean => row.computed.label === 'Restreint';

const STATE_TESTS: Record<(typeof LIBRARY_STATES)[number], (row: LibraryRow) => boolean> = {
  unplaced: (row) => row.unplaced,
  anomaly: (row) => row.choice?.origin === 'anomaly',
  restricted: isRestricted,
  imposed: (row) => row.choice !== null,
  personal: (row) => row.personal.length > 0,
};

/** What needs the admin first: on no shelf, held by an anomaly, restricted, imposed by hand, then the rest. */
const attentionRank = (row: LibraryRow): number =>
  row.unplaced ? 0 : row.choice?.origin === 'anomaly' ? 1 : isRestricted(row) ? 2 : row.choice ? 3 : 4;

const byTitle = (a: LibraryRow, b: LibraryRow): number => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' });

const SORTS: Record<LibraryFilter['sort'], (a: LibraryRow, b: LibraryRow) => number> = {
  attention: (a, b) => attentionRank(a) - attentionRank(b) || byTitle(a, b),
  title: byTitle,
  shelf: (a, b) => (a.shared ?? '~').localeCompare(b.shared ?? '~') || byTitle(a, b),
  rules: (a, b) => a.computed.label.localeCompare(b.computed.label, 'fr') || byTitle(a, b),
};

function matches(row: LibraryRow, filter: LibraryFilter): boolean {
  const query = filter.q ? fold(filter.q) : '';
  return (
    (!query || fold(row.title).includes(query) || row.imdbId.toLowerCase() === query) &&
    (!filter.type || row.section === filter.type) &&
    (!filter.shelf || (filter.shelf === 'none' ? row.shared === null : row.shared === filter.shelf)) &&
    (!filter.state || STATE_TESTS[filter.state](row))
  );
}

/** The page of rows the filter keeps, sorted, with how many it keeps in all. */
export function selectRows(rows: LibraryRow[], filter: LibraryFilter): { rows: LibraryRow[]; total: number } {
  const kept = rows.filter((row) => matches(row, filter)).sort(SORTS[filter.sort]);
  const start = (Math.max(1, filter.page) - 1) * PAGE_SIZE;
  return { rows: kept.slice(start, start + PAGE_SIZE), total: kept.length };
}

/** The filter as a query string, to keep it across pages and actions (empty values left out). */
export function filterQuery(filter: LibraryFilter, page = filter.page): string {
  const params = new URLSearchParams();
  Object.entries({ ...filter, page: page > 1 ? String(page) : '' }).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && !(key === 'sort' && value === 'attention')) {
      params.set(key, String(value));
    }
  });
  return params.toString();
}
