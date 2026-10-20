import { QuietHoursScheduleError, ScheduledAnnouncementsService } from '@/services/announcements/scheduled';
import { AnnouncementService } from '@/services/announcements/service';
import { ScheduledAnnouncementsRepository } from '@/services/database/scheduled-announcements';
import { UserEntity } from '@/services/database/users';
import { ServiceNotice } from '@/services/messaging/user';
import { QuietHours } from '@/services/messaging/user/quiet-hours';

const quietHours = new QuietHours({ window: '00:00-07:00', timeZone: 'Europe/Paris' });
const at = (time: string): Date => quietHours.parseLocal(`2026-10-22T${time}`)!;

const notice: ServiceNotice = { subject: 'Maintenance', title: 'Maintenance', tone: 'info', paragraphs: ['Ce soir'] };
const user = { id: 'u1', name: 'Camille' } as UserEntity;
const due = { id: 'a1', notice, userIds: ['u1'], sendAt: at('08:00') };

function build(now: Date) {
  const repository = {
    create: jest.fn().mockResolvedValue(undefined),
    claimDue: jest.fn().mockResolvedValue([due]),
    recordOutcomes: jest.fn().mockResolvedValue(undefined),
  };
  const announcements = {
    send: jest.fn().mockResolvedValue([{ user, outcome: 'failed', error: 'smtp down' }]),
  };
  const service = new ScheduledAnnouncementsService(
    repository as unknown as ScheduledAnnouncementsRepository,
    announcements as unknown as AnnouncementService,
    quietHours,
    () => now,
  );
  return { repository, announcements, service };
}

describe('ScheduledAnnouncementsService', () => {
  it('stores an announcement for the time asked for', async () => {
    const { repository, service } = build(at('12:00'));

    await expect(service.schedule(notice, ['u1'], at('20:30'), 'dashboard:1')).resolves.toEqual(at('20:30'));
    expect(repository.create).toHaveBeenCalledWith(notice, ['u1'], at('20:30'), 'dashboard:1');
  });

  it('sends now when no time or a past time is given', async () => {
    const { repository, service } = build(at('12:00'));

    await service.schedule(notice, ['u1'], null, 'dashboard:1');
    await service.schedule(notice, ['u1'], at('09:00'), 'dashboard:1');

    expect(repository.create.mock.calls.map(([, , sendAt]) => sendAt)).toEqual([at('12:00'), at('12:00')]);
  });

  it('refuses a time typed inside quiet hours, without suggesting another one', async () => {
    const { repository, service } = build(at('12:00'));

    const refusal = service.schedule(notice, ['u1'], quietHours.parseLocal('2026-10-23T04:00'), 'a');

    await expect(refusal).rejects.toThrow('Impossible de programmer pendant les quiet hours (0h–7h)');
    await expect(refusal).rejects.toMatchObject({ suggestedSendAt: null });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('refuses « now » at night too, suggesting the end of quiet hours for the admin to confirm', async () => {
    const { repository, service } = build(at('03:00'));

    const refusal = service.schedule(notice, ['u1'], null, 'a');

    await expect(refusal).rejects.toThrow(QuietHoursScheduleError);
    await expect(refusal).rejects.toMatchObject({ suggestedSendAt: at('07:00') });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('sends what is due and keeps every recipient outcome', async () => {
    const { repository, announcements, service } = build(at('08:00'));

    await service.sendDue();

    expect(repository.claimDue).toHaveBeenCalledWith(at('08:00'));
    expect(announcements.send).toHaveBeenCalledWith(notice, ['u1']);
    expect(repository.recordOutcomes).toHaveBeenCalledWith('a1', [
      { userId: 'u1', userName: 'Camille', outcome: 'failed', error: 'smtp down' },
    ]);
  });

  it('never sends during quiet hours: a due announcement waits for the morning', async () => {
    const { repository, announcements, service } = build(at('03:00'));

    await service.sendDue();

    expect(repository.claimDue).not.toHaveBeenCalled();
    expect(announcements.send).not.toHaveBeenCalled();
  });
});
