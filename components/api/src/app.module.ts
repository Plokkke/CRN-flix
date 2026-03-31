import { Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from '@plokkke/nest-health-registry';
import { z } from 'zod';

import { AppService } from '@/app.service';
import { AdminController } from '@/controllers/AdminController';
import { AssetsController } from '@/controllers/AssetsController';
import { MailingController } from '@/controllers/MailingController';
import { UserGuideController } from '@/controllers/UserGuideController';
import { UsersController } from '@/controllers/UsersController';
import { EnvironmentVariables } from '@/environment';
import { configSchema as darkiworldConfigSchema } from '@/modules/darkiworld/api';
import { discordConfigSchema } from '@/modules/discord/discord';
import { jellyfinConfigSchema } from '@/modules/jellyfin/jellyfin';
import { tmdbConfigSchema } from '@/modules/tmdb/tmdb';
import { configSchema as traktConfigSchema } from '@/modules/trakt/api';
import { contextProvider } from '@/providers/context';
import { darkiworldProvider } from '@/providers/darkiworld';
import { darkiworldSyncProvider } from '@/providers/darkiworld-sync';
import { repositoryProviders } from '@/providers/database';
import { discordProvider } from '@/providers/discord';
import { fetchrSyncProvider } from '@/providers/fetchr-sync';
import { postDownloadProviders } from '@/providers/post-download';
import { jellyfinProvider } from '@/providers/jellyfin';
import { jellyfinSyncProvider } from '@/providers/jellyfin-sync';
import { adminMessagingProvider } from '@/providers/messaging/admin';
import { allUserMessagingProvider } from '@/providers/messaging/all';
import { userMessagingProviders } from '@/providers/messaging/user';
import { syncDataSourceConfigSchema, syncDataSourceProvider } from '@/providers/syncDataSource';
import { tmdbProvider } from '@/providers/tmdb';
import { traktProvider } from '@/providers/trakt';
import { traktSyncProvider } from '@/providers/trakt-sync';
import { traktPluginProvider } from '@/providers/traktPlugin';
import { MemoryCacheService } from '@/services/cache/memory-cache.service';
import { mediaPathsConfigSchema } from '@/services/media-labelizer';
import { configSchema as mailingConfigSchema } from '@/services/messaging/user/email';
import { syncConfigSchema } from '@/services/trakt-sync';

export const configSchema = z.object({
  name: z.string(),
  server: z.object({
    url: z.string(),
  }),
  trakt: traktConfigSchema,
  sync: syncConfigSchema,
  datasource: syncDataSourceConfigSchema,
  jellyfin: jellyfinConfigSchema,
  mailing: mailingConfigSchema,
  discord: discordConfigSchema,
  darkiworld: darkiworldConfigSchema,
  fetchr: z.object({
    url: z.string(),
    downloadsPrefix: z.string(),
  }),
  tmdb: tmdbConfigSchema,
  mediaPaths: mediaPathsConfigSchema,
  administration: z.object({
    discordChannelId: z.string(),
    adminIds: z.array(z.string().min(1)).min(1),
  }),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: EnvironmentVariables): Config {
  return configSchema.parse({
    name: env.name,
    server: {
      url: env.server.url,
    },
    trakt: env.trakt,
    sync: {},
    datasource: {
      host: env.database.host,
      port: env.database.port,
      database: env.database.name,
      username: env.database.username,
      password: env.database.password,
      ssl: false,
    },
    jellyfin: env.jellyfin,
    discord: env.discord,
    darkiworld: env.darkiworld,
    fetchr: env.fetchr,
    tmdb: env.tmdb,
    mediaPaths: env.mediaPaths,
    administration: {
      adminIds: env.server.adminIds,
      discordChannelId: env.discord.channelId,
    },
    mailing: env.mailing,
  });
}

export function configureAppModule(env: EnvironmentVariables): new () => NestModule {
  @Module({
    imports: [ConfigModule.forRoot({ load: [() => loadConfig(env)] }), ScheduleModule.forRoot(), HealthModule],
    controllers: [UsersController, MailingController, UserGuideController, AssetsController, AdminController],
    providers: [
      MemoryCacheService,
      AppService,
      contextProvider,
      traktProvider,
      syncDataSourceProvider,
      ...repositoryProviders,
      traktSyncProvider,
      jellyfinSyncProvider,
      darkiworldSyncProvider,
      jellyfinProvider,
      traktPluginProvider,
      discordProvider,
      darkiworldProvider,
      ...userMessagingProviders,
      allUserMessagingProvider,
      adminMessagingProvider,
      fetchrSyncProvider,
      tmdbProvider,
      ...postDownloadProviders,
    ],
  })
  class App implements NestModule {
    configure(): void {}
  }

  return App;
}
