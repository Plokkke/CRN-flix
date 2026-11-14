import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AdminChannel, MetadataSource } from '@crn-flix/contracts';
import { DiscordService } from '@crn-flix/discord';
import { ConsoleAdminChannel } from '@crn-flix/messaging-admin-console';
import { DiscordAdminChannel } from '@crn-flix/messaging-admin-discord';

import { Config } from '@/app.module';
import { METADATA } from '@/providers/media-titles';
import { TicketsRepository } from '@/services/database/tickets';
import { AdminTicketRelay } from '@/services/messaging/admin/relay';
import { TicketContextLoader } from '@/services/tickets/context';
import { TicketService } from '@/services/tickets/ticket.service';

export const ADMIN_CHANNEL = Symbol('AdminChannel');

export type AdminChannelKind = 'discord' | 'console';

const channelProviders: Record<AdminChannelKind, Provider> = {
  discord: {
    provide: ADMIN_CHANNEL,
    inject: [ConfigService, DiscordService],
    useFactory: (configService: ConfigService<Config, true>, discord: DiscordService): AdminChannel => {
      const { discordChannelId, adminIds } = configService.get<Config['administration']>('administration');
      return new DiscordAdminChannel({ channelId: discordChannelId, adminIds }, discord);
    },
  },
  /** No Discord connection at all: the shared DiscordService is not even provided. */
  console: {
    provide: ADMIN_CHANNEL,
    inject: [ConfigService],
    useFactory: (configService: ConfigService<Config, true>): AdminChannel => {
      const { adminIds } = configService.get<Config['administration']>('administration');
      return new ConsoleAdminChannel({ adminIds });
    },
  },
};

export const adminMessagingProviders = (kind: AdminChannelKind): Provider[] => [
  channelProviders[kind],
  {
    provide: AdminTicketRelay,
    inject: [ADMIN_CHANNEL, TicketsRepository, TicketService, TicketContextLoader, METADATA],
    useFactory: (
      channel: AdminChannel,
      tickets: TicketsRepository,
      ticketService: TicketService,
      contextLoader: TicketContextLoader,
      metadata: MetadataSource,
    ): AdminTicketRelay =>
      new AdminTicketRelay(channel, tickets, ticketService, contextLoader, (text) => metadata.findReference(text)),
  },
];
