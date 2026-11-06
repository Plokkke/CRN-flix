import { desiredLinks, diffLinks, linkTo } from '@/services/library/links';
import { LibraryPaths } from '@/services/library/paths';

const paths = new LibraryPaths({
  layout: 'shelves',
  mediasPath: '/data/medias',
  moviesFolder: 'movies',
  seriesFolder: 'series',
  playerRoot: '/medias',
  kidsMaxParentalRating: 10,
});

describe('LibraryPaths', () => {
  it('keeps the standard shelf in the historical section folders, the rest under shelves/', () => {
    expect(paths.store('movies')).toBe('/data/medias/store/movies');
    expect(paths.shelf('standard', 'series')).toBe('/data/medias/series');
    expect(paths.shelf('kids', 'movies')).toBe('/data/medias/shelves/kids/movies');
    expect(paths.personal('u1', 'series')).toBe('/data/medias/shelves/users/u1/series');
    expect(paths.forPlayer('/data/medias/shelves/kids/movies')).toBe('/medias/shelves/kids/movies');
  });
});

describe('desiredLinks', () => {
  it('links each title folder from its shared shelf and the personal shelves, relatively', () => {
    const links = desiredLinks(
      [{ section: 'movies', folder: 'War (1999) [imdbid-tt1]', imdbId: 'tt1' }],
      () => ({ shared: 'standard', personal: ['son'] }),
      paths,
    );

    expect(links).toEqual([
      { path: '/data/medias/movies/War (1999) [imdbid-tt1]', target: '../store/movies/War (1999) [imdbid-tt1]' },
      {
        path: '/data/medias/shelves/users/son/movies/War (1999) [imdbid-tt1]',
        target: '../../../../store/movies/War (1999) [imdbid-tt1]',
      },
    ]);
  });

  it('shows a restricted title nowhere but on personal shelves', () => {
    const links = desiredLinks(
      [{ section: 'series', folder: 'S', imdbId: 'tt2' }],
      () => ({ shared: null, personal: [] }),
      paths,
    );
    expect(links).toEqual([]);
  });
});

describe('diffLinks', () => {
  const kept = linkTo('/data/medias/movies/A', '/data/medias/store/movies/A');
  const moved = linkTo('/data/medias/movies/B', '/data/medias/store/movies/B');

  it('creates the missing links, removes the unwanted ones and replaces those pointing elsewhere', () => {
    const stale = { path: moved.path, target: '../store/movies/Old' };
    const unwanted = linkTo('/data/medias/shelves/kids/movies/C', '/data/medias/store/movies/C');

    expect(diffLinks([kept, moved], [kept, stale, unwanted])).toEqual({ create: [moved], remove: [stale, unwanted] });
  });

  it('changes nothing when the shelves already match', () => {
    expect(diffLinks([kept], [kept])).toEqual({ create: [], remove: [] });
  });
});
