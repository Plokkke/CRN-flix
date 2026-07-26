import { escapeHtml, getWebTemplate } from './email-styles';

export type AdminLoginStep = 'request' | 'code';

export interface AdminLoginParams {
  serviceName: string;
  step: AdminLoginStep;
  message?: string;
}

const REQUEST_SECTION = `
  <div class="info-box">
    <h2>Accès administrateur</h2>
    <p>Un code à 6 chiffres va vous être envoyé en message privé sur Discord.</p>
  </div>
  <form method="POST" action="/admin/login/request">
    <button type="submit">Recevoir un code</button>
  </form>
`;

const CODE_SECTION = `
  <div class="info-box">
    <h2>Saisir le code</h2>
    <p>Entrez le code reçu en message privé sur Discord. Il expire dans 10 minutes.</p>
  </div>
  <form method="POST" action="/admin/login/verify">
    <div class="form-group">
      <label for="code">Code:</label>
      <input type="text" id="code" name="code" inputmode="numeric" autocomplete="one-time-code"
             pattern="[0-9]{6}" maxlength="6" required placeholder="123456" autofocus>
    </div>
    <button type="submit">Se connecter</button>
  </form>
  <form method="POST" action="/admin/login/request">
    <button type="submit" class="secondary">Renvoyer un code</button>
  </form>
`;

const ADDITIONAL_CSS = `
  form + form {
    margin-top: 12px;
  }
  button.secondary {
    background-color: transparent;
    color: #1e90ff;
    border: 1px solid #1e90ff;
  }
  button.secondary:hover {
    background-color: #f0f7ff;
  }
  #code {
    letter-spacing: 8px;
    text-align: center;
    font-size: 24px;
  }
  .flash {
    background-color: #fff8e1;
    border-left: 4px solid #f5a623;
    padding: 12px 16px;
    border-radius: 5px;
    margin-bottom: 20px;
  }
`;

export const adminLoginTemplate = ({ serviceName, step, message }: AdminLoginParams): string => {
  const content = `
    ${message ? `<div class="flash">${escapeHtml(message)}</div>` : ''}
    ${step === 'code' ? CODE_SECTION : REQUEST_SECTION}
  `;

  return getWebTemplate(`Connexion — ${serviceName}`, serviceName, content, ADDITIONAL_CSS);
};
