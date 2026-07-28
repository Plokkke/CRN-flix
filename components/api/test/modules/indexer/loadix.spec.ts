import { IndexerMedia, MediaType } from '@/modules/indexer/contract';
import { LoadixApi } from '@/modules/indexer/loadix/api';
import { LoadixIndexer } from '@/modules/indexer/loadix/indexer';
import { LoadixLink, LoadixMediaDetail, LoadixSearchHit } from '@/modules/indexer/loadix/schemas';
import { Host, Language, Quality } from '@/modules/indexer/preferences';

type ApiStub = Pick<LoadixApi, 'search' | 'getMedia' | 'listLinks'>;

const SITE_HOST = 'https://loadix.test';
const MEDIA_ID = '78b22d3e-00d5-40b6-85c2-714c22d43f90';

const movieMedia: IndexerMedia = {
  imdbId: 'tt0152930',
  type: MediaType.Movie,
  title: 'Taxi',
  originalTitle: null,
  year: 1998,
  seasonNumber: null,
  episodeNumber: null,
  runtimeMinutes: 86,
};

const episodeMedia: IndexerMedia = {
  imdbId: 'tt14688458',
  type: MediaType.Episode,
  title: 'Silo',
  originalTitle: null,
  year: 2023,
  seasonNumber: 3,
  episodeNumber: 1,
  runtimeMinutes: 50,
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

function buildIndexer(api: Partial<ApiStub>): LoadixIndexer {
  return new LoadixIndexer(api as LoadixApi, SITE_HOST);
}

describe('LoadixIndexer', () => {
  it('returns no candidate when media has no imdbId', async () => {
    const search = jest.fn();
    const indexer = buildIndexer({ search });

    await expect(indexer.find({ ...movieMedia, imdbId: '' })).resolves.toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it('returns no candidate when no search hit matches the imdbId', async () => {
    const search = jest.fn().mockResolvedValue([movieHit]);
    const getMedia = jest.fn().mockResolvedValue({
      ...movieDetail,
      media: { ...movieDetail.media, imdbId: 'tt9999999' },
    });
    const indexer = buildIndexer({ search, getMedia });

    await expect(indexer.find(movieMedia)).resolves.toEqual([]);
  });

  it('maps movie links into candidates pointing at the media page', async () => {
    const search = jest.fn().mockResolvedValue([movieHit]);
    const getMedia = jest.fn().mockResolvedValue(movieDetail);
    const listLinks = jest.fn().mockResolvedValue([movieLink]);
    const indexer = buildIndexer({ search, getMedia, listLinks });

    const candidates = await indexer.find(movieMedia);

    expect(candidates).toEqual([
      {
        indexerName: 'loadix',
        url: `${SITE_HOST}/media/${MEDIA_ID}`,
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

    await expect(indexer.find(movieMedia)).resolves.toEqual([]);
  });

  it('ignores hits with the wrong type, no links, or a far-off year', async () => {
    const search = jest.fn().mockResolvedValue([
      { ...movieHit, type: 'series' },
      { ...movieHit, hasLinks: false },
      { ...movieHit, year: 2010 },
    ]);
    const getMedia = jest.fn();
    const indexer = buildIndexer({ search, getMedia });

    await expect(indexer.find(movieMedia)).resolves.toEqual([]);
    expect(getMedia).not.toHaveBeenCalled();
  });

  it('stops fetching details once the lookup budget is exhausted', async () => {
    const hits = Array.from({ length: 10 }, (_, i) => ({ ...movieHit, id: `hit-${i}` }));
    const search = jest.fn().mockResolvedValue(hits);
    const getMedia = jest.fn().mockResolvedValue({
      ...movieDetail,
      media: { ...movieDetail.media, imdbId: 'tt9999999' },
    });
    const indexer = buildIndexer({ search, getMedia });

    await expect(indexer.find(movieMedia)).resolves.toEqual([]);
    expect(getMedia).toHaveBeenCalledTimes(5);
  });

  it('resolves the seasonId and keeps only the requested episode links', async () => {
    const seriesDetail: LoadixMediaDetail = {
      media: { id: 'series-id', type: 'series', imdbId: 'tt14688458', title: 'Silo' },
      seasons: [
        { id: 'season-1', seasonNumber: 1 },
        { id: 'season-3', seasonNumber: 3 },
      ],
    };
    const episodeLink: LoadixLink = {
      ...movieLink,
      scope: 'episode',
      seasonNumber: 3,
      episodeNumber: 1,
      quality: 'WEB 1080p (x265)',
      language: 'MULTi VFF',
      sizeBytes: '2630000000',
      releaseGroup: null,
    };
    const search = jest.fn().mockResolvedValue([{ ...movieHit, id: 'series-id', type: 'series', year: 2023 }]);
    const getMedia = jest.fn().mockResolvedValue(seriesDetail);
    const listLinks = jest.fn().mockResolvedValue([episodeLink, { ...episodeLink, episodeNumber: 3 }]);
    const indexer = buildIndexer({ search, getMedia, listLinks });

    const candidates = await indexer.find(episodeMedia);

    expect(listLinks).toHaveBeenCalledWith('series-id', { seasonId: 'season-3' });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      quality: Quality.HD_1080P,
      language: Language.MULTI,
      host: Host.ONE_FICHIER,
      sizeBytes: 2630000000,
    });
  });

  it('returns no candidate when the requested season does not exist on Loadix', async () => {
    const search = jest.fn().mockResolvedValue([{ ...movieHit, id: 'series-id', type: 'series', year: 2023 }]);
    const getMedia = jest.fn().mockResolvedValue({
      media: { id: 'series-id', type: 'series', imdbId: 'tt14688458', title: 'Silo' },
      seasons: [{ id: 'season-1', seasonNumber: 1 }],
    });
    const listLinks = jest.fn();
    const indexer = buildIndexer({ search, getMedia, listLinks });

    await expect(indexer.find(episodeMedia)).resolves.toEqual([]);
    expect(listLinks).not.toHaveBeenCalled();
  });

  it('propagates API errors (handled by the orchestrator)', async () => {
    const search = jest.fn().mockRejectedValue(new Error('boom'));
    const indexer = buildIndexer({ search });

    await expect(indexer.find(movieMedia)).rejects.toThrow('boom');
  });
});
