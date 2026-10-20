import { LibraryIdentity } from '@crn-flix/contracts';

import { JellyfinLayout, sanitizeTitle } from '../src';

const movie: LibraryIdentity = {
  imdbId: 'tt0367594',
  type: 'movie',
  title: 'Charlie and the Chocolate Factory',
  year: 2005,
  seasonNumber: null,
  episodeNumber: null,
  episodeNumberEnd: null,
};

const episode: LibraryIdentity = {
  imdbId: 'tt14688458',
  type: 'episode',
  title: 'Silo',
  year: 2023,
  seasonNumber: 1,
  episodeNumber: 3,
  episodeNumberEnd: null,
};

const layout = new JellyfinLayout();

describe('JellyfinLayout', () => {
  it('files a movie in an imdb-tagged folder named like the file', () => {
    expect(layout.place(movie)).toEqual({
      section: 'movies',
      folders: ['Charlie.and.the.Chocolate.Factory.(2005).[imdbid-tt0367594]'],
      fileName: 'Charlie.and.the.Chocolate.Factory.(2005).[imdbid-tt0367594]',
    });
  });

  it('files an episode under its show and season', () => {
    expect(layout.place(episode)).toEqual({
      section: 'series',
      folders: ['Silo.(2023).[imdbid-tt14688458]', 'Season01'],
      fileName: 'Silo.(2023).S01E03.[imdbid-tt14688458]',
    });
  });

  it('names a multi-episode file with its episode range', () => {
    expect(layout.place({ ...episode, episodeNumberEnd: 4 }).fileName).toBe(
      'Silo.(2023).S01E03-E04.[imdbid-tt14688458]',
    );
  });

  it('leaves out the tags it does not know', () => {
    expect(layout.place({ ...movie, year: null, imdbId: null }).fileName).toBe('Charlie.and.the.Chocolate.Factory');
  });
});

describe('sanitizeTitle', () => {
  it('drops accents and punctuation and dots the words', () => {
    expect(sanitizeTitle("L'Été - meurtrier !")).toBe('L.Ete.meurtrier.');
  });
});
