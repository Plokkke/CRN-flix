import { MediaFacts, PolicySubject } from '@crn-flix/contracts';

import { attributesParamsSchema, attributesPolicy } from '../src';

const facts: MediaFacts = {
  kind: 'movie',
  adult: false,
  year: 2003,
  runtimeMinutes: 100,
  originalLanguage: 'en',
  originCountries: ['US'],
  genres: ['Animation', 'Family'],
  keywords: [],
  certifications: [
    { country: 'FR', rating: 'U' },
    { country: 'US', rating: 'G' },
  ],
  credits: [],
};

function evaluate(params: Record<string, unknown>, overrides: Partial<MediaFacts> = {}) {
  const subject: PolicySubject = {
    imdbId: 'tt1',
    titles: { title: 'X', originalTitle: null, frenchTitle: null, originalLanguage: null, year: null },
    facts: { ...facts, ...overrides },
    requester: null,
  };
  return attributesPolicy.evaluate(subject, { params: attributesParamsSchema.parse(params), entries: [] });
}

const KIDS = { certifications: ['FR:U', 'FR:10'] };

describe('attributesPolicy', () => {
  it('admits a title within every filled criterion', () => {
    expect(evaluate({ ...KIDS, genresAnyOf: ['animation'], maxRuntime: 120 })).toEqual([]);
  });

  it('only looks at the countries the allow-list names', () => {
    expect(
      evaluate(KIDS, {
        certifications: [
          { country: 'US', rating: 'R' },
          { country: 'FR', rating: '10' },
        ],
      }),
    ).toEqual([]);
  });

  it('refuses with every failed criterion and what it saw', () => {
    const [match] = evaluate(
      { ...KIDS, genresNoneOf: ['War'] },
      {
        certifications: [{ country: 'FR', rating: '16' }],
        genres: ['War', 'Drama'],
      },
    )!;

    expect(match.summary).toBe('Classification : FR:16 · Genres : War, Drama');
    expect(match.notice.blocks).toEqual([
      {
        type: 'facts',
        items: [
          { label: 'Classification', value: 'FR:16' },
          { label: 'Genres', value: 'War, Drama' },
        ],
      },
    ]);
  });

  it('cannot tell when a filled criterion has no known value', () => {
    expect(evaluate(KIDS, { certifications: [{ country: 'US', rating: 'G' }] })).toBeNull();
    expect(evaluate({ maxRuntime: 120 }, { runtimeMinutes: null })).toBeNull();
  });

  it('still refuses on a known failure when another criterion is unknown', () => {
    expect(evaluate({ ...KIDS, maxYear: 2000 }, { certifications: [] })).toHaveLength(1);
  });

  it('checks ranges and the original language', () => {
    expect(evaluate({ minYear: 2010 })).toHaveLength(1);
    expect(evaluate({ languagesNoneOf: ['EN'] })).toHaveLength(1);
    expect(evaluate({ countriesAnyOf: ['FR'] })).toHaveLength(1);
  });

  it('cannot tell without facts', () => {
    const subject: PolicySubject = {
      imdbId: 'tt1',
      titles: { title: 'X', originalTitle: null, frenchTitle: null, originalLanguage: null, year: null },
      facts: null,
      requester: null,
    };
    expect(attributesPolicy.evaluate(subject, { params: attributesParamsSchema.parse({}), entries: [] })).toBeNull();
  });
});
