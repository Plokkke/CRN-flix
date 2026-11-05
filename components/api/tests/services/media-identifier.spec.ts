import { Pool } from 'pg';

import { MediaMetadata, MetadataSource, ReferencedMedia } from '@crn-flix/contracts';

import { MediasRepository } from '@/services/database/medias';
import { RequestsRepository } from '@/services/database/requests';
import { MediaIdentifierService } from '@/services/media-identifier';

const UNKNOWN: MediaMetadata = {
  title: null,
  originalTitle: null,
  frenchTitle: null,
  originalLanguage: null,
  year: null,
  kind: null,
  posterUrl: null,
};

const page = (imdbId: string | null): ReferencedMedia => ({
  title: "L'Arabe dans le poste",
  originalTitle: "L'Arabe dans le poste",
  frenchTitle: "L'Arabe dans le poste",
  originalLanguage: 'fr',
  year: 2023,
  kind: 'movie',
  posterUrl: null,
  imdbId,
  pageUrl: 'https://www.themoviedb.org/movie/1205366',
});

function build(described: MediaMetadata, referenced: ReferencedMedia | null) {
  const metadata = {
    name: 'tmdb',
    describe: jest.fn().mockResolvedValue(described),
    describeReference: jest.fn().mockResolvedValue(referenced),
  };
  const service = new MediaIdentifierService(
    metadata as unknown as MetadataSource,
    {} as Pool,
    {} as MediasRepository,
    {} as RequestsRepository,
  );
  return { service, metadata };
}

describe('MediaIdentifierService.resolveSubmission', () => {
  it('asks for the page when the source links no page to the imdb id', async () => {
    const { service } = build(UNKNOWN, null);

    await expect(service.resolveSubmission({ imdbId: 'tt31510564', reference: null })).resolves.toEqual({
      ok: false,
      reason: expect.stringContaining("TMDB ne connaît pas tt31510564 (aucune fiche liée) : répondre avec l'URL"),
    });
  });

  it('designates the media of a known imdb id', async () => {
    const { service } = build({ ...UNKNOWN, kind: 'movie', title: 'Citizen Kane', year: 1941 }, null);

    await expect(service.resolveSubmission({ imdbId: 'tt0033467', reference: null })).resolves.toMatchObject({
      ok: true,
      designated: { media: { imdbId: 'tt0033467', kind: 'movie', title: 'Citizen Kane', year: 1941 } },
    });
  });

  it('asks for the imdb id when the page links none', async () => {
    const { service } = build(UNKNOWN, page(null));

    await expect(service.resolveSubmission({ imdbId: null, reference: 'movie/1205366' })).resolves.toEqual({
      ok: false,
      reason: expect.stringContaining("La fiche https://www.themoviedb.org/movie/1205366 n'a pas d'IMDb ID"),
    });
  });

  it('pins a page without imdb id to the given one, with the page titles', async () => {
    const { service, metadata } = build(UNKNOWN, page(null));

    const resolution = await service.resolveSubmission({ imdbId: 'tt31510564', reference: 'movie/1205366' });

    expect(resolution).toMatchObject({
      ok: true,
      designated: {
        media: { imdbId: 'tt31510564', kind: 'movie', title: "L'Arabe dans le poste", year: 2023 },
        metadata: { frenchTitle: "L'Arabe dans le poste", originalLanguage: 'fr' },
      },
    });
    expect(metadata.describe).not.toHaveBeenCalled();
  });

  it('takes the imdb id the page links', async () => {
    const { service } = build(UNKNOWN, page('tt31510564'));

    await expect(service.resolveSubmission({ imdbId: null, reference: 'movie/1205366' })).resolves.toMatchObject({
      ok: true,
      designated: { media: { imdbId: 'tt31510564' } },
    });
  });

  it('refuses a page linked to another imdb id', async () => {
    const { service } = build(UNKNOWN, page('tt0000001'));

    await expect(service.resolveSubmission({ imdbId: 'tt31510564', reference: 'movie/1205366' })).resolves.toEqual({
      ok: false,
      reason: 'La fiche https://www.themoviedb.org/movie/1205366 est liée à tt0000001, pas à tt31510564',
    });
  });

  it('says when the page does not exist', async () => {
    const { service } = build(UNKNOWN, null);

    await expect(service.resolveSubmission({ imdbId: null, reference: 'movie/0' })).resolves.toEqual({
      ok: false,
      reason: 'Fiche TMDB movie/0 introuvable',
    });
  });
});
