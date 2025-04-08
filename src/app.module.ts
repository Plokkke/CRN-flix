import { Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from '@plokkke/nest-health-registry';
import { z } from 'zod';

import { AppService } from '@/app.service';
import { MailingController } from '@/controllers/MailingController';
import { UsersController } from '@/controllers/UsersController';
import { EnvironmentVariables } from '@/environment';
import { jellyfinConfigSchema } from '@/modules/jellyfin/jellyfin';
import { configSchema as traktConfigSchema } from '@/modules/trakt/api';
import { contextProvider } from '@/providers/context';
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
import { configSchema as mailingConfigSchema } from '@/services/messaging/user/email';
import { configSchema as syncConfigSchema } from '@/services/sync';

export const configSchema = z.object({
  name: z.string(),
  server: z.object({
    url: z.string(),
  }),
  trakt: traktConfigSchema,
  sync: syncConfigSchema,
  'sync-datasource': syncDataSourceConfigSchema,
  jellyfin: jellyfinConfigSchema,
  mailing: mailingConfigSchema,
  discord: discordConfigSchema,
  administration: z.object({
    discordChannelId: z.string(),
    adminIds: z.array(z.string().min(1)).min(1),
  }),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: EnvironmentVariables): Config {
  return configSchema.parse({
    name: 'CRN-Flix',
    server: {
      url: env.server.url,
    },
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
    imports: [ConfigModule.forRoot({ load: [() => loadConfig(env)] }), HealthModule],
    controllers: [UsersController, MailingController],
    providers: [
      AppService,
      contextProvider,
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
