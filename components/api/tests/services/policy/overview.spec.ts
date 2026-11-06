import { RuleOutcome } from '@crn-flix/policy';

import { TitledAssessment } from '@/services/database/policy';
import { buildPolicyOverview } from '@/services/policy/overview';
import { SHELVES } from '@/services/policy/shelves';

const outcome = (ruleId: string, audience: string, status: RuleOutcome['status']): RuleOutcome => ({
  ruleId,
  ruleName: ruleId,
  audience,
  status,
  matches: status === 'refused' ? [{ summary: `${ruleId} refuse`, notice: { headline: '', blocks: [] } }] : [],
  problem: null,
});

const assessment = (imdbId: string, title: string, outcomes: RuleOutcome[], fingerprint = 'fp'): TitledAssessment => ({
  imdbId,
  title,
  outcomes,
  fingerprint,
});

describe('buildPolicyOverview', () => {
  const assessments = [
    assessment('tt1', 'Zorro', [outcome('credits', 'everyone', 'refused'), outcome('kids', 'kids', 'passed')]),
    assessment('tt2', 'Bambi', [outcome('credits', 'everyone', 'passed'), outcome('kids', 'kids', 'passed')]),
    assessment('tt3', 'Alien', [outcome('credits', 'everyone', 'passed'), outcome('kids', 'kids', 'undetermined')]),
    assessment('tt4', 'Old', [outcome('credits', 'everyone', 'refused')], 'older rules'),
  ];

  it('places every title assessed with the current rules', () => {
    const overview = buildPolicyOverview(assessments, 'fp', SHELVES, new Map());

    expect(overview.restricted).toEqual([
      { imdbId: 'tt1', title: 'Zorro', refusals: [expect.objectContaining({ ruleId: 'credits' })] },
    ]);
    expect(overview.shelved).toEqual({
      kids: [{ imdbId: 'tt2', title: 'Bambi' }],
      standard: [{ imdbId: 'tt3', title: 'Alien' }],
    });
    expect(overview.outdated).toBe(1);
  });

  it('counts what each rule holds back, by reason', () => {
    const overview = buildPolicyOverview(assessments, 'fp', SHELVES, new Map());

    expect(overview.counts.get('credits')).toEqual({ refused: 1, undetermined: 0, invalid: 0 });
    expect(overview.counts.get('kids')).toEqual({ refused: 0, undetermined: 1, invalid: 0 });
  });

  it('lets a global exemption through', () => {
    const exemptions = new Map([['tt1', [{ userId: null, ruleId: 'credits' }]]]);

    expect(buildPolicyOverview(assessments, 'fp', SHELVES, exemptions).restricted).toEqual([]);
  });
});
