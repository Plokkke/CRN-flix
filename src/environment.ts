import { z } from 'zod';

import { logger } from '@/services/logger';

export const environmentVariablesSchema = z
  .object({
    PORT: z.coerce.number(),
    TRAKT_HOST: z.string(),
    TRAKT_CLIENT_ID: z.string(),
    TRAKT_CLIENT_SECRET: z.string(),
    JELLYFIN_URL: z.string(),
    JELLYFIN_TOKEN: z.string().optional(),
    JELLYFIN_USERNAME: z.string().optional(),
    JELLYFIN_PASSWORD: z.string().optional(),
    DISCORD_CHANNEL_ID: z.string(),
    DISCORD_BOT_TOKEN: z.string(),
    DISCORD_ADMIN_IDS: z.string(),
    EMAIL_HOST: z.string(),
    EMAIL_PORT: z.coerce.number(),
    EMAIL_USER: z.string(),
    EMAIL_PASSWORD: z.string(),
    EMAIL_FROM: z.string(),
  })
  .transform((env) => ({
    server: {
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
      username: env.JELLYFIN_USERNAME,
      password: env.JELLYFIN_PASSWORD,
    },
    discord: {
      channelId: env.DISCORD_CHANNEL_ID,
      bot: {
        token: env.DISCORD_BOT_TOKEN,
      },
    },
    mailing: {
      host: env.EMAIL_HOST,
      port: env.EMAIL_PORT,
      user: env.EMAIL_USER,
      pass: env.EMAIL_PASSWORD,
      from: env.EMAIL_FROM,
    },
  }));

export type EnvironmentVariables = z.infer<typeof environmentVariablesSchema>;

export function loadEnv(): EnvironmentVariables {
  const config = environmentVariablesSchema.parse(process.env);
  logger.debug(`Parsed environment variables ${JSON.stringify(config, null, 2)}`);
  return config;
}
