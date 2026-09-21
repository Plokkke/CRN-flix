import { MediaTitles } from '@/modules/indexer/contract';
import { MediasRepository } from '@/services/database/medias';
import { MediaTitlesService } from '@/services/media-titles';
import { MediaTitlesResolution, MediaTitlesResolver } from '@/services/media-titles-resolver';

const stored: MediaTitles = {
  title: 'The Hangover',
  originalTitle: null,
  frenchTitle: null,
  originalLanguage: null,
  year: 2009,
};

const resolved: MediaTitlesResolution = {
  title: 'The Hangover',
  originalTitle: 'The Hangover',
  frenchTitle: 'Very Bad Trip',
  originalLanguage: 'en',
  year: 2009,
  posterPath: '/hangover.jpg',
};

function build(resolution: MediaTitlesResolution, imdbIdsWithoutFrench: string[] = []) {
  const resolve = jest.fn().mockResolvedValue(resolution);
  const updateTitles = jest.fn().mockResolvedValue(undefined);
  const listImdbIdsWithoutFrenchTitle = jest.fn().mockResolvedValue(imdbIdsWithoutFrench);
  const service = new MediaTitlesService(
    { resolve } as unknown as MediaTitlesResolver,
    { updateTitles, listImdbIdsWithoutFrenchTitle } as unknown as MediasRepository,
  );
  return { service, resolve, updateTitles };
}

describe('MediaTitlesService.ensure', () => {
  it('returns the stored titles untouched when the French one is known', async () => {
    const { service, resolve } = build(resolved);

    const known = { ...stored, frenchTitle: 'Very Bad Trip' };
    await expect(service.ensure('tt1119646', known)).resolves.toBe(known);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('resolves, persists on every row of the imdb id and returns the completed titles', async () => {
    const { service, updateTitles } = build(resolved);

    const { posterPath: _poster, ...titles } = resolved;
    await expect(service.ensure('tt1119646', stored)).resolves.toEqual(titles);
    expect(updateTitles).toHaveBeenCalledWith('tt1119646', resolved);
  });

  it('keeps the stored titles when TMDB knows nothing', async () => {
    const unknown: MediaTitlesResolution = { ...resolved, title: null, originalTitle: null, frenchTitle: null };
    const { service, updateTitles } = build(unknown);

    await expect(service.ensure('tt0', stored)).resolves.toBe(stored);
    expect(updateTitles).not.toHaveBeenCalled();
  });
});

describe('MediaTitlesService.backfill', () => {
  it('resolves and persists every imdb id still without a French title', async () => {
    const { service, updateTitles } = build(resolved, ['tt1', 'tt2']);

    await service.backfill();

    expect(updateTitles.mock.calls.map(([imdbId]) => imdbId)).toEqual(['tt1', 'tt2']);
  });
});
