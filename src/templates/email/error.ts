import { COMMON_CSS } from './styles';

export const errorTemplate = (message: string): { subject: string; html: string; text: string } => {
  const subject = '❌ Quelque chose s\'est mal passé!';
  const html = `
  <!DOCTYPE html>
  <html>
    <head>
      <style>${COMMON_CSS}</style>
    </head>
    <body>
      <div class="container">
        <h1>❌ Quelque chose s'est mal passé!</h1>
        <p>${message}</p>
        <div class="footer">
          <p>Si vous avez besoin d'assistance, veuillez contacter le support.</p>
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
