import { ZodError } from 'zod';

import {
  movieFacts,
  personCandidates,
  TmdbApiService,
  TmdbMetadataSource,
  tmdbMovieDetailsSchema,
  tmdbPeopleSearchSchema,
  tmdbTvDetailsSchema,
  tvFacts,
} from '../src';

const movieDetails = {
  adult: false,
  release_date: '2004-03-19',
  runtime: 108,
  original_language: 'en',
  origin_country: ['US'],
  production_countries: [{ iso_3166_1: 'US' }, { iso_3166_1: 'FR' }],
  genres: [{ id: 18, name: 'Drama' }],
  keywords: { keywords: [{ id: 1, name: 'memory' }] },
  release_dates: {
    results: [
      { iso_3166_1: 'FR', release_dates: [{ certification: '' }, { certification: '12' }] },
      { iso_3166_1: 'DE', release_dates: [{ certification: '' }] },
    ],
  },
  credits: {
    cast: [{ id: 10, name: 'Alex Lead', character: 'Joel', order: 0 }],
    crew: [
      { id: 20, name: 'Sam Director', department: 'Directing', job: 'Director' },
      { id: 21, name: 'Kim Producer', department: 'Production', job: 'Producer' },
    ],
  },
};

const tvDetails = {
  adult: false,
  first_air_date: '2023-05-05',
  episode_run_time: [50],
  original_language: 'en',
  origin_country: ['US'],
  genres: [{ id: 1, name: 'Sci-Fi & Fantasy' }],
  created_by: [{ id: 30, name: 'Robin Creator' }],
  keywords: { results: [{ id: 2, name: 'dystopia' }] },
  content_ratings: {
    results: [
      { iso_3166_1: 'US', rating: 'TV-14' },
      { iso_3166_1: 'FR', rating: ' ' },
    ],
  },
  aggregate_credits: {
    cast: [
      { id: 40, name: 'Lee Star', order: 0, roles: [{ character: 'Juliette', episode_count: 10 }] },
      { id: 41, name: 'Pat Guest', order: 30, roles: [{ character: 'Guard', episode_count: 1 }] },
    ],
    crew: [{ id: 50, name: 'Max Writer', department: 'Writing', jobs: [{ job: 'Writer', episode_count: 3 }] }],
  },
};

describe('movieFacts', () => {
  const facts = movieFacts(tmdbMovieDetailsSchema.parse(movieDetails));

  it('keeps what policies look at', () => {
    expect(facts).toMatchObject({
      kind: 'movie',
      adult: false,
      year: 2004,
      runtimeMinutes: 108,
      originalLanguage: 'en',
      originCountries: ['US', 'FR'],
      genres: ['Drama'],
      keywords: ['memory'],
    });
  });

  it('takes the first non-empty certification of each country', () => {
    expect(facts.certifications).toEqual([{ country: 'FR', rating: '12' }]);
  });

  it('identifies people by an opaque reference, cast and crew alike', () => {
    expect(facts.credits).toEqual([
      {
        person: { ref: 'tmdb:person:10', name: 'Alex Lead' },
        department: 'Acting',
        job: 'Actor',
        character: 'Joel',
        billingOrder: 0,
        episodeCount: null,
      },
      expect.objectContaining({ person: { ref: 'tmdb:person:20', name: 'Sam Director' }, job: 'Director' }),
      expect.objectContaining({ department: 'Production', job: 'Producer' }),
    ]);
  });
});

describe('tvFacts', () => {
  const facts = tvFacts(tmdbTvDetailsSchema.parse(tvDetails));

  it('counts the episodes of every credit so a rule can ignore guests', () => {
    expect(facts.credits.map(({ person, job, episodeCount }) => [person.name, job, episodeCount])).toEqual([
      ['Robin Creator', 'Creator', null],
      ['Lee Star', 'Actor', 10],
      ['Pat Guest', 'Actor', 1],
      ['Max Writer', 'Writer', 3],
    ]);
  });

  it('reads the show ratings and runtime, blank ratings dropped', () => {
    expect(facts).toMatchObject({
      kind: 'show',
      year: 2023,
      runtimeMinutes: 50,
      certifications: [{ country: 'US', rating: 'TV-14' }],
      keywords: ['dystopia'],
    });
  });

  it('fails loudly when TMDB changes its shape', () => {
    expect(() => tmdbTvDetailsSchema.parse({ ...tvDetails, created_by: 'nobody' })).toThrow(ZodError);
  });
});

describe('personCandidates', () => {
  it('describes namesakes by what they are known for', () => {
    const search = tmdbPeopleSearchSchema.parse({
      results: [
        {
          id: 7,
          name: 'Jo Doe',
          known_for_department: 'Directing',
          known_for: [{ title: 'A' }, { name: 'B' }, { title: 'C' }, { title: 'D' }],
        },
      ],
    });

    expect(personCandidates(search)).toEqual([
      {
        ref: 'tmdb:person:7',
        name: 'Jo Doe',
        knownForDepartment: 'Directing',
        knownFor: ['A', 'B', 'C'],
        pageUrl: 'https://www.themoviedb.org/person/7',
      },
    ]);
  });
});

describe('TmdbMetadataSource.facts', () => {
  function source(found: { movies: unknown[]; tvShows: unknown[] }): TmdbMetadataSource {
    const api = {
      findByImdbId: jest.fn().mockResolvedValue(found),
      getMovieDetails: jest.fn().mockResolvedValue(tmdbMovieDetailsSchema.parse(movieDetails)),
      getTvDetails: jest.fn().mockResolvedValue(tmdbTvDetailsSchema.parse(tvDetails)),
    };
    return new TmdbMetadataSource(api as unknown as TmdbApiService);
  }

  it('reads the movie page when the imdb id is a movie', async () => {
    await expect(source({ movies: [{ id: 1 }], tvShows: [] }).facts('tt1')).resolves.toMatchObject({
      kind: 'movie',
    });
  });

  it('reads the show page when the imdb id is a show', async () => {
    await expect(source({ movies: [], tvShows: [{ id: 2 }] }).facts('tt2')).resolves.toMatchObject({ kind: 'show' });
  });

  it('is null when TMDB does not know the imdb id', async () => {
    await expect(source({ movies: [], tvShows: [] }).facts('tt3')).resolves.toBeNull();
  });
});
