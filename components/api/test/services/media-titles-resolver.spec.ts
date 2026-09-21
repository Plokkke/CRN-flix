import { TmdbApiService } from '@/modules/tmdb/tmdb';
import { MediaTitlesResolver } from '@/services/media-titles-resolver';

const hangover = {
  id: 18785,
  title: 'The Hangover',
  original_title: 'The Hangover',
  original_language: 'en',
  release_date: '2009-06-05',
  popularity: 1,
  vote_count: 1,
};

function tmdb(findByImdbId: jest.Mock): TmdbApiService {
  return { findByImdbId } as unknown as TmdbApiService;
}

describe('MediaTitlesResolver', () => {
  it('resolves the English, French and original titles of a movie with two TMDB calls', async () => {
    const findByImdbId = jest.fn().mockImplementation((_imdbId: string, { language }: { language: string }) => ({
      movies: [language === 'fr-FR' ? { ...hangover, title: 'Very Bad Trip' } : hangover],
      tvShows: [],
    }));
    const resolver = new MediaTitlesResolver(tmdb(findByImdbId));

    await expect(resolver.resolve('tt1119646')).resolves.toEqual({
      title: 'The Hangover',
      originalTitle: 'The Hangover',
      frenchTitle: 'Very Bad Trip',
      originalLanguage: 'en',
      year: 2009,
    });
    expect(findByImdbId.mock.calls.map(([, opts]) => opts.language)).toEqual(['en-US', 'fr-FR']);
  });

  it('reads tv shows when no movie matches', async () => {
    const show = { id: 1, name: 'Silo', original_name: 'Silo', original_language: 'en', first_air_date: '2023-05-05' };
    const findByImdbId = jest.fn().mockResolvedValue({ movies: [], tvShows: [show] });
    const resolver = new MediaTitlesResolver(tmdb(findByImdbId));

    await expect(resolver.resolve('tt14688458')).resolves.toMatchObject({
      title: 'Silo',
      frenchTitle: 'Silo',
      year: 2023,
    });
  });

  it('memoises per imdb id, unknown ids and failures included', async () => {
    const findByImdbId = jest.fn().mockRejectedValue(new Error('boom'));
    const resolver = new MediaTitlesResolver(tmdb(findByImdbId));

    await expect(resolver.resolve('tt0')).resolves.toMatchObject({ title: null, frenchTitle: null });
    await resolver.resolve('tt0');
    expect(findByImdbId).toHaveBeenCalledTimes(1);
  });
});
