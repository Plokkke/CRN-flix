import { z } from 'zod';

export const hydrackerTitleSchema = z.object({
  id: z.number(),
  name: z.string(),
  original_title: z.string().nullable().optional(),
  type: z.string().optional(),
  is_series: z.boolean().optional(),
  imdb_id: z.string().nullable(),
  tmdb_id: z.number().nullable(),
  have_link: z.number().optional(),
  year: z.number().nullable().optional(),
  poster: z.string().nullable(),
  rating: z.number().nullable().optional(),
});

export const hydrackerSearchResponseSchema = z.object({
  status: z.string().optional(),
  query: z.string(),
  results: z.array(hydrackerTitleSchema),
});

export type HydrackerTitle = z.infer<typeof hydrackerTitleSchema>;

export type HydrackerSearchResponse = z.infer<typeof hydrackerSearchResponseSchema>;
