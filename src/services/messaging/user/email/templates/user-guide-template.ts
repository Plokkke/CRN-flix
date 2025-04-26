import { COMMON_CSS, getHeaderSection } from './styles';

export interface UserGuideTemplateParams {
  serviceName: string;
}

const getSection = (title: string, content: string) => `
  <div class="section">
    <h2>${title}</h2>
    <div class="section-content">${content}</div>
  </div>
`;

export function userGuideTemplate(params: UserGuideTemplateParams): string {
  const { serviceName } = params;

  return `
<!DOCTYPE html>
<html>
  <head>
    <title>Guide d'utilisation – ${serviceName}</title>
    <style>
      ${COMMON_CSS}
      .section-content {
        color: #444;
        font-size: 16px;
        line-height: 1.7;
      }
      .section-content ul {
        margin: 10px 0 10px 20px;
      }
      .screenshot-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        background: #e3eaf3;
        color: #7a8ca3;
        border: 1px dashed #b5c6d6;
        border-radius: 6px;
        height: 120px;
        margin: 18px 0;
        font-size: 15px;
      }
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
      .modal-content {
        max-width: 90vw;
        max-height: 90vh;
        border-radius: 8px;
        box-shadow: 0 2px 16px rgba(0,0,0,0.25);
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
    </style>
  </head>
  <body>
    <div class="container">
      ${getHeaderSection(serviceName)}
      <div class="content">
        ${getSection(
          'Se connecter au serveur multimédia',
          `<ul>
            <li><b>Sur ordinateur :</b> Naviguez directement vers l'URL du serveur.</li>
            <li><b>Sur télévision, tablette, smartphone… :</b> Téléchargez l'application Jellyfin sur le store de votre appareil. Au lancement, renseignez l'adresse du serveur.</li>
          </ul>
          <div class="preview-gallery">
            <img src="/assets/jellyfin-server-page.jpg" alt="Page serveur Jellyfin" class="preview-thumb" onclick="showPreview('/assets/jellyfin-server-page.jpg')">
            <img src="/assets/jellyfin-login-page.png" alt="Page login Jellyfin" class="preview-thumb" onclick="showPreview('/assets/jellyfin-login-page.png')">
          </div>`,
        )}
        ${getSection(
          'Demander un nouveau contenu',
          `<p>Il manque un film ou une série que vous aimeriez regarder ? Faites-en la demande facilement :</p>
          <ol>
              <li>Créez un compte sur la plateforme <a href="https://trakt.tv" target="_blank" rel="noopener noreferrer">Trakt</a></li>
              <li>Utilisez le lien disponnible dans votre email d'inscription pour connecter votre compte à ${serviceName} <span title="Si vous n'avez plus accès à cet email, contactez un administrateur">ℹ️</span></li>
              <li>Ajoutez simplement les films ou séries souhaités à votre liste "Watchlist" sur Trakt</li>
          </ol>
          <p>Vous serez notifié par email lorsque vos contenus demandés seront disponibles sur la plateforme !</p>
        `,
        )}
        ${getSection(
          'Ajouter un film à ma liste de souhaits',
          `<ul>
            <li>Parcourez le catalogue Trakt.</li>
            <li>Cliquez sur l'icône bleue <b>Watchlist</b> ou, dans le détail du média, sur le bouton <b>"Add to watch list"</b>.</li>
            <li>Pour annuler, cliquez à nouveau sur ce bouton.</li>
          </ul>
          <div class="preview-gallery">
            <img src="/assets/trakt-anticipated-page.png" alt="Page anticipated Trakt" class="preview-thumb" onclick="showPreview('/assets/trakt-anticipated-page.png')">
            <img src="/assets/trakt-movie-detail-page.png" alt="Page détail film Trakt" class="preview-thumb" onclick="showPreview('/assets/trakt-movie-detail-page.png')">
          </div>`,
        )}
        ${getSection(
          'Quand mes demandes seront-elles disponibles ?',
          `<ul>
            <li>La synchronisation des requêtes a lieu toutes les 10 minutes.</li>
            <li>Les mise à disposition de contenu sont effectuées manuellement. Les administrateurs font le nécessaire pour vous satisfaire dans les plus brefs délais.</li>
            <li>Une fois disponible, vous recevrez immédiatement un email d'information.</li>
          </ul>`,
        )}
        ${getSection(
          'Quels contenus sont synchronisés ?',
          `<ul>
            <li><b>${serviceName}</b> prend en compte tous les éléments de votre <b>watchlist</b>, les <b>séries en cours</b> de visionnage, et les contenus <b>notés 10</b>/10.</li>
            <li>Si une nouvelle saison est disponible pour une série déjà regardée, elle sera automatiquement ajoutée à vos requêtes. Pas besoin de l'ajouter à votre watchlist.</li>
          </ul>`,
        )}
      </div>
    </div>
    <div id="modalPreview" class="modal-preview" onclick="hidePreview()">
      <span class="modal-close">&times;</span>
      <img class="modal-content" id="modalImg">
    </div>
    <script>
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
    </script>
  </body>
</html>
`;
}
