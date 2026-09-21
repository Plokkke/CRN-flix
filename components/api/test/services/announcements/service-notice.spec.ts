import { buildPresetNotice, NOTICE_PRESETS } from '@/services/announcements/presets';
import { serviceNoticeTemplate } from '@/services/messaging/user/email/templates/service-notice';

const ctx = { serviceName: 'CRN-Flix', mediaServerUrl: 'https://jellyfin.test' };

describe('serviceNoticeTemplate', () => {
  it('renders the header, the highlighted lead and the remaining paragraphs', () => {
    const { subject, html, text } = serviceNoticeTemplate('CRN-Flix', {
      subject: 'Sujet',
      title: 'Titre',
      tone: 'warning',
      paragraphs: ['Premier', 'Second'],
    });

    expect(subject).toBe('Sujet');
    expect(html).toContain('Votre collection privée de films et séries');
    expect(html).toContain('⚠️ Titre');
    expect(html.indexOf('border-left: 4px solid')).toBeLessThan(html.indexOf('Premier'));
    expect(html).toContain(
      '<p style="font-size: 16px; color: #333333; line-height: 1.6; margin: 0 0 15px 0;">Second</p>',
    );
    expect(text).toContain('Premier\n\nSecond');
  });

  it('escapes user-provided content and renders the optional button', () => {
    const { html, text } = serviceNoticeTemplate('CRN-Flix', {
      subject: 's',
      title: '<b>x</b>',
      tone: 'success',
      paragraphs: ['a & b'],
      cta: { label: 'Go', url: 'https://x.test/?a=1&b=2' },
    });

    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('a &amp; b');
    expect(html).toContain('href="https://x.test/?a=1&amp;b=2"');
    expect(text).toContain('Go : https://x.test/?a=1&b=2');
  });
});

describe('buildPresetNotice', () => {
  it.each(NOTICE_PRESETS)('%s names the service in its subject', (preset) => {
    const notice = buildPresetNotice(preset, ctx);
    expect(notice.subject).toContain('CRN-Flix');
    expect(notice.paragraphs.length).toBeGreaterThan(0);
  });

  it('restored links to the media server', () => {
    expect(buildPresetNotice('restored', ctx).cta).toEqual({ label: 'Accéder à CRN-Flix', url: ctx.mediaServerUrl });
  });
});
