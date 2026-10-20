import { Body, Controller, Get, Header, Param, Post, Query, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { z } from 'zod';

import { serviceNoticeTemplate } from '@crn-flix/messaging-user-email';

import { SessionAuthRedirectFilter } from '@/filters/session-auth-redirect.filter';
import { AdminSessionGuard } from '@/guards/admin-session.guard';
import { buildPresetNotice, isNoticePreset, NoticePreset } from '@/services/announcements/presets';
import { QuietHoursScheduleError, ScheduledAnnouncementsService } from '@/services/announcements/scheduled';
import { AnnouncementService } from '@/services/announcements/service';
import { ContextService } from '@/services/context';
import { NOTICE_TONES, ServiceNotice } from '@/services/messaging/user';
import { QuietHours } from '@/services/messaging/user/quiet-hours';
import { adminAnnounceFormTemplate } from '@/web/templates/admin-announce';

const optionalText = z.string().trim().optional().default('');

const noticeFormSchema = z.object({
  subject: z.string().trim().min(1),
  title: z.string().trim().min(1),
  body: z.string().trim().min(1),
  tone: z.enum(NOTICE_TONES).default('info'),
  ctaLabel: optionalText,
  ctaUrl: optionalText,
});

const sendFormSchema = noticeFormSchema.extend({
  users: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .default([]),
  sendAt: optionalText,
});

const BASE_PATH = '/admin/announce';

/** What the form shows: a preset's text, or what the admin typed when it comes back with an error. */
type FormState = {
  preset: NoticePreset | null;
  notice: ServiceNotice;
  flashMessage?: string;
  flashError?: boolean;
  sendAt?: string;
  selectedUserIds?: string[];
};
const redirectWith = (res: Response, message: string): void =>
  res.redirect(`${BASE_PATH}?message=${encodeURIComponent(message)}`);

const toParagraphs = (body: string): string[] =>
  body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

const toNotice = (form: z.infer<typeof noticeFormSchema>): ServiceNotice => ({
  subject: form.subject,
  title: form.title,
  paragraphs: toParagraphs(form.body),
  tone: form.tone,
  ...(form.ctaLabel && form.ctaUrl ? { cta: { label: form.ctaLabel, url: form.ctaUrl } } : {}),
});

@Controller('admin/announce')
@UseGuards(AdminSessionGuard)
@UseFilters(SessionAuthRedirectFilter)
export class AnnounceAdminController {
  constructor(
    private readonly contextService: ContextService,
    private readonly announcements: AnnouncementService,
    private readonly scheduled: ScheduledAnnouncementsService,
    private readonly quietHours: QuietHours,
  ) {}

  private presetNotice(preset: NoticePreset): ServiceNotice {
    return buildPresetNotice(preset, this.contextService.identity);
  }

  @Get()
  @Header('content-type', 'text/html')
  async form(@Query('preset') presetParam?: string, @Query('message') message?: string): Promise<string> {
    const preset: NoticePreset = isNoticePreset(presetParam) ? presetParam : 'outage';
    return this.renderForm({ preset, notice: this.presetNotice(preset), flashMessage: message });
  }

  private async renderForm(state: FormState): Promise<string> {
    const [recipients, upcoming, sent] = await Promise.all([
      this.announcements.listRecipients(),
      this.scheduled.listUpcoming(),
      this.scheduled.listRecentlySent(),
    ]);
    return adminAnnounceFormTemplate({
      serviceName: this.contextService.name,
      ...state,
      recipients,
      schedule: {
        quietLabel: this.quietHours.label(),
        sendAt: state.sendAt ?? this.quietHours.toLocalInput(new Date()),
        format: (date) => this.quietHours.format(date),
      },
      upcoming,
      sent,
    });
  }

  @Post('preview')
  @Header('content-type', 'text/html')
  preview(@Body() body: unknown): string {
    const notice = toNotice(noticeFormSchema.parse(body));
    return serviceNoticeTemplate(this.contextService.name, notice).html;
  }

  /** Always scheduled; a time inside quiet hours is refused and the form comes back as typed. */
  @Post('send')
  async send(@Body() body: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const form = sendFormSchema.parse(body);
    const userIds = Array.isArray(form.users) ? form.users : [form.users];
    if (userIds.length === 0) {
      redirectWith(res, 'Aucun destinataire sélectionné');
      return;
    }
    const adminUserId = (req as Request & { adminUserId?: string }).adminUserId ?? 'unknown';
    try {
      const requested = form.sendAt ? this.quietHours.parseLocal(form.sendAt) : null;
      const sendAt = await this.scheduled.schedule(toNotice(form), userIds, requested, `dashboard:${adminUserId}`);
      redirectWith(res, `Annonce programmée le ${this.quietHours.format(sendAt)}`);
    } catch (error) {
      if (!(error instanceof QuietHoursScheduleError)) {
        throw error;
      }
      const state = {
        notice: toNotice(form),
        flashMessage: error.message,
        flashError: true,
        sendAt: error.suggestedSendAt ? this.quietHours.toLocalInput(error.suggestedSendAt) : form.sendAt,
        selectedUserIds: userIds,
      };
      res
        .status(400)
        .type('html')
        .send(await this.renderForm({ preset: null, ...state }));
    }
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const cancelled = await this.scheduled.cancel(id);
    redirectWith(res, cancelled ? 'Annonce annulée' : 'Annonce déjà partie ou annulée');
  }
}
