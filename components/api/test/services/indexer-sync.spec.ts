import { IndexerCandidate } from '@/modules/indexer/contract';
import { Host, Language, Quality } from '@/modules/indexer/preferences';
import { MediaEntity, MediaType } from '@/services/database/medias';
import { RequestEntity, RequestsRepository, RequestStatus } from '@/services/database/requests';
import { IndexerOrchestrator } from '@/services/indexer-orchestrator';
import { IndexerSyncService } from '@/services/indexer-sync';

const MEDIA: MediaEntity = {
  id: 'media-1',
  imdbId: 'tt0000001',
  type: MediaType.Movie,
  title: 'Test',
  originalTitle: 'Test',
  year: 2024,
  seasonNumber: null,
  episodeNumber: null,
  runtimeMinutes: 90,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildRequest(overrides: Partial<RequestEntity> = {}): RequestEntity {
  return {
    mediaId: MEDIA.id,
    status: RequestStatus.Pending,
    createdAt: new Date(),
    updatedAt: new Date(),
    discordMessageId: null,
    indexerName: 'mock',
    indexerLink: 'https://1fichier.com/?abc',
    media: MEDIA,
    ...overrides,
  };
}

function buildRepo(
  requests: RequestEntity[],
): jest.Mocked<Pick<RequestsRepository, 'listByStatuses' | 'clearIndexerInfo' | 'updateStatus'>> {
  return {
    listByStatuses: jest.fn().mockResolvedValue(requests),
    clearIndexerInfo: jest.fn().mockResolvedValue(undefined),
    updateStatus: jest.fn().mockResolvedValue(undefined),
  };
}

function buildOrchestrator(returns: IndexerCandidate | null): jest.Mocked<Pick<IndexerOrchestrator, 'runForRequest'>> {
  return {
    runForRequest: jest.fn().mockResolvedValue(returns),
  };
}

function buildService(
  repo: ReturnType<typeof buildRepo>,
  orchestrator: ReturnType<typeof buildOrchestrator>,
): IndexerSyncService {
  return new IndexerSyncService(repo as unknown as RequestsRepository, orchestrator as unknown as IndexerOrchestrator);
}

describe('IndexerSyncService', () => {
  it('clears indexer info and flips Pending requests back to Missing when no candidate is found', async () => {
    const request = buildRequest({ status: RequestStatus.Pending });
    const repo = buildRepo([request]);
    const orchestrator = buildOrchestrator(null);
    const service = buildService(repo, orchestrator);

    await service.sync();

    expect(orchestrator.runForRequest).toHaveBeenCalledWith(request);
    expect(repo.clearIndexerInfo).toHaveBeenCalledWith(MEDIA.id);
    expect(repo.updateStatus).toHaveBeenCalledWith(MEDIA.id, RequestStatus.Missing);
  });

  it('leaves Missing requests untouched when no candidate is found', async () => {
    const request = buildRequest({ status: RequestStatus.Missing });
    const repo = buildRepo([request]);
    const orchestrator = buildOrchestrator(null);
    const service = buildService(repo, orchestrator);

    await service.sync();

    expect(repo.clearIndexerInfo).not.toHaveBeenCalled();
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('does not flip status when the orchestrator returns a candidate (it already persisted everything)', async () => {
    const request = buildRequest({ status: RequestStatus.Pending });
    const repo = buildRepo([request]);
    const candidate: IndexerCandidate = {
      indexerName: 'mock',
      url: 'https://1fichier.com/?abc',
      quality: Quality.HD_1080P,
      language: Language.TRUEFRENCH,
      host: Host.ONE_FICHIER,
      sizeBytes: null,
    };
    const orchestrator = buildOrchestrator(candidate);
    const service = buildService(repo, orchestrator);

    await service.sync();

    expect(repo.clearIndexerInfo).not.toHaveBeenCalled();
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('skips requests without an imdbId', async () => {
    const request = buildRequest({ media: { ...MEDIA, imdbId: '' } });
    const repo = buildRepo([request]);
    const orchestrator = buildOrchestrator(null);
    const service = buildService(repo, orchestrator);

    await service.sync();

    expect(orchestrator.runForRequest).not.toHaveBeenCalled();
  });

  it('swallows orchestrator errors and continues processing other requests', async () => {
    const a = buildRequest({ status: RequestStatus.Pending, mediaId: 'a', media: { ...MEDIA, id: 'a' } });
    const b = buildRequest({ status: RequestStatus.Pending, mediaId: 'b', media: { ...MEDIA, id: 'b' } });
    const repo = buildRepo([a, b]);
    const orchestrator = {
      runForRequest: jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(null),
    };
    const service = buildService(
      repo,
      orchestrator as unknown as jest.Mocked<Pick<IndexerOrchestrator, 'runForRequest'>>,
    );

    await expect(service.sync()).resolves.toBeUndefined();
    expect(orchestrator.runForRequest).toHaveBeenCalledTimes(2);
    expect(repo.clearIndexerInfo).toHaveBeenCalledWith('b');
  });
});
