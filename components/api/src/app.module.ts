import { Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from '@plokkke/nest-health-registry';
import { z } from 'zod';

import { traktConfigSchema } from '@crn-flix/catalog-trakt';
import { Host, Language, Quality } from '@crn-flix/contracts';
import { discordConfigSchema } from '@crn-flix/discord';
import { fetchrConfigSchema } from '@crn-flix/downloader-fetchr';
import { loadixConfigSchema } from '@crn-flix/indexer-loadix';
import { emailConfigSchema } from '@crn-flix/messaging-user-email';
import { tmdbConfigSchema } from '@crn-flix/metadata-tmdb';
import { jellyfinConfigSchema } from '@crn-flix/player-jellyfin';

import { AppService } from '@/app.service';
import { AdminController } from '@/controllers/AdminController';
import { AnnounceAdminController } from '@/controllers/AnnounceAdminController';
import { AssetsController } from '@/controllers/AssetsController';
import { HealthVersionController } from '@/controllers/HealthController';
import { MailingController } from '@/controllers/MailingController';
import { MeController } from '@/controllers/MeController';
import { MessagesAdminController } from '@/controllers/MessagesAdminController';
import { TicketsAdminController } from '@/controllers/TicketsAdminController';
import { UserGuideController } from '@/controllers/UserGuideController';
import { UsersAdminController } from '@/controllers/UsersAdminController';
import { UsersController } from '@/controllers/UsersController';
import { EnvironmentVariables } from '@/environment';
import { adminAuthProvider } from '@/providers/admin-auth';
import { catalogProviders } from '@/providers/catalog';
import { contextProvider } from '@/providers/context';
import { repositoryProviders } from '@/providers/database';
import { DiscordConnectionLifecycle, discordProvider } from '@/providers/discord';
import { downloaderProviders } from '@/providers/downloader';
import { jellyfinProvider } from '@/providers/jellyfin';
import { mediaTitlesProviders } from '@/providers/media-titles';
import { adminMessagingProviders } from '@/providers/messaging/admin';
import {
  allUserMessagingProvider,
  announcementProvider,
  notificationRedeliveryProvider,
  quietHoursProvider,
  scheduledAnnouncementsProvider,
} from '@/providers/messaging/all';
import { namingAuditProviders } from '@/providers/naming-audit';
import { indexersRegistryProvider, plannerProvider } from '@/providers/planner';
import { playerProviders } from '@/providers/player';
import { postDownloadProviders } from '@/providers/post-download';
import { syncDataSourceConfigSchema, syncDataSourceProvider } from '@/providers/syncDataSource';
import { ticketProviders } from '@/providers/tickets';
import { tmdbProvider } from '@/providers/tmdb';
import { traktProvider } from '@/providers/trakt';
import { traktPluginProvider } from '@/providers/traktPlugin';
import { userAuthProvider } from '@/providers/user-auth';
import { MemoryCacheService } from '@/services/cache/memory-cache.service';
import { syncConfigSchema } from '@/services/catalog/sync';
import { DownloadProgressService } from '@/services/download-progress';
import { HealthChecksService } from '@/services/health-checks';
import { mediaPathsConfigSchema } from '@/services/media-labelizer';
import { quietHoursConfigSchema } from '@/services/messaging/user/quiet-hours';
import { namingAuditConfigSchema } from '@/services/naming-audit';
import { StartupRecoveryService } from '@/services/startup-recovery';

export const configSchema = z.object({
  name: z.string(),
  server: z.object({
    url: z.string(),
  }),
  trakt: traktConfigSchema,
  sync: syncConfigSchema,
  datasource: syncDataSourceConfigSchema,
  jellyfin: jellyfinConfigSchema,
  mailing: emailConfigSchema,
  userMessaging: z.object({ mode: z.enum(['send', 'dry-run']), quietHours: quietHoursConfigSchema }),
  discord: discordConfigSchema,
  indexer: z.object({
    loadix: loadixConfigSchema.nullable(),
    preferences: z.object({
      allowedQualities: z.array(z.enum(Quality)),
      allowedLanguages: z.array(z.enum(Language)),
      allowedHosts: z.array(z.enum(Host)),
      sizePolicy: z.object({
        bytesPerMinute: z.partialRecord(z.enum(Quality), z.number().positive()),
        tolerance: z.number().positive(),
      }),
    }),
  }),
  fetchr: fetchrConfigSchema,
  tmdb: tmdbConfigSchema,
  mediaPaths: mediaPathsConfigSchema,
  namingAudit: namingAuditConfigSchema,
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
    sync: env.sync,
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
    indexer: env.indexer,
    fetchr: env.fetchr,
    tmdb: env.tmdb,
    mediaPaths: env.mediaPaths,
    namingAudit: env.namingAudit,
    administration: {
      adminIds: env.server.adminIds,
      discordChannelId: env.discord.channelId,
    },
    mailing: env.mailing,
    userMessaging: env.userMessaging,
  });
}

export function configureAppModule(env: EnvironmentVariables): new () => NestModule {
  @Module({
    imports: [ConfigModule.forRoot({ load: [() => loadConfig(env)] }), ScheduleModule.forRoot(), HealthModule],
    controllers: [
      UsersController,
      MailingController,
      UserGuideController,
      AssetsController,
      HealthVersionController,
      AdminController,
      TicketsAdminController,
      AnnounceAdminController,
      UsersAdminController,
      MessagesAdminController,
      MeController,
    ],
    providers: [
      MemoryCacheService,
      AppService,
      adminAuthProvider,
      userAuthProvider,
      contextProvider,
      traktProvider,
      syncDataSourceProvider,
      ...repositoryProviders,
      ...catalogProviders,
      ...playerProviders,
      indexersRegistryProvider,
      plannerProvider,
      jellyfinProvider,
      traktPluginProvider,
      discordProvider,
      DiscordConnectionLifecycle,
      quietHoursProvider,
      allUserMessagingProvider,
      notificationRedeliveryProvider,
      announcementProvider,
      scheduledAnnouncementsProvider,
      ...adminMessagingProviders,
      ...ticketProviders,
      ...downloaderProviders,
      DownloadProgressService,
      tmdbProvider,
      ...mediaTitlesProviders,
      ...postDownloadProviders,
      ...namingAuditProviders,
      HealthChecksService,
      StartupRecoveryService,
    ],
  })
  class App implements NestModule {
    configure(): void {}
  }

  return App;
}
