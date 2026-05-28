import { MediaInfos, MediaType } from '@/services/database/medias';

import { DarkiworldApi, DarkiworldUnparseableResponseError } from './api';
import { DarkiworldService } from './service';
import { DarkiworldTitle } from './types';

type ApiStub = Pick<DarkiworldApi, 'search' | 'listLinks' | 'ping'>;

const SITE_HOST = 'https://darki.test';

const baseMedia: MediaInfos = {
  imdbId: 'tt0111161',
  type: MediaType.Movie,
  title: 'The Shawshank Redemption',
  originalTitle: null,
  year: 1994,
  seasonNumber: null,
  episodeNumber: null,
};

const matchingTitle: DarkiworldTitle = {
  id: 42,
  name: 'The Shawshank Redemption',
  imdb_id: 'tt0111161',
  tmdb_id: null,
  poster: null,
  type: 'film',
  is_series: false,
};

function buildService(api: Partial<ApiStub>): DarkiworldService {
  return new DarkiworldService(api as DarkiworldApi, SITE_HOST);
}

describe('DarkiworldService', () => {
  describe('find', () => {
    it('returns not-found when media has no imdbId', async () => {
      const search = jest.fn();
      const service = buildService({ search });

      const result = await service.find({ ...baseMedia, imdbId: '' });

      expect(result).toEqual({ status: 'not-found' });
      expect(search).not.toHaveBeenCalled();
    });

    it('returns not-found when search returns empty arrays for every query', async () => {
      const search = jest.fn().mockResolvedValue([]);
      const service = buildService({ search });

      const result = await service.find(baseMedia);

      expect(result).toEqual({ status: 'not-found' });
      expect(search).toHaveBeenCalled();
    });

    it('returns unknown when search throws DarkiworldUnparseableResponseError', async () => {
      const search = jest.fn().mockRejectedValue(new DarkiworldUnparseableResponseError('q', '<html>'));
      const service = buildService({ search });

      const result = await service.find(baseMedia);

      expect(result.status).toBe('unknown');
      if (result.status === 'unknown') {
        expect(result.reason).toContain('Unparseable Darkiworld response');
      }
    });

    it('returns unknown when search throws a generic axios-like error', async () => {
      const search = jest.fn().mockRejectedValue(new Error('socket hang up'));
      const service = buildService({ search });

      const result = await service.find(baseMedia);

      expect(result).toEqual({ status: 'unknown', reason: 'socket hang up' });
    });

    it('returns not-found when title is found but listLinks returns false for every quality', async () => {
      const search = jest.fn().mockResolvedValue([matchingTitle]);
      const listLinks = jest.fn().mockResolvedValue(false);
      const service = buildService({ search, listLinks });

      const result = await service.find(baseMedia);

      expect(result).toEqual({ status: 'not-found' });
      expect(listLinks).toHaveBeenCalled();
    });

    it('returns available with non-null title and downloadUrl when title found and links available', async () => {
      const search = jest.fn().mockResolvedValue([matchingTitle]);
      const listLinks = jest.fn().mockResolvedValue(true);
      const service = buildService({ search, listLinks });

      const result = await service.find(baseMedia);

      expect(result.status).toBe('available');
      if (result.status === 'available') {
        expect(result.title).toEqual(matchingTitle);
        expect(result.downloadUrl).toContain(SITE_HOST);
        expect(result.downloadUrl).toContain('/titles/42');
      }
    });

    it('returns unknown when title found but listLinks throws', async () => {
      const search = jest.fn().mockResolvedValue([matchingTitle]);
      const listLinks = jest.fn().mockRejectedValue(new Error('boom'));
      const service = buildService({ search, listLinks });

      const result = await service.find(baseMedia);

      expect(result).toEqual({ status: 'unknown', reason: 'boom' });
    });
  });

  describe('isHealthy', () => {
    it('delegates to api.ping', async () => {
      const ping = jest.fn().mockResolvedValue(true);
      const service = buildService({ ping });

      await expect(service.isHealthy()).resolves.toBe(true);
      expect(ping).toHaveBeenCalledTimes(1);
    });

    it('propagates ping failure result', async () => {
      const ping = jest.fn().mockResolvedValue(false);
      const service = buildService({ ping });

      await expect(service.isHealthy()).resolves.toBe(false);
    });
  });
});
