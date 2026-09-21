import { JellyfinMediaService } from '@/modules/jellyfin/jellyfin';
import { TraktPlugin } from '@/modules/jellyfin/plugins/trakt';

const config = { TraktUsers: [] };

function setup() {
  const jellyfin = {
    listPlugins: jest.fn().mockResolvedValue([{ Id: 'trakt-id', Name: 'Trakt' }]),
    getPluginConfiguration: jest.fn().mockResolvedValue(config),
    setPluginConfiguration: jest.fn().mockResolvedValue(undefined),
  };
  return { jellyfin, plugin: new TraktPlugin(jellyfin as unknown as JellyfinMediaService) };
}

describe('TraktPlugin', () => {
  it('does not touch Jellyfin until first use', () => {
    const { jellyfin } = setup();
    expect(jellyfin.listPlugins).not.toHaveBeenCalled();
  });

  it('resolves the plugin once and reuses it', async () => {
    const { jellyfin, plugin } = setup();
    await plugin.getUsersAuthContext();
    await plugin.getUsersAuthContext();
    expect(jellyfin.listPlugins).toHaveBeenCalledTimes(1);
    expect(jellyfin.setPluginConfiguration).toHaveBeenCalledTimes(1);
  });

  it('retries the resolution after a Jellyfin failure', async () => {
    const { jellyfin, plugin } = setup();
    jellyfin.listPlugins.mockRejectedValueOnce(new Error('502'));

    await expect(plugin.getUsersAuthContext()).rejects.toThrow('502');
    await expect(plugin.getUsersAuthContext()).resolves.toEqual([]);
    expect(jellyfin.listPlugins).toHaveBeenCalledTimes(2);
  });
});
