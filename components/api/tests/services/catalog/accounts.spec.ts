import { Catalog, CatalogAccountRevokedError, CatalogAccountSource } from '@crn-flix/contracts';

import { CatalogAccountsService } from '@/services/catalog/accounts';
import { UsersRepository } from '@/services/database/users';

function build(renewCredentials: jest.Mock = jest.fn().mockResolvedValue(null)) {
  const watcher = { revoked: jest.fn(), usable: jest.fn() };
  const users = {
    list: jest.fn().mockResolvedValue([
      { id: 'u1', name: 'one', jellyfinId: 'jf1' },
      { id: 'u2', name: 'two', jellyfinId: null },
    ]),
  };
  const source = {
    listAccounts: jest.fn().mockResolvedValue([
      { playerAccountId: 'jf1', credentials: { token: 'a' } },
      { playerAccountId: 'jf-unknown', credentials: { token: 'b' } },
    ]),
    saveCredentials: jest.fn().mockResolvedValue(undefined),
    enforceSettings: jest.fn().mockResolvedValue(0),
  };
  const service = new CatalogAccountsService(
    users as unknown as UsersRepository,
    source as CatalogAccountSource,
    { renewCredentials } as unknown as Catalog,
    watcher,
  );
  return { source, renewCredentials, watcher, service };
}

describe('CatalogAccountsService', () => {
  it('ties each linked catalog account to the user owning that player account', async () => {
    const { service, source } = build();

    expect(await service.list()).toEqual([
      { user: { id: 'u1', name: 'one', jellyfinId: 'jf1' }, account: { userRef: 'u1', credentials: { token: 'a' } } },
    ]);
    expect(source.saveCredentials).not.toHaveBeenCalled();
  });

  it('stores renewed credentials where the player keeps them and uses them right away', async () => {
    const { service, source } = build(jest.fn().mockResolvedValue({ token: 'renewed' }));

    const [{ account }] = await service.list();

    expect(account.credentials).toEqual({ token: 'renewed' });
    expect(source.saveCredentials).toHaveBeenCalledWith('jf1', { token: 'renewed' });
  });

  it('renews an account once even when several callers list at the same time', async () => {
    const { service, renewCredentials } = build(jest.fn().mockResolvedValue({ token: 'renewed' }));

    await Promise.all([service.list(), service.list(), service.list()]);

    expect(renewCredentials).toHaveBeenCalledTimes(1);
  });

  it('leaves out an account the catalog revoked, keeps one whose renewal merely failed', async () => {
    const revoked = build(jest.fn().mockRejectedValue(new CatalogAccountRevokedError('refused')));
    const failed = build(jest.fn().mockRejectedValue(new Error('timeout')));

    expect(await revoked.service.list()).toEqual([]);
    expect((await failed.service.list())[0].account.credentials).toEqual({ token: 'a' });
  });

  it('tells the watcher which accounts work and which were revoked', async () => {
    const healthy = build();
    const revoked = build(jest.fn().mockRejectedValue(new CatalogAccountRevokedError('refused')));

    await healthy.service.list();
    await revoked.service.list();

    expect(healthy.watcher.usable).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }));
    expect(revoked.watcher.revoked).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }));
    expect(revoked.watcher.usable).not.toHaveBeenCalled();
  });
});
