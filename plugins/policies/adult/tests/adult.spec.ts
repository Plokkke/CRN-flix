import { MediaFacts, PolicySubject } from '@crn-flix/contracts';

import { adultParamsSchema, adultPolicy } from '../src';

const facts: MediaFacts = {
  kind: 'movie',
  adult: false,
  year: 2001,
  runtimeMinutes: 90,
  originalLanguage: 'en',
  originCountries: ['US'],
  genres: [],
  keywords: [],
  certifications: [
    { country: 'FR', rating: '16' },
    { country: 'US', rating: 'NC-17' },
  ],
  credits: [],
};

function subject(overrides: Partial<MediaFacts> | null): PolicySubject {
  return {
    imdbId: 'tt1',
    titles: { title: 'X', originalTitle: null, frenchTitle: null, originalLanguage: null, year: null },
    facts: overrides === null ? null : { ...facts, ...overrides },
    requester: null,
  };
}

const params = adultParamsSchema.parse({ certifications: ['fr:18', 'US:NC-17'] });

describe('adultPolicy', () => {
  it('refuses a listed certification, whatever its case', () => {
    expect(adultPolicy.evaluate(subject({}), { params, entries: [] })).toEqual([
      {
        summary: 'Classé US:NC-17',
        notice: {
          headline: 'Contenu réservé aux adultes',
          blocks: [{ type: 'facts', items: [{ label: 'Classification', value: 'Classé US:NC-17' }] }],
        },
      },
    ]);
  });

  it('refuses what the source flags as adult', () => {
    const [match] = adultPolicy.evaluate(subject({ adult: true, certifications: [] }), { params, entries: [] })!;

    expect(match.summary).toBe('Marqué « adulte » par la source');
  });

  it('lets the rest through', () => {
    expect(adultPolicy.evaluate(subject({ certifications: [] }), { params, entries: [] })).toEqual([]);
  });

  it('cannot tell without facts', () => {
    expect(adultPolicy.evaluate(subject(null), { params, entries: [] })).toBeNull();
  });
});
