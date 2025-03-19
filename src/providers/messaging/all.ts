import { AllUserMessaging } from '@/services/messaging/user/all';
import { DiscordUserMessaging } from '@/services/messaging/user/discord';

export const allUserMessagingProvider = {
  provide: AllUserMessaging,
  inject: [DiscordUserMessaging],
  useFactory: (discord: DiscordUserMessaging): AllUserMessaging => {
    return new AllUserMessaging({
      discord,
    });
  },
};
