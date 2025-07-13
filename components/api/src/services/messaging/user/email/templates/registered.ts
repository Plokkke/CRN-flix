import { getEmailTemplate, getInfoBox, getMediaGrid, TYPOGRAPHY, BUTTONS, COLORS } from './email-styles';

export interface MediaItem {
  title: string;
  posterUrl: string;
  imdbId: string;
  type: 'movie' | 'show' | 'episode';
}

const getCredentialsSection = (userName: string, password: string, mediaServerUrl: string) => 
  getInfoBox(`
    <h2 style="${TYPOGRAPHY.h2}">Vos identifiants de connexion</h2>
    <p style="${TYPOGRAPHY.body}"><strong>URL du serveur:</strong> <a href="${mediaServerUrl}" target="_blank" rel="noopener noreferrer" style="color: ${COLORS.secondary};">${mediaServerUrl}</a></p>
    <p style="${TYPOGRAPHY.body}"><strong>Nom d'utilisateur:</strong> ${userName}</p>
    <p style="${TYPOGRAPHY.body}"><strong>Mot de passe:</strong> ${password}</p>
    <div style="margin-top: 20px;">
      <a href="${mediaServerUrl}" style="${BUTTONS.primary}" target="_blank" rel="noopener noreferrer">ACCÉDER MAINTENANT</a>
    </div>
  `, 'info');

const getSuggestionsSection = (movies?: MediaItem[], series?: MediaItem[]) => {
  if (!movies?.length && !series?.length) {
    return '';
  }

  let content = `
    <h2 style="${TYPOGRAPHY.h2}">Notre catalogue</h2>
    <p style="${TYPOGRAPHY.body}">Voici quelques exemples de contenu disponible :</p>
  `;

  if (movies && movies.length > 0) {
    content += `
      <h3 style="${TYPOGRAPHY.h3}">Films</h3>
      ${getMediaGrid(movies)}
    `;
  }

  if (series && series.length > 0) {
    content += `
      <h3 style="${TYPOGRAPHY.h3}">Séries</h3>
      ${getMediaGrid(series)}
    `;
  }

  return content;
};

const getRequestSection = (serviceName: string, traktLinkUrl: string, userGuideUrl: string) => 
  getInfoBox(`
    <h2 style="${TYPOGRAPHY.h2}">Demander un nouveau contenu</h2>
    <p style="${TYPOGRAPHY.body}">Il manque un film ou une série que vous aimeriez regarder ? Faites-en la demande facilement :</p>
    <ol style="${TYPOGRAPHY.body}">
        <li style="margin-bottom: 8px;">Créez un compte sur la plateforme <a href="https://trakt.tv" target="_blank" rel="noopener noreferrer" style="color: ${COLORS.secondary};">Trakt</a></li>
        <li style="margin-bottom: 8px;">Utilisez <a href="${traktLinkUrl}" target="_blank" rel="noopener noreferrer" style="color: ${COLORS.secondary};">ce lien de synchronisation</a> pour connecter votre compte à ${serviceName}</li>
        <li style="margin-bottom: 8px;">Ajoutez simplement les films ou séries souhaités à votre liste "Watchlist" sur Trakt</li>
    </ol>
    <p style="${TYPOGRAPHY.body}">Vous serez notifié par email lorsque vos contenus demandés seront disponibles sur la plateforme !</p>
    <div style="margin-top: 20px;">
      <a href="${userGuideUrl}" style="${BUTTONS.secondary}" target="_blank" rel="noopener noreferrer">CONSULTER LE GUIDE COMPLET</a>
    </div>
  `, 'success');

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
  const subject = `Bienvenue sur ${serviceName}!`;
  
  const content = `
    <h1 style="${TYPOGRAPHY.h1}">Bienvenue sur ${serviceName} !</h1>
    
    <p style="${TYPOGRAPHY.body}">Nous sommes ravis de vous accueillir dans notre service de streaming privé. Vous avez désormais accès à notre vaste collection de films et séries.</p>
    
    ${getCredentialsSection(userName, password, mediaServerUrl)}
    
    ${showSuggestions ? getSuggestionsSection(movies, series) : ''}
    
    ${getRequestSection(serviceName, traktLinkUrl, userGuideUrl)}
  `;

  const html = getEmailTemplate(subject, serviceName, content);

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

  return { subject, html, text };
};
