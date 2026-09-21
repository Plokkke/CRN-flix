import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { DiscordService } from '@/modules/discord/discord';
import { TicketsRepository } from '@/services/database/tickets';
import { DiscordAdminChannel } from '@/services/messaging/admin/channel';
import { DiscordChannelCleanup } from '@/services/messaging/admin/channel-cleanup';
import { DownloadsBoard } from '@/services/messaging/admin/downloads-board';
import { DiscordTicketAdapter } from '@/services/messaging/admin/ticket-adapter';
import { TicketContextLoader } from '@/services/tickets/context';
import { TicketService } from '@/services/tickets/ticket.service';

export const adminMessagingProviders: Provider[] = [
  {
    provide: DiscordAdminChannel,
    inject: [ConfigService, DiscordService],
    useFactory: async (
      configService: ConfigService<Config, true>,
      discordService: DiscordService,
    ): Promise<DiscordAdminChannel> => {
      const adminConfig = configService.get<Config['administration']>('administration');
      return DiscordAdminChannel.create(
        { channelId: adminConfig.discordChannelId, adminIds: adminConfig.adminIds },
        discordService,
      );
    },
  },
  {
    provide: DiscordTicketAdapter,
    inject: [DiscordAdminChannel, TicketsRepository, TicketService, TicketContextLoader],
    useFactory: (
      adminChannel: DiscordAdminChannel,
      tickets: TicketsRepository,
      ticketService: TicketService,
      contextLoader: TicketContextLoader,
    ): DiscordTicketAdapter => new DiscordTicketAdapter(adminChannel, tickets, ticketService, contextLoader),
  },
  {
    provide: DiscordChannelCleanup,
    inject: [DiscordAdminChannel, TicketsRepository],
    useFactory: (adminChannel: DiscordAdminChannel, tickets: TicketsRepository): DiscordChannelCleanup =>
      new DiscordChannelCleanup(adminChannel, tickets),
  },
  {
    provide: DownloadsBoard,
    inject: [DiscordAdminChannel],
    useFactory: (adminChannel: DiscordAdminChannel): DownloadsBoard => new DownloadsBoard(adminChannel),
  },
];
