import { buildSearchQueries, isSameTitle, sanitizeForSearch } from '@/modules/indexer/query';

describe('sanitizeForSearch', () => {
  it('strips accents, punctuation and extra spaces', () => {
    expect(sanitizeForSearch("Maman, j'ai raté  l'avion !")).toBe('Maman jai rate lavion');
  });
});

describe('buildSearchQueries', () => {
  it('keeps the caller order, drops blanks and duplicates, then repeats with the year', () => {
    expect(buildSearchQueries(['Piège de cristal', null, 'Die Hard', 'Die Hard', ''], 1988)).toEqual([
      'Piege de cristal',
      'Die Hard',
      'Piege de cristal 1988',
      'Die Hard 1988',
    ]);
  });

  it('adds no year variant when the year is unknown', () => {
    expect(buildSearchQueries(['Silo'], null)).toEqual(['Silo']);
  });
});

describe('isSameTitle', () => {
  it('ignores accents, punctuation and case', () => {
    expect(isSameTitle("Maman, j'ai raté l'avion !", 'maman jai rate lavion')).toBe(true);
  });

  it('never matches a missing title', () => {
    expect(isSameTitle(null, 'Taxi')).toBe(false);
    expect(isSameTitle('', '')).toBe(false);
  });
});
