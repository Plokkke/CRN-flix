import { COMMON_CSS } from './styles';

export const errorTemplate = (message: string): { subject: string; html: string; text: string } => {
  const subject = "❌ Quelque chose s'est mal passé!";
  const html = `
  <!DOCTYPE html>
  <html>
    <head>
      <style>${COMMON_CSS}</style>
    </head>
    <body>
      <div class="container">
        <div class="content">
          <h1>❌ Quelque chose s'est mal passé!</h1>
          <div class="section-info">
            <p>${message}</p>
          </div>
          <div class="footer">
            <p>Si vous avez besoin d'assistance, veuillez contacter le support.</p>
          </div>
        </div>
      </div>
    </body>
  </html> 
`;

  const text = `
❌ Quelque chose s'est mal passé!

${message}
`;

  return { subject, html, text };
};
