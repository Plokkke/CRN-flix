import { COMMON_CSS } from './styles';

export const registeredTemplate = (): string => `
  <!DOCTYPE html>
  <html>
    <head>
      <style>${COMMON_CSS}</style>
    </head>
    <body>
      <div class="container">
        <h1>✅ Registration Completed Successfully!</h1>
        <p>Your account has been created and you can now access <a href="https://jellyfin.crn-tech.fr">CRN-Flix</a>.</p>
        <div class="footer">
          <p>Thank you for joining our community!</p>
        </div>
      </div>
    </body>
  </html>
`;
