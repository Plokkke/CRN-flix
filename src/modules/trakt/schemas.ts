import { z } from 'zod';

import { isoDateSchema } from '@/schemas';

import { ACTIVITY_TYPES, MEDIA_TYPES } from './constants';

export const mediaTypeSchema = z.enum(MEDIA_TYPES);

export const mediaIdsSchema = z.object({
  trakt: z.number().int(),
  slug: z.string().optional(),
  imdb: z.string().nullable().optional(),
  tmdb: z.number().int().nullable().optional(),
  tvdb: z.number().int().nullable().optional(),
  tvrage: z.number().int().nullable().optional(),
});

export const movieSchema = z.object({
  title: z.string(),
  year: z.number().int().nullable(),
  ids: mediaIdsSchema,
});

export const movieDetailsSchema = movieSchema.extend({
  overview: z.string().nullable(),
  released: isoDateSchema.nullable(),
  runtime: z.number().int().nonnegative().nullable(),
  status: z.string().nullable(),
});

export const showSchema = z.object({
  title: z.string(),
  year: z.number().int().nullable(),
  ids: mediaIdsSchema,
});

export const showDetailsSchema = showSchema.extend({
  overview: z.string().nullable(),
  first_aired: isoDateSchema.nullable().optional(),
  last_aired: isoDateSchema.nullable().optional(),
  runtime: z.number().int().nonnegative().nullable(),
  network: z.string().nullable(),
  status: z.string().nullable(),
  rating: z.number().nullable(),
  votes: z.number().int().nullable(),
  aired_episodes: z.number().int().nullable(),
});

export const seasonSchema = z.object({
  number: z.number().int(),
  ids: mediaIdsSchema,
});

export const episodeSchema = z.object({
  season: z.number().int(),
  number: z.number().int(),
  title: z.string(),
  ids: mediaIdsSchema,
});

export const seasonDetailsSchema = seasonSchema.extend({
  episodes: episodeSchema.array(),
});

const mediaAttrsSchema = z.object({
  type: mediaTypeSchema,
});

const mediaMovieSchema = mediaAttrsSchema.extend({
  type: z.literal('movie'),
  movie: movieSchema,
});

const mediaShowSchema = mediaAttrsSchema.extend({
  type: z.literal('show'),
  show: showSchema,
});

const mediaSeasonSchema = mediaAttrsSchema.extend({
  type: z.literal('season'),
  show: showSchema,
  season: seasonSchema,
});

const mediaEpisodeSchema = mediaAttrsSchema.extend({
  type: z.literal('episode'),
  show: showSchema,
  episode: episodeSchema,
});

export const mediaSchema = z.discriminatedUnion('type', [
  mediaMovieSchema,
  mediaShowSchema,
  mediaSeasonSchema,
  mediaEpisodeSchema,
]);

const mediaMovieDetailsSchema = mediaAttrsSchema.extend({
  type: z.literal('movie'),
  movie: movieDetailsSchema,
});

const mediaShowDetailsSchema = mediaAttrsSchema.extend({
  type: z.literal('show'),
  show: showDetailsSchema,
});

const mediaSeasonDetailsSchema = mediaAttrsSchema.extend({
  type: z.literal('season'),
  show: showDetailsSchema,
  season: seasonSchema,
});

const mediaEpisodeDetailsSchema = mediaAttrsSchema.extend({
  type: z.literal('episode'),
  show: showDetailsSchema,
  episode: episodeSchema,
});

export const mediaDetailsSchema = z.discriminatedUnion('type', [
  mediaMovieDetailsSchema,
  mediaShowDetailsSchema,
  mediaSeasonDetailsSchema,
  mediaEpisodeDetailsSchema,
]);

export const releasedMediaSchema = mediaSchema.refine((val) => {
  const currentYear = new Date().getFullYear();
  const year = val.type === 'movie' ? val.movie.year : val.show.year;
  return year !== null && year <= currentYear;
});

export const listedAttrsSchema = z.intersection(
  mediaSchema,
  z.object({
    rank: z.number().int(),
    id: z.number().int(),
    listed_at: isoDateSchema,
    notes: z.string().nullable(),
  }),
);

export const ratedMediaSchema = z.intersection(
  mediaSchema,
  z.object({
    rating: z.number().int().min(1).max(10),
    rated_at: isoDateSchema,
  }),
);

export const userAuthContextSchema = z.object({
  id: z.string(),
  accessToken: z.string(),
});

export const authDevicePublicCtxtSchema = z.object({
  verification_url: z.string(),
  user_code: z.string(),
  expires_in: z.number().int(),
});

export const authDeviceCtxtSchema = authDevicePublicCtxtSchema.extend({
  device_code: z.string(),
  interval: z.number().int(),
});

export const userSettingsSchema = z.object({
  user: z.object({
    username: z.string(),
    name: z.string(),
    vip: z.boolean(),
    ids: z.object({
      slug: z.string(),
      uuid: z.string(),
    }),
  }),
});

export const watchedShowSchema = z.object({
  plays: z.number().int(),
  last_watched_at: isoDateSchema,
  last_updated_at: isoDateSchema,
  reset_at: isoDateSchema.nullable(),
  show: showSchema,
});

export const hiddenShowSchema = z.object({
  hidden_at: isoDateSchema,
  show: showSchema,
});

const progressEpisodeSchema = z.object({
  number: z.number(),
  completed: z.boolean(),
  last_watched_at: z.string().nullable(),
});

const progressSeasonSchema = z.object({
  number: z.number(),
  title: z.string().nullable(),
  aired: z.number(),
  completed: z.number(),
  episodes: z.array(progressEpisodeSchema),
});

export const progressShowSchema = z.object({
  aired: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  last_watched_at: isoDateSchema.nullable(),
  reset_at: isoDateSchema.nullable(),
  seasons: z.array(progressSeasonSchema),
  hidden_seasons: z.array(z.unknown()),
  next_episode: episodeSchema.nullable(),
  last_episode: episodeSchema.nullable(),
});

export const deviceTokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
});

export const activityTypeSchema = z.enum(ACTIVITY_TYPES);

export const lastActivitiesSchema = z.object({
  all: isoDateSchema,
  movies: z.object({
    watched_at: isoDateSchema.nullable(),
    rated_at: isoDateSchema.nullable(),
    hidden_at: isoDateSchema.nullable(),
  }),
  episodes: z.object({
    watched_at: isoDateSchema.nullable(),
    rated_at: isoDateSchema.nullable(),
  }),
  shows: z.object({
    rated_at: isoDateSchema.nullable(),
    hidden_at: isoDateSchema.nullable(),
    dropped_at: isoDateSchema.nullable(),
  }),
  seasons: z.object({
    rated_at: isoDateSchema.nullable(),
    hidden_at: isoDateSchema.nullable(),
  }),
  lists: z.object({
    liked_at: isoDateSchema.nullable(),
  }),
  watchlist: z.object({
    updated_at: isoDateSchema.nullable(),
  }),
  favorites: z.object({
    updated_at: isoDateSchema.nullable(),
  }),
});
