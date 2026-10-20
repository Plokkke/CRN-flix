import { DateTime, IANAZone } from 'luxon';
import { z } from 'zod';

const WINDOW_PATTERN = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/;

/** `HH:MM-HH:MM` in the given zone; the window may span midnight, equal bounds mean never quiet. */
export const quietHoursConfigSchema = z.object({
  window: z.string().regex(WINDOW_PATTERN, 'Expected HH:MM-HH:MM'),
  timeZone: z.string().refine((zone) => IANAZone.isValidZone(zone), 'Unknown time zone'),
});

export type QuietHoursConfig = z.infer<typeof quietHoursConfigSchema>;

type TimeOfDay = { hour: number; minute: number };

const minutesOf = ({ hour, minute }: TimeOfDay): number => hour * 60 + minute;

const hourLabel = ({ hour, minute }: TimeOfDay): string =>
  `${hour}h${minute === 0 ? '' : String(minute).padStart(2, '0')}`;

function parseWindow(window: string): { start: TimeOfDay; end: TimeOfDay } {
  const [, startHour, startMinute, endHour, endMinute] = WINDOW_PATTERN.exec(window)!.map(Number);
  return { start: { hour: startHour, minute: startMinute }, end: { hour: endHour, minute: endMinute } };
}

/**
 * When subscribers must not be disturbed. Pure: every answer is about the instant the caller
 * passes, read in the service's time zone (daylight saving changes included).
 */
export class QuietHours {
  private readonly start: TimeOfDay;
  private readonly end: TimeOfDay;

  constructor(private readonly config: QuietHoursConfig) {
    ({ start: this.start, end: this.end } = parseWindow(config.window));
  }

  isQuietTime(now: Date): boolean {
    const local = this.local(now);
    const minute = minutesOf({ hour: local.hour, minute: local.minute });
    const [start, end] = [minutesOf(this.start), minutesOf(this.end)];
    return start <= end ? minute >= start && minute < end : minute >= start || minute < end;
  }

  /** `now` itself outside quiet hours, else the end of the current quiet window. */
  nextSendableAt(now: Date): Date {
    if (!this.isQuietTime(now)) {
      return now;
    }
    const today = this.local(now).set({ ...this.end, second: 0, millisecond: 0 });
    const next = today.toMillis() > now.getTime() ? today : today.plus({ days: 1 });
    return next.toJSDate();
  }

  /** The window as people say it, e.g. « 0h–7h » for `00:00-07:00`. */
  label(): string {
    return `${hourLabel(this.start)}–${hourLabel(this.end)}`;
  }

  /** e.g. « 21/10 à 07:00 », in the service's time zone. */
  format(date: Date): string {
    return this.local(date).setLocale('fr').toFormat("dd/LL 'à' HH:mm");
  }

  /** Parses a `datetime-local` value (no zone) as wall-clock time in the service's zone. */
  parseLocal(value: string): Date | null {
    const parsed = DateTime.fromISO(value, { zone: this.config.timeZone });
    return parsed.isValid ? parsed.toJSDate() : null;
  }

  /** The `datetime-local` value of an instant, in the service's zone. */
  toLocalInput(date: Date): string {
    return this.local(date).toFormat("yyyy-LL-dd'T'HH:mm");
  }

  private local(date: Date): DateTime {
    return DateTime.fromJSDate(date, { zone: this.config.timeZone });
  }
}
