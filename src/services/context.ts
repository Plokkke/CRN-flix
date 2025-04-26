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

  async getRandomMedias(count: number, type: 'movie' | 'show'): Promise<MediaItem[]> {
    const entries = await this.jellyfin.listEntries();
    const medias = entries.filter((entry) => (type === 'movie' ? entry.Type === 'Movie' : entry.Type === 'Series'));

    // Shuffle the array using Fisher-Yates algorithm
    const shuffled = [...medias];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled.slice(0, count).map((media) => ({
      title: media.Name,
      posterUrl: `https://jellyfin.crn-tech.fr/Items/${media.Id}/Images/Primary?fillWidth=100`,
    }));
  }
}
