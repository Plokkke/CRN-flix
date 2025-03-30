import { COMMON_CSS } from './styles';

export const traktLinkTemplate = (url: string): { html: string; text: string } => {
  const html = `
  <!DOCTYPE html>
  <html>
    <head>
      <style>${COMMON_CSS}</style>
    </head>
    <body>
      <div class="container">
        <h1>🔗 Link Your Trakt Account</h1>
        <p>To complete your setup, please link your Trakt account by clicking the button below:</p>
        <a href="${url}" class="button">Link Trakt Account</a>
        <p>Or copy and paste this link in your browser:</p>
        <p>${url}</p>
        <div class="footer">
          <p>This link will expire in 10 minutes.</p>
        </div>
      </div>
    </body>
  </html>
  `;

  const text = `
🔗 Link Your Trakt Account

To complete your setup, please link your Trakt account by visiting this link:
${url}

This link will expire in 10 minutes.
  `;

  return { html, text };
};
