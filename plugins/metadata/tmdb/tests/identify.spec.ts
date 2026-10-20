import { TmdbApiService, TmdbMetadataSource } from '../src';

const movie = (id: number, year: number) => ({
  id,
  title: `Dune ${year}`,
  original_title: 'Dune',
  release_date: `${year}-09-15`,
  popularity: 1,
  vote_count: 1,
});

function build() {
  const tmdb = {
    searchMovie: jest.fn().mockResolvedValue([]),
    searchTv: jest.fn().mockResolvedValue([]),
    getMovieExternalIds: jest.fn(async (id: number) => ({ imdb_id: `tt-movie-${id}` })),
    getTvExternalIds: jest.fn(
      async (id: number): Promise<{ imdb_id: string | null }> => ({ imdb_id: `tt-show-${id}` }),
    ),
  };
  return { tmdb, source: new TmdbMetadataSource(tmdb as unknown as TmdbApiService) };
}

describe('TmdbMetadataSource.identify', () => {
  it('identifies a movie by its first hit', async () => {
    const { tmdb, source } = build();
    tmdb.searchMovie.mockResolvedValue([movie(1, 2021)]);

    await expect(source.identify({ kind: 'movie', title: 'Dune', year: 2021 })).resolves.toEqual({
      imdbId: 'tt-movie-1',
      kind: 'movie',
      title: 'Dune 2021',
      originalTitle: 'Dune',
      year: 2021,
    });
    expect(tmdb.searchMovie).toHaveBeenCalledWith('Dune', 2021);
  });

  it('prefers a hit within a year of the release when the first one is off', async () => {
    const { tmdb, source } = build();
    tmdb.searchMovie.mockResolvedValue([movie(1, 1984), movie(2, 2020)]);

    await expect(source.identify({ kind: 'movie', title: 'Dune', year: 2021 })).resolves.toMatchObject({
      imdbId: 'tt-movie-2',
    });
  });

  it('identifies a show and nothing when TMDB has no imdb id for it', async () => {
    const { tmdb, source } = build();
    tmdb.searchTv.mockResolvedValue([{ id: 7, name: 'Silo', original_name: 'Silo', first_air_date: '2023-05-05' }]);

    await expect(source.identify({ kind: 'show', title: 'Silo', year: null })).resolves.toMatchObject({
      imdbId: 'tt-show-7',
      kind: 'show',
      year: 2023,
    });

    tmdb.getTvExternalIds.mockResolvedValue({ imdb_id: null });
    await expect(source.identify({ kind: 'show', title: 'Silo', year: null })).resolves.toBeNull();
  });

  it('finds nothing without a hit', async () => {
    const { source } = build();

    await expect(source.identify({ kind: 'movie', title: 'Nope', year: null })).resolves.toBeNull();
  });
});
