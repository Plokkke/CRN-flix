import { RequestsRepository } from '@/services/database/requests';
import { DiscordSyncService } from '@/services/discord-sync';
import { DiscordAdminMessaging } from '@/services/messaging/admin/discord';

export const discordSyncProvider = {
  provide: DiscordSyncService,
  inject: [RequestsRepository, DiscordAdminMessaging],
  useFactory: (requestsRepository: RequestsRepository, adminsMessaging: DiscordAdminMessaging): DiscordSyncService => {
    return new DiscordSyncService(requestsRepository, adminsMessaging);
  },
};
