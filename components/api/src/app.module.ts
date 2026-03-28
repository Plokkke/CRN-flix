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
import { jdownloaderConfigSchema } from '@/modules/jdownloader/jdownloader-api.service';
import { jellyfinConfigSchema } from '@/modules/jellyfin/jellyfin';
import { tmdbConfigSchema } from '@/modules/tmdb/tmdb';
import { configSchema as traktConfigSchema } from '@/modules/trakt/api';
import { contextProvider } from '@/providers/context';
import { darkiworldProvider } from '@/providers/darkiworld';
import { repositoryProviders } from '@/providers/database';
import { discordProvider } from '@/providers/discord';
import { jdownloaderProvider } from '@/providers/jdownloader';
import { jellyfinProvider } from '@/providers/jellyfin';
import { mediaAvailabilityProvider } from '@/providers/media-availability';
import { adminMessagingProvider } from '@/providers/messaging/admin';
import { allUserMessagingProvider } from '@/providers/messaging/all';
import { userMessagingProviders } from '@/providers/messaging/user';
import { postDownloadProviders } from '@/providers/post-download';
import { syncProvider } from '@/providers/request-synchronizer';
import { syncDataSourceConfigSchema, syncDataSourceProvider } from '@/providers/syncDataSource';
import { tmdbProvider } from '@/providers/tmdb';
import { traktProvider } from '@/providers/trakt';
import { traktPluginProvider } from '@/providers/traktPlugin';
import { MemoryCacheService } from '@/services/cache/memory-cache.service';
import { mediaPathsConfigSchema } from '@/services/media-labelizer';
import { configSchema as mailingConfigSchema } from '@/services/messaging/user/email';
import { syncConfigSchema } from '@/services/request-synchronizer';

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
  jdownloader: jdownloaderConfigSchema,
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
    jdownloader: env.jdownloader,
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
      syncProvider,
      mediaAvailabilityProvider,
      jellyfinProvider,
      traktPluginProvider,
      discordProvider,
      darkiworldProvider,
      ...userMessagingProviders,
      allUserMessagingProvider,
      adminMessagingProvider,
      jdownloaderProvider,
      tmdbProvider,
      ...postDownloadProviders,
    ],
  })
  class App implements NestModule {
    configure(): void {}
  }

  return App;
}
