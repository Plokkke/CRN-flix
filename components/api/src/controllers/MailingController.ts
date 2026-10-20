import { Controller, Get, Header, Inject, NotFoundException, Param } from '@nestjs/common';

import { MetadataSource, RequestNotice, RequestOutcome, ShowcaseItem } from '@crn-flix/contracts';
import {
  catalogRelinkTemplate,
  registeredTemplate,
  requestUpdateTemplate,
  serviceNoticeTemplate,
} from '@crn-flix/messaging-user-email';

import { METADATA } from '@/providers/media-titles';
import { buildPresetNotice, isNoticePreset } from '@/services/announcements/presets';
import { ContextService } from '@/services/context';

@Controller('mailing')
export class MailingController {
  constructor(
    private readonly contextService: ContextService,
    @Inject(METADATA) private readonly metadata: MetadataSource,
  ) {}

  /** Preview fixtures come from the player; the poster is the metadata source's, like in production. */
  private async posterUrlOf(imdbId: string): Promise<string | null> {
    return (await this.metadata.describe(imdbId)).posterUrl;
  }

  @Get('registered')
  @Header('content-type', 'text/html')
  async previewRegistrationEmail(): Promise<string> {
    const { html } = registeredTemplate({
      serviceName: this.contextService.name,
      playerUrl: this.contextService.mediaServerUrl,
      userSpaceUrl: this.contextService.userSpaceUrl,
      userGuideUrl: this.contextService.userGuideUrl,
      catalogLinkUrl: this.contextService.getTraktLinkUrl('978ab97f-817d-4e9a-86b4-637b12dfc34c'),
      userName: 'UserName',
      password: 'Str0ngP4ssW0rd!',
      movies: await this.contextService.getRandomMedias(5, 'movie'),
      series: await this.contextService.getRandomMedias(5, 'show'),
    });

    return html;
  }

  @Get('catalog-relink')
  @Header('content-type', 'text/html')
  previewCatalogRelinkEmail(): string {
    return catalogRelinkTemplate(this.contextService.name, 'UserName', {
      catalogName: 'Trakt',
      linkUrl: this.contextService.getTraktLinkUrl('978ab97f-817d-4e9a-86b4-637b12dfc34c'),
    }).html;
  }

  @Get('service-notice/:preset')
  @Header('content-type', 'text/html')
  previewServiceNotice(@Param('preset') preset: string): string {
    if (!isNoticePreset(preset)) {
      throw new NotFoundException(`Unknown notice preset ${preset}`);
    }
    const notice = buildPresetNotice(preset, this.contextService.identity);
    return serviceNoticeTemplate(this.contextService.name, notice).html;
  }

  @Get(['media-request-updated/:status', 'media-request-updated'])
  @Header('content-type', 'text/html')
  async previewMediaRequestUpdatedEmail(@Param('status') status: RequestOutcome = 'fulfilled'): Promise<string> {
    const nextStatus: RequestOutcome = status === 'fulfilled' ? 'rejected' : 'fulfilled';

    const [movie] = await this.contextService.getRandomMedias(1, 'movie');
    const [show] = await this.contextService.getRandomMedias(1, 'show');
    const [episode] = await this.contextService.getRandomMedias(1, 'episode');
    const notice = async (
      item: ShowcaseItem,
      season: number | null,
      number: number | null,
    ): Promise<RequestNotice> => ({
      title: item.title,
      year: 2025,
      type: item.type === 'movie' ? 'movie' : 'episode',
      seasonNumber: season,
      episodeNumber: number,
      outcome: status,
      posterUrl: await this.posterUrlOf(item.imdbId),
    });

    const { html: originalHtml } = requestUpdateTemplate(this.contextService.identity, [
      await notice(show, null, null),
      await notice(movie, null, null),
      await notice(episode, 2, 4),
    ]);

    // Add a button to navigate to the next status
    const nextStatusButton = `
      <div style="margin-top: 30px; text-align: center;">
        <a href="/mailing/media-request-updated/${nextStatus}" 
           style="display: inline-block; padding: 12px 24px; background-color: #3498db; 
                  color: white; text-decoration: none; border-radius: 4px; font-weight: bold;">
          Voir le statut suivant: ${nextStatus.toUpperCase().replace('_', ' ')}
        </a>
      </div>
    `;

    // Insert the button before the closing body tag
    const html = originalHtml.replace('</body>', `${nextStatusButton}</body>`);

    return html;
  }
}
