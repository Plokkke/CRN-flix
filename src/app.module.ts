import { Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { z } from 'zod';

import { AppService } from '@/app.service';
import { UsersController } from '@/controllers/UsersController';
import { EnvironmentVariables } from '@/environment';
import { jellyfinConfigSchema } from '@/modules/jellyfin/jellyfin';
import { configSchema as traktConfigSchema } from '@/modules/trakt/TraktApi';
import { repositoryProviders } from '@/providers/database';
import { discordProvider } from '@/providers/discord';
import { jellyfinProvider } from '@/providers/jellyfin';
import { adminMessagingProvider } from '@/providers/messaging/admin';
import { allUserMessagingProvider } from '@/providers/messaging/all';
import { userMessagingProviders } from '@/providers/messaging/user';
import { syncProvider } from '@/providers/sync';
import { syncDataSourceConfigSchema, syncDataSourceProvider } from '@/providers/syncDataSource';
import { traktProvider } from '@/providers/trakt';
import { traktPluginProvider } from '@/providers/traktPlugin';
import { discordConfigSchema } from '@/services/discord';
import { configSchema as syncConfigSchema } from '@/services/sync';
import { configSchema as mailingConfigSchema } from '@/services/messaging/user/email';

export const configSchema = z.object({
  trakt: traktConfigSchema,
  sync: syncConfigSchema,
  'sync-datasource': syncDataSourceConfigSchema,
  jellyfin: jellyfinConfigSchema,
  discord: discordConfigSchema,
  administration: z.object({
    discordChannelId: z.string(),
    adminIds: z.array(z.string().min(1)).min(1),
  }),
  mailing: mailingConfigSchema,
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: EnvironmentVariables): Config {
  return configSchema.parse({
    trakt: env.trakt,
    sync: {},
    'sync-datasource': {
      database: 'trakt-sync',
      username: 'root',
      password: 'password',
      ssl: false,
    },
    jellyfin: env.jellyfin,
    discord: env.discord,
    administration: {
      adminIds: env.server.adminIds,
      discordChannelId: env.discord.channelId,
    },
    mailing: env.mailing,
  });
}

export function configureAppModule(env: EnvironmentVariables): new () => NestModule {
  @Module({
    imports: [ConfigModule.forRoot({ load: [() => loadConfig(env)] })],
    controllers: [UsersController],
    providers: [
      AppService,
      traktProvider,
      syncDataSourceProvider,
      ...repositoryProviders,
      syncProvider,
      jellyfinProvider,
      traktPluginProvider,
      discordProvider,
      ...userMessagingProviders,
      allUserMessagingProvider,
      adminMessagingProvider,
    ],
  })
  class App implements NestModule {
    configure(): void {}
  }

  return App;
}
