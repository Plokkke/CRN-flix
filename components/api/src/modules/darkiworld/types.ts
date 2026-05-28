import { z } from 'zod';

import { darkiworldSearchResponseSchema, darkiworldTitleSchema } from './schemas';

export type DarkiworldTitle = z.infer<typeof darkiworldTitleSchema>;

export type DarkiworldSearchResponse = z.infer<typeof darkiworldSearchResponseSchema>;

export type ListLinksOptions = {
  season?: number;
  episode?: number;
  quality?: number;
  lang?: number;
  host?: number;
};

export type DarkiworldAvailability =
  | { status: 'available'; title: DarkiworldTitle; downloadUrl: string }
  | { status: 'not-found' }
  | { status: 'unknown'; reason: string };
