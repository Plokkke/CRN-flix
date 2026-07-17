import { IndexerCandidate } from '@/modules/indexer/contract';
import { Host, Language, Quality } from '@/modules/indexer/preferences';
import { MediaEntity, MediaType } from '@/services/database/medias';
import { RequestEntity, RequestsRepository, RequestStatus } from '@/services/database/requests';
import { IndexerOrchestrator } from '@/services/indexer-orchestrator';
import { IndexerSyncService } from '@/services/indexer-sync';
import { DiscordAdminMessaging } from '@/services/messaging/admin/discord';

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
): jest.Mocked<Pick<RequestsRepository, 'listByStatuses' | 'clearIndexerInfo' | 'updateStatus' | 'get'>> {
  return {
    listByStatuses: jest.fn().mockResolvedValue(requests),
    clearIndexerInfo: jest.fn().mockResolvedValue(undefined),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
  };
}

function buildAdminsMessaging(): jest.Mocked<Pick<DiscordAdminMessaging, 'refreshRequestMessage'>> {
  return {
    refreshRequestMessage: jest.fn().mockResolvedValue(undefined),
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
  adminsMessaging: ReturnType<typeof buildAdminsMessaging> = buildAdminsMessaging(),
): IndexerSyncService {
  return new IndexerSyncService(
    repo as unknown as RequestsRepository,
    orchestrator as unknown as IndexerOrchestrator,
    adminsMessaging as unknown as DiscordAdminMessaging,
  );
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

  it('refreshes the Discord message when a new link is found for an already-posted request', async () => {
    const request = buildRequest({
      status: RequestStatus.Pending,
      discordMessageId: 'msg-1',
      indexerLink: 'https://old-link.example',
    });
    const repo = buildRepo([request]);
    const updated = buildRequest({ discordMessageId: 'msg-1' });
    repo.get.mockResolvedValue(updated);
    const candidate: IndexerCandidate = {
      indexerName: 'mock',
      url: 'https://1fichier.com/?abc',
      quality: Quality.HD_1080P,
      language: Language.TRUEFRENCH,
      host: Host.ONE_FICHIER,
      sizeBytes: null,
    };
    const adminsMessaging = buildAdminsMessaging();
    const service = buildService(repo, buildOrchestrator(candidate), adminsMessaging);

    await service.sync();

    expect(repo.get).toHaveBeenCalledWith(MEDIA.id);
    expect(adminsMessaging.refreshRequestMessage).toHaveBeenCalledWith(updated);
  });

  it('does not refresh the Discord message when the link is unchanged', async () => {
    const request = buildRequest({ status: RequestStatus.Pending, discordMessageId: 'msg-1' });
    const repo = buildRepo([request]);
    const candidate: IndexerCandidate = {
      indexerName: 'mock',
      url: request.indexerLink!,
      quality: Quality.HD_1080P,
      language: Language.TRUEFRENCH,
      host: Host.ONE_FICHIER,
      sizeBytes: null,
    };
    const adminsMessaging = buildAdminsMessaging();
    const service = buildService(repo, buildOrchestrator(candidate), adminsMessaging);

    await service.sync();

    expect(adminsMessaging.refreshRequestMessage).not.toHaveBeenCalled();
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
