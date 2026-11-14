import { Placement } from '@crn-flix/policy';

import { ShelfOverridesRepository } from '@/services/database/library';
import { PolicyExemptionsRepository } from '@/services/database/policy';
import { UsersRepository } from '@/services/database/users';
import { LibraryAccess } from '@/services/library/access';
import { LibraryPaths } from '@/services/library/paths';
import { PolicyShelfResolver } from '@/services/library/resolver';
import { PolicyService } from '@/services/policy/policy';

const TITLE = { section: 'movies' as const, folder: 'War [imdbid-tt1]', imdbId: 'tt1' };

function build(opts: {
  placement?: Placement | Error;
  overrides?: Map<string, string>;
  personal?: Map<string, string[]>;
  stored?: Map<string, Placement>;
}) {
  const placementOf = jest.fn(() =>
    opts.placement instanceof Error ? Promise.reject(opts.placement) : Promise.resolve(opts.placement ?? null),
  );
  const resolver = new PolicyShelfResolver(
    {
      placementOf,
      storedPlacements: jest.fn().mockResolvedValue(opts.stored ?? new Map()),
    } as unknown as PolicyService,
    {
      listGrantedPersonal: jest.fn().mockResolvedValue(opts.personal ?? new Map()),
    } as unknown as PolicyExemptionsRepository,
    { list: jest.fn().mockResolvedValue(opts.overrides ?? new Map()) } as unknown as ShelfOverridesRepository,
    {
      list: jest.fn().mockResolvedValue([
        { id: 'dad', profile: 'adult' },
        { id: 'son', profile: 'kids' },
      ]),
    } as unknown as UsersRepository,
  );
  return { resolver, placementOf };
}

describe('PolicyShelfResolver', () => {
  it('gives the war film to the son on his own shelf, leaving it on standard for the others', async () => {
    const { resolver } = build({
      placement: { kind: 'shelf', shelf: 'standard', forced: false },
      personal: new Map([['tt1', ['son', 'dad']]]),
    });

    const shelvesOf = await resolver.shelvesOf([TITLE]);

    expect(shelvesOf('tt1')).toEqual({ shared: 'standard', personal: ['son'] });
  });

  it('shows a restricted title on personal shelves only', async () => {
    const { resolver } = build({
      placement: { kind: 'restricted', refusals: [] },
      personal: new Map([['tt1', ['dad']]]),
    });

    expect((await resolver.shelvesOf([TITLE]))('tt1')).toEqual({ shared: null, personal: ['dad'] });
  });

  it('passes the admin’s choice to the placement and keeps a title it cannot place off the shared shelves', async () => {
    const { resolver, placementOf } = build({
      placement: new Error('TMDB down'),
      overrides: new Map([['tt1', 'kids']]),
    });

    expect((await resolver.shelvesOf([TITLE]))('tt1')).toEqual({ shared: null, personal: [] });
    expect(placementOf).toHaveBeenCalledWith('tt1', 'kids');
  });
});

describe('PolicyShelfResolver on a page', () => {
  it('reads the stored placements and never assesses a title not assessed yet', async () => {
    const { resolver, placementOf } = build({
      stored: new Map([['tt1', { kind: 'shelf', shelf: 'kids', forced: false } as Placement]]),
    });

    const shelvesOf = await resolver.shelvesOf([TITLE, { ...TITLE, imdbId: 'tt2', folder: 'New' }], { assess: false });

    expect(shelvesOf('tt1').shared).toBe('kids');
    expect(shelvesOf('tt2').shared).toBeNull();
    expect(placementOf).not.toHaveBeenCalled();
  });
});

describe('LibraryAccess', () => {
  const config = {
    mediasPath: '/data/medias',
    moviesFolder: 'movies',
    seriesFolder: 'series',
    playerRoot: '/medias',
    kidsMaxParentalRating: 10,
  };
  const fs = (personalOf: string[]) => ({
    mkdir: jest.fn().mockResolvedValue(undefined),
    stat: jest.fn((folder: string) =>
      personalOf.some((userId) => folder.includes(`/users/${userId}/`))
        ? Promise.resolve({})
        : Promise.reject(new Error('ENOENT')),
    ),
  });
  const user = (id: string, profile: 'adult' | 'kids') => ({ id, name: id, profile }) as never;

  it('gives a child the kids shelf, their own shelf and the parental limit', async () => {
    const access = new LibraryAccess(config, new LibraryPaths(config), fs(['son']) as never);

    await expect(access.policyOf(user('son', 'kids'))).resolves.toEqual({
      libraries: {
        paths: [
          '/medias/shelves/kids/movies',
          '/medias/shelves/kids/series',
          '/medias/shelves/users/son/movies',
          '/medias/shelves/users/son/series',
        ],
        managedRoot: '/medias',
      },
      maxParentalRating: 10,
    });
  });

  it('gives an adult every shared shelf and no parental limit', async () => {
    const access = new LibraryAccess(config, new LibraryPaths(config), fs([]) as never);

    await expect(access.policyOf(user('dad', 'adult'))).resolves.toEqual({
      libraries: {
        paths: ['/medias/shelves/kids/movies', '/medias/shelves/kids/series', '/medias/movies', '/medias/series'],
        managedRoot: '/medias',
      },
      maxParentalRating: null,
    });
  });

  it('lists the shared libraries and the personal ones that hold something', async () => {
    const access = new LibraryAccess(config, new LibraryPaths(config), fs(['son']) as never);

    const libraries = await access.libraries([user('dad', 'adult'), user('son', 'kids')]);

    expect(libraries.map((library) => `${library.name} → ${library.path}`)).toEqual([
      'Films enfants → /medias/shelves/kids/movies',
      'Séries enfants → /medias/shelves/kids/series',
      'Films → /medias/movies',
      'Séries → /medias/series',
      'Films · son → /medias/shelves/users/son/movies',
      'Séries · son → /medias/shelves/users/son/series',
    ]);
  });

  it('gives each library the picture of its shelf, the personal ones sharing one', async () => {
    const images = {
      of: jest.fn(async (shelf: string, section: string) => ({
        data: new Uint8Array(),
        contentType: 'image/jpeg' as const,
        tag: `${shelf}/${section}`,
      })),
    };
    const access = new LibraryAccess(config, new LibraryPaths(config), fs(['son']) as never, images);

    const libraries = await access.libraries([user('son', 'kids')]);

    expect(libraries.map((library) => `${library.name}: ${(library.image as unknown as { tag: string }).tag}`)).toEqual(
      [
        'Films enfants: kids/movies',
        'Séries enfants: kids/series',
        'Films: standard/movies',
        'Séries: standard/series',
        'Films · son: personal/movies',
        'Séries · son: personal/series',
      ],
    );
  });
});
