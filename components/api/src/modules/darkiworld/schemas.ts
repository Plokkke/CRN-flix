import { z } from 'zod';

export const darkiworldTitleSchema = z.object({
  id: z.number(),
  name: z.string(),
  original_title: z.string().nullable(),
  type: z.string(),
  is_series: z.boolean(),
  imdb_id: z.string().nullable(),
  tmdb_id: z.number().nullable(),
  have_link: z.number(),
  year: z.number().nullable(),
  poster: z.string().nullable(),
  rating: z.number().nullable(),
});

export const darkiworldSearchResponseSchema = z.object({
  status: z.string(),
  query: z.string(),
  results: z.array(darkiworldTitleSchema),
});
