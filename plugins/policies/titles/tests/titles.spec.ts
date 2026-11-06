import { PolicySubject } from '@crn-flix/contracts';

import { titleEntrySchema, titlesPolicy } from '../src';

const subject: PolicySubject = {
  imdbId: 'tt0000001',
  titles: { title: 'Some Title', originalTitle: null, frenchTitle: null, originalLanguage: null, year: 2001 },
  facts: null,
  requester: null,
};

const entry = { imdbId: 'tt0000001', title: 'Some Title', reason: 'Retiré à la demande de l’ayant droit.' };

describe('titlesPolicy', () => {
  it('refuses a listed title with its own reason, even without facts', () => {
    const matches = titlesPolicy.evaluate(subject, { params: {}, entries: [entry] });

    expect(matches).toEqual([
      {
        summary: 'Titre exclu : Retiré à la demande de l’ayant droit.',
        notice: {
          headline: 'Ce titre n’est pas proposé sur le service',
          blocks: [{ type: 'paragraph', text: 'Retiré à la demande de l’ayant droit.' }],
        },
      },
    ]);
  });

  it('lets any other title through', () => {
    expect(titlesPolicy.evaluate(subject, { params: {}, entries: [{ ...entry, imdbId: 'tt9' }] })).toEqual([]);
  });

  it('puts the admin message first', () => {
    const [match] = titlesPolicy.evaluate(subject, { params: { message: 'Politique du foyer.' }, entries: [entry] })!;

    expect(match.notice.blocks[0]).toEqual({ type: 'paragraph', text: 'Politique du foyer.' });
  });

  it('only stores real imdb ids', () => {
    expect(() => titleEntrySchema.parse({ ...entry, imdbId: '12' })).toThrow();
  });
});
