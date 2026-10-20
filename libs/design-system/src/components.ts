import { BUTTONS, COLORS, FONT_STACK, getStatusStyle, RADIUS, statusLabel, Tone, TONES } from './tokens';

export const TAGLINE = 'Votre collection privée de films et séries';

// Common email structure
export const getEmailContainer = (content: string): string => `
<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; background-color: ${COLORS.background}; font-family: ${FONT_STACK};">
  <tr>
    <td style="padding: 32px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; max-width: 600px; margin: 0 auto; background-color: ${COLORS.white}; border: 1px solid ${COLORS.border}; border-radius: ${RADIUS.lg}; overflow: hidden;">
        ${content}
      </table>
    </td>
  </tr>
</table>
`;

/** Quiet wordmark: the brand red is kept for the main action. */
export const wordmark = (serviceName: string): string =>
  `<span style="font-family: ${FONT_STACK}; font-size: 20px; font-weight: 800; letter-spacing: -0.02em; color: ${COLORS.primary};">${serviceName}</span><span style="color: ${COLORS.secondary}; font-size: 20px; font-weight: 800;">.</span>`;

export const getHeaderSection = (serviceName: string): string => `
<tr>
  <td style="padding: 24px 32px; border-bottom: 1px solid ${COLORS.borderLight};">
    ${wordmark(serviceName)}
    <div style="font-family: ${FONT_STACK}; font-size: 13px; color: ${COLORS.textMuted}; margin-top: 2px;">${TAGLINE}</div>
  </td>
</tr>
`;

export const getFooterSection = (): string => `
<tr>
  <td style="background-color: ${COLORS.footerBg}; padding: 18px 32px; color: ${COLORS.footerText}; font-family: ${FONT_STACK}; font-size: 12px; border-top: 1px solid ${COLORS.borderLight};">
    <p style="margin: 0;">Service privé — merci de ne pas partager vos identifiants.</p>
  </td>
</tr>
`;

export const getContentSection = (content: string): string => `
<tr>
  <td style="padding: 28px 32px;">
    ${content}
  </td>
</tr>
`;

/** Highlighted block: a soft tint and a hairline border, no heavy side bar. */
export const getInfoBox = (content: string, type: Tone = 'info'): string => {
  const { bg, border } = TONES[type];
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; margin: 20px 0;">
  <tr>
    <td style="background-color: ${bg}; padding: 20px 22px; border: 1px solid ${border}; border-radius: ${RADIUS.md};">
      ${content}
    </td>
  </tr>
</table>
  `;
};

const chip = (label: string): string =>
  `<span style="display: inline-block; padding: 2px 8px; margin-right: 6px; border-radius: ${RADIUS.sm}; background-color: ${COLORS.borderLight}; font-family: ${FONT_STACK}; font-size: 12px; color: ${COLORS.textLight};">${label}</span>`;

const cardRow = (content: string, paddingTop: number): string =>
  `<tr><td style="padding-top: ${paddingTop}px;">${content}</td></tr>`;

const posterCell = (imageUrl: string): string => `
    <td style="width: 84px; padding: 16px 0 16px 16px; vertical-align: top;">
      <img src="${imageUrl}" alt="" width="84" style="width: 84px; height: auto; border-radius: ${RADIUS.sm}; display: block;" />
    </td>`;

/** One media in a notification: secondary action only, many cards may share an email. */
export const getMediaCard = (
  title: string,
  year: string | number,
  imageUrl?: string,
  status?: string,
  description?: string,
  actionButton?: { text: string; url: string },
  episodeInfo?: { season: number; episode: number },
): string => {
  const rows = [
    cardRow(
      `<span style="font-family: ${FONT_STACK}; font-size: 17px; font-weight: 650; color: ${COLORS.primary};">${title}</span>
       <span style="font-family: ${FONT_STACK}; font-size: 14px; color: ${COLORS.textMuted}; margin-left: 6px;">${year}</span>`,
      0,
    ),
    episodeInfo ? cardRow(`${chip(`Saison ${episodeInfo.season}`)}${chip(`Épisode ${episodeInfo.episode}`)}`, 8) : '',
    status ? cardRow(`<span style="${getStatusStyle(status)}">${statusLabel(status)}</span>`, 10) : '',
    description
      ? cardRow(
          `<p style="margin: 0; font-family: ${FONT_STACK}; font-size: 14px; color: ${COLORS.textLight}; line-height: 1.5;">${description}</p>`,
          10,
        )
      : '',
    actionButton
      ? cardRow(
          `<a href="${actionButton.url}" style="${BUTTONS.secondary}" target="_blank" rel="noopener noreferrer">${actionButton.text}</a>`,
          14,
        )
      : '',
  ];
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; margin-bottom: 16px; background-color: ${COLORS.white}; border-radius: ${RADIUS.md}; border: 1px solid ${COLORS.border};">
  <tr>
    ${imageUrl ? posterCell(imageUrl) : ''}
    <td style="padding: 16px; vertical-align: top;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%;">${rows.join('')}</table>
    </td>
  </tr>
</table>
  `;
};

export const getMediaGrid = (medias: Array<{ title: string; posterUrl: string; imdbId: string }>): string => {
  if (medias.length === 0) {
    return '';
  }

  const mediaItems = medias
    .map(
      (media) => `
    <td style="width: 20%; padding: 6px; text-align: center; vertical-align: top;">
      <img src="${media.posterUrl}" alt="${media.title}" width="96" style="width: 96px; max-width: 100%; height: auto; border-radius: ${RADIUS.sm}; display: block; margin: 0 auto;" />
      <div style="margin-top: 6px; font-family: ${FONT_STACK}; font-size: 12px; color: ${COLORS.textLight}; line-height: 1.3;">${media.title}</div>
    </td>
  `,
    )
    .join('');

  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; margin: 12px 0;">
  <tr>
    ${mediaItems}
  </tr>
</table>
  `;
};
