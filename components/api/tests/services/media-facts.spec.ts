import { MediaFacts, MetadataSource } from '@crn-flix/contracts';

import { MediaFactsRepository, StoredFacts } from '@/services/database/media-facts';
import { IntegrationTracker } from '@/services/integrations/monitor';
import { FACTS_SCHEMA_VERSION, MediaFactsService } from '@/services/media-facts';

const facts: MediaFacts = {
  kind: 'movie',
  adult: false,
  year: 2004,
  runtimeMinutes: 108,
  originalLanguage: 'en',
  originCountries: ['US'],
  genres: ['Drama'],
  keywords: [],
  certifications: [{ country: 'FR', rating: '12' }],
  credits: [],
};

const NOW = Date.parse('2026-11-06T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function build(stored: StoredFacts | null, sourceFacts: jest.Mock = jest.fn().mockResolvedValue(facts)) {
  const repository = {
    get: jest.fn().mockResolvedValue(stored),
    save: jest.fn().mockResolvedValue(undefined),
    listImdbIdsToRefresh: jest.fn().mockResolvedValue(['tt1', 'tt2']),
  };
  const tracker: IntegrationTracker = { track: jest.fn((_integration, _operation, run) => run()) };
  const service = new MediaFactsService(
    { name: 'tmdb', facts: sourceFacts } as unknown as MetadataSource,
    repository as unknown as MediaFactsRepository,
    tracker,
    () => NOW,
  );
  return { service, repository, sourceFacts, tracker };
}

describe('MediaFactsService.ensure', () => {
  it('serves stored facts without calling the source, stale ones included', async () => {
    const stored = { facts, schemaVersion: FACTS_SCHEMA_VERSION, fetchedAt: new Date(NOW - 90 * DAY) };
    const { service, sourceFacts } = build(stored);

    await expect(service.ensure('tt1')).resolves.toBe(facts);
    expect(sourceFacts).not.toHaveBeenCalled();
  });

  it('serves a stored "unknown" as such', async () => {
    const { service, sourceFacts } = build({ facts: null, schemaVersion: FACTS_SCHEMA_VERSION, fetchedAt: new Date() });

    await expect(service.ensure('tt1')).resolves.toBeNull();
    expect(sourceFacts).not.toHaveBeenCalled();
  });

  it('fetches, tracks and stores what was never fetched', async () => {
    const { service, repository, tracker } = build(null);

    await expect(service.ensure('tt1')).resolves.toBe(facts);
    expect(tracker.track).toHaveBeenCalledWith('tmdb', 'facts', expect.any(Function));
    expect(repository.save).toHaveBeenCalledWith('tt1', facts, FACTS_SCHEMA_VERSION);
  });

  it('fetches again what was stored in an older shape', async () => {
    const { service, sourceFacts } = build({ facts, schemaVersion: FACTS_SCHEMA_VERSION - 1, fetchedAt: new Date() });

    await service.ensure('tt1');
    expect(sourceFacts).toHaveBeenCalledWith('tt1');
  });

  it('stores nothing when the source fails', async () => {
    const { service, repository } = build(null, jest.fn().mockRejectedValue(new Error('timeout')));

    await expect(service.ensure('tt1')).rejects.toThrow('timeout');
    expect(repository.save).not.toHaveBeenCalled();
  });
});

describe('MediaFactsService.refresh', () => {
  it('asks for the current shape, a month for known titles and a day for unknown ones', async () => {
    const { service, repository } = build(null);

    await service.refresh();
    expect(repository.listImdbIdsToRefresh).toHaveBeenCalledWith({
      schemaVersion: FACTS_SCHEMA_VERSION,
      knownFetchedBefore: new Date(NOW - 30 * DAY),
      unknownFetchedBefore: new Date(NOW - DAY),
      limit: 100,
    });
  });

  it('keeps going past a failing title', async () => {
    const sourceFacts = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(facts);
    const { service, repository } = build(null, sourceFacts);

    await service.refresh();
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.save).toHaveBeenCalledWith('tt2', facts, FACTS_SCHEMA_VERSION);
  });
});
