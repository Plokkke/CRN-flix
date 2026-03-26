import { z } from 'zod';

import { logger } from '@/services/logger';

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
    SYNC_CRON: z.string(),
    CLICKUP_API_TOKEN: z.string(),
    CLICKUP_TEAM_ID: z.string(),
    CLICKUP_LIST_ID: z.string(),
    DARKIWORLD_API_KEY: z.string(),
    DARKIWORLD_HOST: z.string().default('https://darkiworld.com'),
  })
  .transform((env) => ({
    name: env.SERVICE_NAME,
    syncCron: env.SYNC_CRON,
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
    clickup: {
      apiToken: env.CLICKUP_API_TOKEN,
      teamId: env.CLICKUP_TEAM_ID,
      listId: env.CLICKUP_LIST_ID,
    },
    darkiworld: {
      apiKey: env.DARKIWORLD_API_KEY,
      host: env.DARKIWORLD_HOST,
    },
  }));

export type EnvironmentVariables = z.infer<typeof environmentVariablesSchema>;

export function loadEnv(): EnvironmentVariables {
  const config = environmentVariablesSchema.parse(process.env);
  logger.debug(`Parsed environment variables ${JSON.stringify(config, null, 2)}`);
  return config;
}
