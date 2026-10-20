import { Logger } from '@nestjs/common';

import { AnnouncementService } from '@/services/announcements/service';
import {
  AnnouncementOutcome,
  ScheduledAnnouncementEntity,
  ScheduledAnnouncementsRepository,
} from '@/services/database/scheduled-announcements';
import { ServiceNotice } from '@/services/messaging/user';
import { QuietHours } from '@/services/messaging/user/quiet-hours';

const RECENT_LIMIT = 10;

/**
 * The time asked for falls in quiet hours: refused, never silently moved. When the admin asked
 * for « now », `suggestedSendAt` is the end of the window, for the form to offer instead.
 */
export class QuietHoursScheduleError extends Error {
  constructor(
    window: string,
    readonly suggestedSendAt: Date | null,
  ) {
    super(`Impossible de programmer pendant les quiet hours (${window})`);
    this.name = 'QuietHoursScheduleError';
  }
}

/**
 * Announcements are always scheduled, "now" included: the admin picks a time outside quiet
 * hours, and a job sends what is due through the regular announcement path.
 */
export class ScheduledAnnouncementsService {
  private static readonly logger = new Logger(ScheduledAnnouncementsService.name);

  constructor(
    private readonly repository: ScheduledAnnouncementsRepository,
    private readonly announcements: AnnouncementService,
    private readonly quietHours: QuietHours,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** A past or missing time means now; inside quiet hours throws `QuietHoursScheduleError`. */
  async schedule(notice: ServiceNotice, userIds: string[], requested: Date | null, actor: string): Promise<Date> {
    const now = this.now();
    const asap = !requested || requested.getTime() <= now.getTime();
    const sendAt = asap ? now : requested;
    if (this.quietHours.isQuietTime(sendAt)) {
      const suggestion = asap ? this.quietHours.nextSendableAt(now) : null;
      throw new QuietHoursScheduleError(this.quietHours.label(), suggestion);
    }
    await this.repository.create(notice, userIds, sendAt, actor);
    ScheduledAnnouncementsService.logger.log(`Announcement "${notice.subject}" scheduled at ${sendAt.toISOString()}`);
    return sendAt;
  }

  /** Double-check: a due row never leaves inside quiet hours, it waits for the next pass. */
  async sendDue(): Promise<void> {
    const now = this.now();
    if (this.quietHours.isQuietTime(now)) {
      return;
    }
    for (const announcement of await this.repository.claimDue(now)) {
      await this.repository.recordOutcomes(announcement.id, await this.deliver(announcement));
    }
  }

  cancel(id: string): Promise<boolean> {
    return this.repository.cancel(id, this.now());
  }

  listUpcoming(): Promise<ScheduledAnnouncementEntity[]> {
    return this.repository.listUpcoming();
  }

  listRecentlySent(): Promise<ScheduledAnnouncementEntity[]> {
    return this.repository.listRecentlySent(RECENT_LIMIT);
  }

  private async deliver({ notice, userIds }: ScheduledAnnouncementEntity): Promise<AnnouncementOutcome[]> {
    const results = await this.announcements.send(notice, userIds);
    return results.map(({ user, outcome, error }) => ({
      userId: user.id,
      userName: user.name,
      outcome,
      ...(error ? { error } : {}),
    }));
  }
}
