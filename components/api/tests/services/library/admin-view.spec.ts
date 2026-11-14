import { Placement } from '@crn-flix/policy';

import { buildLibraryView, LibraryViewInput } from '@/services/library/admin-view';
import { adminLibraryTemplate } from '@/web/templates/admin-library';

const RESTRICTED: Placement = {
  kind: 'restricted',
  refusals: [{ ruleId: 'r1', ruleName: 'Violences', summary: 'Marlon Brando (Interprétation (Paul))', notices: [] }],
};

function input(overrides: Partial<LibraryViewInput> = {}): LibraryViewInput {
  const titles: Record<string, string> = { tt1: 'Le Parrain', tt2: 'Cars', tt3: 'Le Dernier Tango à Paris' };
  return {
    imdbIds: ['tt1', 'tt2', 'tt3'],
    titleOf: (imdbId) => titles[imdbId] ?? imdbId,
    computedOf: (imdbId) => (imdbId === 'tt3' ? RESTRICTED : { kind: 'shelf', shelf: 'standard', forced: false }),
    overrides: [],
    sharedOf: (imdbId) => (imdbId === 'tt3' ? null : 'standard'),
    grantsOf: () => [],
    userNameOf: (userId) => `user-${userId}`,
    ...overrides,
  };
}

describe('buildLibraryView', () => {
  it('lists the titles on no shelf first, with why the rules restrict them, then the others by title', () => {
    const rows = buildLibraryView(input());

    expect(rows.map((row) => row.title)).toEqual(['Le Dernier Tango à Paris', 'Cars', 'Le Parrain']);
    expect(rows[0]).toMatchObject({
      unplaced: true,
      computed: { label: 'Restreint', reasons: ['Violences : Marlon Brando (Interprétation (Paul))'] },
    });
    expect(rows[1]).toMatchObject({ unplaced: false, shared: 'standard', computed: { label: 'Standard' } });
  });

  it('shows the admin choice and who was granted the title personally', () => {
    const rows = buildLibraryView(
      input({
        overrides: [{ imdbId: 'tt3', shelf: 'none', origin: 'manual-download' }],
        grantsOf: (imdbId) => (imdbId === 'tt3' ? ['son'] : []),
      }),
    );
    const tango = rows.find((row) => row.imdbId === 'tt3');

    expect(tango).toMatchObject({
      choice: { shelf: 'none', origin: 'manual-download' },
      personal: [{ userId: 'son', name: 'user-son' }],
      unplaced: false,
    });
  });

  it('says when a title was never assessed', () => {
    expect(buildLibraryView(input({ computedOf: () => null }))[0].computed.label).toBe('Pas encore évalué');
  });
});

describe('adminLibraryTemplate', () => {
  const render = (layout = 'shelves', mode = 'enforce'): string =>
    adminLibraryTemplate({
      serviceName: 'CRN-Flix',
      layout,
      mode,
      rows: buildLibraryView(input({ grantsOf: (imdbId) => (imdbId === 'tt1' ? ['u1'] : []) })),
      users: [
        { id: 'u1', name: 'papa' },
        { id: 'u2', name: 'leo' },
      ],
    });

  it('offers to choose the shared shelf and to add the title to a subscriber not granted yet', () => {
    const html = render();

    expect(html).toContain('action="/admin/library/tt1/shelf"');
    expect(html).toContain('<option value="auto" selected>Selon les règles</option>');
    expect(html).toContain('1 titre(s) sur aucune étagère');
    const parrain = html.slice(html.indexOf('Le Parrain'));
    expect(parrain.slice(0, parrain.indexOf('</tr>'))).toContain('<option value="u2">leo</option>');
    expect(parrain.slice(0, parrain.indexOf('</tr>'))).not.toContain('<option value="u1">papa</option>');
  });

  it('warns when the shelves or the rules are not active yet', () => {
    expect(render('legacy', 'dry-run')).toContain('LIBRARY_LAYOUT=legacy');
    expect(render('legacy', 'dry-run')).toContain('Politique en mode dry-run');
    expect(render()).not.toContain('LIBRARY_LAYOUT=legacy');
  });
});
