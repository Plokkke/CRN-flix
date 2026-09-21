import { ServiceNotice } from '@/services/messaging/user';

import { BUTTONS, escapeHtml, getEmailTemplate, getInfoBox, TYPOGRAPHY } from './email-styles';

const TITLE_ICON: Record<ServiceNotice['tone'], string> = {
  warning: '⚠️',
  success: '✅',
  info: 'ℹ️',
};

const renderParagraphs = (paragraphs: string[]): string =>
  paragraphs.map((paragraph) => `<p style="${TYPOGRAPHY.body}">${escapeHtml(paragraph)}</p>`).join('\n');

const renderCta = (cta: ServiceNotice['cta']): string =>
  cta
    ? `<p style="text-align: center; margin: 24px 0 8px 0;">
      <a href="${escapeHtml(cta.url)}" style="${BUTTONS.primary}" target="_blank" rel="noopener noreferrer">${escapeHtml(cta.label)}</a>
    </p>`
    : '';

export const serviceNoticeTemplate = (
  serviceName: string,
  notice: ServiceNotice,
): { subject: string; html: string; text: string } => {
  const [lead, ...rest] = notice.paragraphs;
  const icon = TITLE_ICON[notice.tone];

  const content = `
    <h1 style="${TYPOGRAPHY.h1}">${icon} ${escapeHtml(notice.title)}</h1>
    ${lead ? getInfoBox(`<p style="${TYPOGRAPHY.body} margin: 0;">${escapeHtml(lead)}</p>`, notice.tone) : ''}
    ${renderParagraphs(rest)}
    ${renderCta(notice.cta)}
    <p style="${TYPOGRAPHY.muted}">L'équipe ${escapeHtml(serviceName)}</p>
  `;

  const text = [
    `${icon} ${notice.title}`,
    '',
    ...notice.paragraphs.flatMap((paragraph) => [paragraph, '']),
    ...(notice.cta ? [`${notice.cta.label} : ${notice.cta.url}`, ''] : []),
    `L'équipe ${serviceName}`,
  ].join('\n');

  return { subject: notice.subject, html: getEmailTemplate(notice.subject, serviceName, content), text };
};
