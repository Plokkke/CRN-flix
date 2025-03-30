import { JellyfinUser } from '@/modules/jellyfin/jellyfin';

import { COMMON_CSS } from './styles';

export const registeredTemplate = (jellyfinUser: JellyfinUser): { html: string; text: string } => {
  const html = `
  <!DOCTYPE html>
  <html>
    <head>
      <style>${COMMON_CSS}</style>
    </head>
    <body>
      <div class="container">
        <h1>✅ Inscription Complétée avec Succès!</h1>
        <p>Votre compte a été créé et vous pouvez maintenant accéder à <a href="https://jellyfin.crn-tech.fr">CRN-Flix</a>.</p>
        <div class="credentials">
          <h2>Identifiants Jellyfin</h2>
          <p><strong>Nom d'utilisateur:</strong> ${jellyfinUser.name}</p>
          <p><strong>Mot de passe:</strong> ${jellyfinUser.password}</p>
        </div>
        <div class="footer">
          <p>Merci de rejoindre notre communauté!</p>
        </div>
      </div>
    </body>
  </html>
  `;

  const text = `
✅ Inscription Complétée avec Succès!

Votre compte a été créé et vous pouvez maintenant accéder à CRN-Flix (https://jellyfin.crn-tech.fr).

Identifiants Jellyfin:
Nom d'utilisateur: ${jellyfinUser.name}
Mot de passe: ${jellyfinUser.password}

Merci de rejoindre notre communauté!
  `;

  return { html, text };
};
