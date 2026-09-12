import { EnglishTitleResolver } from '@/services/english-title-resolver';
import { MediaIdentity, MediaLabelizerService } from '@/services/media-labelizer';

const config = {
  downloads: '/data/downloads',
  movies: '/data/medias/movies',
  series: '/data/medias/series',
  privateMovies: '/data/medias/private/movies',
  privateSeries: '/data/medias/private/series',
};

function resolver(title: string | null): EnglishTitleResolver {
  return { resolve: jest.fn().mockResolvedValue({ title, year: 2005 }) } as unknown as EnglishTitleResolver;
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
    const service = new MediaLabelizerService(config, resolver('Charlie and the Chocolate Factory'));

    const canonical = await service.toCanonicalIdentity(frenchMovie);
    const [folder, file] = service.generateDestination(canonical);

    expect(folder).toBe('/data/medias/movies/Charlie.and.the.Chocolate.Factory.(2005).[imdbid-tt0367594]');
    expect(file).toBe('Charlie.and.the.Chocolate.Factory.(2005).[imdbid-tt0367594]');
  });

  it('keeps the identified title when TMDB has no English title', async () => {
    const service = new MediaLabelizerService(config, resolver(null));

    const canonical = await service.toCanonicalIdentity(frenchMovie);

    expect(canonical.title).toBe('Charlie et la Chocolaterie');
  });

  it('skips resolution without an IMDb id', async () => {
    const english = resolver('Anything');
    const service = new MediaLabelizerService(config, english);

    await service.toCanonicalIdentity({ ...frenchMovie, imdbId: null as unknown as string });

    expect(english.resolve).not.toHaveBeenCalled();
  });
});
