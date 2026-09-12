import { LoginChallenge } from '@/services/messaging/user';

import { BUTTONS, escapeHtml, getEmailTemplate, getInfoBox, TYPOGRAPHY } from './email-styles';

export const loginChallengeTemplate = (challenge: LoginChallenge): { subject: string; html: string; text: string } => {
  const subject = `Votre code de connexion ${challenge.serviceName}`;
  const link = escapeHtml(challenge.link);

  const content = `
    <h1 style="${TYPOGRAPHY.h1}">Connexion à votre espace</h1>
    <p style="${TYPOGRAPHY.body}">Cliquez sur le bouton pour accéder à vos demandes :</p>
    <p style="text-align: center; margin: 24px 0;">
      <a href="${link}" style="${BUTTONS.primary}">Accéder à mon espace</a>
    </p>
    ${getInfoBox(`
      <p style="${TYPOGRAPHY.body}">Ou saisissez ce code sur la page de connexion :</p>
      <p style="font-size: 32px; letter-spacing: 8px; font-weight: bold; text-align: center; margin: 12px 0;">${challenge.code}</p>
    `)}
    <p style="${TYPOGRAPHY.small}">Ce code et ce lien expirent dans ${challenge.expiresInMinutes} minutes et ne servent qu'une fois. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p>
  `;

  const text = `
Connexion à votre espace ${challenge.serviceName}

Lien de connexion : ${challenge.link}
Ou saisissez ce code : ${challenge.code}

Valable ${challenge.expiresInMinutes} minutes.
`;

  return { subject, html: getEmailTemplate(subject, challenge.serviceName, content), text };
};
