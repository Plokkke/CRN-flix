import { MediaEntity, MediaType } from '@/services/database/medias';
import { RequestEntity, RequestStatus } from '@/services/database/requests';
import { indexerDisplayLink } from '@/services/indexer-link';

const MEDIA: MediaEntity = {
  id: 'media-1',
  imdbId: 'tt0111161',
  type: MediaType.Movie,
  title: 'Test',
  originalTitle: null,
  year: 2024,
  seasonNumber: null,
  episodeNumber: null,
  runtimeMinutes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildRequest(overrides: Partial<RequestEntity> = {}): RequestEntity {
  return {
    mediaId: MEDIA.id,
    status: RequestStatus.Pending,
    createdAt: new Date(),
    updatedAt: new Date(),
    discordMessageId: null,
    indexerName: 'hydracker',
    indexerLink: 'https://hydracker.test/titles/42/download?filters=abc',
    media: MEDIA,
    ...overrides,
  };
}

describe('indexerDisplayLink', () => {
  it('returns null when there is no indexer link', () => {
    expect(indexerDisplayLink(buildRequest({ indexerLink: null }))).toBeNull();
  });

  it('appends correlation params while preserving existing query params', () => {
    const link = indexerDisplayLink(buildRequest());
    const url = new URL(link!);

    expect(url.searchParams.get('filters')).toBe('abc');
    expect(url.searchParams.get('crn-flix-request-id')).toBe('media-1');
    expect(url.searchParams.get('imdbid')).toBe('tt0111161');
  });

  it('omits imdbid when the media has none', () => {
    const link = indexerDisplayLink(buildRequest({ media: { ...MEDIA, imdbId: '' } }));
    const url = new URL(link!);

    expect(url.searchParams.get('crn-flix-request-id')).toBe('media-1');
    expect(url.searchParams.has('imdbid')).toBe(false);
  });

  it('does not mutate the stored indexer link', () => {
    const request = buildRequest();
    indexerDisplayLink(request);

    expect(request.indexerLink).toBe('https://hydracker.test/titles/42/download?filters=abc');
  });

  it('falls back to the raw link when it is not a valid absolute URL', () => {
    const request = buildRequest({ indexerLink: 'not-a-url' });
    expect(indexerDisplayLink(request)).toBe('not-a-url');
  });
});
