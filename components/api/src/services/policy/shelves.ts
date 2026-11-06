import { Shelf } from '@crn-flix/policy';

export const PROFILES = ['adult', 'kids'] as const;

export type Profile = (typeof PROFILES)[number];

/** The shared shelves, in classification order: a title goes on the first one whose rules it passes. */
export const SHELVES: Shelf[] = [
  { key: 'kids', profiles: ['adult', 'kids'] },
  { key: 'standard', profiles: ['adult'] },
];
