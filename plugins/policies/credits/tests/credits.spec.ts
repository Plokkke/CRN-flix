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
  status: 'accused',
  allegations: 'harcèlement sexuel',
  sources: [{ label: 'Journal (2024-01-02)', url: 'https://example.org/article' }],
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
  it('refuses a title crediting a listed person, with roles, status, allegations and sources', () => {
    const matches = evaluate([
      credit('tmdb:person:1', 'Jo Example', { department: 'Directing', job: 'Director' }),
      credit('tmdb:person:1', 'Jo Example', { character: 'Sam', billingOrder: 2 }),
    ]);

    expect(matches).toEqual([
      {
        summary: 'Jo Example (Réalisation, Interprétation (Sam)) — Mise en cause publique (présomption d’innocence)',
        notice: {
          headline: 'Ce titre implique Jo Example',
          blocks: [
            {
              type: 'facts',
              items: [
                { label: 'Rôle', value: 'Réalisation, Interprétation (Sam)' },
                { label: 'Statut', value: 'Mise en cause publique (présomption d’innocence)' },
                { label: 'Faits', value: 'harcèlement sexuel' },
              ],
            },
            {
              type: 'links',
              title: 'Sources',
              links: [{ label: 'Journal (2024-01-02)', url: 'https://example.org/article' }],
            },
          ],
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

  it('requires at least one source per person', () => {
    expect(() => personEntrySchema.parse({ ...listed, sources: [] })).toThrow();
  });
});
