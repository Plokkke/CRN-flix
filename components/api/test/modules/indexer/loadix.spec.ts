import { IndexerBookmark, IndexerTarget } from '@/modules/indexer/contract';
import { LoadixApi } from '@/modules/indexer/loadix/api';
import { LoadixIndexer } from '@/modules/indexer/loadix/indexer';
import { LoadixLink, LoadixMediaDetail, LoadixSearchHit } from '@/modules/indexer/loadix/schemas';
import { EnginePreferences, Host, Language, Quality } from '@/modules/indexer/preferences';
import { MediaType } from '@/services/database/medias';

type ApiStub = Pick<LoadixApi, 'search' | 'getMedia' | 'listLinks'>;

const ALLOW_ALL: EnginePreferences = {
  allowedQualities: [],
  allowedLanguages: [],
  allowedHosts: [],
  sizePolicy: { bytesPerMinute: {}, tolerance: 1 },
};

const SITE_HOST = 'https://loadix.test';
const MEDIA_ID = '78b22d3e-00d5-40b6-85c2-714c22d43f90';

const movieTarget: Extract<IndexerTarget, { kind: 'movie' }> = {
  kind: 'movie',
  media: {
    imdbId: 'tt0152930',
    type: MediaType.Movie,
    title: 'Taxi',
    originalTitle: null,
    frenchTitle: null,
    originalLanguage: null,
    year: 1998,
    seasonNumber: null,
    episodeNumber: null,
    runtimeMinutes: 86,
  },
};

const showTarget: IndexerTarget = {
  kind: 'show',
  imdbId: 'tt14688458',
  title: 'Silo',
  originalTitle: null,
  frenchTitle: null,
  originalLanguage: null,
  year: 2023,
  episodes: [
    { season: 3, episode: 1, runtimeMinutes: 50 },
    { season: 3, episode: 2, runtimeMinutes: 50 },
    { season: 3, episode: 3, runtimeMinutes: 50 },
  ],
};

const movieHit: LoadixSearchHit = {
  id: MEDIA_ID,
  type: 'movie',
  title: 'Taxi',
  year: 1998,
  hasLinks: true,
};

const movieDetail: LoadixMediaDetail = {
  media: { id: MEDIA_ID, type: 'movie', imdbId: 'tt0152930', title: 'Taxi' },
  seasons: [],
};

const movieLink: LoadixLink = {
  id: '57742842-e57b-42b1-bd67-3baf9976d03d',
  scope: 'series',
  seasonNumber: null,
  episodeNumber: null,
  provider: '1fichier',
  linkType: 'ddl_url',
  quality: 'HDLight 1080p',
  language: 'VFF',
  sizeBytes: '2988241207',
  releaseGroup: 'Taxi.1998.VOF.1080P.mHD.X264.AC3-ROMKENT.mkv',
  status: 'validated',
};

const seriesDetail: LoadixMediaDetail = {
  media: { id: 'series-id', type: 'series', imdbId: 'tt14688458', title: 'Silo' },
  seasons: [
    { id: 'season-1', seasonNumber: 1 },
    { id: 'season-3', seasonNumber: 3 },
  ],
};

const episodeLink: LoadixLink = {
  ...movieLink,
  id: 'link-episode',
  scope: 'episode',
  seasonNumber: 3,
  episodeNumber: 1,
  quality: 'WEB 1080p (x265)',
  language: 'MULTi VFF',
  sizeBytes: '2630000000',
  releaseGroup: null,
};

function buildIndexer(api: Partial<ApiStub>): LoadixIndexer {
  return new LoadixIndexer(api as LoadixApi, SITE_HOST);
}

describe('LoadixIndexer', () => {
  it('returns no candidate when the target has no imdbId', async () => {
    const search = jest.fn();
    const indexer = buildIndexer({ search });

    const target: IndexerTarget = { ...movieTarget, media: { ...movieTarget.media, imdbId: '' } };
    await expect(indexer.find(target, ALLOW_ALL, null)).resolves.toMatchObject({ candidates: [] });
    expect(search).not.toHaveBeenCalled();
  });

  it('returns no candidate when no search hit matches the imdbId', async () => {
    const search = jest.fn().mockResolvedValue([movieHit]);
    const getMedia = jest.fn().mockResolvedValue({
      ...movieDetail,
      media: { ...movieDetail.media, imdbId: 'tt9999999' },
    });
    const indexer = buildIndexer({ search, getMedia });

    await expect(indexer.find(movieTarget, ALLOW_ALL, null)).resolves.toMatchObject({ candidates: [] });
  });

  it('maps movie links into movie-scoped candidates pointing at the media page', async () => {
    const search = jest.fn().mockResolvedValue([movieHit]);
    const getMedia = jest.fn().mockResolvedValue(movieDetail);
    const listLinks = jest.fn().mockResolvedValue([movieLink]);
    const indexer = buildIndexer({ search, getMedia, listLinks });

    const { candidates } = await indexer.find(movieTarget, ALLOW_ALL, null);

    expect(candidates).toEqual([
      {
        indexerName: 'loadix',
        url: `${SITE_HOST}/media/${MEDIA_ID}`,
        scope: { kind: 'movie' },
        quality: Quality.HD_1080P,
        language: Language.TRUEFRENCH,
        host: Host.ONE_FICHIER,
        sizeBytes: 2988241207,
      },
    ]);
    expect(listLinks).toHaveBeenCalledWith(MEDIA_ID, { seasonId: undefined });
  });

  it('excludes links that are not validated ddl urls', async () => {
    const search = jest.fn().mockResolvedValue([movieHit]);
    const getMedia = jest.fn().mockResolvedValue(movieDetail);
    const listLinks = jest.fn().mockResolvedValue([
      { ...movieLink, status: 'pending' },
      { ...movieLink, linkType: 'stream' },
    ]);
    const indexer = buildIndexer({ search, getMedia, listLinks });

    await expect(indexer.find(movieTarget, ALLOW_ALL, null)).resolves.toMatchObject({ candidates: [] });
  });

  it('ignores hits with the wrong type, no links, or a far-off year', async () => {
    const search = jest.fn().mockResolvedValue([
      { ...movieHit, type: 'series' },
      { ...movieHit, hasLinks: false },
      { ...movieHit, year: 2010 },
    ]);
    const getMedia = jest.fn();
    const indexer = buildIndexer({ search, getMedia });

    await expect(indexer.find(movieTarget, ALLOW_ALL, null)).resolves.toMatchObject({ candidates: [] });
    expect(getMedia).not.toHaveBeenCalled();
  });

  it('inspects anime hits for both movie and show targets (Loadix files animation apart)', async () => {
    const animeHit: LoadixSearchHit = { id: 'anime-id', type: 'anime', title: "La Pat' Patrouille", year: 2023 };
    const animeDetail: LoadixMediaDetail = {
      media: { id: 'anime-id', type: 'anime', imdbId: 'tt14688458', title: "La Pat' Patrouille" },
      seasons: [{ id: 'season-3', seasonNumber: 3 }],
    };
    const search = jest.fn().mockResolvedValue([animeHit]);
    const getMedia = jest.fn().mockResolvedValue(animeDetail);
    const listLinks = jest.fn().mockResolvedValue([episodeLink]);
    const indexer = buildIndexer({ search, getMedia, listLinks });

    const { candidates, bookmark } = await indexer.find(showTarget, ALLOW_ALL, null);

    expect(getMedia).toHaveBeenCalledWith('anime-id');
    expect(candidates).toHaveLength(1);
    expect(bookmark?.pageUrl).toBe(`${SITE_HOST}/media/anime-id`);
  });

  it('stops fetching details once the lookup budget is exhausted', async () => {
    const hits = Array.from({ length: 10 }, (_, i) => ({ ...movieHit, id: `hit-${i}` }));
    const search = jest.fn().mockResolvedValue(hits);
    const getMedia = jest.fn().mockResolvedValue({
      ...movieDetail,
      media: { ...movieDetail.media, imdbId: 'tt9999999' },
    });
    const indexer = buildIndexer({ search, getMedia });

    await expect(indexer.find(movieTarget, ALLOW_ALL, null)).resolves.toMatchObject({ candidates: [] });
    expect(getMedia).toHaveBeenCalledTimes(5);
  });

  describe('title queries', () => {
    const hangover: Extract<IndexerTarget, { kind: 'movie' }> = {
      kind: 'movie',
      media: {
        ...movieTarget.media,
        imdbId: 'tt1119646',
        title: 'The Hangover',
        originalTitle: 'The Hangover',
        frenchTitle: 'Very Bad Trip',
        year: 2009,
      },
    };
    const hangoverHit: LoadixSearchHit = {
      id: 'hangover-id',
      type: 'movie',
      title: 'Very Bad Trip',
      originalTitle: 'The Hangover',
      year: 2009,
      hasLinks: true,
    };
    const hangoverDetail: LoadixMediaDetail = {
      media: { id: 'hangover-id', type: 'movie', imdbId: 'tt1119646', title: 'Very Bad Trip' },
      seasons: [],
    };

    it('searches the French title first and stops at the first match', async () => {
      const search = jest.fn().mockResolvedValue([hangoverHit]);
      const getMedia = jest.fn().mockResolvedValue(hangoverDetail);
      const listLinks = jest.fn().mockResolvedValue([]);
      const indexer = buildIndexer({ search, getMedia, listLinks });

      const { bookmark } = await indexer.find(hangover, ALLOW_ALL, null);

      expect(search).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledWith('Very Bad Trip', { from: 2008, to: 2010 });
      expect(bookmark?.searchUrl).toBe(`${SITE_HOST}/search?q=Very+Bad+Trip&year_from=2008&year_to=2010`);
    });

    it('searches without a year window when the year is unknown', async () => {
      const search = jest.fn().mockResolvedValue([hangoverHit]);
      const getMedia = jest.fn().mockResolvedValue(hangoverDetail);
      const listLinks = jest.fn().mockResolvedValue([]);
      const indexer = buildIndexer({ search, getMedia, listLinks });

      const { bookmark } = await indexer.find(
        { ...hangover, media: { ...hangover.media, year: null } },
        ALLOW_ALL,
        null,
      );

      expect(search).toHaveBeenCalledWith('Very Bad Trip', null);
      expect(bookmark?.searchUrl).toBe(`${SITE_HOST}/search?q=Very+Bad+Trip`);
    });

    it('falls back to the original then the English title', async () => {
      const search = jest.fn().mockImplementation((query: string) => (query === 'The Hangover' ? [hangoverHit] : []));
      const getMedia = jest.fn().mockResolvedValue(hangoverDetail);
      const listLinks = jest.fn().mockResolvedValue([]);
      const indexer = buildIndexer({ search, getMedia, listLinks });

      await indexer.find(hangover, ALLOW_ALL, null);

      expect(search.mock.calls.map(([query]) => query)).toEqual(['Very Bad Trip', 'The Hangover']);
    });

    it('looks up hits carrying one of the known titles before look-alikes', async () => {
      const lookAlike = {
        ...hangoverHit,
        id: 'look-alike',
        title: 'Very Bad Trip 2',
        originalTitle: 'The Hangover Part II',
      };
      const search = jest.fn().mockResolvedValue([lookAlike, hangoverHit]);
      const getMedia = jest.fn().mockResolvedValue(hangoverDetail);
      const listLinks = jest.fn().mockResolvedValue([]);
      const indexer = buildIndexer({ search, getMedia, listLinks });

      await indexer.find(hangover, ALLOW_ALL, null);

      expect(getMedia).toHaveBeenCalledTimes(1);
      expect(getMedia).toHaveBeenCalledWith('hangover-id');
    });

    it('spends at most two lookups per query on look-alikes so later queries keep their budget', async () => {
      const lookAlikes = Array.from({ length: 5 }, (_, i) => ({
        ...hangoverHit,
        id: `alike-${i}`,
        title: `Trip ${i}`,
        originalTitle: `Trip ${i}`,
      }));
      const search = jest
        .fn()
        .mockImplementation((query: string) => (query === 'Very Bad Trip' ? lookAlikes : [hangoverHit]));
      const getMedia = jest
        .fn()
        .mockImplementation((id: string) =>
          id === 'hangover-id'
            ? hangoverDetail
            : { ...hangoverDetail, media: { ...hangoverDetail.media, id, imdbId: 'tt0' } },
        );
      const listLinks = jest.fn().mockResolvedValue([]);
      const indexer = buildIndexer({ search, getMedia, listLinks });

      const { bookmark } = await indexer.find(hangover, ALLOW_ALL, null);

      expect(getMedia.mock.calls.map(([id]) => id)).toEqual(['alike-0', 'alike-1', 'hangover-id']);
      expect(bookmark?.pageUrl).toBe(`${SITE_HOST}/media/hangover-id`);
    });
  });

  it('lists links unscoped and per intent season, deduplicated by link id', async () => {
    const search = jest.fn().mockResolvedValue([{ ...movieHit, id: 'series-id', type: 'series', year: 2023 }]);
    const getMedia = jest.fn().mockResolvedValue(seriesDetail);
    const listLinks = jest.fn().mockResolvedValue([episodeLink]);
    const indexer = buildIndexer({ search, getMedia, listLinks });

    const { candidates } = await indexer.find(showTarget, ALLOW_ALL, null);

    expect(listLinks).toHaveBeenCalledTimes(2);
    expect(listLinks).toHaveBeenCalledWith('series-id', { seasonId: undefined });
    expect(listLinks).toHaveBeenCalledWith('series-id', { seasonId: 'season-3' });
    // Same link returned by both listings → a single candidate.
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      scope: { kind: 'episode', season: 3, episode: 1 },
      quality: Quality.HD_1080P,
      language: Language.MULTI,
      host: Host.ONE_FICHIER,
      sizeBytes: 2630000000,
    });
  });

  it('derives season and series scopes from the link season/episode fields', async () => {
    const seasonPack: LoadixLink = { ...movieLink, id: 'link-season', scope: 'season', seasonNumber: 3 };
    const seriesPack: LoadixLink = { ...movieLink, id: 'link-series', scope: 'series' };
    const otherSeasonPack: LoadixLink = { ...movieLink, id: 'link-other', scope: 'season', seasonNumber: 1 };

    const search = jest.fn().mockResolvedValue([{ ...movieHit, id: 'series-id', type: 'series', year: 2023 }]);
    const getMedia = jest.fn().mockResolvedValue(seriesDetail);
    const listLinks = jest.fn().mockResolvedValue([seasonPack, seriesPack, otherSeasonPack]);
    const indexer = buildIndexer({ search, getMedia, listLinks });

    const { candidates } = await indexer.find(showTarget, ALLOW_ALL, null);

    // The season-1 pack is outside the intent (season 3 only) and is dropped.
    expect(candidates.map((c) => c.scope)).toEqual(
      expect.arrayContaining([{ kind: 'season', season: 3 }, { kind: 'series' }]),
    );
    expect(candidates).toHaveLength(2);
  });

  it('collapses same-scope same-quality links into the lightest candidate (page URL is shared)', async () => {
    const heavy: LoadixLink = { ...episodeLink, id: 'link-heavy', sizeBytes: '9999999999' };
    const unknownSize: LoadixLink = { ...episodeLink, id: 'link-unknown', sizeBytes: null };
    const light: LoadixLink = { ...episodeLink, id: 'link-light' };

    const search = jest.fn().mockResolvedValue([{ ...movieHit, id: 'series-id', type: 'series', year: 2023 }]);
    const getMedia = jest.fn().mockResolvedValue(seriesDetail);
    const listLinks = jest.fn().mockResolvedValueOnce([heavy, unknownSize, light]).mockResolvedValue([]);
    const indexer = buildIndexer({ search, getMedia, listLinks });

    const { candidates } = await indexer.find(showTarget, ALLOW_ALL, null);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].sizeBytes).toBe(2630000000);
  });

  it('propagates API errors (handled by the planner)', async () => {
    const search = jest.fn().mockRejectedValue(new Error('boom'));
    const indexer = buildIndexer({ search });

    await expect(indexer.find(movieTarget, ALLOW_ALL, null)).rejects.toThrow('boom');
  });

  describe('bookmarks', () => {
    const movieBookmark: IndexerBookmark = {
      pageUrl: `${SITE_HOST}/media/${MEDIA_ID}`,
      searchUrl: `${SITE_HOST}/search?q=Taxi&year_from=1997&year_to=1999`,
      state: { mediaId: MEDIA_ID, seasons: [] },
    };

    it('remembers the matched media page and a manual search url', async () => {
      const search = jest.fn().mockResolvedValue([movieHit]);
      const getMedia = jest.fn().mockResolvedValue(movieDetail);
      const listLinks = jest.fn().mockResolvedValue([movieLink]);
      const indexer = buildIndexer({ search, getMedia, listLinks });

      const { bookmark } = await indexer.find(movieTarget, ALLOW_ALL, null);

      expect(bookmark).toEqual(movieBookmark);
    });

    it('remembers only the search url when nothing matched', async () => {
      const search = jest.fn().mockResolvedValue([]);
      const indexer = buildIndexer({ search });

      const { bookmark } = await indexer.find(movieTarget, ALLOW_ALL, null);

      expect(bookmark).toEqual({
        pageUrl: null,
        searchUrl: `${SITE_HOST}/search?q=Taxi&year_from=1997&year_to=1999`,
        state: null,
      });
    });

    it('skips search and detail lookups when handed a bookmark', async () => {
      const search = jest.fn();
      const getMedia = jest.fn();
      const listLinks = jest.fn().mockResolvedValue([movieLink]);
      const indexer = buildIndexer({ search, getMedia, listLinks });

      const result = await indexer.find(movieTarget, ALLOW_ALL, movieBookmark);

      expect(result.candidates).toHaveLength(1);
      expect(result.bookmark).toEqual(movieBookmark);
      expect(search).not.toHaveBeenCalled();
      expect(getMedia).not.toHaveBeenCalled();
      expect(listLinks).toHaveBeenCalledWith(MEDIA_ID, expect.anything());
    });

    it('refreshes the detail once when the intent reaches a season the bookmark does not know', async () => {
      const search = jest.fn();
      const getMedia = jest.fn().mockResolvedValue(seriesDetail);
      const listLinks = jest.fn().mockResolvedValue([episodeLink]);
      const indexer = buildIndexer({ search, getMedia, listLinks });
      const stale: IndexerBookmark = {
        pageUrl: `${SITE_HOST}/media/series-id`,
        searchUrl: null,
        state: { mediaId: 'series-id', seasons: [{ id: 'season-1', seasonNumber: 1 }] },
      };

      const { bookmark } = await indexer.find(showTarget, ALLOW_ALL, stale);

      expect(search).not.toHaveBeenCalled();
      expect(getMedia).toHaveBeenCalledWith('series-id');
      expect(listLinks).toHaveBeenCalledWith('series-id', expect.objectContaining({ seasonId: 'season-3' }));
      expect(bookmark?.state).toEqual({ mediaId: 'series-id', seasons: seriesDetail.seasons });
    });

    it('searches again when the bookmarked media is gone', async () => {
      const gone = Object.assign(new Error('Not Found'), { isAxiosError: true, response: { status: 404 } });
      const search = jest.fn().mockResolvedValue([movieHit]);
      const getMedia = jest.fn().mockResolvedValue(movieDetail);
      const listLinks = jest.fn().mockRejectedValueOnce(gone).mockResolvedValue([movieLink]);
      const indexer = buildIndexer({ search, getMedia, listLinks });

      const result = await indexer.find(movieTarget, ALLOW_ALL, {
        ...movieBookmark,
        state: { mediaId: 'stale-id', seasons: [] },
      });

      expect(search).toHaveBeenCalled();
      expect(result.candidates).toHaveLength(1);
      expect(result.bookmark).toEqual(movieBookmark);
    });

    it('searches again when the refreshed detail no longer carries the imdb id', async () => {
      const search = jest.fn().mockResolvedValue([]);
      const getMedia = jest
        .fn()
        .mockResolvedValue({ ...seriesDetail, media: { ...seriesDetail.media, imdbId: 'tt0' } });
      const indexer = buildIndexer({ search, getMedia });

      const result = await indexer.find(showTarget, ALLOW_ALL, {
        pageUrl: null,
        searchUrl: null,
        state: { mediaId: 'series-id', seasons: [] },
      });

      expect(search).toHaveBeenCalled();
      expect(result.bookmark?.pageUrl).toBeNull();
    });

    it('ignores a bookmark whose state it does not recognize', async () => {
      const search = jest.fn().mockResolvedValue([movieHit]);
      const getMedia = jest.fn().mockResolvedValue(movieDetail);
      const listLinks = jest.fn().mockResolvedValue([movieLink]);
      const indexer = buildIndexer({ search, getMedia, listLinks });

      const result = await indexer.find(movieTarget, ALLOW_ALL, { pageUrl: null, searchUrl: null, state: { foo: 1 } });

      expect(search).toHaveBeenCalled();
      expect(result.bookmark).toEqual(movieBookmark);
    });
  });
});
