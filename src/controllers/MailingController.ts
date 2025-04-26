import { Controller, Get, Header, Param } from '@nestjs/common';

import { ContextService } from '@/services/context';
import { REQUEST_STATUS, RequestEntity, RequestStatus } from '@/services/database/requests';
import { registeredTemplate } from '@/services/messaging/user/email/templates/registered';
import { requestUpdateTemplate } from '@/services/messaging/user/email/templates/request-update';

@Controller('mailing')
export class MailingController {
  constructor(private readonly contextService: ContextService) {}

  @Get('registered')
  @Header('content-type', 'text/html')
  async previewRegistrationEmail(): Promise<string> {
    const { html } = registeredTemplate({
      serviceName: this.contextService.name,
      mediaServerUrl: this.contextService.mediaServerUrl,
      userGuideUrl: this.contextService.userGuideUrl,
      traktLinkUrl: this.contextService.getTraktLinkUrl('user-id'),
      userName: 'UserName',
      password: 'Str0ngP4ssW0rd!',
      movies: await this.contextService.getRandomMedias(5, 'movie'),
      series: await this.contextService.getRandomMedias(5, 'show'),
    });

    return html;
  }

  @Get(['media-request-updated/:status', 'media-request-updated'])
  @Header('content-type', 'text/html')
  async previewMediaRequestUpdatedEmail(@Param('status') status: RequestStatus = 'pending'): Promise<string> {
    const statusIdx = REQUEST_STATUS.indexOf(status);
    const nextStatus = REQUEST_STATUS[(statusIdx + 1) % REQUEST_STATUS.length];

    const media =
      Math.random() > 0.5
        ? {
            imdbId: 'tt3566834',
            type: 'movie',
            title: 'Minecraft',
            year: 2025,
            seasonNumber: null,
            episodeNumber: null,
          }
        : {
            imdbId: 'tt3566834',
            type: 'episode',
            title: 'Minecraft',
            year: 2025,
            seasonNumber: 1,
            episodeNumber: 1,
          };

    const { html: originalHtml } = requestUpdateTemplate([
      {
        mediaId: 'media.id',
        status,
        media,
      } as unknown as RequestEntity,
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
