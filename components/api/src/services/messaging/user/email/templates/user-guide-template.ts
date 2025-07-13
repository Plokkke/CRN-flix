import { getWebTemplate, TYPOGRAPHY, COLORS } from './email-styles';

export interface UserGuideTemplateParams {
  serviceName: string;
}

const getSection = (title: string, content: string) => `
  <div style="margin: 30px 0; border-bottom: 1px solid ${COLORS.borderLight}; padding-bottom: 20px;">
    <h2 style="${TYPOGRAPHY.h2}">${title}</h2>
    <div style="color: #444444; font-size: 16px; line-height: 1.7;">${content}</div>
  </div>
`;

const getPreviewGallery = (images: Array<{ src: string; alt: string }>) => `
  <div class="preview-gallery">
    ${images
      .map(
        (img) => `
      <img src="${img.src}" alt="${img.alt}" class="preview-thumb" onclick="showPreview('${img.src}')">
    `,
      )
      .join('')}
  </div>
`;

export function userGuideTemplate(params: UserGuideTemplateParams): string {
  const { serviceName } = params;

  const content = `
    ${getSection(
      'Se connecter au serveur multimédia',
      `<ul style="margin: 10px 0 10px 20px;">
        <li><b>Sur ordinateur :</b> Naviguez directement vers l'URL du serveur.</li>
        <li><b>Sur télévision, tablette, smartphone… :</b> Téléchargez l'application Jellyfin sur le store de votre appareil. Au lancement, renseignez l'adresse du serveur.</li>
      </ul>
      ${getPreviewGallery([
        { src: '/assets/jellyfin-server-page.jpg', alt: 'Page serveur Jellyfin' },
        { src: '/assets/jellyfin-login-page.png', alt: 'Page login Jellyfin' },
      ])}`,
    )}
    ${getSection(
      'Demander un nouveau contenu',
      `<p>Il manque un film ou une série que vous aimeriez regarder ? Faites-en la demande facilement :</p>
      <ol style="margin: 10px 0 10px 20px;">
          <li style="margin-bottom: 8px;">Créez un compte sur la plateforme <a href="https://trakt.tv" target="_blank" rel="noopener noreferrer" style="color: ${COLORS.secondary};">Trakt</a></li>
          <li style="margin-bottom: 8px;">Utilisez le lien disponible dans votre email d'inscription pour connecter votre compte à ${serviceName} <span title="Si vous n'avez plus accès à cet email, contactez un administrateur">ℹ️</span></li>
          <li style="margin-bottom: 8px;">Ajoutez simplement les films ou séries souhaités à votre liste "Watchlist" sur Trakt</li>
      </ol>
      <p>Vous serez notifié par email lorsque vos contenus demandés seront disponibles sur la plateforme !</p>`,
    )}
    ${getSection(
      'Ajouter un film à ma liste de souhaits',
      `<ul style="margin: 10px 0 10px 20px;">
        <li>Parcourez le catalogue Trakt.</li>
        <li>Cliquez sur l'icône bleue <b>Watchlist</b> ou, dans le détail du média, sur le bouton <b>"Add to watch list"</b>.</li>
        <li>Pour annuler, cliquez à nouveau sur ce bouton.</li>
      </ul>
      ${getPreviewGallery([
        { src: '/assets/trakt-anticipated-page.png', alt: 'Page anticipated Trakt' },
        { src: '/assets/trakt-movie-detail-page.png', alt: 'Page détail film Trakt' },
      ])}`,
    )}
    ${getSection(
      'Quand mes demandes seront-elles disponibles ?',
      `<ul style="margin: 10px 0 10px 20px;">
        <li>La synchronisation des requêtes a lieu toutes les 10 minutes.</li>
        <li>Les mise à disposition de contenu sont effectuées manuellement. Les administrateurs font le nécessaire pour vous satisfaire dans les plus brefs délais.</li>
        <li>Une fois disponible, vous recevrez immédiatement un email d'information.</li>
      </ul>`,
    )}
    ${getSection(
      'Quels contenus sont synchronisés ?',
      `<ul style="margin: 10px 0 10px 20px;">
        <li><b>${serviceName}</b> prend en compte tous les éléments de votre <b>watchlist</b>, les <b>séries en cours</b> de visionnage, et les contenus <b>notés 10</b>/10.</li>
        <li>Si une nouvelle saison est disponible pour une série déjà regardée, elle sera automatiquement ajoutée à vos requêtes. Pas besoin de l'ajouter à votre watchlist.</li>
      </ul>`,
    )}
    
    <!-- Modal Preview -->
    <div id="modalPreview" class="modal-preview" onclick="hidePreview()">
      <span class="modal-close">&times;</span>
      <img class="modal-content" id="modalImg" style="max-width: 90vw; max-height: 90vh; border-radius: 8px;">
    </div>
  `;

  const additionalCSS = `
    .preview-gallery {
      display: flex;
      gap: 18px;
      flex-wrap: wrap;
      margin: 24px 0;
      justify-content: center;
    }
    .preview-thumb {
      width: 120px;
      height: 80px;
      object-fit: cover;
      border-radius: 6px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.13);
      cursor: pointer;
      transition: transform 0.15s;
    }
    .preview-thumb:hover {
      transform: scale(1.08);
      box-shadow: 0 2px 8px rgba(0,0,0,0.18);
    }
    .modal-preview {
      display: none;
      position: fixed;
      z-index: 9999;
      left: 0; top: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.85);
      align-items: center;
      justify-content: center;
    }
    .modal-preview.active {
      display: flex;
    }
    .modal-close {
      position: absolute;
      top: 32px;
      right: 48px;
      color: #fff;
      font-size: 40px;
      font-weight: bold;
      cursor: pointer;
      z-index: 10001;
      text-shadow: 0 2px 8px #000;
    }
  `;

  const additionalJS = `
    function showPreview(src) {
      var modal = document.getElementById('modalPreview');
      var img = document.getElementById('modalImg');
      img.src = src;
      modal.classList.add('active');
    }
    function hidePreview() {
      var modal = document.getElementById('modalPreview');
      modal.classList.remove('active');
    }
    document.addEventListener('DOMContentLoaded', function() {
      var modal = document.getElementById('modalPreview');
      modal.onclick = function(e) {
        if (e.target === modal || e.target.classList.contains('modal-close')) hidePreview();
      };
    });
  `;

  return getWebTemplate(`Guide d'utilisation – ${serviceName}`, serviceName, content, additionalCSS, additionalJS);
}
