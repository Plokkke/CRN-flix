import { MediaType } from '@crn-flix/contracts';

import { JellyfinMedia, JellyfinMediaService, JellyfinPlayer, toPlayerAsset } from '../src';

function media(overrides: Partial<JellyfinMedia>): JellyfinMedia {
  return { Id: 'id', Name: 'Name', ProductionYear: 2023, Type: 'Movie', ProviderIds: { Imdb: '' }, ...overrides };
}

const series = media({ Id: 'series-1', Name: 'Silo', Type: 'Series', ProviderIds: { Imdb: 'tt14688458' } });
const episode = media({
  Id: 'ep-1',
  Name: 'Freedom Day',
  Type: 'Episode',
  SeriesId: 'series-1',
  SeriesName: 'Silo',
  ParentIndexNumber: 1,
  IndexNumber: 1,
  ProviderIds: { Imdb: 'tt-episode' },
});

function buildPlayer() {
  const jellyfin = {
    url: 'https://jellyfin.example.com',
    listAssets: jest.fn().mockResolvedValue([]),
    listEntries: jest.fn().mockResolvedValue([]),
    refreshLibrary: jest.fn().mockResolvedValue(undefined),
    findUserByName: jest.fn().mockResolvedValue(null),
    registerUser: jest.fn().mockResolvedValue('new-id'),
    resetUserPassword: jest.fn().mockResolvedValue(undefined),
    getUserPolicy: jest.fn().mockResolvedValue({}),
    setUserPolicy: jest.fn().mockResolvedValue(undefined),
  };
  return { jellyfin, player: new JellyfinPlayer(jellyfin as unknown as JellyfinMediaService) };
}

describe('toPlayerAsset', () => {
  it('files an episode under its series imdb id, not its own', () => {
    expect(toPlayerAsset(episode, new Map([['series-1', 'tt14688458']]))).toMatchObject({
      imdbId: 'tt14688458',
      type: MediaType.Episode,
      title: 'Silo',
      seasonNumber: 1,
      episodeNumber: 1,
    });
  });

  it('falls back on the episode imdb id when its series has none', () => {
    expect(toPlayerAsset(episode, new Map())?.imdbId).toBe('tt-episode');
  });

  it('skips series and medias without any imdb id', () => {
    expect(toPlayerAsset(series, new Map())).toBeNull();
    expect(toPlayerAsset(media({ Type: 'Movie' }), new Map())).toBeNull();
  });
});

describe('JellyfinPlayer', () => {
  it('lists the identified movies and episodes of the library', async () => {
    const { jellyfin, player } = buildPlayer();
    jellyfin.listAssets.mockResolvedValue([series, episode, media({ Type: 'Movie', ProviderIds: { Imdb: 'tt1' } })]);

    const assets = await player.listAvailable();

    expect(assets.map((a) => `${a.type}:${a.imdbId}`)).toEqual(['episode:tt14688458', 'movie:tt1']);
  });

  describe('upsertAccount', () => {
    it('resets the password of a known account', async () => {
      const { jellyfin, player } = buildPlayer();

      await expect(player.upsertAccount('antoine', 'pw', 'jf-1')).resolves.toBe('jf-1');
      expect(jellyfin.resetUserPassword).toHaveBeenCalledWith('jf-1', 'pw');
      expect(jellyfin.findUserByName).not.toHaveBeenCalled();
    });

    it('adopts an existing account of the same name', async () => {
      const { jellyfin, player } = buildPlayer();
      jellyfin.findUserByName.mockResolvedValue({ Id: 'jf-2', Name: 'Antoine' });

      await expect(player.upsertAccount('antoine', 'pw', null)).resolves.toBe('jf-2');
      expect(jellyfin.resetUserPassword).toHaveBeenCalledWith('jf-2', 'pw');
      expect(jellyfin.registerUser).not.toHaveBeenCalled();
    });

    it('creates the account when none exists', async () => {
      const { jellyfin, player } = buildPlayer();

      await expect(player.upsertAccount('antoine', 'pw', null)).resolves.toBe('new-id');
      expect(jellyfin.registerUser).toHaveBeenCalledWith('antoine', 'pw');
      expect(jellyfin.resetUserPassword).not.toHaveBeenCalled();
    });
  });

  it('builds showcase posters from the player url, series artwork for episodes', async () => {
    const { jellyfin, player } = buildPlayer();
    jellyfin.listEntries.mockResolvedValue([episode]);

    const [item] = await player.showcase('episode', 5);

    expect(jellyfin.listEntries).toHaveBeenCalledWith(['Episode']);
    expect(item).toEqual({
      title: 'Silo',
      imdbId: 'tt-episode',
      type: 'episode',
      posterUrl: 'https://jellyfin.example.com/Items/series-1/Images/Primary?fillWidth=100',
    });
  });

  describe('account policy', () => {
    const viewer = {
      IsAdministrator: false,
      EnableRemoteAccess: true,
      EnableLiveTvAccess: true,
      EnableLiveTvManagement: false,
      EnableAudioPlaybackTranscoding: true,
      EnablePlaybackRemuxing: true,
      EnableVideoPlaybackTranscoding: false,
      EnableMediaConversion: false,
      MaxActiveSessions: 1,
      AuthenticationProviderId: 'auth-provider',
      PasswordResetProviderId: 'reset-provider',
    };

    it('applies the viewer rules on top of the full current policy', async () => {
      const { jellyfin, player } = buildPlayer();
      jellyfin.getUserPolicy.mockResolvedValue({
        ...viewer,
        EnableLiveTvAccess: false,
        EnableVideoPlaybackTranscoding: true,
        MaxActiveSessions: 0,
      });

      await expect(player.applyAccountPolicy('jf-1', { maxStreams: 3 })).resolves.toBe(true);
      expect(jellyfin.setUserPolicy).toHaveBeenCalledWith('jf-1', { ...viewer, MaxActiveSessions: 3 });
    });

    it('writes nothing when the account already complies', async () => {
      const { jellyfin, player } = buildPlayer();
      jellyfin.getUserPolicy.mockResolvedValue(viewer);

      await expect(player.applyAccountPolicy('jf-1', { maxStreams: 1 })).resolves.toBe(false);
      expect(jellyfin.setUserPolicy).not.toHaveBeenCalled();
    });

    it('never touches an administrator, whose stream limit is not the engine’s', async () => {
      const { jellyfin, player } = buildPlayer();
      jellyfin.getUserPolicy.mockResolvedValue({ ...viewer, IsAdministrator: true, MaxActiveSessions: 0 });

      await expect(player.applyAccountPolicy('jf-1', { maxStreams: 1 })).resolves.toBe(false);
      await expect(player.accountMaxStreams('jf-1')).resolves.toBeNull();
      expect(jellyfin.setUserPolicy).not.toHaveBeenCalled();
    });
  });
});
