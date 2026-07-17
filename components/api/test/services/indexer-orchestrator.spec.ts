import { Indexer, IndexerCandidate } from '@/modules/indexer/contract';
import { EnginePreferences, Host, Language, Quality } from '@/modules/indexer/preferences';
import { MediaEntity, MediaType } from '@/services/database/medias';
import { RequestEntity, RequestsRepository, RequestStatus } from '@/services/database/requests';
import { FetchrSyncService } from '@/services/fetchr-sync';
import { IndexerOrchestrator } from '@/services/indexer-orchestrator';

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

const PREFS: EnginePreferences = {
  allowedQualities: [Quality.HD_1080P],
  allowedLanguages: [Language.TRUEFRENCH],
  allowedHosts: [],
  sizePolicy: { bytesPerMinute: {}, tolerance: 1 },
};

function buildRequest(overrides: Partial<RequestEntity> = {}): RequestEntity {
  return {
    mediaId: MEDIA.id,
    status: RequestStatus.Missing,
    createdAt: new Date(),
    updatedAt: new Date(),
    discordMessageId: null,
    indexerName: null,
    indexerLink: null,
    media: MEDIA,
    ...overrides,
  };
}

function buildCandidate(overrides: Partial<IndexerCandidate> = {}): IndexerCandidate {
  return {
    indexerName: 'mock-indexer',
    url: 'https://1fichier.com/?abc',
    quality: Quality.HD_1080P,
    language: Language.TRUEFRENCH,
    host: Host.ONE_FICHIER,
    sizeBytes: null,
    ...overrides,
  };
}

function buildRepo(): jest.Mocked<Pick<RequestsRepository, 'setIndexerInfo' | 'updateStatus' | 'clearIndexerInfo'>> {
  return {
    setIndexerInfo: jest.fn().mockResolvedValue(undefined),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    clearIndexerInfo: jest.fn().mockResolvedValue(undefined),
  };
}

function buildFetchr(canHandle: boolean = true): jest.Mocked<Pick<FetchrSyncService, 'canHandle' | 'download'>> {
  return {
    canHandle: jest.fn().mockResolvedValue(canHandle),
    download: jest.fn(),
  };
}

function buildOrchestrator(
  indexers: Indexer[],
  repo: ReturnType<typeof buildRepo>,
  fetchr: ReturnType<typeof buildFetchr>,
  prefs: EnginePreferences = PREFS,
): IndexerOrchestrator {
  return new IndexerOrchestrator(
    indexers,
    fetchr as unknown as FetchrSyncService,
    repo as unknown as RequestsRepository,
    prefs,
  );
}

describe('IndexerOrchestrator', () => {
  it('returns null when the registry is empty', async () => {
    const repo = buildRepo();
    const fetchr = buildFetchr();
    const orchestrator = buildOrchestrator([], repo, fetchr);

    const result = await orchestrator.runForRequest(buildRequest());

    expect(result).toBeNull();
    expect(repo.setIndexerInfo).not.toHaveBeenCalled();
    expect(repo.updateStatus).not.toHaveBeenCalled();
    expect(fetchr.download).not.toHaveBeenCalled();
  });

  it('returns null when imdbId is missing', async () => {
    const repo = buildRepo();
    const fetchr = buildFetchr();
    const orchestrator = buildOrchestrator(
      [{ name: 'mock', find: jest.fn().mockResolvedValue([buildCandidate()]) }],
      repo,
      fetchr,
    );

    const result = await orchestrator.runForRequest(buildRequest({ media: { ...MEDIA, imdbId: '' } }));

    expect(result).toBeNull();
  });

  it('continues iterating when one indexer throws', async () => {
    const repo = buildRepo();
    const fetchr = buildFetchr();
    const winning = buildCandidate({ indexerName: 'good', url: 'https://1fichier.com/?good' });
    const throwing: Indexer = { name: 'bad', find: jest.fn().mockRejectedValue(new Error('boom')) };
    const good: Indexer = { name: 'good', find: jest.fn().mockResolvedValue([winning]) };
    const orchestrator = buildOrchestrator([throwing, good], repo, fetchr);

    const result = await orchestrator.runForRequest(buildRequest());

    expect(result).toEqual(winning);
    expect(repo.setIndexerInfo).toHaveBeenCalledWith(MEDIA.id, 'good', winning.url);
  });

  it('flips status from Missing to Pending and triggers fetchr when auto-triggerable', async () => {
    const repo = buildRepo();
    const fetchr = buildFetchr(true);
    const candidate = buildCandidate();
    const indexer: Indexer = { name: 'mock', find: jest.fn().mockResolvedValue([candidate]) };
    const orchestrator = buildOrchestrator([indexer], repo, fetchr);

    const result = await orchestrator.runForRequest(buildRequest({ status: RequestStatus.Missing }));

    expect(result).toEqual(candidate);
    expect(repo.setIndexerInfo).toHaveBeenCalledWith(MEDIA.id, 'mock-indexer', candidate.url);
    expect(repo.updateStatus).toHaveBeenCalledWith(MEDIA.id, RequestStatus.Pending);
    expect(fetchr.download).toHaveBeenCalledWith(candidate.url, {
      'crn-flix-request-id': MEDIA.id,
      imdbid: MEDIA.imdbId,
      type: MEDIA.type,
      title: MEDIA.title,
      year: String(MEDIA.year),
    });
  });

  it('persists the candidate but does not call fetchr when canHandle returns false', async () => {
    const repo = buildRepo();
    const fetchr = buildFetchr(false);
    const candidate = buildCandidate({ url: 'https://captcha-landing.example/?id=1' });
    const indexer: Indexer = { name: 'mock', find: jest.fn().mockResolvedValue([candidate]) };
    const orchestrator = buildOrchestrator([indexer], repo, fetchr);

    const result = await orchestrator.runForRequest(buildRequest({ status: RequestStatus.Missing }));

    expect(result).toEqual(candidate);
    expect(repo.setIndexerInfo).toHaveBeenCalledWith(MEDIA.id, 'mock-indexer', candidate.url);
    expect(repo.updateStatus).toHaveBeenCalledWith(MEDIA.id, RequestStatus.Pending);
    expect(fetchr.download).not.toHaveBeenCalled();
  });

  it('does not flip status when the request is already Pending', async () => {
    const repo = buildRepo();
    const fetchr = buildFetchr(true);
    const candidate = buildCandidate();
    const indexer: Indexer = { name: 'mock', find: jest.fn().mockResolvedValue([candidate]) };
    const orchestrator = buildOrchestrator([indexer], repo, fetchr);

    await orchestrator.runForRequest(buildRequest({ status: RequestStatus.Pending }));

    expect(repo.updateStatus).not.toHaveBeenCalled();
    expect(repo.setIndexerInfo).toHaveBeenCalled();
  });

  it('picks the highest-scored candidate across multiple indexers', async () => {
    const repo = buildRepo();
    const fetchr = buildFetchr(true);
    const low = buildCandidate({ indexerName: 'low', quality: Quality.HD_720P, url: 'https://1fichier.com/?low' });
    const high = buildCandidate({ indexerName: 'high', quality: Quality.HD_1080P, url: 'https://1fichier.com/?high' });
    const indexerA: Indexer = { name: 'a', find: jest.fn().mockResolvedValue([low]) };
    const indexerB: Indexer = { name: 'b', find: jest.fn().mockResolvedValue([high]) };
    const orchestrator = buildOrchestrator([indexerA, indexerB], repo, fetchr, {
      ...PREFS,
      allowedQualities: [Quality.HD_1080P, Quality.HD_720P],
    });

    const result = await orchestrator.runForRequest(buildRequest());

    expect(result).toEqual(high);
    expect(repo.setIndexerInfo).toHaveBeenCalledWith(MEDIA.id, 'high', high.url);
  });
});
