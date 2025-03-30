import { COMMON_CSS } from './styles';

export const welcomeTemplate = (): string => `
  <!DOCTYPE html>
  <html>
    <head>
      <style>${COMMON_CSS}</style>
    </head>
    <body>
      <div class="container">
        <h1>👋 Welcome to TraktSync!</h1>
        <p>We're excited to have you on board! TraktSync will help you manage your media requests and keep track of your favorite content.</p>
        <div class="footer">
          <p>If you have any questions, feel free to reach out to our support team.</p>
        </div>
      </div>
    </body>
  </html>
`;
