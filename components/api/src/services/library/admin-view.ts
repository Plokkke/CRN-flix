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
  imdbIds: string[];
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

/** One row per title of the store: titles on no shelf first (they need a decision), then by title. */
export function buildLibraryView(input: LibraryViewInput): LibraryRow[] {
  const choices = new Map(input.overrides.map((override) => [override.imdbId, override]));
  const rows = input.imdbIds.map((imdbId): LibraryRow => {
    const shared = input.sharedOf(imdbId);
    const personal = input.grantsOf(imdbId);
    const choice = choices.get(imdbId);
    return {
      imdbId,
      title: input.titleOf(imdbId),
      computed: computedLabel(input.computedOf(imdbId)),
      choice: choice ? { shelf: choice.shelf, origin: choice.origin } : null,
      shared,
      personal: personal.map((userId) => ({ userId, name: input.userNameOf(userId) })),
      unplaced: shared === null && personal.length === 0,
    };
  });
  return rows.sort(
    (a, b) => Number(b.unplaced) - Number(a.unplaced) || a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }),
  );
}
