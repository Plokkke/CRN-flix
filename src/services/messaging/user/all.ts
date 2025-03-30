import { JellyfinUser } from '@/modules/jellyfin/jellyfin';
import { MediaRequestEntity } from '@/services/database/mediaRequests';

import { UserMessaging } from '.';

export type UserMessagingCtxt = {
  key: string;
  id: string;
};

export class AllUserMessaging extends UserMessaging<UserMessagingCtxt> {
  constructor(private readonly messagingByKey: Record<string, UserMessaging<string>>) {
    super();
  }

  private getMessaging(key: string): UserMessaging<string> {
    const messaging = this.messagingByKey[key];
    if (!messaging) {
      throw new Error(`No messaging service found for key ${key}`);
    }
    return messaging;
  }

  async registered(ctxt: UserMessagingCtxt, user: JellyfinUser): Promise<void> {
    const messaging = this.getMessaging(ctxt.key);
    await messaging.registered(ctxt.id, user);
  }

  async error(ctxt: UserMessagingCtxt, message: string): Promise<void> {
    const messaging = this.getMessaging(ctxt.key);
    await messaging.error(ctxt.id, message);
  }

  async mediaRequestUpdated(ctxt: UserMessagingCtxt, request: MediaRequestEntity): Promise<void> {
    const messaging = this.getMessaging(ctxt.key);
    await messaging.mediaRequestUpdated(ctxt.id, request);
  }
}
