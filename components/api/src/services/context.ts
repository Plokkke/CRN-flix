import { ConfigService } from '@nestjs/config';

import { EnginePreferences, Player, ServiceIdentity, ShowcaseItem, ShowcaseKind } from '@crn-flix/contracts';

import { Config } from '@/app.module';

export class ContextService {
  constructor(
    private readonly configService: ConfigService<Config, true>,
    private readonly player: Player,
  ) {}

  get name(): string {
    return this.configService.get('name');
  }

  get indexerPreferences(): EnginePreferences {
    return this.configService.get('indexer', { infer: true }).preferences;
  }

  get mediaServerUrl(): string {
    return this.player.url;
  }

  get userGuideUrl(): string {
    const serverConfig = this.configService.get('server');
    return `${serverConfig.url}/user-guide`;
  }

  get userSpaceUrl(): string {
    return `${this.configService.get('server').url}/me`;
  }

  get identity(): ServiceIdentity {
    return { serviceName: this.name, playerUrl: this.mediaServerUrl, userSpaceUrl: this.userSpaceUrl };
  }

  getTraktLinkUrl(userId: string): string {
    const serverConfig = this.configService.get('server');
    return `${serverConfig.url}/users/${userId}/trakt-link`;
  }

  getRandomMedias(count: number, type: ShowcaseKind): Promise<ShowcaseItem[]> {
    return this.player.showcase(type, count);
  }
}
