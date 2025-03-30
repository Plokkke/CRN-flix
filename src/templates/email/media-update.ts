import { MediaRequestEntity, RequestStatus } from '@/services/database/mediaRequests';

import { COMMON_CSS } from './styles';

const getStatusDescription = (status: RequestStatus): string => {
  const descriptions: Record<RequestStatus, string> = {
    pending: 'Nous avons bien reçu votre demande. Vous serez notifié lorsque elle sera terminée.',
    in_progress: 'Un administrateur a pris en charge votre demande. Elle sera disponible dans quelques minutes.',
    fulfilled: 'Votre demande est disponible sur CRN-Flix.',
    rejected: 'Le contenu demandé ne respecte pas les règles du serveur. Veuillez réessayer avec un contenu approprié.',
    canceled: 'Vous avez annulé votre demande.',
    missing: 'Le contenu demandé est introuvable. Nous sommes navrés de ne pas pouvoir vous satisfaire.',
  };
  return descriptions[status] || 'Status update received.';
};

export const mediaUpdateTemplate = (request: MediaRequestEntity): { subject: string; html: string; text: string } => {
  const subject = `📺 Mise à jour concernant ${request.title}`;
  const statusClass = `status-${request.status.toLowerCase().replace('_', '-')}`;
  const statusText = request.status.replace('_', ' ').toUpperCase();

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>${COMMON_CSS}</style>
      </head>
      <body>
        <div class="container">
          <h1>📺 Mise à jour concernant ${request.title}</h1>
          <h2>${request.title} (${request.year})</h2>
          <div class="status ${statusClass}">${statusText}</div>
          ${
            request.type === 'episode'
              ? `
            <p><strong>Saison:</strong> ${request.seasonNumber}</p>
            <p><strong>Episode:</strong> ${request.episodeNumber}</p>
          `
              : ''
          }
          <p>${getStatusDescription(request.status)}</p>
          ${
            request.status === 'fulfilled'
              ? `
            <a href="https://jellyfin.crn-tech.fr" class="button">Regarder sur CRN-Flix</a>
          `
              : ''
          }
        </div>
      </body>
    </html>
  `;

  const text = `
📺 Mise à jour concernant ${request.title}

${request.title} (${request.year})
Statut: ${statusText}
${request.type === 'episode' ? `Saison: ${request.seasonNumber}\nEpisode: ${request.episodeNumber}\n` : ''}
${getStatusDescription(request.status)}
${request.status === 'fulfilled' ? 'Regarder sur CRN-Flix: https://jellyfin.crn-tech.fr' : ''}
  `;

  return { subject, html, text };
};
