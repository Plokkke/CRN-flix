import { PolicyKind } from '@crn-flix/contracts';
import { creditsPolicy } from '@crn-flix/policy-credits';
import { titlesPolicy } from '@crn-flix/policy-titles';

import { PolicyRuleEntity } from '@/services/database/policy';
import { adminPoliciesTemplate, adminPolicyRuleTemplate } from '@/web/templates/admin-policies';

const rule: PolicyRuleEntity = {
  id: 'rule-1',
  name: 'Politique <violences>',
  kind: 'credits',
  audience: 'everyone',
  params: { departments: ['Directing', 'Acting'], jobs: [], minEpisodes: 3 },
  enabled: true,
  position: 0,
  entryCount: 1,
};

const KINDS = [creditsPolicy, titlesPolicy] as PolicyKind[];

describe('adminPoliciesTemplate', () => {
  it('lists the rules with what they hold back, and the restricted titles', () => {
    const html = adminPoliciesTemplate({
      serviceName: 'CRN-Flix',
      mode: 'dry-run',
      rules: [rule],
      kinds: KINDS,
      audiences: ['everyone', 'kids', 'standard'],
      overview: {
        restricted: [
          { imdbId: 'tt1', title: 'Film', refusals: [{ ruleId: 'rule-1', ruleName: 'R', summary: 'Jo', notices: [] }] },
        ],
        shelved: { kids: [], standard: [] },
        counts: new Map([['rule-1', { refused: 1, undetermined: 0, invalid: 2 }]]),
        outdated: 0,
      },
    });

    expect(html).toContain('Politique &lt;violences&gt;');
    expect(html).toContain('1 refusé(s)');
    expect(html).toContain('2 invalide(s)');
    expect(html).toContain('dry-run : les titres sont évalués, personne n’est refusé');
    expect(html).toContain('Restreints (1)');
  });
});

describe('adminPolicyRuleTemplate', () => {
  it('renders the kind params as inputs filled with the stored values', () => {
    const html = adminPolicyRuleTemplate({
      serviceName: 'CRN-Flix',
      rule,
      kind: creditsPolicy as PolicyKind,
      audiences: ['everyone'],
      entries: [],
      personQuery: '',
      candidates: [],
    });

    expect(html).toContain('name="departments"');
    expect(html).toContain('Directing\nActing</textarea>');
    expect(html).toMatch(/name="minEpisodes" value="3"/);
  });

  it('offers namesakes to pick from, with their page', () => {
    const html = adminPolicyRuleTemplate({
      serviceName: 'CRN-Flix',
      rule,
      kind: creditsPolicy as PolicyKind,
      audiences: ['everyone'],
      entries: [
        {
          id: 'e1',
          data: {
            ref: 'tmdb:person:1',
            name: 'Jo Example',
          },
        },
      ],
      personQuery: 'Jo',
      candidates: [
        {
          ref: 'tmdb:person:2',
          name: 'Jo Other',
          knownForDepartment: 'Acting',
          knownFor: ['A'],
          pageUrl: 'https://tmdb/p/2',
        },
      ],
    });

    expect(html).toContain('value="tmdb:person:2|Jo Other"');
    expect(html).toContain('href="https://tmdb/p/2"');
    expect(html).toContain('Jo Example');
    expect(html).toContain('/admin/policies/rule-1/entries/e1/delete');
  });
});
