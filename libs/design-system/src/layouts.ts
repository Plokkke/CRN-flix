import { getContentSection, getEmailContainer, getFooterSection, getHeaderSection } from './components';
import { COLORS } from './tokens';

// Complete email template wrapper
export const getEmailTemplate = (title: string, serviceName: string, content: string): string => `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: ${COLORS.background};">
    ${getEmailContainer(`
        ${getHeaderSection(serviceName)}
        ${getContentSection(content)}
        ${getFooterSection()}
    `)}
</body>
</html>
`;

// Web form template (for registration forms - not email)
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
      body {
        font-family: Arial, sans-serif;
        margin: 0;
        padding: 0;
        background-color: ${COLORS.background};
        color: ${COLORS.text};
      }
      .container {
        max-width: 600px;
        margin: 0 auto;
        background-color: ${COLORS.white};
        min-height: 100vh;
      }
      .header {
        background-color: ${COLORS.primary};
        color: white;
        padding: 30px 20px;
        text-align: center;
      }
      .logo {
        font-size: 32px;
        font-weight: bold;
        margin-bottom: 10px;
      }
      .tagline {
        font-size: 16px;
        opacity: 0.9;
      }
      .content {
        padding: 30px 20px;
      }
      .form-group {
        margin-bottom: 20px;
      }
      label {
        display: block;
        margin-bottom: 8px;
        font-weight: bold;
        color: ${COLORS.text};
      }
      input {
        width: 100%;
        padding: 12px;
        border: 1px solid ${COLORS.border};
        border-radius: 4px;
        font-size: 16px;
        box-sizing: border-box;
      }
      input:focus {
        outline: none;
        border-color: ${COLORS.info};
        box-shadow: 0 0 0 2px rgba(30, 144, 255, 0.2);
      }
      button {
        background-color: ${COLORS.info};
        color: white;
        padding: 12px 24px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 16px;
        font-weight: bold;
        width: 100%;
      }
      button:hover {
        background-color: #1c7ed6;
      }
      .info-box {
        background-color: #f0f7ff;
        padding: 20px;
        border-left: 4px solid ${COLORS.info};
        border-radius: 5px;
        margin: 20px 0;
      }
      ${additionalCSS}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">${serviceName}</div>
            <div class="tagline">Votre collection privée de films et séries</div>
        </div>
        <div class="content">
            ${content}
        </div>
    </div>
    ${additionalJS ? `<script>${additionalJS}</script>` : ''}
</body>
</html>
`;
