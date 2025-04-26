import { COMMON_CSS, getHeaderSection } from './styles';

export interface RegistrationFormParams {
  serviceName: string;
  formAction: string;
}

const getFormSection = (formAction: string) => `
  <form method="POST" action="${formAction}">
    <div class="form-group">
      <label for="username">
        <span class="slot-label-container">
          <span id="slot-label-list">
            <span>Pseudo:</span>
            <span>Prénom:</span>
            <span>Identifiant:</span>
          </span>
        </span>
      </label>
      <input type="text" id="username" name="username" required placeholder="TheBossDu59">
    </div>
    <div class="form-group">
      <label for="email">Email:</label>
      <input type="email" id="email" name="email" required placeholder="thebossdu59@wanadoo.fr">
    </div>
    <button type="submit">S'inscrire</button>
  </form>
`;

export const registrationFormTemplate = (params: RegistrationFormParams): string => {
  const { serviceName, formAction } = params;
  
  return `
<!DOCTYPE html>
<html>
  <head>
    <title>Inscription - ${serviceName}</title>
    <style>
      ${COMMON_CSS}
      .slot-label-container {
        display: inline-block;
        height: 22px;
        overflow: hidden;
        vertical-align: bottom;
        width: 90px;
        position: relative;
      }
      #slot-label-list {
        display: flex;
        flex-direction: column;
        transition: transform 0.4s cubic-bezier(.68,-0.55,.27,1.55);
      }
      #slot-label-list span {
        height: 22px;
        display: block;
        font-size: 16px;
      }
    </style>
  </head>
  <body>
    <div class="container">
      ${getHeaderSection(serviceName)}
      <div class="content">
        <div class="section-info">
          <h2>Bienvenue sur ${serviceName} !</h2>
          <p>Pour accéder à notre plateforme de streaming, veuillez renseigner votre pseudo et votre adresse email.</p>
          <p>Votre inscription sera validée par un administrateur, et vous recevrez par email toutes les informations nécessaires pour commencer à profiter de notre catalogue de médias.</p>
        </div>
        ${getFormSection(formAction)}
      </div>
    </div>
    <script>
      ${`
        const slotWords = ['Pseudo:', 'Prénom:', 'Identifiant:'];
        let slotIndex = 0;
        const slotList = document.getElementById('slot-label-list');
        
        if (slotList) {
          setInterval(() => {
            slotIndex = (slotIndex + 1) % slotWords.length;
            slotList.style.transform = \`translateY(-\${slotIndex * 22}px)\`;
          }, 1500);
        }
      `}
    </script>
  </body>
</html>
`;
}; 