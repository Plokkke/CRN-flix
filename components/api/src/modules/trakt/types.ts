import { z } from 'zod';

import { MEDIA_CATEGORIES, MEDIA_TYPES } from './constants';
import {
  authDeviceCtxtSchema,
  authDevicePublicCtxtSchema,
  deviceTokenSchema,
  episodeSchema,
  hiddenShowSchema,
  mediaDetailsSchema,
  mediaSchema,
  movieDetailsSchema,
  movieSchema,
  progressShowSchema,
  releasedMediaSchema,
  seasonDetailsSchema,
  seasonSchema,
  showDetailsSchema,
  showSchema,
  userAuthContextSchema,
  userSettingsSchema,
  watchedShowSchema,
  lastActivitiesSchema,
  activityTypeSchema,
} from './schemas';

export type Movie = z.infer<typeof movieSchema>;
export type MovieDetails = z.infer<typeof movieDetailsSchema>;
export type Show = z.infer<typeof showSchema>;
export type ShowDetails = z.infer<typeof showDetailsSchema>;
export type Season = z.infer<typeof seasonSchema>;
export type SeasonDetails = z.infer<typeof seasonDetailsSchema>;
export type Episode = z.infer<typeof episodeSchema>;
export type Media = z.infer<typeof mediaSchema>;
export type MediaDetails = z.infer<typeof mediaDetailsSchema>;
export type WantedMedia = { media: Media; userIds: string[] };
export type ReleasedMedia = z.infer<typeof releasedMediaSchema>;

export type MediaType = (typeof MEDIA_TYPES)[number];
export type MediaCategory = (typeof MEDIA_CATEGORIES)[number];

export type UserAuthCtxt = z.infer<typeof userAuthContextSchema>;
export type AuthDeviceCtxt = z.infer<typeof authDeviceCtxtSchema>;
export type AuthDevicePublicCtxt = z.infer<typeof authDevicePublicCtxtSchema>;
export type UserSettings = z.infer<typeof userSettingsSchema>;
export type WatchedShow = z.infer<typeof watchedShowSchema>;
export type HiddenShow = z.infer<typeof hiddenShowSchema>;
export type ProgressShowNoDetails = z.infer<typeof progressShowSchema>;
export type ProgressShow = ProgressShowNoDetails & { show: Show };
export type DeviceToken = z.infer<typeof deviceTokenSchema>;
export type ActivityType = z.infer<typeof activityTypeSchema>;
export type LastActivities = z.infer<typeof lastActivitiesSchema>;
