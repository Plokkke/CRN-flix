import { COMMON_CSS } from './styles';

export interface RegistrationFormParams {
  serviceName: string;
  formAction: string;
}

const getHeaderSection = (serviceName: string) => `
  <div class="header">
    <div class="logo">${serviceName}</div>
    <div class="welcome-message">
      <h2>Bienvenue sur ${serviceName} !</h2>
      <p>Pour accéder à notre plateforme de streaming, veuillez renseigner votre pseudo et votre adresse email.</p>
      <p>Votre inscription sera validée par un administrateur, et vous recevrez par email toutes les informations nécessaires pour commencer à profiter de notre catalogue de médias.</p>
    </div>
  </div>
`;

const getFormSection = (formAction: string) => `
  <form method="POST" action="${formAction}">
    <div class="form-group">
      <label for="username">Pseudo:</label>
      <input type="text" id="username" name="username" required placeholder="Votre pseudo">
    </div>
    <div class="form-group">
      <label for="email">Email:</label>
      <input type="email" id="email" name="email" required placeholder="Votre adresse email">
    </div>
    <button type="submit">S'inscrire</button>
  </form>
`;

const getFooterSection = (serviceName: string) => `
  <div class="footer">
    <p>${serviceName}</p>
  </div>
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
      .header {
        text-align: center;
        margin-bottom: 30px;
        padding-bottom: 20px;
        border-bottom: 1px solid #eee;
      }
      .logo {
        font-size: 28px;
        font-weight: bold;
        color: #2c3e50;
        margin-bottom: 20px;
      }
      .welcome-message {
        text-align: left;
        max-width: 500px;
        margin: 0 auto;
        padding: 15px;
        background-color: #f8f9fa;
        border-radius: 6px;
        border-left: 4px solid #3498db;
      }
      .welcome-message h2 {
        color: #2c3e50;
        font-size: 20px;
        margin-bottom: 15px;
      }
      .welcome-message p {
        color: #555;
        line-height: 1.6;
        margin-bottom: 10px;
      }
      .welcome-message p:last-child {
        margin-bottom: 0;
      }
      .form-group {
        margin-bottom: 20px;
        width: 100%;
      }
      label {
        display: block;
        margin-bottom: 8px;
        font-weight: 500;
        color: #2c3e50;
      }
      input {
        width: 100%;
        padding: 12px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 16px;
        transition: all 0.2s;
        box-sizing: border-box;
        display: block;
      }
      input:focus {
        outline: none;
        border-color: #3498db;
        box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.2);
      }
      button {
        background-color: #3498db;
        color: white;
        padding: 12px 24px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 16px;
        font-weight: 500;
        transition: background-color 0.2s;
        width: 100%;
      }
      button:hover {
        background-color: #2980b9;
      }
      .footer {
        margin-top: 30px;
        padding-top: 20px;
        border-top: 1px solid #eee;
        text-align: center;
        font-size: 14px;
        color: #666;
      }
    </style>
  </head>
  <body>
    <div class="container">
      ${getHeaderSection(serviceName)}
      ${getFormSection(formAction)}
      ${getFooterSection(serviceName)}
    </div>
  </body>
</html>
`;
}; 