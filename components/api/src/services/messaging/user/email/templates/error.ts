import { getEmailTemplate, getInfoBox, TYPOGRAPHY } from './email-styles';

export const errorTemplate = (message: string): { subject: string; html: string; text: string } => {
  const subject = "❌ Quelque chose s'est mal passé!";

  const content = `
    <h1 style="${TYPOGRAPHY.h1}">❌ Quelque chose s'est mal passé!</h1>
    ${getInfoBox(
      `
      <p style="${TYPOGRAPHY.body}">${message}</p>
    `,
      'warning',
    )}
    <p style="${TYPOGRAPHY.small}">Si vous avez besoin d'assistance, veuillez contacter le support.</p>
  `;

  const html = getEmailTemplate(subject, 'CRN-Flix', content);

  const text = `
❌ Quelque chose s'est mal passé!

${message}
`;

  return { subject, html, text };
};
