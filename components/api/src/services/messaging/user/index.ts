import { RequestStatus } from '@/services/database/requests';

export { LoginChallenge, NOTICE_TONES, NoticeTone, ServiceNotice } from '@crn-flix/contracts';

/**
 * Missing et Pending sont volontairement exclus : une request oscille entre les deux
 * au fil des syncs (Trakt, indexers) et chaque bascule générerait une notification.
 */
export const USER_NOTIFIABLE_STATUSES: RequestStatus[] = [RequestStatus.Fulfilled, RequestStatus.Rejected];

export const isUserNotifiableStatus = (status: RequestStatus): boolean => USER_NOTIFIABLE_STATUSES.includes(status);
