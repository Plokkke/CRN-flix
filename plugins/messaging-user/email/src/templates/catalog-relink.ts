import { CatalogRelink } from '@crn-flix/contracts';
import { BUTTONS, escapeHtml, getEmailTemplate, getInfoBox, TYPOGRAPHY } from '@crn-flix/design-system';

export const catalogRelinkTemplate = (
  serviceName: string,
  userName: string,
  relink: CatalogRelink,
): { subject: string; html: string; text: string } => {
  const subject = `🔗 Reconnectez votre compte ${relink.catalogName} à ${serviceName}`;
  const catalog = escapeHtml(relink.catalogName);

  const content = `
    <h1 style="${TYPOGRAPHY.h1}">🔗 Votre compte ${catalog} s'est déconnecté</h1>
    <p style="${TYPOGRAPHY.body}">Bonjour ${escapeHtml(userName)},</p>
    ${getInfoBox(
      `<p style="${TYPOGRAPHY.body} margin: 0;">${catalog} n'autorise plus ${escapeHtml(serviceName)} à lire votre liste : vos nouvelles demandes sont en pause.</p>`,
      'warning',
    )}
    <p style="${TYPOGRAPHY.body}">Rien n'est perdu : tout ce qui est déjà disponible le reste, et vos demandes reprendront dès que le lien sera rétabli. Il suffit d'autoriser à nouveau l'accès, cela prend une minute.</p>
    <p style="text-align: center; margin: 24px 0 8px 0;">
      <a href="${escapeHtml(relink.linkUrl)}" style="${BUTTONS.primary}" target="_blank" rel="noopener noreferrer">Reconnecter ${catalog}</a>
    </p>
    <p style="${TYPOGRAPHY.small}">Le lien ouvre ${catalog} : connectez-vous si besoin, puis validez l'accès.</p>
    <p style="${TYPOGRAPHY.muted}">L'équipe ${escapeHtml(serviceName)}</p>
  `;

  const text = [
    `Bonjour ${userName},`,
    '',
    `${relink.catalogName} n'autorise plus ${serviceName} à lire votre liste : vos nouvelles demandes sont en pause.`,
    `Rien n'est perdu : vos demandes reprendront dès que le lien sera rétabli.`,
    '',
    `Reconnecter ${relink.catalogName} : ${relink.linkUrl}`,
    '',
    `L'équipe ${serviceName}`,
  ].join('\n');

  return { subject, html: getEmailTemplate(subject, serviceName, content), text };
};
