import { MediaCredit, MediaFacts, PolicySubject } from '@crn-flix/contracts';

import { creditsParamsSchema, creditsPolicy, personEntrySchema } from '../src';

function credit(ref: string, name: string, extra: Partial<MediaCredit>): MediaCredit {
  return {
    person: { ref, name },
    department: 'Acting',
    job: 'Actor',
    character: null,
    billingOrder: null,
    episodeCount: null,
    ...extra,
  };
}

const listed = personEntrySchema.parse({
  ref: 'tmdb:person:1',
  name: 'Jo Example',
});

function subject(credits: MediaCredit[] | null): PolicySubject {
  const facts: MediaFacts | null = credits && {
    kind: 'movie',
    adult: false,
    year: 2001,
    runtimeMinutes: 100,
    originalLanguage: 'en',
    originCountries: [],
    genres: [],
    keywords: [],
    certifications: [],
    credits,
  };
  return {
    imdbId: 'tt1',
    titles: { title: 'X', originalTitle: null, frenchTitle: null, originalLanguage: null, year: null },
    facts,
    requester: null,
  };
}

const evaluate = (credits: MediaCredit[] | null, params: Record<string, unknown> = {}) =>
  creditsPolicy.evaluate(subject(credits), { params: creditsParamsSchema.parse(params), entries: [listed] });

describe('creditsPolicy', () => {
  it('refuses a title crediting a listed person, telling the roles only', () => {
    const matches = evaluate([
      credit('tmdb:person:1', 'Jo Example', { department: 'Directing', job: 'Director' }),
      credit('tmdb:person:1', 'Jo Example', { character: 'Sam', billingOrder: 2 }),
    ]);

    expect(matches).toEqual([
      {
        summary: 'Jo Example (Réalisation, Interprétation (Sam))',
        notice: {
          headline: 'Ce titre implique Jo Example',
          blocks: [{ type: 'facts', items: [{ label: 'Rôle', value: 'Réalisation, Interprétation (Sam)' }] }],
        },
      },
    ]);
  });

  it('matches people by reference, never by name', () => {
    expect(evaluate([credit('tmdb:person:2', 'Jo Example', {})])).toEqual([]);
  });

  it('only counts the departments and jobs the rule targets', () => {
    const actor = [credit('tmdb:person:1', 'Jo Example', {})];

    expect(evaluate(actor, { departments: ['directing'] })).toEqual([]);
    expect(evaluate(actor, { jobs: ['Actor'] })).toHaveLength(1);
  });

  it('ignores minor billing and show guests when asked to', () => {
    expect(evaluate([credit('tmdb:person:1', 'Jo Example', { billingOrder: 12 })], { maxBillingOrder: 5 })).toEqual([]);
    expect(evaluate([credit('tmdb:person:1', 'Jo Example', { episodeCount: 1 })], { minEpisodes: 3 })).toEqual([]);
    expect(evaluate([credit('tmdb:person:1', 'Jo Example', { episodeCount: 8 })], { minEpisodes: 3 })).toHaveLength(1);
  });

  it('cannot tell without facts', () => {
    expect(evaluate(null)).toBeNull();
  });

  it('keeps the person only, dropping any former details', () => {
    expect(personEntrySchema.parse({ ...listed, allegations: 'x', sources: [] })).toEqual(listed);
  });
});
