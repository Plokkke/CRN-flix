import { TmdbMetadataSource, TmdbApiService } from '../src';

const hangover = {
  id: 18785,
  title: 'The Hangover',
  original_title: 'The Hangover',
  original_language: 'en',
  poster_path: '/hangover-en.jpg',
  release_date: '2009-06-05',
  popularity: 1,
  vote_count: 1,
};

function tmdb(findByImdbId: jest.Mock): TmdbApiService {
  return { findByImdbId } as unknown as TmdbApiService;
}

describe('TmdbMetadataSource', () => {
  it('resolves the English, French and original titles of a movie with two TMDB calls', async () => {
    const findByImdbId = jest.fn().mockImplementation((_imdbId: string, { language }: { language: string }) => ({
      movies: [
        language === 'fr-FR' ? { ...hangover, title: 'Very Bad Trip', poster_path: '/hangover-fr.jpg' } : hangover,
      ],
      tvShows: [],
    }));
    const resolver = new TmdbMetadataSource(tmdb(findByImdbId));

    await expect(resolver.describe('tt1119646')).resolves.toEqual({
      title: 'The Hangover',
      originalTitle: 'The Hangover',
      frenchTitle: 'Very Bad Trip',
      originalLanguage: 'en',
      year: 2009,
      kind: 'movie',
      posterUrl: 'https://image.tmdb.org/t/p/w342/hangover-fr.jpg',
    });
    expect(findByImdbId.mock.calls.map(([, opts]) => opts.language)).toEqual(['en-US', 'fr-FR']);
  });

  it('reads tv shows when no movie matches', async () => {
    const show = { id: 1, name: 'Silo', original_name: 'Silo', original_language: 'en', first_air_date: '2023-05-05' };
    const findByImdbId = jest.fn().mockResolvedValue({ movies: [], tvShows: [show] });
    const resolver = new TmdbMetadataSource(tmdb(findByImdbId));

    await expect(resolver.describe('tt14688458')).resolves.toMatchObject({
      kind: 'show',
      title: 'Silo',
      frenchTitle: 'Silo',
      year: 2023,
    });
  });

  it('memoises what TMDB knows', async () => {
    const findByImdbId = jest.fn().mockResolvedValue({ movies: [hangover], tvShows: [] });
    const resolver = new TmdbMetadataSource(tmdb(findByImdbId));

    await resolver.describe('tt1119646');
    await resolver.describe('tt1119646');
    expect(findByImdbId).toHaveBeenCalledTimes(2);
  });

  it('asks again for unknown ids and after failures (the id may have been linked on TMDB since)', async () => {
    const findByImdbId = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ movies: [], tvShows: [] })
      .mockResolvedValue({ movies: [hangover], tvShows: [] });
    const resolver = new TmdbMetadataSource(tmdb(findByImdbId));

    await expect(resolver.describe('tt0')).resolves.toMatchObject({ title: null, frenchTitle: null });
    await expect(resolver.describe('tt0')).resolves.toMatchObject({ title: null });
    await expect(resolver.describe('tt0')).resolves.toMatchObject({ title: 'The Hangover' });
  });

  describe('page references', () => {
    const resolver = new TmdbMetadataSource({} as TmdbApiService);

    it.each([
      ['https://www.themoviedb.org/movie/1205366-l-arabe-dans-le-poste?language=fr-FR', 'movie/1205366'],
      ['voilà https://www.themoviedb.org/fr/tv/125988-silo', 'tv/125988'],
      ['https://themoviedb.org/fr-FR/movie/15', 'movie/15'],
      ['https://www.themoviedb.org/tv/125988-silo/season/2', 'tv/125988'],
      ['https://www.themoviedb.org/tv/125988-silo/season/2/episode/3?language=fr-FR', 'tv/125988'],
    ])('finds the reference of %s', (text, reference) => {
      expect(resolver.findReference(text)).toBe(reference);
    });

    it('finds none elsewhere', () => {
      expect(resolver.findReference('https://www.imdb.com/fr/title/tt31510564/')).toBeNull();
      expect(resolver.findReference('https://www.themoviedb.org/collection/1241-harry-potter-collection')).toBeNull();
      expect(resolver.findReference('https://www.themoviedb.org/person/287-brad-pitt')).toBeNull();
    });

    it('reads the page itself, imdb id or not', async () => {
      const arabe = {
        id: 1205366,
        title: "L'Arabe dans le poste",
        original_title: "L'Arabe dans le poste",
        original_language: 'fr',
        poster_path: '/arabe.jpg',
        release_date: '2023-11-14',
        external_ids: { imdb_id: null, tvdb_id: null },
      };
      const getPage = jest.fn().mockResolvedValue(arabe);
      const source = new TmdbMetadataSource({ getPage } as unknown as TmdbApiService);

      await expect(source.describeReference('movie/1205366')).resolves.toEqual({
        title: "L'Arabe dans le poste",
        originalTitle: "L'Arabe dans le poste",
        frenchTitle: "L'Arabe dans le poste",
        originalLanguage: 'fr',
        year: 2023,
        kind: 'movie',
        posterUrl: 'https://image.tmdb.org/t/p/w342/arabe.jpg',
        imdbId: null,
        pageUrl: 'https://www.themoviedb.org/movie/1205366',
      });
      expect(getPage.mock.calls).toEqual([
        ['movie', 1205366, 'en-US'],
        ['movie', 1205366, 'fr-FR'],
      ]);
    });

    it('returns null for a missing page', async () => {
      const source = new TmdbMetadataSource({
        getPage: jest.fn().mockResolvedValue(null),
      } as unknown as TmdbApiService);
      await expect(source.describeReference('tv/0')).resolves.toBeNull();
    });
  });
});
