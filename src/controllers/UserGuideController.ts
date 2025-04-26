import { Controller, Get, Header } from '@nestjs/common';

import { ContextService } from '@/services/context';
import { userGuideTemplate } from '@/services/messaging/user/email/templates/user-guide-template';

@Controller('user-guide')
export class UserGuideController {
  constructor(private readonly contextService: ContextService) {}

  @Get()
  @Header('content-type', 'text/html')
  getUserGuide(): string {
    return userGuideTemplate({
      serviceName: this.contextService.name,
    });
  }
}
