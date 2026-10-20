import { HealthRegistryService } from '@plokkke/nest-health-registry';
import { Pool } from 'pg';

import { AdminChannel, Downloader } from '@crn-flix/contracts';

import { HealthChecksService } from '@/services/health-checks';
import { AllUserMessaging } from '@/services/messaging/user/all';

function build() {
  const readiness = new Map<string, () => boolean | Promise<boolean>>();
  const registry = {
    addReadinessCheck: (name: string, check: () => boolean | Promise<boolean>) => readiness.set(name, check),
    addLivenessCheck: jest.fn(),
  };
  const adminChannel = { isConnected: jest.fn().mockReturnValue(true) };
  const messaging = { canReachUsers: true };
  new HealthChecksService(
    {} as Pool,
    { isConnected: () => false } as unknown as Downloader,
    registry as unknown as HealthRegistryService,
    messaging as unknown as AllUserMessaging,
    adminChannel as unknown as AdminChannel,
  ).onModuleInit();
  return { readiness, adminChannel, messaging };
}

describe('HealthChecksService', () => {
  it('is unready while the admin channel is disconnected or users cannot be reached', () => {
    const { readiness, adminChannel, messaging } = build();
    expect(readiness.get('admin-channel')?.()).toBe(true);

    adminChannel.isConnected.mockReturnValue(false);
    messaging.canReachUsers = false;

    expect(readiness.get('admin-channel')?.()).toBe(false);
    expect(readiness.get('user-messaging')?.()).toBe(false);
  });
});
