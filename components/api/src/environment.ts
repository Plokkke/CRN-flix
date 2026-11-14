import * as path from 'path';

import { z } from 'zod';

import { preferencesFromEnv } from '@/modules/indexer/preferences-env';
import { logger } from '@/services/logger';

export const environmentVariablesSchema = z
  .object({
    SERVER_URL: z.string(),
    PORT: z.coerce.number(),
    SERVICE_NAME: z.string(),
    /** `file`: requests and playheads read from CATALOG_FILE (local sandbox only, refused in production). */
    CATALOG: z.enum(['trakt', 'file']).default('trakt'),
    CATALOG_FILE: z.string().optional(),
    TRAKT_HOST: z.string(),
    TRAKT_CLIENT_ID: z.string(),
    TRAKT_CLIENT_SECRET: z.string(),
    JELLYFIN_URL: z.string(),
    JELLYFIN_TOKEN: z.string().optional(),
    /** `console`: tickets and admin login codes go to the logs (local sandbox only, refused in production). */
    ADMIN_CHANNEL: z.enum(['discord', 'console']).default('discord'),
    DISCORD_CHANNEL_ID: z.string().default(''),
    DISCORD_BOT_TOKEN: z.string().default(''),
    /** The admins' ids on the admin channel (Discord user ids; any name with the console channel). */
    DISCORD_ADMIN_IDS: z.string(),
    GMAIL_USER: z.string().default(''),
    GMAIL_PASSWORD: z.string().default(''),
    /** Local sandbox: emails are written to this folder instead of being sent (refused in production). */
    USER_MESSAGING_OUTBOX: z.string().optional(),
    /** `dry-run` logs what would reach users without sending nor recording anything. */
    USER_MESSAGING: z.enum(['send', 'dry-run']),
    /** Subscribers are only messaged outside this window (login codes excepted). */
    USER_MESSAGING_QUIET_HOURS: z.string().default('00:00-07:00'),
    USER_MESSAGING_TIMEZONE: z.string().default('Europe/Paris'),
    KIDS_MAX_PARENTAL_RATING: z.coerce.number().int().min(0).default(10),
    DATABASE_HOST: z.string(),
    DATABASE_PORT: z.coerce.number(),
    DATABASE_NAME: z.string(),
    DATABASE_USERNAME: z.string(),
    DATABASE_PASSWORD: z.string(),
    SYNC_RATING_THRESHOLD: z.coerce.number().optional(),
    SYNC_NEED_WINDOW_HOURS: z.coerce.number().optional(),
    SYNC_MAX_WINDOW_HOURS: z.coerce.number().optional(),
    SYNC_FULL_INTERVAL_HOURS: z.coerce.number().optional(),
    LOADIX_API_HOST: z.string().optional(),
    LOADIX_SITE_HOST: z.string().optional(),
    INDEXER_ALLOWED_QUALITIES: z.string().default(''),
    INDEXER_ALLOWED_LANGUAGES: z.string().default(''),
    INDEXER_ALLOWED_HOSTS: z.string().default(''),
    INDEXER_SIZE_TOLERANCE: z.coerce.number().default(1),
    INDEXER_BYTES_PER_MIN_JSON: z.string().default(''),
    /** `fake`: downloads are copies of FAKE_DOWNLOADER_SAMPLE (local sandbox only, refused in production). */
    DOWNLOADER: z.enum(['fetchr', 'fake']).default('fetchr'),
    FAKE_DOWNLOADER_SAMPLE: z.string().optional(),
    FAKE_DOWNLOADER_DURATION_MS: z.coerce.number().int().min(0).default(10_000),
    FETCHR_URL: z.string().default(''),
    FETCHR_API_KEY: z.string().optional(),
    FETCHR_DOWNLOADS_PREFIX: z.string().default('/downloads'),
    TMDB_API_KEY: z.string(),
    DOWNLOADS_PATH: z.string(),
    MEDIAS_PATH: z.string(),
    MOVIES_FOLDER: z.string().default('movies'),
    SERIES_FOLDER: z.string().default('series'),
    JELLYFIN_LIBRARY_ROOT: z.string().default('/medias'),
  })
  .superRefine((env, ctx) => {
    if (env.ADMIN_CHANNEL === 'discord' && (!env.DISCORD_CHANNEL_ID || !env.DISCORD_BOT_TOKEN)) {
      ctx.addIssue({
        code: 'custom',
        message: 'DISCORD_CHANNEL_ID and DISCORD_BOT_TOKEN are required with ADMIN_CHANNEL=discord',
      });
    }
    if (!env.USER_MESSAGING_OUTBOX && (!env.GMAIL_USER || !env.GMAIL_PASSWORD)) {
      ctx.addIssue({
        code: 'custom',
        message: 'GMAIL_USER and GMAIL_PASSWORD are required without USER_MESSAGING_OUTBOX',
      });
    }
    if (env.USER_MESSAGING_OUTBOX && process.env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        message: 'USER_MESSAGING_OUTBOX keeps every email on disk: refused in production',
      });
    }
    if (env.DOWNLOADER === 'fetchr' && !env.FETCHR_URL) {
      ctx.addIssue({ code: 'custom', message: 'FETCHR_URL is required with DOWNLOADER=fetchr' });
    }
    if (env.DOWNLOADER === 'fake' && !env.FAKE_DOWNLOADER_SAMPLE) {
      ctx.addIssue({ code: 'custom', message: 'FAKE_DOWNLOADER_SAMPLE is required with DOWNLOADER=fake' });
    }
    if (env.DOWNLOADER === 'fake' && process.env.NODE_ENV === 'production') {
      ctx.addIssue({ code: 'custom', message: 'DOWNLOADER=fake downloads nothing: refused in production' });
    }
    if (env.CATALOG === 'file' && !env.CATALOG_FILE) {
      ctx.addIssue({ code: 'custom', message: 'CATALOG_FILE is required with CATALOG=file' });
    }
    if (env.CATALOG === 'file' && process.env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        message: 'CATALOG=file would replace every user’s requests with a file: refused in production',
      });
    }
    if (env.ADMIN_CHANNEL === 'console' && process.env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        message: 'ADMIN_CHANNEL=console prints admin login codes to the logs: refused in production',
      });
    }
  })
  .transform((env) => ({
    name: env.SERVICE_NAME,
    adminChannel: env.ADMIN_CHANNEL,
    downloader:
      env.DOWNLOADER === 'fake'
        ? {
            kind: 'fake' as const,
            samplePath: env.FAKE_DOWNLOADER_SAMPLE!,
            durationMs: env.FAKE_DOWNLOADER_DURATION_MS,
          }
        : { kind: 'fetchr' as const },
    catalog: env.CATALOG === 'file' ? { kind: 'file' as const, file: env.CATALOG_FILE! } : { kind: 'trakt' as const },
    server: {
      url: env.SERVER_URL,
      port: env.PORT,
      adminIds: env.DISCORD_ADMIN_IDS.split(','),
    },
    trakt: {
      host: env.TRAKT_HOST,
      clientId: env.TRAKT_CLIENT_ID,
      clientSecret: env.TRAKT_CLIENT_SECRET,
    },
    sync: {
      ...(env.SYNC_RATING_THRESHOLD !== undefined && { ratingThreshold: env.SYNC_RATING_THRESHOLD }),
      ...(env.SYNC_NEED_WINDOW_HOURS !== undefined && { needWindowHours: env.SYNC_NEED_WINDOW_HOURS }),
      ...(env.SYNC_MAX_WINDOW_HOURS !== undefined && { maxWindowHours: env.SYNC_MAX_WINDOW_HOURS }),
      ...(env.SYNC_FULL_INTERVAL_HOURS !== undefined && { fullSyncIntervalHours: env.SYNC_FULL_INTERVAL_HOURS }),
    },
    jellyfin: {
      url: env.JELLYFIN_URL,
      token: env.JELLYFIN_TOKEN,
    },
    discord: {
      channelId: env.DISCORD_CHANNEL_ID,
      bot: {
        token: env.DISCORD_BOT_TOKEN,
      },
    },
    userMessaging: {
      mode: env.USER_MESSAGING,
      quietHours: { window: env.USER_MESSAGING_QUIET_HOURS, timeZone: env.USER_MESSAGING_TIMEZONE },
    },
    mailing: {
      serviceName: env.SERVICE_NAME,
      gmailUser: env.GMAIL_USER,
      gmailPassword: env.GMAIL_PASSWORD,
      outbox: env.USER_MESSAGING_OUTBOX ?? null,
    },
    database: {
      host: env.DATABASE_HOST,
      port: env.DATABASE_PORT,
      name: env.DATABASE_NAME,
      username: env.DATABASE_USERNAME,
      password: env.DATABASE_PASSWORD,
    },
    indexer: {
      loadix:
        env.LOADIX_API_HOST && env.LOADIX_SITE_HOST
          ? {
              apiHost: env.LOADIX_API_HOST,
              siteHost: env.LOADIX_SITE_HOST,
            }
          : null,
      preferences: preferencesFromEnv(env),
    },
    fetchr: {
      url: env.FETCHR_URL,
      apiKey: env.FETCHR_API_KEY,
      downloadsPrefix: env.FETCHR_DOWNLOADS_PREFIX,
    },
    tmdb: {
      apiKey: env.TMDB_API_KEY,
    },
    mediaPaths: {
      downloads: env.DOWNLOADS_PATH,
      movies: path.join(env.MEDIAS_PATH, env.MOVIES_FOLDER),
      series: path.join(env.MEDIAS_PATH, env.SERIES_FOLDER),
    },
    library: {
      mediasPath: env.MEDIAS_PATH,
      moviesFolder: env.MOVIES_FOLDER,
      seriesFolder: env.SERIES_FOLDER,
      playerRoot: env.JELLYFIN_LIBRARY_ROOT,
      kidsMaxParentalRating: env.KIDS_MAX_PARENTAL_RATING,
    },
    namingAudit: {
      jellyfinLibraryRoot: env.JELLYFIN_LIBRARY_ROOT,
      engineMediasPath: env.MEDIAS_PATH,
      renamesAllowed: false,
    },
  }));

export type EnvironmentVariables = z.infer<typeof environmentVariablesSchema>;

export function loadEnv(): EnvironmentVariables {
  const config = environmentVariablesSchema.parse(process.env);
  logger.debug(`Parsed environment variables ${JSON.stringify(config, null, 2)}`);
  return config;
}
