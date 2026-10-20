import { RequestNotice, RequestOutcome, ServiceIdentity } from '@crn-flix/contracts';
import { BUTTONS, getEmailTemplate, getInfoBox, getMediaCard, TYPOGRAPHY } from '@crn-flix/design-system';

const DESCRIPTION_BY_OUTCOME: Record<RequestOutcome, string> = {
  fulfilled: 'Votre demande est disponible.',
  rejected: 'Le contenu demandé ne respecte pas les règles du serveur. Veuillez réessayer avec un contenu approprié.',
};

/** Episodes in airing order, then everything else by title. */
function byAiringThenTitle(a: RequestNotice, b: RequestNotice): number {
  if (a.type === 'episode' && b.type === 'episode') {
    return (a.seasonNumber || 0) - (b.seasonNumber || 0) || (a.episodeNumber || 0) - (b.episodeNumber || 0);
  }
  return a.title.localeCompare(b.title);
}

const card = (notice: RequestNotice, { serviceName, playerUrl }: ServiceIdentity): string =>
  getMediaCard(
    notice.title,
    notice.year?.toString() || '',
    notice.posterUrl ?? undefined,
    notice.outcome,
    DESCRIPTION_BY_OUTCOME[notice.outcome],
    notice.outcome === 'fulfilled' ? { text: `Regarder sur ${serviceName}`, url: playerUrl } : undefined,
    notice.type === 'episode' ? { season: notice.seasonNumber || 0, episode: notice.episodeNumber || 0 } : undefined,
  );

const textBlock = (notice: RequestNotice, { serviceName, playerUrl }: ServiceIdentity): string => `
${notice.title} (${notice.year})
${notice.type === 'episode' ? `Saison ${notice.seasonNumber} - Episode ${notice.episodeNumber}\n` : ''}
Statut: ${notice.outcome.toUpperCase()}
${DESCRIPTION_BY_OUTCOME[notice.outcome]}
${notice.outcome === 'fulfilled' ? `Regarder sur ${serviceName}: ${playerUrl}` : ''}
---`;

const userSpaceBox = (userSpaceUrl: string): string =>
  getInfoBox(
    `<h2 style="${TYPOGRAPHY.h2}">Et vos autres demandes ?</h2>
     <p style="${TYPOGRAPHY.body}">Retrouvez toutes vos demandes en cours, ce qui est déjà disponible et la progression des téléchargements dans votre espace personnel.</p>
     <div style="margin-top: 20px;">
       <a href="${userSpaceUrl}" style="${BUTTONS.primary}" target="_blank" rel="noopener noreferrer">Suivre mes demandes</a>
     </div>`,
    'info',
  );

export const requestUpdateTemplate = (
  identity: ServiceIdentity,
  notices: RequestNotice[],
): { subject: string; html: string; text: string } => {
  const sorted = [...notices].sort(byAiringThenTitle);
  const subject = `📺 Mise à jour de vos demandes (${notices.length})`;

  const content = `
    <h1 style="${TYPOGRAPHY.h1}">Mise à jour de vos demandes</h1>
    ${sorted.map((notice) => card(notice, identity)).join('')}
    ${userSpaceBox(identity.userSpaceUrl)}
  `;

  const text = `
📺 Mise à jour de vos demandes (${notices.length})

${sorted.map((notice) => textBlock(notice, identity)).join('\n')}

Suivez toutes vos demandes en cours sur votre espace: ${identity.userSpaceUrl}

--
L'équipe ${identity.serviceName}`;

  return { subject, html: getEmailTemplate(subject, identity.serviceName, content), text };
};
