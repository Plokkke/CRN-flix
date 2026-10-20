import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AdminChannel } from '@crn-flix/contracts';
import { DiscordService } from '@crn-flix/discord';
import { DiscordAdminChannel } from '@crn-flix/messaging-admin-discord';

import { Config } from '@/app.module';
import { TicketsRepository } from '@/services/database/tickets';
import { AdminTicketRelay } from '@/services/messaging/admin/relay';
import { TicketContextLoader } from '@/services/tickets/context';
import { TicketService } from '@/services/tickets/ticket.service';

export const ADMIN_CHANNEL = Symbol('AdminChannel');

export const adminMessagingProviders: Provider[] = [
  {
    provide: ADMIN_CHANNEL,
    inject: [ConfigService, DiscordService],
    useFactory: (configService: ConfigService<Config, true>, discord: DiscordService): AdminChannel => {
      const { discordChannelId, adminIds } = configService.get<Config['administration']>('administration');
      return new DiscordAdminChannel({ channelId: discordChannelId, adminIds }, discord);
    },
  },
  {
    provide: AdminTicketRelay,
    inject: [ADMIN_CHANNEL, TicketsRepository, TicketService, TicketContextLoader],
    useFactory: (
      channel: AdminChannel,
      tickets: TicketsRepository,
      ticketService: TicketService,
      contextLoader: TicketContextLoader,
    ): AdminTicketRelay => new AdminTicketRelay(channel, tickets, ticketService, contextLoader),
  },
];
