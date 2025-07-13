import { MediaEntity } from '@/services/database/medias';
import { RequestEntity, RequestStatus } from '@/services/database/requests';
import { getEmailTemplate, getMediaCard, TYPOGRAPHY } from './email-styles';

const getStatusDescription = (status: RequestStatus): string => {
  const descriptions: Record<RequestStatus, string> = {
    pending: 'Nous avons bien reçu votre demande. Vous serez notifié lorsque elle sera terminée.',
    fulfilled: 'Votre demande est disponible.',
    rejected: 'Le contenu demandé ne respecte pas les règles du serveur. Veuillez réessayer avec un contenu approprié.',
    canceled: 'Vous avez annulé votre demande.',
    missing: 'Le contenu demandé est introuvable. Nous sommes navrés de ne pas pouvoir vous satisfaire.',
  };
  return descriptions[status] || 'Status update received.';
};

export type RequestUpdateTemplateParams = {
  serviceName: string;
  mediaServerUrl: string;
  requests: RequestEntity[];
  posterUrlByImdbId: Record<string, string>;
};

export const requestUpdateTemplate = (
  params: RequestUpdateTemplateParams,
): { subject: string; html: string; text: string } => {
  const { serviceName, mediaServerUrl, requests, posterUrlByImdbId } = params;
  const subject = `📺 Mise à jour de vos demandes (${requests.length})`;

  const mediaCards = requests
    .sort((a, b) => {
      const mediaA = a.media!;
      const mediaB = b.media!;
      if (mediaA.type === 'episode' && mediaB.type === 'episode') {
        return (
          (mediaA.seasonNumber || 0) - (mediaB.seasonNumber || 0) ||
          (mediaA.episodeNumber || 0) - (mediaB.episodeNumber || 0)
        );
      }
      return mediaA.title.localeCompare(mediaB.title);
    })
    .map((request) => {
      const media = request.media!;
      const posterUrl = media.imdbId ? posterUrlByImdbId[media.imdbId] : undefined;
      
      return getMediaCard(
        media.title,
        media.year?.toString() || '',
        posterUrl,
        request.status,
        getStatusDescription(request.status),
        request.status === 'fulfilled' ? {
          text: `Regarder sur ${serviceName}`,
          url: mediaServerUrl
        } : undefined,
        media.type === 'episode' ? {
          season: media.seasonNumber || 0,
          episode: media.episodeNumber || 0
        } : undefined
      );
    })
    .join('');

  const content = `
    <h1 style="${TYPOGRAPHY.h1}">Mise à jour de vos demandes</h1>
    ${mediaCards}
  `;

  const html = getEmailTemplate(subject, serviceName, content);

  const text = `
📺 Mise à jour de vos demandes (${requests.length})

${requests
  .map(
    (request) => `
${request.media!.title} (${request.media!.year})
${request.media!.type === 'episode' ? `Saison ${request.media!.seasonNumber} - Episode ${request.media!.episodeNumber}\n` : ''}
Statut: ${request.status.replace('_', ' ').toUpperCase()}
${getStatusDescription(request.status)}
${request.status === 'fulfilled' ? `Regarder sur ${serviceName}: ${mediaServerUrl}` : ''}
---`,
  )
  .join('\n')}

--
L'équipe ${serviceName}`;

  return { subject, html, text };
};
