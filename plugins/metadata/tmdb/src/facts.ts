import { z } from 'zod';

import { Certification, MediaCredit, MediaFacts, PersonCandidate } from '@crn-flix/contracts';

const named = z.object({ name: z.string() });

const person = z.object({ id: z.number(), name: z.string() });

const common = {
  adult: z.boolean().optional(),
  original_language: z.string().nullish(),
  origin_country: z.array(z.string()).optional(),
  genres: z.array(named).optional(),
};

export const tmdbMovieDetailsSchema = z.object({
  ...common,
  release_date: z.string().nullish(),
  runtime: z.number().nullish(),
  production_countries: z.array(z.object({ iso_3166_1: z.string() })).optional(),
  keywords: z.object({ keywords: z.array(named).optional() }).optional(),
  release_dates: z
    .object({
      results: z.array(
        z.object({
          iso_3166_1: z.string(),
          release_dates: z.array(z.object({ certification: z.string().optional() })),
        }),
      ),
    })
    .optional(),
  credits: z
    .object({
      cast: z.array(person.extend({ character: z.string().nullish(), order: z.number().nullish() })).optional(),
      crew: z.array(person.extend({ department: z.string(), job: z.string() })).optional(),
    })
    .optional(),
});

export const tmdbTvDetailsSchema = z.object({
  ...common,
  first_air_date: z.string().nullish(),
  episode_run_time: z.array(z.number()).optional(),
  created_by: z.array(person).optional(),
  keywords: z.object({ results: z.array(named).optional() }).optional(),
  content_ratings: z.object({ results: z.array(z.object({ iso_3166_1: z.string(), rating: z.string() })) }).optional(),
  aggregate_credits: z
    .object({
      cast: z
        .array(
          person.extend({
            order: z.number().nullish(),
            roles: z.array(z.object({ character: z.string().nullish(), episode_count: z.number() })),
          }),
        )
        .optional(),
      crew: z
        .array(
          person.extend({
            department: z.string(),
            jobs: z.array(z.object({ job: z.string(), episode_count: z.number() })),
          }),
        )
        .optional(),
    })
    .optional(),
});

export const tmdbPeopleSearchSchema = z.object({
  results: z.array(
    person.extend({
      known_for_department: z.string().nullish(),
      known_for: z.array(z.object({ title: z.string().optional(), name: z.string().optional() })).optional(),
    }),
  ),
});

export type TmdbMovieDetails = z.infer<typeof tmdbMovieDetailsSchema>;
export type TmdbTvDetails = z.infer<typeof tmdbTvDetailsSchema>;
export type TmdbPeopleSearch = z.infer<typeof tmdbPeopleSearchSchema>;

const PERSON_PAGE_URL = 'https://www.themoviedb.org/person';

export function personRef(id: number): string {
  return `tmdb:person:${id}`;
}

function ref(p: { id: number; name: string }): MediaCredit['person'] {
  return { ref: personRef(p.id), name: p.name };
}

function yearOf(date: string | null | undefined): number | null {
  return date ? Number(date.slice(0, 4)) : null;
}

function names(items: { name: string }[] | undefined): string[] {
  return (items ?? []).map((item) => item.name);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function movieCertifications(details: TmdbMovieDetails): Certification[] {
  return (details.release_dates?.results ?? []).flatMap(({ iso_3166_1, release_dates }) => {
    const rating = release_dates.map((release) => release.certification?.trim()).find(Boolean);
    return rating ? [{ country: iso_3166_1, rating }] : [];
  });
}

function movieCredits(details: TmdbMovieDetails): MediaCredit[] {
  const cast = (details.credits?.cast ?? []).map((member) => ({
    person: ref(member),
    department: 'Acting',
    job: 'Actor',
    character: member.character || null,
    billingOrder: member.order ?? null,
    episodeCount: null,
  }));
  const crew = (details.credits?.crew ?? []).map((member) => ({
    person: ref(member),
    department: member.department,
    job: member.job,
    character: null,
    billingOrder: null,
    episodeCount: null,
  }));
  return [...cast, ...crew];
}

export function movieFacts(details: TmdbMovieDetails): MediaFacts {
  const productionCountries = (details.production_countries ?? []).map((country) => country.iso_3166_1);
  return {
    kind: 'movie',
    adult: details.adult ?? false,
    year: yearOf(details.release_date),
    runtimeMinutes: details.runtime || null,
    originalLanguage: details.original_language ?? null,
    originCountries: unique([...(details.origin_country ?? []), ...productionCountries]),
    genres: names(details.genres),
    keywords: names(details.keywords?.keywords),
    certifications: movieCertifications(details),
    credits: movieCredits(details),
  };
}

function tvCredits(details: TmdbTvDetails): MediaCredit[] {
  const creators = (details.created_by ?? []).map((creator) => ({
    person: ref(creator),
    department: 'Creator',
    job: 'Creator',
    character: null,
    billingOrder: null,
    episodeCount: null,
  }));
  const cast = (details.aggregate_credits?.cast ?? []).flatMap((member) =>
    member.roles.map((role) => ({
      person: ref(member),
      department: 'Acting',
      job: 'Actor',
      character: role.character || null,
      billingOrder: member.order ?? null,
      episodeCount: role.episode_count,
    })),
  );
  const crew = (details.aggregate_credits?.crew ?? []).flatMap((member) =>
    member.jobs.map((job) => ({
      person: ref(member),
      department: member.department,
      job: job.job,
      character: null,
      billingOrder: null,
      episodeCount: job.episode_count,
    })),
  );
  return [...creators, ...cast, ...crew];
}

export function tvFacts(details: TmdbTvDetails): MediaFacts {
  return {
    kind: 'show',
    adult: details.adult ?? false,
    year: yearOf(details.first_air_date),
    runtimeMinutes: details.episode_run_time?.[0] ?? null,
    originalLanguage: details.original_language ?? null,
    originCountries: details.origin_country ?? [],
    genres: names(details.genres),
    keywords: names(details.keywords?.results),
    certifications: (details.content_ratings?.results ?? [])
      .filter(({ rating }) => rating.trim())
      .map(({ iso_3166_1, rating }) => ({ country: iso_3166_1, rating: rating.trim() })),
    credits: tvCredits(details),
  };
}

const KNOWN_FOR_LIMIT = 3;

export function personCandidates(search: TmdbPeopleSearch): PersonCandidate[] {
  return search.results.map((result) => ({
    ...ref(result),
    knownForDepartment: result.known_for_department ?? null,
    knownFor: (result.known_for ?? [])
      .map((work) => work.title ?? work.name)
      .filter((title): title is string => Boolean(title))
      .slice(0, KNOWN_FOR_LIMIT),
    pageUrl: `${PERSON_PAGE_URL}/${result.id}`,
  }));
}
