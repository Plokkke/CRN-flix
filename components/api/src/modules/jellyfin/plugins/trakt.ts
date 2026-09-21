import { Logger } from '@nestjs/common';
import { z } from 'zod';

import { JellyfinMediaService } from '@/modules/jellyfin/jellyfin';

export const traktPluginUserConfigSchema = z.object({
  LinkedMbUserId: z.string(),

  AccessToken: z.string().optional(),
  RefreshToken: z.string().optional(),
  AccessTokenExpiration: z.string().optional(),

  LocationsExcluded: z.array(z.string()).optional(),
  Scrobble: z.boolean(),

  SkipUnwatchedImportFromTrakt: z.boolean(),
  SkipPlaybackProgressImportFromTrakt: z.boolean(),
  SkipWatchedImportFromTrakt: z.boolean(),

  PostWatchedHistory: z.boolean(),
  PostUnwatchedHistory: z.boolean(),
  PostSetWatched: z.boolean(),
  PostSetUnwatched: z.boolean(),

  SynchronizeCollections: z.boolean(),
  ExportMediaInfo: z.boolean(),
  DontRemoveItemFromTrakt: z.boolean(),
  ExtraLogging: z.boolean(),
});

export type TraktPluginUserConfig = z.infer<typeof traktPluginUserConfigSchema>;

export const traktPluginConfigSchema = z.object({
  TraktUsers: z.array(traktPluginUserConfigSchema),
});

export type TraktPluginConfig = z.infer<typeof traktPluginConfigSchema>;

export const TRAKT_PLUGIN_NAME = 'Trakt';
export const DEFAULT_TRAKT_PLUGIN_CONFIG = {
  LocationsExcluded: [],
  Scrobble: true,

  SkipUnwatchedImportFromTrakt: false,
  SkipWatchedImportFromTrakt: false,
  SkipPlaybackProgressImportFromTrakt: true,

  PostWatchedHistory: true,
  PostUnwatchedHistory: false,
  PostSetWatched: false,
  PostSetUnwatched: false,

  SynchronizeCollections: false,
  ExportMediaInfo: false,
  DontRemoveItemFromTrakt: false,
  ExtraLogging: false,
} as const;

export type UserAuthContext = {
  jellyfinId: string;
  accessToken: string;
};

/**
 * Resolves the Jellyfin plugin lazily: Jellyfin may be down when the engine boots,
 * and nothing else needs it until the first Trakt sync or user registration.
 */
export class TraktPlugin {
  private static readonly logger = new Logger(TraktPlugin.name);

  private pluginId: Promise<string> | null = null;

  constructor(private readonly jellyfin: JellyfinMediaService) {}

  private resolvePluginId(): Promise<string> {
    if (!this.pluginId) {
      this.pluginId = this.initialize().catch((error: unknown) => {
        this.pluginId = null;
        TraktPlugin.logger.warn(
          `Trakt plugin unavailable, will retry on next use: ${error instanceof Error ? error.message : error}`,
        );
        throw error;
      });
    }
    return this.pluginId;
  }

  private async initialize(): Promise<string> {
    const plugins = await this.jellyfin.listPlugins();
    const plugin = plugins.find((plugin) => plugin.Name === TRAKT_PLUGIN_NAME);
    if (!plugin) {
      throw new Error(`Plugin ${TRAKT_PLUGIN_NAME} not found`);
    }

    const pluginConfig = traktPluginConfigSchema.parse(await this.jellyfin.getPluginConfiguration(plugin.Id));
    pluginConfig.TraktUsers = pluginConfig.TraktUsers.map((c) => ({
      ...c,
      ...DEFAULT_TRAKT_PLUGIN_CONFIG,
      LocationsExcluded: DEFAULT_TRAKT_PLUGIN_CONFIG.LocationsExcluded.slice(),
    }));
    await this.jellyfin.setPluginConfiguration(plugin.Id, pluginConfig);
    TraktPlugin.logger.log(`Trakt plugin ready (${plugin.Id})`);
    return plugin.Id;
  }

  private async getFullConfig(): Promise<TraktPluginConfig> {
    const config = await this.jellyfin.getPluginConfiguration(await this.resolvePluginId());
    return traktPluginConfigSchema.parse(config);
  }

  async getConfig(userId: string): Promise<TraktPluginUserConfig> {
    const config = await this.getFullConfig();
    const userConfig = config.TraktUsers.find(({ LinkedMbUserId }) => LinkedMbUserId === userId);
    if (!userConfig) {
      throw new Error(`No config found for user ${userId}`);
    }
    return userConfig;
  }

  async setConfig(
    userId: string,
    tokens: { accessToken: string; refreshToken: string; accessTokenExpiration: string },
  ): Promise<void> {
    const userConfig: TraktPluginUserConfig = {
      ...DEFAULT_TRAKT_PLUGIN_CONFIG,
      LocationsExcluded: DEFAULT_TRAKT_PLUGIN_CONFIG.LocationsExcluded.slice(),
      AccessToken: tokens.accessToken,
      RefreshToken: tokens.refreshToken,
      AccessTokenExpiration: tokens.accessTokenExpiration,
      LinkedMbUserId: userId,
    };
    const pluginConfig = await this.getFullConfig();
    const existingIdx = pluginConfig.TraktUsers.findIndex((c) => c.LinkedMbUserId === userId);
    if (existingIdx >= 0) {
      // Merge to preserve any Jellyfin-managed fields we don't own (scrobble
      // prefs, excluded locations) while overwriting the auth tuple cohesively.
      pluginConfig.TraktUsers[existingIdx] = {
        ...pluginConfig.TraktUsers[existingIdx],
        AccessToken: tokens.accessToken,
        RefreshToken: tokens.refreshToken,
        AccessTokenExpiration: tokens.accessTokenExpiration,
      };
    } else {
      pluginConfig.TraktUsers.push(userConfig);
    }
    await this.jellyfin.setPluginConfiguration(await this.resolvePluginId(), pluginConfig);
  }

  async getUsersAuthContext(): Promise<UserAuthContext[]> {
    const pluginConfig = await this.getFullConfig();
    return pluginConfig.TraktUsers.filter((c) => c.AccessToken).map((c) => ({
      jellyfinId: c.LinkedMbUserId,
      accessToken: c.AccessToken!,
    }));
  }
}
