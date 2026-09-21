import { Logger } from '@nestjs/common';

import { Indexer, IndexerBookmark, IndexerCandidate, IndexerTarget, MediaType } from '@/modules/indexer/contract';
import { EnginePreferences, Host, Language, Quality } from '@/modules/indexer/preferences';
import { BookmarkStore, findAcrossIndexers } from '@/services/planner/bookmarks';

const PREFS: EnginePreferences = {
  allowedQualities: [],
  allowedLanguages: [],
  allowedHosts: [],
  sizePolicy: { bytesPerMinute: {}, tolerance: 1 },
};

const target: IndexerTarget = {
  kind: 'movie',
  media: {
    imdbId: 'tt1',
    type: MediaType.Movie,
    title: 'Movie',
    originalTitle: null,
    frenchTitle: null,
    originalLanguage: null,
    year: 2020,
    seasonNumber: null,
    episodeNumber: null,
    runtimeMinutes: 90,
  },
};

const candidate: IndexerCandidate = {
  indexerName: 'a',
  url: 'https://a.test/media/1',
  scope: { kind: 'movie' },
  quality: Quality.HD_1080P,
  language: Language.MULTI,
  host: Host.ONE_FICHIER,
  sizeBytes: null,
};

const bookmark: IndexerBookmark = { pageUrl: 'https://a.test/media/1', searchUrl: null, state: { id: 1 } };

function indexer(name: string, find: Indexer['find']): Indexer {
  return { name, find };
}

function store(initial: Record<string, IndexerBookmark> = {}): BookmarkStore & { save: jest.Mock } {
  return {
    listByImdbId: jest.fn(async () => new Map(Object.entries(initial))),
    save: jest.fn(async () => undefined),
  };
}

const logger = new Logger('test');

describe('findAcrossIndexers', () => {
  it('hands each indexer its own stored bookmark', async () => {
    const findA = jest.fn(async () => ({ candidates: [candidate], bookmark }));
    const findB = jest.fn(async () => ({ candidates: [], bookmark: null }));
    const bookmarks = store({ a: bookmark });

    const candidates = await findAcrossIndexers(
      [indexer('a', findA), indexer('b', findB)],
      target,
      PREFS,
      bookmarks,
      logger,
    );

    expect(candidates).toEqual({ candidates: [candidate], referenced: true });
    expect(findA).toHaveBeenCalledWith(target, PREFS, bookmark);
    expect(findB).toHaveBeenCalledWith(target, PREFS, null);
  });

  it('stores a bookmark only when the indexer changed it', async () => {
    const same = { ...bookmark, state: { id: 1 } };
    const changed = { ...bookmark, state: { id: 2 } };
    const bookmarks = store({ a: bookmark, b: bookmark });

    await findAcrossIndexers(
      [
        indexer('a', async () => ({ candidates: [], bookmark: same })),
        indexer('b', async () => ({ candidates: [], bookmark: changed })),
      ],
      target,
      PREFS,
      bookmarks,
      logger,
    );

    expect(bookmarks.save).toHaveBeenCalledTimes(1);
    expect(bookmarks.save).toHaveBeenCalledWith('b', 'tt1', changed);
  });

  it('forgets a stored bookmark when the indexer returns none', async () => {
    const bookmarks = store({ a: bookmark });

    await findAcrossIndexers(
      [indexer('a', async () => ({ candidates: [], bookmark: null }))],
      target,
      PREFS,
      bookmarks,
      logger,
    );

    expect(bookmarks.save).toHaveBeenCalledWith('a', 'tt1', null);
  });

  it('keeps the other indexers running when one fails', async () => {
    const bookmarks = store();

    const candidates = await findAcrossIndexers(
      [
        indexer('a', async () => {
          throw new Error('boom');
        }),
        indexer('b', async () => ({ candidates: [candidate], bookmark: null })),
      ],
      target,
      PREFS,
      bookmarks,
      logger,
    );

    expect(candidates).toEqual({ candidates: [candidate], referenced: false });
  });

  it('still searches when bookmarks cannot be loaded', async () => {
    const bookmarks: BookmarkStore = {
      listByImdbId: jest.fn(async () => {
        throw new Error('db down');
      }),
      save: jest.fn(async () => undefined),
    };
    const find = jest.fn(async () => ({ candidates: [candidate], bookmark: null }));

    const candidates = await findAcrossIndexers([indexer('a', find)], target, PREFS, bookmarks, logger);

    expect(candidates.candidates).toEqual([candidate]);
    expect(find).toHaveBeenCalledWith(target, PREFS, null);
  });
});
