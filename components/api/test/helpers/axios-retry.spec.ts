import { parseRetryAfter } from '@/helpers/axios-retry';

const NOW = Date.parse('2026-07-26T12:00:00Z');

describe('parseRetryAfter', () => {
  it('reads a delay expressed in seconds', () => {
    expect(parseRetryAfter('30', NOW)).toBe(30_000);
  });

  it('accepts a zero delay', () => {
    expect(parseRetryAfter('0', NOW)).toBe(0);
  });

  it('reads an HTTP date and returns the remaining delay', () => {
    expect(parseRetryAfter('Sun, 26 Jul 2026 12:00:45 GMT', NOW)).toBe(45_000);
  });

  it('never returns a negative delay for a date already past', () => {
    expect(parseRetryAfter('Sun, 26 Jul 2026 11:59:00 GMT', NOW)).toBe(0);
  });

  it.each([[undefined], [null], [''], ['   '], ['soon'], [42]])('ignores %p', (header) => {
    expect(parseRetryAfter(header, NOW)).toBeNull();
  });

  it('ignores a negative number of seconds', () => {
    expect(parseRetryAfter('-5', NOW)).toBeNull();
  });
});
