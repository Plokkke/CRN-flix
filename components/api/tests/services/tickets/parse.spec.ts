import { parseMessageOperation, parseSpontaneousUrl } from '@/services/tickets/parse';

describe('parseMessageOperation', () => {
  it('extracts an imdb id when the ticket accepts one', () => {
    expect(parseMessageOperation('voilà tt1234567', ['submitImdb'])).toEqual({
      kind: 'submitImdb',
      imdbId: 'tt1234567',
    });
  });

  it('prefers the link over an embedded imdb id when both are accepted', () => {
    const operation = parseMessageOperation('https://dl.test/file?imdbid=tt1234567', ['submitImdb', 'submitLink']);
    expect(operation).toEqual({ kind: 'submitLink', url: 'https://dl.test/file?imdbid=tt1234567' });
  });

  it('falls back to the imdb id of an imdb.com link', () => {
    const operation = parseMessageOperation('https://www.imdb.com/title/tt1234567/', ['submitImdb', 'submitLink']);
    expect(operation).toEqual({ kind: 'submitImdb', imdbId: 'tt1234567' });
  });

  it('ignores content the ticket cannot consume', () => {
    expect(parseMessageOperation('tt1234567', ['submitLink'])).toBeNull();
    expect(parseMessageOperation('un simple commentaire', ['submitImdb', 'submitLink'])).toBeNull();
  });
});

describe('parseSpontaneousUrl', () => {
  it('extracts the first url of a spontaneous message', () => {
    expect(parseSpontaneousUrl('regarde https://dl.test/file stp')).toBe('https://dl.test/file');
    expect(parseSpontaneousUrl('pas de lien ici')).toBeNull();
  });
});
