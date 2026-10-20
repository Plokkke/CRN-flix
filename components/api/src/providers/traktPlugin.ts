import { JellyfinMediaService, TraktPlugin } from '@crn-flix/player-jellyfin';

export const traktPluginProvider = {
  provide: TraktPlugin,
  inject: [JellyfinMediaService],
  useFactory: (jellyfin: JellyfinMediaService): TraktPlugin => new TraktPlugin(jellyfin),
};
