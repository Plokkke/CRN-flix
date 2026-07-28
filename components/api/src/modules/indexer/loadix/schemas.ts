import { z } from 'zod';

export const loadixSearchHitSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  originalTitle: z.string().nullable().optional(),
  year: z.number().nullable().optional(),
  hasLinks: z.boolean().optional(),
});

export const loadixSearchResponseSchema = z.object({
  hits: z.array(loadixSearchHitSchema),
});

export const loadixMediaDetailSchema = z.object({
  media: z.object({
    id: z.string(),
    type: z.string(),
    imdbId: z.string().nullable(),
    title: z.string(),
  }),
  seasons: z.array(
    z.object({
      id: z.string(),
      seasonNumber: z.number(),
    }),
  ),
});

export const loadixLinkSchema = z.object({
  id: z.string(),
  scope: z.string(),
  seasonNumber: z.number().nullable(),
  episodeNumber: z.number().nullable(),
  provider: z.string(),
  linkType: z.string(),
  quality: z.string(),
  language: z.string(),
  sizeBytes: z.string().nullable().optional(),
  releaseGroup: z.string().nullable().optional(),
  status: z.string(),
});

export const loadixLinksResponseSchema = z.object({
  items: z.array(loadixLinkSchema),
  total: z.number(),
});

export type LoadixSearchHit = z.infer<typeof loadixSearchHitSchema>;
export type LoadixMediaDetail = z.infer<typeof loadixMediaDetailSchema>;
export type LoadixLink = z.infer<typeof loadixLinkSchema>;
