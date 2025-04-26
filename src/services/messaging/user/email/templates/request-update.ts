import { MediaEntity } from '@/services/database/medias';
import { RequestEntity, RequestStatus } from '@/services/database/requests';

import { COMMON_CSS, getHeaderSection, getFooterSection } from './styles';

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

const getMediaCard = (
  media: MediaEntity,
  request: RequestEntity,
  serviceName: string,
  mediaServerUrl: string,
  posterUrlByImdbId: Record<string, string>,
) => {
  const posterUrl = media.imdbId ? posterUrlByImdbId[media.imdbId] : undefined;
  return `
    <div class="media-card" style="display: flex; gap: 24px; align-items: stretch;">
      ${
        posterUrl
          ? `<div style="flex: 0 0 110px; display: flex; align-items: center;"><img src="${posterUrl}" alt="Poster" style="width: 110px; height: 100%; object-fit: cover; border-radius: 8px 0 0 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);" /></div>`
          : ''
      }
      <div class="media-details" style="flex: 1; display: flex; flex-direction: column; justify-content: center;">
        <div style="display: flex; align-items: baseline; gap: 10px;">
          <span class="media-title" style="font-size: 20px; font-weight: 600; color: #1e1e2a;">${media.title}</span>
          <span class="media-year" style="font-size: 16px; color: #888; font-weight: 400;">${media.year}</span>
        </div>
        ${
          media.type === 'episode'
            ? `<div class="episode-info" style="margin-top: 8px;">
                  <span class="episode-label">Saison ${media.seasonNumber}</span>
                  <span class="episode-number">Episode ${media.episodeNumber}</span>
                </div>`
            : ''
        }
        <div style="margin-top: 16px;">
          <span class="status status-${request.status.toLowerCase().replace('_', '-')}">
            ${request.status.replace('_', ' ').toUpperCase()}
          </span>
        </div>
        <p class="status-description" style="margin: 12px 0 0 0;">${getStatusDescription(request.status)}</p>
        ${
          request.status === 'fulfilled'
            ? `<a href="${mediaServerUrl}" class="btn" target="_blank" rel="noopener noreferrer" style="margin-top: 18px;">Regarder sur ${serviceName}</a>`
            : ''
        }
      </div>
    </div>
  `;
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
    .map((request) => getMediaCard(request.media!, request, serviceName, mediaServerUrl, posterUrlByImdbId))
    .join('');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${subject}</title>
    <style>
        ${COMMON_CSS}
    </style>
</head>
<body>
    <div class="container">
        ${getHeaderSection(serviceName)}
        
        <div class="content">
            <h1>Mise à jour de vos demandes</h1>
            ${mediaCards}
        </div>
        
        ${getFooterSection()}
    </div>
</body>
</html>`;

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
