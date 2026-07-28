import { HydrackerApi, HydrackerUnparseableResponseError } from '@/modules/indexer/hydracker/api';
import { HydrackerIndexer } from '@/modules/indexer/hydracker/indexer';
import { HydrackerTitle } from '@/modules/indexer/hydracker/schemas';
import { EnginePreferences, Host, Language, Quality } from '@/modules/indexer/preferences';
import { MediaInfos, MediaType } from '@/services/database/medias';

type ApiStub = Pick<HydrackerApi, 'search' | 'listLinks'>;

const ALLOW_ALL: EnginePreferences = {
  allowedQualities: [],
  allowedLanguages: [],
  allowedHosts: [],
  sizePolicy: { bytesPerMinute: {}, tolerance: 1 },
};

const SITE_HOST = 'https://hydracker.test';

const baseMedia: MediaInfos = {
  imdbId: 'tt0111161',
  type: MediaType.Movie,
  title: 'The Shawshank Redemption',
  originalTitle: null,
  year: 1994,
  seasonNumber: null,
  episodeNumber: null,
  runtimeMinutes: 142,
};

const matchingTitle: HydrackerTitle = {
  id: 42,
  name: 'The Shawshank Redemption',
  imdb_id: 'tt0111161',
  tmdb_id: null,
  poster: null,
  type: 'film',
  is_series: false,
};

function buildIndexer(api: Partial<ApiStub>): HydrackerIndexer {
  return new HydrackerIndexer(api as HydrackerApi, SITE_HOST);
}

describe('HydrackerIndexer', () => {
  describe('find', () => {
    it('returns no candidate when media has no imdbId', async () => {
      const search = jest.fn();
      const indexer = buildIndexer({ search });

      await expect(indexer.find({ ...baseMedia, imdbId: '' }, ALLOW_ALL)).resolves.toEqual([]);
      expect(search).not.toHaveBeenCalled();
    });

    it('skips entirely when preferences exclude what hydracker can produce', async () => {
      const search = jest.fn();
      const indexer = buildIndexer({ search });

      await expect(indexer.find(baseMedia, { ...ALLOW_ALL, allowedQualities: [Quality.HD_720P] })).resolves.toEqual([]);
      await expect(indexer.find(baseMedia, { ...ALLOW_ALL, allowedLanguages: [Language.VOSTFR] })).resolves.toEqual([]);
      expect(search).not.toHaveBeenCalled();
    });

    it('returns no candidate when search returns empty arrays for every query', async () => {
      const search = jest.fn().mockResolvedValue([]);
      const indexer = buildIndexer({ search });

      await expect(indexer.find(baseMedia, ALLOW_ALL)).resolves.toEqual([]);
      expect(search).toHaveBeenCalled();
    });

    it('propagates unparseable response errors (handled by the orchestrator)', async () => {
      const search = jest.fn().mockRejectedValue(new HydrackerUnparseableResponseError('q', '<html>'));
      const indexer = buildIndexer({ search });

      await expect(indexer.find(baseMedia, ALLOW_ALL)).rejects.toThrow('Unparseable Hydracker response');
    });

    it('propagates generic API errors', async () => {
      const search = jest.fn().mockRejectedValue(new Error('socket hang up'));
      const indexer = buildIndexer({ search });

      await expect(indexer.find(baseMedia, ALLOW_ALL)).rejects.toThrow('socket hang up');
    });

    it('probes once without quality and stops when nothing is available at all', async () => {
      const search = jest.fn().mockResolvedValue([matchingTitle]);
      const listLinks = jest.fn().mockResolvedValue(false);
      const indexer = buildIndexer({ search, listLinks });

      await expect(indexer.find(baseMedia, ALLOW_ALL)).resolves.toEqual([]);
      expect(listLinks).toHaveBeenCalledTimes(1);
      expect(listLinks.mock.calls[0][1].quality).toBeUndefined();
    });

    it('returns no candidate when the probe passes but no listed quality has links', async () => {
      const search = jest.fn().mockResolvedValue([matchingTitle]);
      const listLinks = jest.fn().mockImplementation((_id, options) => Promise.resolve(options.quality === undefined));
      const indexer = buildIndexer({ search, listLinks });

      await expect(indexer.find(baseMedia, ALLOW_ALL)).resolves.toEqual([]);
      expect(listLinks.mock.calls.length).toBeGreaterThan(1);
    });

    it('returns a 1080p truefrench 1fichier candidate when links are available', async () => {
      const search = jest.fn().mockResolvedValue([matchingTitle]);
      const listLinks = jest.fn().mockResolvedValue(true);
      const indexer = buildIndexer({ search, listLinks });

      const candidates = await indexer.find(baseMedia, ALLOW_ALL);

      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        indexerName: 'hydracker',
        quality: Quality.HD_1080P,
        language: Language.TRUEFRENCH,
        host: Host.ONE_FICHIER,
        sizeBytes: null,
      });
      expect(candidates[0].url).toContain(SITE_HOST);
      expect(candidates[0].url).toContain('/titles/42');
    });

    it('builds an episode URL with season and episode path segments', async () => {
      const episodeMedia: MediaInfos = {
        ...baseMedia,
        type: MediaType.Episode,
        seasonNumber: 2,
        episodeNumber: 5,
      };
      const search = jest.fn().mockResolvedValue([{ ...matchingTitle, is_series: true }]);
      const listLinks = jest.fn().mockResolvedValue(true);
      const indexer = buildIndexer({ search, listLinks });

      const candidates = await indexer.find(episodeMedia, ALLOW_ALL);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].url).toContain('/titles/42/season/2/episode/5/download');
      expect(listLinks).toHaveBeenCalledWith(42, expect.objectContaining({ season: 2, episode: 5 }));
    });

    it('propagates listLinks errors', async () => {
      const search = jest.fn().mockResolvedValue([matchingTitle]);
      const listLinks = jest.fn().mockRejectedValue(new Error('boom'));
      const indexer = buildIndexer({ search, listLinks });

      await expect(indexer.find(baseMedia, ALLOW_ALL)).rejects.toThrow('boom');
    });

    it('ignores search results whose type is filtered or whose series flag mismatches', async () => {
      const search = jest.fn().mockResolvedValue([
        { ...matchingTitle, type: 'music' },
        { ...matchingTitle, is_series: true },
      ]);
      const indexer = buildIndexer({ search });

      await expect(indexer.find(baseMedia, ALLOW_ALL)).resolves.toEqual([]);
    });
  });
});
