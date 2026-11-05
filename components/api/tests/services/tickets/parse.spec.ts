import { parseMessageOperation, parseSpontaneousUrl } from '@/services/tickets/parse';

const tmdbPages = (text: string): string | null =>
  text
    .match(/themoviedb\.org\/(movie|tv)\/(\d+)/)
    ?.slice(1)
    .join('/') ?? null;

const TMDB_URL = 'https://www.themoviedb.org/movie/1205366-l-arabe-dans-le-poste?language=fr-FR';

describe('parseMessageOperation', () => {
  it('reads a bare imdb id', () => {
    expect(parseMessageOperation('voilà tt1234567', ['submitIdentity'], tmdbPages)).toEqual({
      kind: 'submitIdentity',
      imdbId: 'tt1234567',
      reference: null,
    });
  });

  it('reads the imdb id of an imdb.com link, never taken for a download link', () => {
    const operation = parseMessageOperation(
      'https://www.imdb.com/fr/title/tt31510564/?ref_=fn_t_1',
      ['submitIdentity', 'submitLink'],
      tmdbPages,
    );
    expect(operation).toEqual({ kind: 'submitIdentity', imdbId: 'tt31510564', reference: null });
  });

  it('reads a metadata page, never taken for a download link', () => {
    expect(parseMessageOperation(TMDB_URL, ['submitIdentity', 'submitLink'], tmdbPages)).toEqual({
      kind: 'submitIdentity',
      imdbId: null,
      reference: 'movie/1205366',
    });
  });

  it('reads an imdb id and a metadata page given together', () => {
    expect(parseMessageOperation(`tt31510564\n${TMDB_URL}`, ['submitIdentity'], tmdbPages)).toEqual({
      kind: 'submitIdentity',
      imdbId: 'tt31510564',
      reference: 'movie/1205366',
    });
  });

  it('prefers the download link over an embedded imdb id when both are accepted', () => {
    const operation = parseMessageOperation(
      'https://dl.test/file?imdbid=tt1234567',
      ['submitIdentity', 'submitLink'],
      tmdbPages,
    );
    expect(operation).toEqual({ kind: 'submitLink', url: 'https://dl.test/file?imdbid=tt1234567' });
  });

  it('ignores content the ticket cannot consume', () => {
    expect(parseMessageOperation('tt1234567', ['submitLink'], tmdbPages)).toBeNull();
    expect(parseMessageOperation('un simple commentaire', ['submitIdentity', 'submitLink'], tmdbPages)).toBeNull();
  });
});

describe('parseSpontaneousUrl', () => {
  it('extracts the first url of a spontaneous message', () => {
    expect(parseSpontaneousUrl('regarde https://dl.test/file stp')).toBe('https://dl.test/file');
    expect(parseSpontaneousUrl('pas de lien ici')).toBeNull();
  });
});
