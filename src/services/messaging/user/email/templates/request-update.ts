import { MediaEntity } from '@/services/database/medias';
import { RequestEntity, RequestStatus } from '@/services/database/requests';

const getStatusDescription = (status: RequestStatus): string => {
  const descriptions: Record<RequestStatus, string> = {
    pending: 'Nous avons bien reçu votre demande. Vous serez notifié lorsque elle sera terminée.',
    fulfilled: 'Votre demande est disponible sur CRN-Flix.',
    rejected: 'Le contenu demandé ne respecte pas les règles du serveur. Veuillez réessayer avec un contenu approprié.',
    canceled: 'Vous avez annulé votre demande.',
    missing: 'Le contenu demandé est introuvable. Nous sommes navrés de ne pas pouvoir vous satisfaire.',
  };
  return descriptions[status] || 'Status update received.';
};

const getHeaderSection = (serviceName: string) => `
    <div class="header">
        <div class="logo">${serviceName}</div>
        <div class="tagline">Votre collection privée de films et séries</div>
    </div>
`;

const getMediaCard = (media: MediaEntity) => `
    <div class="media-card">
        <div class="media-details">
            <h2 class="media-title">${media.title}<span class="media-year">${media.year}</span></h2>
            
            ${
              media.type === 'episode'
                ? `
                <div class="episode-info">
                    <span class="episode-label">Saison ${media.seasonNumber}</span>
                    <span class="episode-number">Episode ${media.episodeNumber}</span>
                </div>
              `
                : ''
            }
        </div>
    </div>
`;

const getStatusSection = (request: RequestEntity, statusClass: string, statusText: string) => `
    <div class="status-section">
        <div class="status ${statusClass}">${statusText}</div>
        <p class="status-description">${getStatusDescription(request.status)}</p>
        ${
          request.status === 'fulfilled'
            ? `
            <a href="https://jellyfin.crn-tech.fr" class="btn" target="_blank" rel="noopener noreferrer">Regarder sur CRN-Flix</a>
          `
            : ''
        }
    </div>
`;

const getFooterSection = () => `
    <div class="footer">
        <p>Ceci est un service privé. Merci de ne pas partager vos identifiants.</p>
    </div>
`;

export const requestUpdateTemplate = (requests: RequestEntity[]): { subject: string; html: string; text: string } => {
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
      const statusClass = `status-${request.status.toLowerCase().replace('_', '-')}`;
      const statusText = request.status.replace('_', ' ').toUpperCase();
      return `
      ${getMediaCard(request.media!)}
      ${getStatusSection(request, statusClass, statusText)}
    `;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${subject}</title>
    <style>
        /* Styles généraux */
        body {
            font-family: 'Arial', sans-serif;
            line-height: 1.6;
            color: #333;
            margin: 0;
            padding: 0;
            background-color: #f7f7f7;
        }
        
        .container {
            max-width: 600px;
            width: 600px;
            min-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            box-shadow: 0 0 10px rgba(0,0,0,0.1);
        }
        
        /* En-tête */
        .header {
            background-color: #1e1e2a;
            color: white;
            padding: 30px 20px;
            text-align: center;
        }
        
        .logo {
            font-size: 32px;
            font-weight: bold;
            margin-bottom: 10px;
        }
        
        .tagline {
            font-size: 16px;
            opacity: 0.9;
        }
        
        /* Contenu principal */
        .content {
            padding: 30px 20px;
        }
        
        h1 {
            color: #1e1e2a;
            margin-top: 0;
        }
        
        h2 {
            color: #1e1e2a;
            margin-top: 25px;
            font-size: 20px;
            border-bottom: 1px solid #eee;
            padding-bottom: 10px;
        }

        h3 {
            color: #1e1e2a;
            margin-top: 20px;
            font-size: 18px;
        }
        
        /* Media Card */
        .media-card {
            display: flex;
            gap: 20px;
            background-color: #ffffff;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .media-details {
            flex-grow: 1;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }
        
        .media-title {
            font-size: 24px;
            font-weight: bold;
            color: #1e1e2a;
            margin: 0 0 8px 0;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .media-year {
            font-size: 16px;
            color: #666;
            font-weight: normal;
        }
        
        .episode-info {
            display: flex;
            gap: 12px;
            margin-top: 8px;
        }
        
        .episode-label, .episode-number {
            background-color: #f0f0f0;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 14px;
            color: #666;
        }
        
        .status-section {
            background-color: #f5f5f5;
            border-left: 4px solid #1e1e2a;
            padding: 20px;
            margin: 20px 0;
            border-radius: 5px;
        }
        
        .status {
            display: inline-block;
            padding: 5px 10px;
            border-radius: 3px;
            font-weight: bold;
            margin: 10px 0;
        }
        
        .status-pending { background-color: #ffd700; color: #000; }
        .status-in-progress { background-color: #1e90ff; color: #fff; }
        .status-fulfilled { background-color: #32cd32; color: #fff; }
        .status-rejected { background-color: #ff4444; color: #fff; }
        .status-canceled { background-color: #808080; color: #fff; }
        .status-missing { background-color: #ff8c00; color: #fff; }
        
        .status-description {
            margin: 15px 0;
            font-size: 16px;
        }
        
        /* Boutons */
        .btn {
            display: inline-block;
            padding: 12px 25px;
            background-color: #e50914;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            font-weight: bold;
            margin-top: 15px;
        }
        
        /* Pied de page */
        .footer {
            background-color: #f5f5f5;
            padding: 20px;
            text-align: center;
            color: #777;
            font-size: 14px;
        }
        
        /* Responsive */
        @media only screen and (max-width: 480px) {
            .container {
                width: 100%;
            }
            
            .header {
                padding: 20px 15px;
            }
            
            .content {
                padding: 20px 15px;
            }
            
            .media-card {
                flex-direction: column;
                align-items: center;
                text-align: center;
            }
            
            .media-title {
                flex-direction: column;
                align-items: center;
                gap: 4px;
            }
            
            .episode-info {
                justify-content: center;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        ${getHeaderSection('CRN-Flix')}
        
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
${request.status === 'fulfilled' ? 'Regarder sur CRN-Flix: https://jellyfin.crn-tech.fr' : ''}
---`,
  )
  .join('\n')}

--
L'équipe CRN-Flix`;

  return { subject, html, text };
};
