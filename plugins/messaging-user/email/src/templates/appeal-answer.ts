import { AppealAnswer, ServiceIdentity } from '@crn-flix/contracts';
import { escapeHtml, getEmailTemplate, getInfoBox, TYPOGRAPHY } from '@crn-flix/design-system';

const WORDING: Record<
  AppealAnswer['outcome'],
  { subject: string; headline: string; tone: 'success' | 'warning' | 'info'; body: string }
> = {
  granted: {
    subject: '✅ Dérogation accordée',
    headline: 'Votre dérogation est accordée',
    tone: 'success',
    body: 'Le titre sera disponible dans votre collection personnelle, visible de vous seul.',
  },
  excluded: {
    subject: '✅ Contestation acceptée',
    headline: 'Votre contestation est acceptée',
    tone: 'success',
    body: 'La règle ne s’applique plus à ce titre : il rejoint la bibliothèque comme les autres.',
  },
  denied: {
    subject: '❌ Demande refusée',
    headline: 'Votre demande n’a pas été acceptée',
    tone: 'warning',
    body: 'Le refus initial est maintenu.',
  },
  message: {
    subject: '💬 Réponse à votre demande',
    headline: 'L’administrateur vous répond',
    tone: 'info',
    body: 'Votre demande reste en cours d’examen.',
  },
};

export const appealAnswerTemplate = (
  identity: ServiceIdentity,
  userName: string,
  answer: AppealAnswer,
): { subject: string; html: string; text: string } => {
  const wording = WORDING[answer.outcome];
  const subject = `${wording.subject} : ${answer.title}`;
  const service = escapeHtml(identity.serviceName);
  const message = answer.message?.trim();
  const content = `
    <h1 style="${TYPOGRAPHY.h1}">${escapeHtml(wording.headline)}</h1>
    <p style="${TYPOGRAPHY.body}">Bonjour ${escapeHtml(userName)},</p>
    ${getInfoBox(`<p style="${TYPOGRAPHY.body} margin: 0;"><strong>${escapeHtml(answer.title)}</strong> — ${escapeHtml(wording.body)}</p>`, wording.tone)}
    ${message ? `<p style="${TYPOGRAPHY.body}">${escapeHtml(message).replace(/\n/g, '<br>')}</p>` : ''}
    <p style="${TYPOGRAPHY.small}">Vos demandes et leur état : <a href="${escapeHtml(identity.userSpaceUrl)}">votre espace</a>.</p>
    <p style="${TYPOGRAPHY.muted}">L'équipe ${service}</p>
  `;
  const text = [
    `Bonjour ${userName},`,
    '',
    `${answer.title} — ${wording.body}`,
    ...(message ? ['', message] : []),
    '',
    `Vos demandes et leur état : ${identity.userSpaceUrl}`,
    '',
    `L'équipe ${identity.serviceName}`,
  ].join('\n');
  return { subject, html: getEmailTemplate(subject, identity.serviceName, content), text };
};
