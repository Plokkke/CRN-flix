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

export class TraktPlugin {
  private static readonly logger = new Logger(TraktPlugin.name);

  static async create(jellyfin: JellyfinMediaService): Promise<TraktPlugin> {
    const plugins = await jellyfin.listPlugins();
    const plugin = plugins.find((plugin) => plugin.Name === TRAKT_PLUGIN_NAME);
    if (!plugin) {
      throw new Error(`Plugin ${TRAKT_PLUGIN_NAME} not found`);
    }
    const pluginService = new TraktPlugin(jellyfin, plugin.Id);

    const pluginConfig = await pluginService.getFullConfig();
    pluginConfig.TraktUsers = pluginConfig.TraktUsers.map((c) => ({
      ...c,
      ...DEFAULT_TRAKT_PLUGIN_CONFIG,
      LocationsExcluded: DEFAULT_TRAKT_PLUGIN_CONFIG.LocationsExcluded.slice(),
    }));
    await pluginService.jellyfin.setPluginConfiguration(plugin.Id, pluginConfig);
    return pluginService;
  }

  private constructor(
    private readonly jellyfin: JellyfinMediaService,
    private readonly pluginId: string,
  ) {}

  private async getFullConfig(): Promise<TraktPluginConfig> {
    const config = await this.jellyfin.getPluginConfiguration(this.pluginId);
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

  async setConfig(userId: string, accessToken: string): Promise<void> {
    const userConfig: TraktPluginUserConfig = {
      ...DEFAULT_TRAKT_PLUGIN_CONFIG,
      LocationsExcluded: DEFAULT_TRAKT_PLUGIN_CONFIG.LocationsExcluded.slice(),
      AccessToken: accessToken,
      LinkedMbUserId: userId,
    };
    const pluginConfig = await this.getFullConfig();
    pluginConfig.TraktUsers.push(userConfig);
    await this.jellyfin.setPluginConfiguration(this.pluginId, pluginConfig);
  }

  async getUsersAuthContext(): Promise<UserAuthContext[]> {
    const pluginConfig = await this.getFullConfig();
    return pluginConfig.TraktUsers.filter((c) => c.AccessToken).map((c) => ({
      jellyfinId: c.LinkedMbUserId,
      accessToken: c.AccessToken!,
    }));
  }
}
