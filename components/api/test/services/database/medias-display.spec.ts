import { displayTitle, posterUrl } from '@/services/database/medias';

describe('displayTitle', () => {
  it('prefers the French title and falls back to the English one', () => {
    expect(displayTitle({ title: 'The Hangover', frenchTitle: 'Very Bad Trip' })).toBe('Very Bad Trip');
    expect(displayTitle({ title: 'The Hangover', frenchTitle: null })).toBe('The Hangover');
  });
});

describe('posterUrl', () => {
  it('builds the TMDB image url from the stored path, w342 by default', () => {
    expect(posterUrl({ posterPath: '/abc.jpg' })).toBe('https://image.tmdb.org/t/p/w342/abc.jpg');
    expect(posterUrl({ posterPath: '/abc.jpg' }, 'w92')).toBe('https://image.tmdb.org/t/p/w92/abc.jpg');
  });

  it('is null without a poster', () => {
    expect(posterUrl({ posterPath: null })).toBeNull();
  });
});
