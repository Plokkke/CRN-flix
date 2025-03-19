import { JellyfinUser } from '@/modules/jellyfin/jellyfin';
import { AuthDevicePublicCtxt } from '@/modules/trakt/types';

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

  async welcome(ctxt: UserMessagingCtxt): Promise<void> {
    const messaging = this.getMessaging(ctxt.key);
    await messaging.welcome(ctxt.id);
  }

  async registered(ctxt: UserMessagingCtxt, user: JellyfinUser): Promise<void> {
    const messaging = this.getMessaging(ctxt.key);
    await messaging.registered(ctxt.id, user);
  }

  async error(ctxt: UserMessagingCtxt, message: string): Promise<void> {
    const messaging = this.getMessaging(ctxt.key);
    await messaging.error(ctxt.id, message);
  }

  async traktLinkRequest(ctxt: UserMessagingCtxt, authCtxt: AuthDevicePublicCtxt): Promise<void> {
    const messaging = this.getMessaging(ctxt.key);
    await messaging.traktLinkRequest(ctxt.id, authCtxt);
  }

  async mediaRequestUpdated(ctxt: UserMessagingCtxt, mediaTitle: string, status: string): Promise<void> {
    const messaging = this.getMessaging(ctxt.key);
    await messaging.mediaRequestUpdated(ctxt.id, mediaTitle, status);
  }

  onJoin(handler: (ctxt: UserMessagingCtxt) => void): void {
    for (const [key, messaging] of Object.entries(this.messagingByKey)) {
      messaging.onJoin((id: string) => {
        handler({ key, id });
      });
    }
  }

  onRegisterRequest(handler: (ctxt: UserMessagingCtxt, username: string) => void): void {
    for (const [key, messaging] of Object.entries(this.messagingByKey)) {
      messaging.onRegisterRequest((id: string, username: string) => {
        handler({ key, id }, username);
      });
    }
  }

  onTraktLinkRequest(handler: (ctxt: UserMessagingCtxt) => void): void {
    for (const [key, messaging] of Object.entries(this.messagingByKey)) {
      messaging.onTraktLinkRequest((id: string) => {
        handler({ key, id });
      });
    }
  }
}
