import { QuietHours, quietHoursConfigSchema } from '@/services/messaging/user/quiet-hours';

const quiet = new QuietHours({ window: '00:00-07:00', timeZone: 'Europe/Paris' });

/** Paris wall-clock times; October 2026 is still on summer time (UTC+2) until the 25th. */
const paris = (iso: string): Date => quiet.parseLocal(iso)!;

describe('QuietHours', () => {
  it.each([
    ['2026-10-21T23:59', false],
    ['2026-10-22T00:00', true],
    ['2026-10-22T03:00', true],
    ['2026-10-22T06:59', true],
    ['2026-10-22T07:00', false],
    ['2026-10-22T12:00', false],
  ])('%s quiet: %s', (time, expected) => {
    expect(quiet.isQuietTime(paris(time))).toBe(expected);
  });

  it('lets a sendable instant through unchanged', () => {
    const noon = paris('2026-10-22T12:00');
    expect(quiet.nextSendableAt(noon)).toBe(noon);
  });

  it('defers a quiet instant to 07:00 the same night, in the service time zone', () => {
    expect(quiet.nextSendableAt(paris('2026-10-22T00:00')).toISOString()).toBe('2026-10-22T05:00:00.000Z');
    expect(quiet.nextSendableAt(paris('2026-10-22T06:59')).toISOString()).toBe('2026-10-22T05:00:00.000Z');
  });

  it('follows daylight saving: 07:00 is 06:00 UTC once winter time starts', () => {
    expect(quiet.nextSendableAt(paris('2026-10-25T03:30')).toISOString()).toBe('2026-10-25T06:00:00.000Z');
    expect(quiet.nextSendableAt(paris('2026-03-29T02:30')).toISOString()).toBe('2026-03-29T05:00:00.000Z');
  });

  it('handles a window that does not span midnight and one that does', () => {
    const lunch = new QuietHours({ window: '12:00-14:00', timeZone: 'Europe/Paris' });
    const night = new QuietHours({ window: '22:00-07:00', timeZone: 'Europe/Paris' });

    expect(lunch.isQuietTime(paris('2026-10-22T13:00'))).toBe(true);
    expect(lunch.isQuietTime(paris('2026-10-22T23:00'))).toBe(false);
    expect(night.isQuietTime(paris('2026-10-22T23:00'))).toBe(true);
    expect(night.nextSendableAt(paris('2026-10-22T23:00')).toISOString()).toBe('2026-10-23T05:00:00.000Z');
  });

  it('names its window as people say it', () => {
    expect(quiet.label()).toBe('0h–7h');
    expect(new QuietHours({ window: '22:30-07:00', timeZone: 'Europe/Paris' }).label()).toBe('22h30–7h');
  });

  it('formats and round-trips the admin form value in the service time zone', () => {
    const date = paris('2026-10-22T07:00');
    expect(quiet.format(date)).toBe('22/10 à 07:00');
    expect(quiet.toLocalInput(date)).toBe('2026-10-22T07:00');
    expect(quiet.parseLocal('not a date')).toBeNull();
  });

  it('rejects a malformed window or an unknown zone', () => {
    expect(quietHoursConfigSchema.safeParse({ window: '0-7', timeZone: 'Europe/Paris' }).success).toBe(false);
    expect(quietHoursConfigSchema.safeParse({ window: '00:00-07:00', timeZone: 'Mars/Base' }).success).toBe(false);
  });
});
