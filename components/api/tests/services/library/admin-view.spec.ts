import { Placement } from '@crn-flix/policy';

import {
  buildLibraryView,
  filterQuery,
  LibraryFilter,
  LibraryViewInput,
  PAGE_SIZE,
  selectRows,
} from '@/services/library/admin-view';
import { adminLibraryTemplate } from '@/web/templates/admin-library';

const RESTRICTED: Placement = {
  kind: 'restricted',
  refusals: [{ ruleId: 'r1', ruleName: 'Violences', summary: 'Marlon Brando (Interprétation (Paul))', notices: [] }],
};

const NAMES: Record<string, string> = {
  tt1: 'Le Parrain',
  tt2: 'Cars',
  tt3: 'Le Dernier Tango à Paris',
  tt4: 'Bluey',
  tt5: 'Élémentaire',
};

function input(overrides: Partial<LibraryViewInput> = {}): LibraryViewInput {
  return {
    titles: [
      { imdbId: 'tt1', section: 'movies' },
      { imdbId: 'tt2', section: 'movies' },
      { imdbId: 'tt3', section: 'movies' },
      { imdbId: 'tt4', section: 'series' },
      { imdbId: 'tt5', section: 'movies' },
    ],
    titleOf: (imdbId) => NAMES[imdbId] ?? imdbId,
    computedOf: (imdbId) =>
      imdbId === 'tt3' || imdbId === 'tt1' ? RESTRICTED : { kind: 'shelf', shelf: 'standard', forced: false },
    overrides: [
      { imdbId: 'tt1', shelf: 'standard', origin: 'anomaly' },
      { imdbId: 'tt2', shelf: 'kids', origin: 'admin' },
    ],
    sharedOf: (imdbId) => ({ tt1: 'standard', tt2: 'kids', tt3: null, tt4: 'kids', tt5: 'standard' })[imdbId] ?? null,
    grantsOf: (imdbId) => (imdbId === 'tt5' ? ['son'] : []),
    userNameOf: (userId) => `user-${userId}`,
    ...overrides,
  };
}

const ALL: LibraryFilter = { sort: 'attention', page: 1 };
const titlesOf = (filter: Partial<LibraryFilter>): string[] =>
  selectRows(buildLibraryView(input()), { ...ALL, ...filter }).rows.map((row) => row.title);

describe('buildLibraryView', () => {
  it('tells for each title what the rules say, where it is, what was imposed and who has it personally', () => {
    const rows = buildLibraryView(input());
    const byId = new Map(rows.map((row) => [row.imdbId, row]));

    expect(byId.get('tt3')).toMatchObject({
      unplaced: true,
      computed: { label: 'Restreint', reasons: ['Violences : Marlon Brando (Interprétation (Paul))'] },
    });
    expect(byId.get('tt2')).toMatchObject({ shared: 'kids', choice: { shelf: 'kids', origin: 'admin' } });
    expect(byId.get('tt5')).toMatchObject({ personal: [{ userId: 'son', name: 'user-son' }], section: 'movies' });
  });

  it('says when a title was never assessed', () => {
    expect(buildLibraryView(input({ computedOf: () => null }))[0].computed.label).toBe('Pas encore évalué');
  });
});

describe('selectRows', () => {
  it('puts first what needs the admin: on no shelf, anomaly, restricted, imposed, then by title', () => {
    expect(titlesOf({})).toEqual(['Le Dernier Tango à Paris', 'Le Parrain', 'Cars', 'Bluey', 'Élémentaire']);
    expect(titlesOf({ sort: 'title' })).toEqual([
      'Bluey',
      'Cars',
      'Élémentaire',
      'Le Dernier Tango à Paris',
      'Le Parrain',
    ]);
  });

  it('filters by name (accents and case ignored, or the exact imdb id), type, shelf and state', () => {
    expect(titlesOf({ q: 'elem' })).toEqual(['Élémentaire']);
    expect(titlesOf({ q: 'TT4' })).toEqual(['Bluey']);
    expect(titlesOf({ type: 'series' })).toEqual(['Bluey']);
    expect(titlesOf({ shelf: 'kids' })).toEqual(['Cars', 'Bluey']);
    expect(titlesOf({ shelf: 'none' })).toEqual(['Le Dernier Tango à Paris']);
    expect(titlesOf({ state: 'anomaly' })).toEqual(['Le Parrain']);
    expect(titlesOf({ state: 'restricted' })).toEqual(['Le Dernier Tango à Paris', 'Le Parrain']);
    expect(titlesOf({ state: 'personal' })).toEqual(['Élémentaire']);
  });

  it('cuts the kept rows into pages and tells how many it kept', () => {
    const many = input({
      titles: Array.from({ length: PAGE_SIZE + 5 }, (_unused, index) => ({ imdbId: `tt${index}`, section: 'movies' })),
    });
    const second = selectRows(buildLibraryView(many), { ...ALL, sort: 'title', page: 2 });

    expect(second.total).toBe(PAGE_SIZE + 5);
    expect(second.rows).toHaveLength(5);
  });
});

describe('filterQuery', () => {
  it('keeps only the set criteria, without the default sort or the first page', () => {
    expect(filterQuery(ALL)).toBe('');
    expect(filterQuery({ ...ALL, q: 'tango', shelf: 'none', sort: 'title', page: 3 })).toBe(
      'sort=title&page=3&q=tango&shelf=none',
    );
  });
});

describe('adminLibraryTemplate', () => {
  const render = (filter: LibraryFilter = { ...ALL, shelf: 'kids' }): string => {
    const rows = buildLibraryView(input());
    return adminLibraryTemplate({
      serviceName: 'CRN-Flix',
      filter,
      unplaced: rows.filter((row) => row.unplaced).length,
      ...selectRows(rows, filter),
      users: [
        { id: 'son', name: 'leo' },
        { id: 'u1', name: 'papa' },
      ],
    });
  };

  it('keeps the filter in the form and in every action, and counts what it shows', () => {
    const html = render();

    expect(html).toContain('<option value="kids" selected>Kids</option>');
    expect(html).toContain('<p class="hint">2 titre(s)</p>');
    expect(html).toContain('<input type="hidden" name="view" value="shelf=kids" />');
    expect(html).toContain('1 titre(s) sur aucune étagère');
    expect(html).toContain('action="/admin/library/tt2/shelf"');
  });

  it('filters as the admin types or picks, with no button: only the results block is replaced', () => {
    const html = render();

    expect(html).not.toContain('>Filtrer</button>');
    expect(html).toContain('<div id="library-results">');
    expect(html).toContain('setTimeout(refresh, 300)');
  });

  it('shows the shared shelf as radio chips and every subscriber as a checkbox chip, checked when granted', () => {
    const html = render({ ...ALL, q: 'elementaire' });

    expect(html).toContain('<input type="radio" name="shelf" value="auto" checked />');
    expect(html).toContain('<input type="radio" name="shelf" value="kids" />');
    expect(html).toContain('<input type="checkbox" name="userId" value="son" checked /><span>leo</span>');
    expect(html).toContain('<input type="checkbox" name="userId" value="u1" /><span>papa</span>');
  });

  it('marks the admin’s choice among the shared shelf chips', () => {
    expect(render({ ...ALL, q: 'cars' })).toContain('<input type="radio" name="shelf" value="kids" checked />');
  });
});
