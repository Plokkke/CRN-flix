import { RequestEntity, RequestStatus } from '@/services/database/requests';
import { UserEntity } from '@/services/database/users';
export const USER_MESSAGING_TYPES = ['discord', 'whatsapp', 'email'] as const;
export type UserMessagingType = (typeof USER_MESSAGING_TYPES)[number];

/**
 * Missing et Pending sont volontairement exclus : une request oscille entre les deux
 * au fil des syncs (Trakt, indexers) et chaque bascule générerait une notification.
 */
export const USER_NOTIFIABLE_STATUSES: RequestStatus[] = [RequestStatus.Fulfilled, RequestStatus.Rejected];

export const isUserNotifiableStatus = (status: RequestStatus): boolean => USER_NOTIFIABLE_STATUSES.includes(status);

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
