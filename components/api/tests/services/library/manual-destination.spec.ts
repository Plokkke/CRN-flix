import { ShelfOverridesRepository } from '@/services/database/library';
import { PolicyExemptionsRepository, PolicyRefusalsRepository } from '@/services/database/policy';
import { UsersRepository } from '@/services/database/users';
import { ManualDestinations } from '@/services/library/manual-destination';
import { LibraryShelves } from '@/services/library/shelves';
import { PolicyGate } from '@/services/policy/gate';
import { PolicyService } from '@/services/policy/policy';

function build(opts: { adminUserName?: string | null; restricted?: boolean } = {}) {
  const overrides = { set: jest.fn().mockResolvedValue(undefined) };
  const exemptions = {
    grantGlobal: jest.fn().mockResolvedValue(undefined),
    grantPersonal: jest.fn().mockResolvedValue(undefined),
  };
  const users = { getByName: jest.fn().mockResolvedValue({ id: 'admin-user' }) };
  const policy = {
    placementOf: jest
      .fn()
      .mockResolvedValue(
        opts.restricted ? { kind: 'restricted', refusals: [] } : { kind: 'shelf', shelf: 'standard', forced: false },
      ),
  };
  const shelves = { reconcile: jest.fn().mockResolvedValue(undefined) };
  const destinations = new ManualDestinations(
    overrides as unknown as ShelfOverridesRepository,
    exemptions as unknown as PolicyExemptionsRepository,
    users as unknown as UsersRepository,
    policy as unknown as PolicyService,
    shelves as unknown as LibraryShelves,
    opts.adminUserName === undefined ? 'antoine' : opts.adminUserName,
  );
  return { destinations, overrides, exemptions, shelves };
}

describe('ManualDestinations', () => {
  it('puts the title on the chosen shared shelf, through every rule, for everyone', async () => {
    const { destinations, overrides, exemptions, shelves } = build();

    await expect(destinations.apply('tt1', 'kids', 'discord:a')).resolves.toBeNull();

    expect(overrides.set).toHaveBeenCalledWith(
      { imdbId: 'tt1', shelf: 'kids', origin: 'manual-download' },
      'discord:a',
    );
    expect(exemptions.grantGlobal).toHaveBeenCalledWith('tt1', [null], 'manual-download', 'discord:a');
    expect(shelves.reconcile).toHaveBeenCalled();
  });

  it('keeps a personal download in the admin’s collection, off the shared shelves', async () => {
    const { destinations, overrides, exemptions } = build();

    await destinations.apply('tt1', 'personal', 'discord:a');

    expect(overrides.set).toHaveBeenCalledWith(
      { imdbId: 'tt1', shelf: 'none', origin: 'manual-download' },
      'discord:a',
    );
    expect(exemptions.grantPersonal).toHaveBeenCalledWith('admin-user', 'tt1', 'manual-download', 'discord:a');
  });

  it('says what is missing when the admin has no account of their own', async () => {
    const { destinations, overrides } = build({ adminUserName: null });

    await expect(destinations.apply('tt1', 'personal', 'discord:a')).resolves.toMatch(/ADMIN_USER_NAME/);
    expect(overrides.set).not.toHaveBeenCalled();
  });

  it('without a choice, sends what the rules restrict to the admin’s collection and leaves the rest to the rules', async () => {
    const restricted = build({ restricted: true });
    await restricted.destinations.applyDefault('tt1', 'system');
    expect(restricted.exemptions.grantPersonal).toHaveBeenCalled();

    const allowed = build();
    await allowed.destinations.applyDefault('tt1', 'system');
    expect(allowed.overrides.set).not.toHaveBeenCalled();
  });
});

describe('PolicyGate and an admin personal download', () => {
  it('publishes it once a subscriber’s request is admitted', async () => {
    const releaseManualHold = jest.fn().mockResolvedValue(true);
    const gate = new PolicyGate(
      {
        admissionsOf: jest.fn().mockResolvedValue(new Map([['u1', { admitted: true, via: 'shelf' }]])),
      } as unknown as PolicyService,
      { get: jest.fn().mockResolvedValue({ id: 'u1', profile: 'adult' }) } as unknown as UsersRepository,
      { lift: jest.fn().mockResolvedValue(undefined) } as unknown as PolicyRefusalsRepository,
      releaseManualHold,
    );

    await gate.admittedUserIds('tt1', ['u1']);
    expect(releaseManualHold).toHaveBeenCalledWith('tt1');

    releaseManualHold.mockClear();
    await gate.admittedUserIds('tt1', []);
    expect(releaseManualHold).not.toHaveBeenCalled();
  });
});
