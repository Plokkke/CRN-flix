import { displayTitle } from '@/services/database/medias';

describe('displayTitle', () => {
  it('prefers the French title and falls back to the English one', () => {
    expect(displayTitle({ title: 'The Hangover', frenchTitle: 'Very Bad Trip' })).toBe('Very Bad Trip');
    expect(displayTitle({ title: 'The Hangover', frenchTitle: null })).toBe('The Hangover');
  });
});
