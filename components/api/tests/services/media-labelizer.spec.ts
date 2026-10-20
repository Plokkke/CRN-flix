import { MetadataSource } from '@crn-flix/contracts';
import { JellyfinLayout } from '@crn-flix/layout-jellyfin';

import { MediaIdentity, MediaLabelizerService } from '@/services/media-labelizer';

const config = {
  downloads: '/data/downloads',
  movies: '/data/medias/movies',
  series: '/data/medias/series',
  privateMovies: '/data/medias/private/movies',
  privateSeries: '/data/medias/private/series',
};

const layout = new JellyfinLayout();

function resolver(title: string | null): MetadataSource {
  return { describe: jest.fn().mockResolvedValue({ title, year: 2005 }) } as unknown as MetadataSource;
}

const frenchMovie: MediaIdentity = {
  title: 'Charlie et la Chocolaterie',
  year: 2005,
  imdbId: 'tt0367594',
  mediaType: 'movie',
  seasonNumber: null,
  episodeNumber: null,
  episodeNumberEnd: null,
};

describe('MediaLabelizerService.toCanonicalIdentity', () => {
  it('names files with the English title, like the naming audit does', async () => {
    const service = new MediaLabelizerService(config, resolver('Charlie and the Chocolate Factory'), layout);

    const canonical = await service.toCanonicalIdentity(frenchMovie);
    const [folder, file] = service.generateDestination(canonical);

    expect(folder).toBe('/data/medias/movies/Charlie.and.the.Chocolate.Factory.(2005).[imdbid-tt0367594]');
    expect(file).toBe('Charlie.and.the.Chocolate.Factory.(2005).[imdbid-tt0367594]');
  });

  it('keeps the identified title when TMDB has no English title', async () => {
    const service = new MediaLabelizerService(config, resolver(null), layout);

    const canonical = await service.toCanonicalIdentity(frenchMovie);

    expect(canonical.title).toBe('Charlie et la Chocolaterie');
  });

  it('skips resolution without an IMDb id', async () => {
    const english = resolver('Anything');
    const service = new MediaLabelizerService(config, english, layout);

    await service.toCanonicalIdentity({ ...frenchMovie, imdbId: null as unknown as string });

    expect(english.describe).not.toHaveBeenCalled();
  });
});

describe('MediaLabelizerService.generateDestination', () => {
  const service = new MediaLabelizerService(config, resolver(null), layout);
  const episode: MediaIdentity = {
    ...frenchMovie,
    title: 'Silo',
    imdbId: 'tt14688458',
    mediaType: 'episode',
    year: 2023,
    seasonNumber: 1,
    episodeNumber: 3,
  };

  it('roots the layout placement in the shared or private section', () => {
    expect(service.generateDestination(episode)[0]).toBe(
      '/data/medias/series/Silo.(2023).[imdbid-tt14688458]/Season01',
    );
    expect(service.generateDestination(episode, { isPrivate: true })[0]).toBe(
      '/data/medias/private/series/Silo.(2023).[imdbid-tt14688458]/Season01',
    );
    expect(service.generateDestination(frenchMovie, { isPrivate: true })[0]).toMatch(
      /^\/data\/medias\/private\/movies\//,
    );
  });
});
