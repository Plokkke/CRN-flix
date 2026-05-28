import { RequestEntity } from '@/services/database/requests';
import { UserEntity } from '@/services/database/users';
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
  abstract registered(id: ID, user: UserEntity, password: string): Promise<void>;
  abstract requestUpdated(id: ID, request: RequestEntity): Promise<void>;
}
