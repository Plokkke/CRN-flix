import { PolicyKind, PolicySubject } from '@crn-flix/contracts';

import { admit, assess, classify, Exemption, PolicyKinds, PolicyRuleRecord, RuleOutcome, Shelf } from '../src';

const SHELVES: Shelf[] = [
  { key: 'kids', profiles: ['adult', 'kids'] },
  { key: 'standard', profiles: ['adult'] },
];

function outcome(ruleId: string, audience: string, status: RuleOutcome['status']): RuleOutcome {
  const matches =
    status === 'refused' ? [{ summary: `${ruleId} refuse`, notice: { headline: `${ruleId}`, blocks: [] } }] : [];
  return { ruleId, ruleName: `Règle ${ruleId}`, audience, status, matches, problem: null };
}

const CREDITS_REFUSED = outcome('credits', 'everyone', 'refused');
const KIDS_PASSED = outcome('kids-rule', 'kids', 'passed');
const KIDS_REFUSED = outcome('kids-rule', 'kids', 'refused');
const KIDS_UNKNOWN = outcome('kids-rule', 'kids', 'undetermined');

const SON: Exemption = { userId: 'son', ruleId: 'kids-rule' };

describe('assess', () => {
  const kind: PolicyKind<{ max: number }, never> = {
    name: 'max-year',
    description: '',
    scope: 'content',
    params: {
      schema: {
        parse: (input) => {
          const max = (input as { max?: unknown }).max;
          if (typeof max !== 'number') {
            throw new Error('max is required');
          }
          return { max };
        },
      },
      fields: [],
    },
    entries: null,
    evaluate: (subject, { params }) =>
      subject.facts === null
        ? null
        : (subject.facts.year ?? 0) > params.max
          ? [{ summary: 'trop récent', notice: { headline: 'x', blocks: [] } }]
          : [],
  };
  const kinds: PolicyKinds = new Map([[kind.name, kind as PolicyKind]]);
  const rule = (params: unknown, kindName = 'max-year'): PolicyRuleRecord => ({
    id: 'r',
    name: 'R',
    kind: kindName,
    audience: 'everyone',
    params,
    entries: [],
  });
  const subject = (year: number | null): PolicySubject => ({
    imdbId: 'tt1',
    titles: { title: 'X', originalTitle: null, frenchTitle: null, originalLanguage: null, year },
    facts:
      year === null
        ? null
        : {
            kind: 'movie',
            adult: false,
            year,
            runtimeMinutes: null,
            originalLanguage: null,
            originCountries: [],
            genres: [],
            keywords: [],
            certifications: [],
            credits: [],
          },
    requester: null,
  });

  it('turns what the kind returns into a status', () => {
    expect(assess(kinds, [rule({ max: 2000 })], subject(2010))[0]).toMatchObject({ status: 'refused' });
    expect(assess(kinds, [rule({ max: 2020 })], subject(2010))[0]).toMatchObject({ status: 'passed', matches: [] });
    expect(assess(kinds, [rule({ max: 2020 })], subject(null))[0]).toMatchObject({ status: 'undetermined' });
  });

  it('flags a rule whose kind is unknown or whose params no longer validate', () => {
    expect(assess(kinds, [rule({ max: 1 }, 'gone')], subject(2010))[0]).toMatchObject({
      status: 'invalid',
      problem: 'Type de règle inconnu : gone',
    });
    expect(assess(kinds, [rule({})], subject(2010))[0]).toMatchObject({
      status: 'invalid',
      problem: 'Paramètres invalides : max is required',
    });
  });
});

describe('classify', () => {
  it('restricts a title refused for everyone, unless exempted for everyone', () => {
    expect(classify([CREDITS_REFUSED, KIDS_PASSED], SHELVES, [], null)).toMatchObject({ kind: 'restricted' });
    expect(classify([CREDITS_REFUSED, KIDS_PASSED], SHELVES, [{ userId: null, ruleId: 'credits' }], null)).toEqual({
      kind: 'shelf',
      shelf: 'kids',
      forced: false,
    });
  });

  it('puts a title on the first shelf whose rules surely admit it', () => {
    expect(classify([KIDS_PASSED], SHELVES, [], null)).toMatchObject({ shelf: 'kids' });
    expect(classify([KIDS_REFUSED], SHELVES, [], null)).toMatchObject({ shelf: 'standard' });
    expect(classify([KIDS_UNKNOWN], SHELVES, [], null)).toMatchObject({ shelf: 'standard' });
  });

  it('lets a rule for everyone fail open: an unknown title stays available', () => {
    expect(classify([outcome('credits', 'everyone', 'undetermined')], SHELVES, [], null)).toMatchObject({
      kind: 'shelf',
    });
  });

  it('follows the admin choice, whatever the rules say', () => {
    expect(classify([CREDITS_REFUSED], SHELVES, [], 'kids')).toEqual({ kind: 'shelf', shelf: 'kids', forced: true });
    expect(classify([KIDS_PASSED], SHELVES, [], 'none')).toEqual({ kind: 'held' });
  });
});

describe('admit', () => {
  it('admits an adult to anything not refused for everyone', () => {
    expect(admit([KIDS_REFUSED], SHELVES, 'adult', [], null)).toEqual({ admitted: true, via: 'shelf' });
  });

  it('refuses an adult a restricted title with the rule notices', () => {
    const admission = admit([CREDITS_REFUSED], SHELVES, 'adult', [], null);

    expect(admission).toEqual({
      admitted: false,
      refusals: [
        {
          ruleId: 'credits',
          ruleName: 'Règle credits',
          summary: 'credits refuse',
          notices: [{ headline: 'credits', blocks: [] }],
        },
      ],
    });
  });

  it('admits through a personal exemption, to the personal shelf', () => {
    const exemption = { userId: 'me', ruleId: 'credits' };
    expect(admit([CREDITS_REFUSED], SHELVES, 'adult', [exemption], null)).toEqual({ admitted: true, via: 'exemption' });
  });

  it('only admits a child to what the kids rules admit', () => {
    expect(admit([KIDS_PASSED], SHELVES, 'kids', [], null)).toEqual({ admitted: true, via: 'shelf' });
    expect(admit([KIDS_REFUSED], SHELVES, 'kids', [], null)).toMatchObject({ admitted: false });
  });

  it('refuses a child when the kids rules cannot tell, with a generic notice', () => {
    const admission = admit([KIDS_UNKNOWN], SHELVES, 'kids', [], null);

    expect(admission).toMatchObject({
      admitted: false,
      refusals: [{ ruleId: 'kids-rule', summary: 'Impossible de vérifier : informations manquantes' }],
    });
  });

  it('gives the war film to the son alone, through his exemption', () => {
    expect(admit([KIDS_REFUSED], SHELVES, 'kids', [SON], null)).toEqual({ admitted: true, via: 'exemption' });
    expect(classify([KIDS_REFUSED], SHELVES, [], null)).toMatchObject({ shelf: 'standard' });
  });

  it('follows the admin choice for the profiles that see the chosen shelf', () => {
    expect(admit([CREDITS_REFUSED], SHELVES, 'adult', [], 'standard')).toEqual({ admitted: true, via: 'shelf' });
    expect(admit([KIDS_PASSED], SHELVES, 'kids', [], 'standard')).toMatchObject({
      admitted: false,
      refusals: [{ ruleId: null, ruleName: 'Choix de l’administrateur' }],
    });
    expect(admit([KIDS_PASSED], SHELVES, 'kids', [SON], 'standard')).toEqual({ admitted: true, via: 'exemption' });
  });

  it('does not hold a request back for an admin personal download', () => {
    expect(admit([KIDS_REFUSED], SHELVES, 'adult', [], 'none')).toEqual({ admitted: true, via: 'shelf' });
  });
});
