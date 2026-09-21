import { JellyfinMediaService } from '@/modules/jellyfin/jellyfin';
import { TraktPlugin } from '@/modules/jellyfin/plugins/trakt';

export const traktPluginProvider = {
  provide: TraktPlugin,
  inject: [JellyfinMediaService],
  useFactory: (jellyfin: JellyfinMediaService): TraktPlugin => new TraktPlugin(jellyfin),
};
