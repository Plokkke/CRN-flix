import { AllUserMessaging } from '@/services/messaging/user/all';
import { DiscordUserMessaging } from '@/services/messaging/user/discord';
import { EmailUserMessaging } from '@/services/messaging/user/email';
export const allUserMessagingProvider = {
  provide: AllUserMessaging,
  inject: [DiscordUserMessaging, EmailUserMessaging],
  useFactory: (discord: DiscordUserMessaging, email: EmailUserMessaging): AllUserMessaging => {
    return new AllUserMessaging({
      discord,
      email,
    });
  },
};
