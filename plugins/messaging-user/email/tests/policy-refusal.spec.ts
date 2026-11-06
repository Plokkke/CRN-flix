import { PolicyRefusal } from '@crn-flix/contracts';

import { policyRefusalTemplate } from '../src/templates';

const identity = { serviceName: 'CRN-Flix', playerUrl: 'https://player', userSpaceUrl: 'https://flix/me' };

const refusal: PolicyRefusal = {
  title: 'Un <film>',
  year: 2001,
  posterUrl: null,
  policies: [
    {
      name: 'Violences',
      notices: [
        {
          headline: 'Ce titre implique Jo Example',
          blocks: [
            { type: 'paragraph', text: 'Le service ne diffuse pas ces œuvres.' },
            { type: 'facts', items: [{ label: 'Rôle', value: 'Réalisation' }] },
            { type: 'links', title: 'Sources', links: [{ label: 'Journal (2024)', url: 'https://example.org/a' }] },
          ],
        },
      ],
    },
  ],
  appealUrl: 'https://flix/me/appeal/1',
};

describe('policyRefusalTemplate', () => {
  it('words one refusal with every block of every policy, escaped', () => {
    const { subject, html, text } = policyRefusalTemplate(identity, 'Alex', [refusal]);

    expect(subject).toBe('🚫 Demande refusée : Un <film> (2001)');
    expect(html).toContain('Un &lt;film&gt; (2001)');
    expect(html).toContain('Politique « Violences »');
    expect(html).toContain('<strong>Rôle :</strong> Réalisation');
    expect(html).toContain('href="https://example.org/a"');
    expect(html).toContain('href="https://flix/me/appeal/1"');
    expect(text).toContain('Ce titre implique Jo Example');
    expect(text).toContain('- Journal (2024) : https://example.org/a');
    expect(text).toContain('Contester ou demander une dérogation : https://flix/me/appeal/1');
  });

  it('batches several titles and offers no appeal until there is one', () => {
    const { subject, html } = policyRefusalTemplate(identity, 'Alex', [
      { ...refusal, appealUrl: null },
      { ...refusal, title: 'Autre', year: null, appealUrl: null },
    ]);

    expect(subject).toBe('🚫 2 demandes refusées sur CRN-Flix');
    expect(html).not.toContain('Contester');
  });
});
