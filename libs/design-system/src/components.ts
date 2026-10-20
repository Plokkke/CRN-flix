import { BUTTONS, COLORS, getStatusStyle } from './tokens';

// Common email structure
export const getEmailContainer = (content: string): string => `
<table cellpadding="0" cellspacing="0" style="width: 100%; background-color: ${COLORS.background}; font-family: Arial, sans-serif;">
  <tr>
    <td style="padding: 20px 0;">
      <table cellpadding="0" cellspacing="0" style="width: 600px; margin: 0 auto; background-color: ${COLORS.white};">
        ${content}
      </table>
    </td>
  </tr>
</table>
`;

// Header section
export const getHeaderSection = (serviceName: string): string => `
<tr>
  <td style="background-color: ${COLORS.primary}; color: white; padding: 30px 20px; text-align: center;">
    <div style="font-size: 32px; font-weight: bold; margin-bottom: 10px;">${serviceName}</div>
    <div style="font-size: 16px; opacity: 0.9;">Votre collection privée de films et séries</div>
  </td>
</tr>
`;

// Footer section
export const getFooterSection = (): string => `
<tr>
  <td style="background-color: ${COLORS.footerBg}; padding: 20px; text-align: center; color: ${COLORS.footerText}; font-size: 14px; border-top: 1px solid ${COLORS.borderLight};">
    <p style="margin: 0;">Ceci est un service privé. Merci de ne pas partager vos identifiants.</p>
  </td>
</tr>
`;

// Content wrapper
export const getContentSection = (content: string): string => `
<tr>
  <td style="padding: 30px 20px;">
    ${content}
  </td>
</tr>
`;

// Info box
export const getInfoBox = (content: string, type: 'info' | 'warning' | 'success' = 'info'): string => {
  const colors = {
    info: { bg: '#f0f7ff', border: COLORS.info },
    warning: { bg: '#fff8f0', border: COLORS.warning },
    success: { bg: '#f0fff0', border: COLORS.success },
  };

  const { bg, border } = colors[type];
  return `
<table cellpadding="0" cellspacing="0" style="width: 100%; margin: 20px 0;">
  <tr>
    <td style="background-color: ${bg}; padding: 20px; border-left: 4px solid ${border}; border-radius: 5px;">
      ${content}
    </td>
  </tr>
</table>
  `;
};

// Media card for complex layouts
export const getMediaCard = (
  title: string,
  year: string | number,
  imageUrl?: string,
  status?: string,
  description?: string,
  actionButton?: { text: string; url: string },
  episodeInfo?: { season: number; episode: number },
): string => {
  const statusBadge = status
    ? `
    <tr>
      <td style="padding-top: 16px;">
        <span style="${getStatusStyle(status)}">
          ${status.replace('_', ' ').toUpperCase()}
        </span>
      </td>
    </tr>
  `
    : '';

  const episodeBadges = episodeInfo
    ? `
    <tr>
      <td style="padding-top: 8px;">
        <span style="background-color: #f0f0f0; padding: 4px 8px; border-radius: 4px; font-size: 14px; color: #666666; margin-right: 8px;">Saison ${episodeInfo.season}</span>
        <span style="background-color: #f0f0f0; padding: 4px 8px; border-radius: 4px; font-size: 14px; color: #666666;">Episode ${episodeInfo.episode}</span>
      </td>
    </tr>
  `
    : '';

  const descriptionRow = description
    ? `
    <tr>
      <td style="padding-top: 12px;">
        <p style="margin: 0; color: #333333; line-height: 1.5;">${description}</p>
      </td>
    </tr>
  `
    : '';

  const buttonRow = actionButton
    ? `
    <tr>
      <td style="padding-top: 18px;">
        <a href="${actionButton.url}" style="${BUTTONS.primary}" target="_blank" rel="noopener noreferrer">${actionButton.text}</a>
      </td>
    </tr>
  `
    : '';

  return `
<table cellpadding="0" cellspacing="0" style="width: 100%; margin-bottom: 30px; background-color: ${COLORS.white}; border-radius: 8px; border: 1px solid ${COLORS.border};">
  <tr>
    ${
      imageUrl
        ? `
    <td style="width: 110px; padding: 20px 0 20px 20px; vertical-align: top;">
      <img src="${imageUrl}" alt="Poster" style="width: 110px; height: auto; border-radius: 8px; display: block;" />
    </td>
    `
        : ''
    }
    <td style="padding: 20px; vertical-align: top;">
      <table cellpadding="0" cellspacing="0" style="width: 100%;">
        <tr>
          <td>
            <span style="font-size: 20px; font-weight: bold; color: ${COLORS.primary}; margin-right: 10px;">${title}</span>
            <span style="font-size: 16px; color: ${COLORS.textMuted};">${year}</span>
          </td>
        </tr>
        ${episodeBadges}
        ${statusBadge}
        ${descriptionRow}
        ${buttonRow}
      </table>
    </td>
  </tr>
</table>
  `;
};

// Media grid for posters
export const getMediaGrid = (medias: Array<{ title: string; posterUrl: string; imdbId: string }>): string => {
  if (medias.length === 0) {
    return '';
  }

  const mediaItems = medias
    .map(
      (media) => `
    <td style="width: 120px; padding: 10px; text-align: center; vertical-align: top;">
      <img src="${media.posterUrl}" alt="${media.title}" style="width: 100px; height: auto; border-radius: 5px; display: block; margin: 0 auto;" />
      <div style="margin-top: 8px; font-size: 14px; color: ${COLORS.text}; line-height: 1.3;">${media.title}</div>
    </td>
  `,
    )
    .join('');

  return `
<table cellpadding="0" cellspacing="0" style="width: 100%; margin: 15px 0;">
  <tr>
    ${mediaItems}
  </tr>
</table>
  `;
};

// Form field (for registration forms)
export const getFormField = (
  type: string,
  id: string,
  name: string,
  label: string,
  placeholder?: string,
  required = false,
): string => `
<table cellpadding="0" cellspacing="0" style="width: 100%; margin-bottom: 20px;">
  <tr>
    <td>
      <label for="${id}" style="display: block; margin-bottom: 8px; font-weight: bold; color: ${COLORS.text};">
        ${label}
      </label>
    </td>
  </tr>
  <tr>
    <td>
      <input 
        type="${type}" 
        id="${id}" 
        name="${name}" 
        ${required ? 'required' : ''}
        ${placeholder ? `placeholder="${placeholder}"` : ''}
        style="width: 100%; padding: 12px; border: 1px solid ${COLORS.border}; border-radius: 4px; font-size: 16px; box-sizing: border-box; display: block;"
      />
    </td>
  </tr>
</table>
`;

// Form button styles
export const getFormButton = (text: string, type: 'submit' | 'button' = 'submit'): string => `
<button 
  type="${type}"
  style="background-color: ${COLORS.info}; color: white; padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: bold; width: 100%; margin-top: 10px;"
>
  ${text}
</button>
`;
