import { COMMON_CSS, getHeaderSection, getFooterSection } from './styles';

export interface MediaItem {
  title: string;
  posterUrl: string;
  imdbId: string;
  type: 'movie' | 'show' | 'episode';
}

const getCredentialsSection = (userName: string, password: string, mediaServerUrl: string) => `
    <div class="section-info">
        <h2>Vos identifiants de connexion</h2>
        <p><strong>URL du serveur:</strong> <a href="${mediaServerUrl}" target="_blank" rel="noopener noreferrer">${mediaServerUrl}</a></p>
        <p><strong>Nom d'utilisateur:</strong> ${userName}</p>
        <p><strong>Mot de passe:</strong> ${password}</p>
        
        <a href="${mediaServerUrl}" class="btn" target="_blank" rel="noopener noreferrer">ACCÉDER MAINTENANT</a>
    </div>
`;

const getSuggestionsSection = (movies?: MediaItem[], series?: MediaItem[]) => {
  if (!movies?.length && !series?.length) {
    return '';
  }

  return `
    <div class="section">
        <h2>Notre catalogue</h2>
        <p>Voici quelques exemples de contenu disponible :</p>
        
        ${
          movies && movies.length > 0
            ? `
        <div class="media-section">
            <h3>Films</h3>
            <div class="media-grid">
                <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                        ${movies
                          .map(
                            (movie) => `
                        <td class="media-item" width="100" valign="top">
                            <img src="${movie.posterUrl}" alt="${movie.title}" class="media-poster">
                            <div class="media-title">${movie.title}</div>
                        </td>
                        `,
                          )
                          .join('')}
                    </tr>
                </table>
            </div>
        </div>
        `
            : ''
        }
        
        ${
          series && series.length > 0
            ? `
        <div class="media-section">
            <h3>Séries</h3>
            <div class="media-grid">
                <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                        ${series
                          .map(
                            (serie) => `
                        <td class="media-item" width="100" valign="top">
                            <img src="${serie.posterUrl}" alt="${serie.title}" class="media-poster">
                            <div class="media-title">${serie.title}</div>
                        </td>
                        `,
                          )
                          .join('')}
                    </tr>
                </table>
            </div>
        </div>
        `
            : ''
        }
    </div>
  `;
};

const getRequestSection = (serviceName: string, traktLinkUrl: string, userGuideUrl: string) => `
    <div class="section-highlight">
        <h2>Demander un nouveau contenu</h2>
        <p>Il manque un film ou une série que vous aimeriez regarder ? Faites-en la demande facilement :</p>
        <ol>
            <li>Créez un compte sur la plateforme <a href="https://trakt.tv" target="_blank" rel="noopener noreferrer">Trakt</a></li>
            <li>Utilisez <a href="${traktLinkUrl}" target="_blank" rel="noopener noreferrer">ce lien de synchronisation</a> pour connecter votre compte à ${serviceName}</li>
            <li>Ajoutez simplement les films ou séries souhaités à votre liste "Watchlist" sur Trakt</li>
        </ol>
        <p>Vous serez notifié par email lorsque vos contenus demandés seront disponibles sur la plateforme !</p>
        
        <a href="${userGuideUrl}" class="btn btn-secondary" target="_blank" rel="noopener noreferrer">CONSULTER LE GUIDE COMPLET</a>
    </div>
`;

export type RegisteredTemplateParams = {
  serviceName: string;
  mediaServerUrl: string;
  userGuideUrl: string;
  traktLinkUrl: string;
  userName: string;
  password: string;
  movies?: MediaItem[];
  series?: MediaItem[];
};

export const registeredTemplate = (
  params: RegisteredTemplateParams,
): { subject: string; html: string; text: string } => {
  const { serviceName, mediaServerUrl, userGuideUrl, traktLinkUrl, userName, password, movies, series } = params;
  const showSuggestions = (movies?.length ?? 0) > 0 || (series?.length ?? 0) > 0;
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bienvenue sur ${serviceName}</title>
    <style>
        ${COMMON_CSS}
    </style>
</head>
<body>
    <div class="container">
        ${getHeaderSection(serviceName)}
        
        <div class="content">
            <h1>Bienvenue sur ${serviceName} !</h1>
            
            <p>Nous sommes ravis de vous accueillir dans notre service de streaming privé. Vous avez désormais accès à notre vaste collection de films et séries.</p>
            
            ${getCredentialsSection(userName, password, mediaServerUrl)}
            
            ${showSuggestions ? getSuggestionsSection(movies, series) : ''}
            
            ${getRequestSection(serviceName, traktLinkUrl, userGuideUrl)}
        </div>
        
        ${getFooterSection()}
    </div>
</body>
</html>
  `;

  const text = `BIENVENUE SUR ${serviceName}!
Votre service de streaming privé!

VOS IDENTIFIANTS:
URL d'accès: ${mediaServerUrl}
Nom d'utilisateur: ${userName}
Mot de passe: ${password}

Pour plus d'informations sur l'utilisation du service, la demande de nouveaux contenus et les fonctionnalités disponibles, consultez notre guide complet:
${userGuideUrl}
Nous vous souhaitons une excellente expérience sur ${serviceName}!
--
L'équipe ${serviceName}`;

  return { subject: `Bienvenue sur ${serviceName}!`, html, text };
};
