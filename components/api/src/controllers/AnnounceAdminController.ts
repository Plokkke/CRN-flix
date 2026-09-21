import { Body, Controller, Get, Header, Post, Query, UseFilters, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { SessionAuthRedirectFilter } from '@/filters/session-auth-redirect.filter';
import { AdminSessionGuard } from '@/guards/admin-session.guard';
import { buildPresetNotice, isNoticePreset, NoticePreset } from '@/services/announcements/presets';
import { AnnouncementService } from '@/services/announcements/service';
import { ContextService } from '@/services/context';
import { NOTICE_TONES, ServiceNotice } from '@/services/messaging/user';
import {
  adminAnnounceFormTemplate,
  adminAnnounceResultTemplate,
} from '@/services/messaging/user/email/templates/admin-announce';
import { serviceNoticeTemplate } from '@/services/messaging/user/email/templates/service-notice';

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
});

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
  ) {}

  private presetNotice(preset: NoticePreset): ServiceNotice {
    return buildPresetNotice(preset, {
      serviceName: this.contextService.name,
      mediaServerUrl: this.contextService.mediaServerUrl,
    });
  }

  @Get()
  @Header('content-type', 'text/html')
  async form(@Query('preset') presetParam?: string, @Query('message') message?: string): Promise<string> {
    const preset: NoticePreset = isNoticePreset(presetParam) ? presetParam : 'outage';
    return adminAnnounceFormTemplate({
      serviceName: this.contextService.name,
      preset,
      notice: this.presetNotice(preset),
      recipients: await this.announcements.listRecipients(),
      flashMessage: message,
    });
  }

  @Post('preview')
  @Header('content-type', 'text/html')
  preview(@Body() body: unknown): string {
    const notice = toNotice(noticeFormSchema.parse(body));
    return serviceNoticeTemplate(this.contextService.name, notice).html;
  }

  @Post('send')
  @Header('content-type', 'text/html')
  async send(@Body() body: unknown): Promise<string> {
    const form = sendFormSchema.parse(body);
    const notice = toNotice(form);
    const userIds = Array.isArray(form.users) ? form.users : [form.users];
    const results = await this.announcements.send(notice, userIds);
    return adminAnnounceResultTemplate({ serviceName: this.contextService.name, notice, results });
  }
}
