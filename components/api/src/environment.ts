import * as path from 'path';

import { z } from 'zod';

import { Host, Language, Quality, SizePolicy } from '@/modules/indexer/preferences';
import { logger } from '@/services/logger';

function parseCsv<T extends string>(value: string, allowed: readonly T[]): T[] {
  if (!value.trim()) {
    return [];
  }
  const allowedSet = new Set<string>(allowed);
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && allowedSet.has(s)) as T[];
}

function parseBytesPerMinute(json: string): SizePolicy['bytesPerMinute'] {
  if (!json.trim()) {
    return {};
  }
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null) {
    return {};
  }
  const result: SizePolicy['bytesPerMinute'] = {};
  const validQualities = new Set<string>(Object.values(Quality));
  for (const [key, value] of Object.entries(parsed)) {
    if (validQualities.has(key) && typeof value === 'number' && value > 0) {
      result[key as Quality] = value;
    }
  }
  return result;
}

export const environmentVariablesSchema = z
  .object({
    SERVER_URL: z.string(),
    PORT: z.coerce.number(),
    SERVICE_NAME: z.string(),
    TRAKT_HOST: z.string(),
    TRAKT_CLIENT_ID: z.string(),
    TRAKT_CLIENT_SECRET: z.string(),
    JELLYFIN_URL: z.string(),
    JELLYFIN_TOKEN: z.string().optional(),
    DISCORD_CHANNEL_ID: z.string(),
    DISCORD_BOT_TOKEN: z.string(),
    DISCORD_ADMIN_IDS: z.string(),
    GMAIL_USER: z.string(),
    GMAIL_PASSWORD: z.string(),
    DATABASE_HOST: z.string(),
    DATABASE_PORT: z.coerce.number(),
    DATABASE_NAME: z.string(),
    DATABASE_USERNAME: z.string(),
    DATABASE_PASSWORD: z.string(),
    HYDRACKER_API_KEY: z.string().optional(),
    HYDRACKER_HOST: z.string().optional(),
    HYDRACKER_CONTACT_EMAIL: z.string().optional(),
    INDEXER_ALLOWED_QUALITIES: z.string().default(''),
    INDEXER_ALLOWED_LANGUAGES: z.string().default(''),
    INDEXER_ALLOWED_HOSTS: z.string().default(''),
    INDEXER_SIZE_TOLERANCE: z.coerce.number().default(1),
    INDEXER_BYTES_PER_MIN_JSON: z.string().default(''),
    FETCHR_URL: z.string(),
    FETCHR_API_KEY: z.string().optional(),
    FETCHR_DOWNLOADS_PREFIX: z.string().default('/downloads'),
    TMDB_API_KEY: z.string(),
    DOWNLOADS_PATH: z.string(),
    MEDIAS_PATH: z.string(),
    MOVIES_FOLDER: z.string().default('movies'),
    SERIES_FOLDER: z.string().default('series'),
    PRIVATE_FOLDER: z.string().default('private'),
    JELLYFIN_LIBRARY_ROOT: z.string().default('/medias'),
  })
  .transform((env) => ({
    name: env.SERVICE_NAME,
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
    mailing: {
      serviceName: env.SERVICE_NAME,
      gmailUser: env.GMAIL_USER,
      gmailPassword: env.GMAIL_PASSWORD,
    },
    database: {
      host: env.DATABASE_HOST,
      port: env.DATABASE_PORT,
      name: env.DATABASE_NAME,
      username: env.DATABASE_USERNAME,
      password: env.DATABASE_PASSWORD,
    },
    indexer: {
      hydracker:
        env.HYDRACKER_API_KEY && env.HYDRACKER_HOST
          ? {
              apiKey: env.HYDRACKER_API_KEY,
              host: env.HYDRACKER_HOST,
              ...(env.HYDRACKER_CONTACT_EMAIL && { contactEmail: env.HYDRACKER_CONTACT_EMAIL }),
            }
          : null,
      preferences: {
        allowedQualities: parseCsv(env.INDEXER_ALLOWED_QUALITIES, Object.values(Quality)),
        allowedLanguages: parseCsv(env.INDEXER_ALLOWED_LANGUAGES, Object.values(Language)),
        allowedHosts: parseCsv(env.INDEXER_ALLOWED_HOSTS, Object.values(Host)),
        sizePolicy: {
          bytesPerMinute: parseBytesPerMinute(env.INDEXER_BYTES_PER_MIN_JSON),
          tolerance: env.INDEXER_SIZE_TOLERANCE,
        },
      },
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
      privateMovies: path.join(env.MEDIAS_PATH, env.PRIVATE_FOLDER, env.MOVIES_FOLDER),
      privateSeries: path.join(env.MEDIAS_PATH, env.PRIVATE_FOLDER, env.SERIES_FOLDER),
    },
    namingAudit: {
      jellyfinLibraryRoot: env.JELLYFIN_LIBRARY_ROOT,
      engineMediasPath: env.MEDIAS_PATH,
    },
  }));

export type EnvironmentVariables = z.infer<typeof environmentVariablesSchema>;

export function loadEnv(): EnvironmentVariables {
  const config = environmentVariablesSchema.parse(process.env);
  logger.debug(`Parsed environment variables ${JSON.stringify(config, null, 2)}`);
  return config;
}
