import { MediaTitles, PolicyKind } from '@crn-flix/contracts';
import { Exemption, PolicyRuleRecord } from '@crn-flix/policy';
import { titlesPolicy } from '@crn-flix/policy-titles';

import { MediasRepository } from '@/services/database/medias';
import {
  PolicyAssessmentsRepository,
  PolicyExemptionsRepository,
  PolicyRulesRepository,
  StoredAssessment,
} from '@/services/database/policy';
import { MediaFactsService } from '@/services/media-facts';
import { PolicyService, rulesFingerprint } from '@/services/policy/policy';

const TITLES: MediaTitles = {
  title: 'Banned',
  originalTitle: null,
  frenchTitle: null,
  originalLanguage: null,
  year: 2001,
};

const RULE: PolicyRuleRecord = {
  id: 'rule-1',
  name: 'Politique titres',
  kind: 'titles',
  audience: 'everyone',
  params: {},
  entries: [{ imdbId: 'tt1', title: 'Banned', reason: 'Retiré.' }],
};

function build(opts: { stored?: StoredAssessment | null; exemptions?: Exemption[]; stale?: string[] } = {}) {
  const assessments = {
    get: jest.fn().mockResolvedValue(opts.stored ?? null),
    save: jest.fn().mockResolvedValue(undefined),
    listStale: jest.fn().mockResolvedValue(opts.stale ?? []),
  };
  const facts = { ensure: jest.fn().mockResolvedValue(null) };
  const service = new PolicyService(
    { mode: 'dry-run' },
    new Map([['titles', titlesPolicy as PolicyKind]]),
    { listEnabled: jest.fn().mockResolvedValue([RULE]) } as unknown as PolicyRulesRepository,
    assessments as unknown as PolicyAssessmentsRepository,
    { listGranted: jest.fn().mockResolvedValue(opts.exemptions ?? []) } as unknown as PolicyExemptionsRepository,
    facts as unknown as MediaFactsService,
    { titlesOf: jest.fn().mockResolvedValue(TITLES) } as unknown as MediasRepository,
  );
  return { service, assessments, facts };
}

describe('PolicyService', () => {
  it('assesses a title on its content and stores the outcomes under the rules fingerprint', async () => {
    const { service, assessments, facts } = build();

    const outcomes = await service.outcomesOf('tt1');

    expect(facts.ensure).toHaveBeenCalledWith('tt1');
    expect(outcomes).toEqual([expect.objectContaining({ ruleId: 'rule-1', status: 'refused' })]);
    expect(assessments.save).toHaveBeenCalledWith('tt1', outcomes, rulesFingerprint([RULE]));
  });

  it('reuses an assessment made with the same rules', async () => {
    const stored = { outcomes: [], fingerprint: rulesFingerprint([RULE]), assessedAt: new Date() };
    const { service, assessments } = build({ stored });

    await expect(service.outcomesOf('tt1')).resolves.toBe(stored.outcomes);
    expect(assessments.save).not.toHaveBeenCalled();
  });

  it('assesses again once the rules changed', async () => {
    const stored = { outcomes: [], fingerprint: 'older rules', assessedAt: new Date() };
    const { service, assessments } = build({ stored });

    await service.outcomesOf('tt1');
    expect(assessments.save).toHaveBeenCalled();
  });

  it('restricts a refused title unless exempted for everyone, then shelves it on standard without kids rules', async () => {
    await expect(build().service.placementOf('tt1')).resolves.toMatchObject({ kind: 'restricted' });
    await expect(
      build({ exemptions: [{ userId: null, ruleId: 'rule-1' }] }).service.placementOf('tt1'),
    ).resolves.toMatchObject({ kind: 'shelf', shelf: 'standard' });
  });

  it('only counts the requester’s own exemptions and the global ones', async () => {
    const { service } = build({ exemptions: [{ userId: 'someone-else', ruleId: 'rule-1' }] });

    await expect(service.admissionOf('me', 'adult', 'tt1')).resolves.toMatchObject({ admitted: false });
    await expect(service.admissionOf('someone-else', 'adult', 'tt1')).resolves.toEqual({
      admitted: true,
      via: 'exemption',
    });
  });

  it('keeps refreshing past a failing title', async () => {
    const { service, assessments, facts } = build({ stale: ['tt1', 'tt2'] });
    facts.ensure.mockRejectedValueOnce(new Error('TMDB down'));

    await service.refresh();
    expect(assessments.save).toHaveBeenCalledTimes(1);
    expect(assessments.save).toHaveBeenCalledWith('tt2', expect.any(Array), expect.any(String));
  });
});
