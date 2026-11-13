import { ConsoleAdminChannel } from '../src';

const view = { title: 'Dérogation — Film', tone: 'warning' as const, fields: [], footer: null, operations: [] };

describe('ConsoleAdminChannel', () => {
  it('is always reachable and calls back once connected', async () => {
    const channel = new ConsoleAdminChannel({ adminIds: ['local-admin'] });
    const connected = jest.fn();

    channel.onConnected(connected);
    await new Promise((resolve) => setImmediate(resolve));

    expect(channel.isConnected()).toBe(true);
    expect(connected).toHaveBeenCalledTimes(1);
    expect(channel.adminIds).toEqual(['local-admin']);
  });

  it('gives every ticket its own reference', async () => {
    const channel = new ConsoleAdminChannel({ adminIds: ['local-admin'] });

    const [a, b] = await Promise.all([channel.postTicket(view), channel.postTicket(view)]);

    expect(a).toMatch(/^console:/);
    expect(a).not.toBe(b);
  });
});
