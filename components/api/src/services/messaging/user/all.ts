import { RequestEntity } from '@/services/database/requests';
import { UserEntity } from '@/services/database/users';
import { UserMessaging } from '@/services/messaging/user';

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

  async registered(ctxt: UserMessagingCtxt, user: UserEntity, password: string): Promise<void> {
    const messaging = this.getMessaging(ctxt.key);
    await messaging.registered(ctxt.id, user, password);
  }

  async error(ctxt: UserMessagingCtxt, message: string): Promise<void> {
    const messaging = this.getMessaging(ctxt.key);
    await messaging.error(ctxt.id, message);
  }

  async requestUpdated(ctxt: UserMessagingCtxt, request: RequestEntity): Promise<void> {
    const messaging = this.getMessaging(ctxt.key);
    await messaging.requestUpdated(ctxt.id, request);
  }
}
