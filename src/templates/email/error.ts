import { COMMON_CSS } from './styles';

export const errorTemplate = (message: string): string => `
  <!DOCTYPE html>
  <html>
    <head>
      <style>${COMMON_CSS}</style>
    </head>
    <body>
      <div class="container">
        <h1>❌ Error</h1>
        <p>${message}</p>
        <div class="footer">
          <p>If you need assistance, please contact support.</p>
        </div>
      </div>
    </body>
  </html>
`;
