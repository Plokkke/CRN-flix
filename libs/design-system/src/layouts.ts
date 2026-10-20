import {
  getContentSection,
  getEmailContainer,
  getFooterSection,
  getHeaderSection,
  TAGLINE,
  wordmark,
} from './components';
import { COLORS, FONT_STACK, RADIUS, TONES } from './tokens';

export const getEmailTemplate = (title: string, serviceName: string, content: string): string => `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: ${FONT_STACK}; background-color: ${COLORS.background};">
    ${getEmailContainer(`
        ${getHeaderSection(serviceName)}
        ${getContentSection(content)}
        ${getFooterSection()}
    `)}
</body>
</html>
`;

const TONE_CLASSES = Object.entries(TONES)
  .map(
    ([tone, { bg, text, border }]) => `.tone-${tone} { background: ${bg}; color: ${text}; border-color: ${border}; }`,
  )
  .join('\n      ');

const WEB_CSS = `
      *, *::before, *::after { box-sizing: border-box; }
      body {
        font-family: ${FONT_STACK};
        margin: 0;
        padding: 0;
        background-color: ${COLORS.background};
        color: ${COLORS.text};
        -webkit-font-smoothing: antialiased;
      }
      .container {
        max-width: 600px;
        margin: 32px auto;
        background-color: ${COLORS.white};
        border: 1px solid ${COLORS.border};
        border-radius: ${RADIUS.lg};
        overflow: hidden;
      }
      .header { padding: 22px 28px; border-bottom: 1px solid ${COLORS.borderLight}; }
      .tagline { font-size: 13px; color: ${COLORS.textMuted}; margin-top: 2px; }
      .content { padding: 28px; line-height: 1.6; }
      h1, h2, h3 { color: ${COLORS.primary}; letter-spacing: -0.01em; }
      h2 { font-size: 20px; margin: 0 0 12px; }
      p { color: ${COLORS.textLight}; }
      a { color: ${COLORS.info}; }
      .form-group { margin-bottom: 18px; }
      label { display: block; margin-bottom: 6px; font-weight: 600; font-size: 14px; color: ${COLORS.text}; }
      input, select, textarea {
        width: 100%;
        padding: 11px 12px;
        border: 1px solid ${COLORS.border};
        border-radius: ${RADIUS.md};
        font: inherit;
        font-size: 15px;
        background: ${COLORS.white};
        color: ${COLORS.text};
      }
      input:focus, select:focus, textarea:focus {
        outline: none;
        border-color: ${COLORS.primary};
        box-shadow: 0 0 0 3px rgba(22, 22, 29, 0.08);
      }
      button, .btn {
        display: inline-block;
        background-color: ${COLORS.secondary};
        color: #ffffff;
        padding: 11px 20px;
        border: 1px solid ${COLORS.secondary};
        border-radius: ${RADIUS.md};
        cursor: pointer;
        font: inherit;
        font-size: 15px;
        font-weight: 600;
        text-decoration: none;
        text-align: center;
        width: 100%;
      }
      button:hover, .btn:hover { background-color: ${COLORS.accentHover}; border-color: ${COLORS.accentHover}; }
      .btn-secondary, button.btn-secondary { background: ${COLORS.white}; color: ${COLORS.primary}; border-color: ${COLORS.border}; }
      .btn-secondary:hover, button.btn-secondary:hover { background: ${COLORS.surfaceMuted}; border-color: ${COLORS.border}; }
      .info-box {
        padding: 18px 20px;
        border: 1px solid ${TONES.info.border};
        background: ${TONES.info.bg};
        border-radius: ${RADIUS.md};
        margin: 0 0 20px;
      }
      .info-box p:last-child { margin-bottom: 0; }
      .pill { display: inline-block; padding: 2px 10px; border-radius: ${RADIUS.pill}; border: 1px solid; font-size: 12px; font-weight: 600; white-space: nowrap; }
      ${TONE_CLASSES}
`;

export const getWebTemplate = (
  title: string,
  serviceName: string,
  content: string,
  additionalCSS = '',
  additionalJS = '',
): string => `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
      ${WEB_CSS}
      ${additionalCSS}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            ${wordmark(serviceName)}
            <div class="tagline">${TAGLINE}</div>
        </div>
        <div class="content">
            ${content}
        </div>
    </div>
    ${additionalJS ? `<script>${additionalJS}</script>` : ''}
</body>
</html>
`;
