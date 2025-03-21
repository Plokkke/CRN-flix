import { JellyfinUser } from '@/modules/jellyfin/jellyfin';
import { AuthDevicePublicCtxt } from '@/modules/trakt/types';
import { MediaRequestEntity } from '@/services/database/mediaRequests';
export const USER_MESSAGING_TYPES = ['discord', 'whatsapp', 'email'] as const;
export type UserMessagingType = (typeof USER_MESSAGING_TYPES)[number];

export type Config = {
  jellyfin: {
    url: string;
  };
  trakt: {
    url: string;
  };
};

export abstract class UserMessaging<ID> {
  abstract error(id: ID, message: string): Promise<void>;
  abstract welcome(id: ID): Promise<void>;
  abstract registered(id: ID, user: JellyfinUser): Promise<void>;
  abstract traktLinkRequest(id: ID, authCtxt: AuthDevicePublicCtxt): Promise<void>;
  abstract mediaRequestUpdated(id: ID, request: MediaRequestEntity): Promise<void>;

  abstract onJoin(handler: (id: ID) => void): void;
  abstract onRegisterRequest(handler: (id: ID, username: string) => void): void;
  abstract onTraktLinkRequest(handler: (id: ID) => void): void;
}
