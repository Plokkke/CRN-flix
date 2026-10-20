import { RequestsRepository, RequestStatus } from '@/services/database/requests';
import { UserNotificationsRepository } from '@/services/database/user-notifications';
import { UsersRepository } from '@/services/database/users';
import { AllUserMessaging } from '@/services/messaging/user/all';
import { NotificationRedeliveryService } from '@/services/messaging/user/redelivery';

const pending = { userId: 'u1', mediaId: 'm1', status: RequestStatus.Fulfilled };
const user = { id: 'u1', messagingKey: 'email', messagingId: 'antoine@test' };

function build(mode: 'send' | 'dry-run', requestStatus = RequestStatus.Fulfilled) {
  const notifications = {
    listPending: jest.fn().mockResolvedValue([pending]),
    discard: jest.fn().mockResolvedValue(undefined),
  };
  const request = { mediaId: 'm1', status: requestStatus };
  const messaging = { mode, requestUpdated: jest.fn().mockResolvedValue(undefined) };
  const service = new NotificationRedeliveryService(
    notifications as unknown as UserNotificationsRepository,
    { get: jest.fn().mockResolvedValue(request) } as unknown as RequestsRepository,
    { get: jest.fn().mockResolvedValue(user) } as unknown as UsersRepository,
    messaging as unknown as AllUserMessaging,
  );
  return { service, notifications, messaging, request };
}

describe('NotificationRedeliveryService', () => {
  it('re-queues what the outbox still holds unsent', async () => {
    const { service, messaging, request } = build('send');

    await service.redeliver();

    expect(messaging.requestUpdated).toHaveBeenCalledWith({ key: 'email', id: 'antoine@test' }, request, 'u1');
  });

  it('drops a notification whose request moved on to another status', async () => {
    const { service, notifications, messaging } = build('send', RequestStatus.Missing);

    await service.redeliver();

    expect(notifications.discard).toHaveBeenCalledWith(pending);
    expect(messaging.requestUpdated).not.toHaveBeenCalled();
  });

  it('keeps everything queued in dry-run', async () => {
    const { service, notifications, messaging } = build('dry-run');

    await service.redeliver();

    expect(messaging.requestUpdated).not.toHaveBeenCalled();
    expect(notifications.discard).not.toHaveBeenCalled();
  });
});
