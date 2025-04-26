import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { JellyfinMediaService } from '@/modules/jellyfin/jellyfin';
import { MediaItem } from '@/services/messaging/user/email/templates/registered';

export class ContextService {
  constructor(
    private readonly configService: ConfigService<Config, true>,
    private readonly jellyfin: JellyfinMediaService,
  ) {}

  get name(): string {
    return this.configService.get('name');
  }

  get mediaServerUrl(): string {
    return this.jellyfin.url;
  }

  get userGuideUrl(): string {
    const serverConfig = this.configService.get('server');
    return `${serverConfig.url}/user-guide`;
  }

  getTraktLinkUrl(userId: string): string {
    const serverConfig = this.configService.get('server');
    return `${serverConfig.url}/users/${userId}/trakt-link`;
  }

  async getRandomMedias(count: number, type: 'movie' | 'show' | 'episode'): Promise<MediaItem[]> {
    const medias = await this.jellyfin.listEntries(
      type === 'movie' ? ['Movie'] : type === 'show' ? ['Series'] : ['Episode'],
    );

    // Shuffle the array using Fisher-Yates algorithm
    const shuffled = [...medias];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled.slice(0, count).map((media) => {
      const itemId = media.Type === 'Episode' ? media.SeriesId! : media.Id;
      if (media.Type === 'Episode') {
        console.log(media);
      }
      return {
        title: media.Type === 'Episode' ? media.SeriesName! : media.Name,
        imdbId: media.ProviderIds.Imdb!,
        type: media.Type === 'Movie' ? 'movie' : media.Type === 'Series' ? 'show' : 'episode',
        posterUrl: `https://jellyfin.crn-tech.fr/Items/${itemId}/Images/Primary?fillWidth=100`,
      };
    });
  }
}
