import { DarkiworldService } from '@/modules/darkiworld/service';
import { DarkiworldAvailability, DarkiworldTitle } from '@/modules/darkiworld/types';
import { DarkiworldSyncService } from '@/services/darkiworld-sync';
import { MediaType } from '@/services/database/medias';
import { RequestEntity, RequestsRepository, RequestStatus } from '@/services/database/requests';

type ServiceStub = Pick<DarkiworldService, 'find' | 'isHealthy'>;
type RepoStub = Pick<
  RequestsRepository,
  'listByStatuses' | 'setDarkiworldInfo' | 'updateStatus' | 'clearDarkiworldUrl'
>;

const TITLE: DarkiworldTitle = {
  id: 42,
  name: 'The Shawshank Redemption',
  imdb_id: 'tt0111161',
  tmdb_id: null,
  poster: null,
};

function buildRequest(overrides: Partial<RequestEntity> = {}): RequestEntity {
  return {
    mediaId: 'media-1',
    status: RequestStatus.Pending,
    createdAt: new Date(),
    updatedAt: new Date(),
    discordMessageId: null,
    darkiworldTitleId: 42,
    darkiworldUrl: 'https://darki.test/titles/42/download?filters=abc',
    media: {
      id: 'media-1',
      imdbId: 'tt0111161',
      type: MediaType.Movie,
      title: 'The Shawshank Redemption',
      originalTitle: null,
      year: 1994,
      seasonNumber: null,
      episodeNumber: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    ...overrides,
  };
}

function buildRepo(): jest.Mocked<RepoStub> {
  return {
    listByStatuses: jest.fn(),
    setDarkiworldInfo: jest.fn().mockResolvedValue(undefined),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    clearDarkiworldUrl: jest.fn().mockResolvedValue(undefined),
  };
}

function buildService(findResult: DarkiworldAvailability, isHealthy = true): jest.Mocked<ServiceStub> {
  return {
    find: jest.fn().mockResolvedValue(findResult),
    isHealthy: jest.fn().mockResolvedValue(isHealthy),
  };
}

function buildSync(repo: RepoStub, service: ServiceStub): DarkiworldSyncService {
  return new DarkiworldSyncService(repo as RequestsRepository, service as DarkiworldService);
}

describe('DarkiworldSyncService', () => {
  describe('sync (health check gate)', () => {
    it('skips sync entirely when Darkiworld is unhealthy and never wipes any URL', async () => {
      const repo = buildRepo();
      const service = buildService({ status: 'not-found' }, false);
      const sync = buildSync(repo, service);

      await sync.sync();

      expect(service.isHealthy).toHaveBeenCalledTimes(1);
      expect(repo.listByStatuses).not.toHaveBeenCalled();
      expect(service.find).not.toHaveBeenCalled();
      expect(repo.clearDarkiworldUrl).not.toHaveBeenCalled();
      expect(repo.updateStatus).not.toHaveBeenCalled();
      expect(repo.setDarkiworldInfo).not.toHaveBeenCalled();
    });

    it('proceeds with sync when Darkiworld is healthy', async () => {
      const repo = buildRepo();
      repo.listByStatuses.mockResolvedValue([]);
      const service = buildService({ status: 'not-found' }, true);
      const sync = buildSync(repo, service);

      await sync.sync();

      expect(repo.listByStatuses).toHaveBeenCalledWith([RequestStatus.Missing, RequestStatus.Pending]);
    });
  });

  describe('checkOne (via sync)', () => {
    it('on available + Missing request: sets darkiworld info and flips to Pending', async () => {
      const repo = buildRepo();
      const request = buildRequest({ status: RequestStatus.Missing, darkiworldUrl: null, darkiworldTitleId: null });
      repo.listByStatuses.mockResolvedValue([request]);
      const service = buildService({
        status: 'available',
        title: TITLE,
        downloadUrl: 'https://darki.test/titles/42/download?filters=abc',
      });
      const sync = buildSync(repo, service);

      await sync.sync();

      expect(repo.setDarkiworldInfo).toHaveBeenCalledWith(
        'media-1',
        42,
        expect.stringContaining('crn-flix-request-id=media-1'),
      );
      expect(repo.updateStatus).toHaveBeenCalledWith('media-1', RequestStatus.Pending);
      expect(repo.clearDarkiworldUrl).not.toHaveBeenCalled();
    });

    it('on available + Pending: refreshes the URL without changing status', async () => {
      const repo = buildRepo();
      const request = buildRequest({ status: RequestStatus.Pending });
      repo.listByStatuses.mockResolvedValue([request]);
      const service = buildService({
        status: 'available',
        title: TITLE,
        downloadUrl: 'https://darki.test/titles/42/download?filters=newfilter',
      });
      const sync = buildSync(repo, service);

      await sync.sync();

      expect(repo.setDarkiworldInfo).toHaveBeenCalledWith('media-1', 42, expect.stringContaining('filters=newfilter'));
      expect(repo.updateStatus).not.toHaveBeenCalled();
      expect(repo.clearDarkiworldUrl).not.toHaveBeenCalled();
    });

    it('on not-found + Pending: wipes URL and reverts to Missing (regression)', async () => {
      const repo = buildRepo();
      const request = buildRequest({ status: RequestStatus.Pending });
      repo.listByStatuses.mockResolvedValue([request]);
      const service = buildService({ status: 'not-found' });
      const sync = buildSync(repo, service);

      await sync.sync();

      expect(repo.clearDarkiworldUrl).toHaveBeenCalledWith('media-1');
      expect(repo.updateStatus).toHaveBeenCalledWith('media-1', RequestStatus.Missing);
    });

    it('on not-found + Missing: makes no DB calls', async () => {
      const repo = buildRepo();
      const request = buildRequest({ status: RequestStatus.Missing, darkiworldUrl: null });
      repo.listByStatuses.mockResolvedValue([request]);
      const service = buildService({ status: 'not-found' });
      const sync = buildSync(repo, service);

      await sync.sync();

      expect(repo.clearDarkiworldUrl).not.toHaveBeenCalled();
      expect(repo.updateStatus).not.toHaveBeenCalled();
      expect(repo.setDarkiworldInfo).not.toHaveBeenCalled();
    });

    it('on unknown + Pending: NEVER wipes URL or changes status (the bug we are fixing)', async () => {
      const repo = buildRepo();
      const request = buildRequest({ status: RequestStatus.Pending });
      repo.listByStatuses.mockResolvedValue([request]);
      const service = buildService({ status: 'unknown', reason: 'darkiworld 503' });
      const sync = buildSync(repo, service);

      await sync.sync();

      expect(repo.clearDarkiworldUrl).not.toHaveBeenCalled();
      expect(repo.updateStatus).not.toHaveBeenCalled();
      expect(repo.setDarkiworldInfo).not.toHaveBeenCalled();
    });

    it('on unknown + Missing: makes no DB calls', async () => {
      const repo = buildRepo();
      const request = buildRequest({ status: RequestStatus.Missing, darkiworldUrl: null });
      repo.listByStatuses.mockResolvedValue([request]);
      const service = buildService({ status: 'unknown', reason: 'parse fail' });
      const sync = buildSync(repo, service);

      await sync.sync();

      expect(repo.clearDarkiworldUrl).not.toHaveBeenCalled();
      expect(repo.updateStatus).not.toHaveBeenCalled();
      expect(repo.setDarkiworldInfo).not.toHaveBeenCalled();
    });

    it('skips requests without media or imdbId', async () => {
      const repo = buildRepo();
      const request = buildRequest({ media: undefined });
      repo.listByStatuses.mockResolvedValue([request]);
      const service = buildService({ status: 'not-found' });
      const sync = buildSync(repo, service);

      await sync.sync();

      expect(service.find).not.toHaveBeenCalled();
    });
  });
});
