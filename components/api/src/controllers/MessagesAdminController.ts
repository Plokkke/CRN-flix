import { Controller, Get, Header, UseFilters, UseGuards } from '@nestjs/common';

import { SessionAuthRedirectFilter } from '@/filters/session-auth-redirect.filter';
import { AdminSessionGuard } from '@/guards/admin-session.guard';
import { buildMessageStats } from '@/services/admin/message-stats';
import { ContextService } from '@/services/context';
import { UserMessagesRepository } from '@/services/database/user-messages';
import { adminMessagesTemplate } from '@/web/templates/admin-messages';

@Controller('admin/messages')
@UseGuards(AdminSessionGuard)
@UseFilters(SessionAuthRedirectFilter)
export class MessagesAdminController {
  constructor(
    private readonly contextService: ContextService,
    private readonly userMessages: UserMessagesRepository,
  ) {}

  @Get()
  @Header('content-type', 'text/html')
  async list(): Promise<string> {
    const rows = buildMessageStats(await this.userMessages.countPerUserAndKind(new Date()));
    return adminMessagesTemplate({ serviceName: this.contextService.name, rows });
  }
}
