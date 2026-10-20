import { DEFAULT_TRAKT_PLUGIN_CONFIG, JellyfinMediaService, TraktPlugin } from '../src';

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
    await plugin.listAccounts();
    await plugin.listAccounts();
    expect(jellyfin.listPlugins).toHaveBeenCalledTimes(1);
    expect(jellyfin.setPluginConfiguration).toHaveBeenCalledTimes(1);
  });

  it('retries the resolution after a Jellyfin failure', async () => {
    const { jellyfin, plugin } = setup();
    jellyfin.listPlugins.mockRejectedValueOnce(new Error('502'));

    await expect(plugin.listAccounts()).rejects.toThrow('502');
    await expect(plugin.listAccounts()).resolves.toEqual([]);
    expect(jellyfin.listPlugins).toHaveBeenCalledTimes(2);
  });

  it('keeps every account when several tokens are written at once', async () => {
    let stored = {
      TraktUsers: ['jf1', 'jf2', 'jf3'].map((id) => ({
        LinkedMbUserId: id,
        Scrobble: true,
        SkipUnwatchedImportFromTrakt: false,
        SkipPlaybackProgressImportFromTrakt: true,
        SkipWatchedImportFromTrakt: false,
        PostWatchedHistory: true,
        PostUnwatchedHistory: false,
        PostSetWatched: false,
        PostSetUnwatched: false,
        SynchronizeCollections: false,
        ExportMediaInfo: false,
        DontRemoveItemFromTrakt: false,
        ExtraLogging: false,
        RefreshToken: 'old',
      })),
    };
    const { jellyfin, plugin } = setup();
    jellyfin.getPluginConfiguration.mockImplementation(async () => structuredClone(stored));
    jellyfin.setPluginConfiguration.mockImplementation(async (_id: string, next: typeof stored) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      stored = structuredClone(next);
    });
    const tokens = (refreshToken: string) => ({ accessToken: 'a', refreshToken, accessTokenExpiration: 'x' });

    await Promise.all(['jf1', 'jf2', 'jf3'].map((id) => plugin.saveCredentials(id, tokens(`new-${id}`))));

    expect(stored.TraktUsers.map((user) => user.RefreshToken)).toEqual(['new-jf1', 'new-jf2', 'new-jf3']);
  });

  it('only scrobbles: every setting off but scrobbling and skipping the playback progress import', () => {
    const { LocationsExcluded, ...settings } = DEFAULT_TRAKT_PLUGIN_CONFIG;

    expect(LocationsExcluded).toEqual([]);
    expect(Object.entries(settings).filter(([, enabled]) => enabled)).toEqual([
      ['Scrobble', true],
      ['SkipPlaybackProgressImportFromTrakt', true],
    ]);
  });
});
