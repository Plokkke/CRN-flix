export interface MediaItem {
  title: string;
  posterUrl: string;
}

const getHeaderSection = (serviceName: string) => `
    <div class="header">
        <div class="logo">${serviceName}</div>
        <div class="tagline">Votre collection privée de films et séries</div>
    </div>
`;

const getCredentialsSection = (userName: string, password: string, mediaServerUrl: string) => `
    <div class="credentials">
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
    <div class="highlights">
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
    <div class="request-section">
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

const getFooterSection = () => `
    <div class="footer">
        <p>Ceci est un service privé. Merci de ne pas partager vos identifiants.</p>
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
        
        .credentials {
            background-color: #f5f5f5;
            border-left: 4px solid #1e1e2a;
            padding: 15px;
            margin: 20px 0;
        }
        
        .credentials p {
            margin: 5px 0;
        }
        
        .highlights {
            margin: 25px 0;
        }

        .media-section {
            margin: 20px 0;
        }
        
        .media-grid {
            margin-top: 15px;
        }
        
        .media-item {
            width: 100px;
            text-align: center;
        }
        
        .media-poster {
            width: 100px;
            height: auto;
            border-radius: 5px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        }
        
        .media-title {
            margin-top: 8px;
            font-size: 14px;
            color: #333;
        }
        
        .request-section {
            background-color: #f0f7ff;
            padding: 20px;
            border-radius: 5px;
            margin-top: 25px;
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
        
        .btn-secondary {
            background-color: #1e1e2a;
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
        }
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
