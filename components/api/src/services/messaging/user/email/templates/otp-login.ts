import { escapeHtml, getWebTemplate } from './email-styles';

export type LoginStep = 'request' | 'code';

export type IdentifierField = { name: string; label: string; placeholder: string };

export interface OtpLoginParams {
  serviceName: string;
  step: LoginStep;
  message?: string;
  title: string;
  requestHint: string;
  codeHint: string;
  requestAction: string;
  verifyAction: string;
  /** Asked on the request step; the admin area has none (every admin gets a code). */
  identifier?: IdentifierField;
  /** Where "start over" goes on the code step: a POST action when no identifier is needed, else a link. */
  restartPath: string;
}

const ADDITIONAL_CSS = `
  form + form, form + p.restart {
    margin-top: 12px;
  }
  button.secondary, a.secondary {
    display: block;
    text-align: center;
    box-sizing: border-box;
    width: 100%;
    padding: 12px 24px;
    border-radius: 4px;
    font-weight: bold;
    font-size: 16px;
    text-decoration: none;
    background-color: transparent;
    color: #1e90ff;
    border: 1px solid #1e90ff;
  }
  button.secondary:hover, a.secondary:hover {
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

const identifierInput = (field: IdentifierField): string => `
  <div class="form-group">
    <label for="${field.name}">${escapeHtml(field.label)}</label>
    <input type="text" id="${field.name}" name="${field.name}" required autofocus
           autocomplete="username" placeholder="${escapeHtml(field.placeholder)}">
  </div>
`;

const requestSection = (p: OtpLoginParams): string => `
  <div class="info-box">
    <h2>${escapeHtml(p.title)}</h2>
    <p>${escapeHtml(p.requestHint)}</p>
  </div>
  <form method="POST" action="${p.requestAction}">
    ${p.identifier ? identifierInput(p.identifier) : ''}
    <button type="submit">Recevoir un code</button>
  </form>
`;

const restartControl = (p: OtpLoginParams): string =>
  p.identifier
    ? `<p class="restart"><a class="secondary" href="${p.restartPath}">Recommencer</a></p>`
    : `<form method="POST" action="${p.restartPath}"><button type="submit" class="secondary">Renvoyer un code</button></form>`;

const codeSection = (p: OtpLoginParams): string => `
  <div class="info-box">
    <h2>Saisir le code</h2>
    <p>${escapeHtml(p.codeHint)}</p>
  </div>
  <form method="POST" action="${p.verifyAction}">
    <div class="form-group">
      <label for="code">Code:</label>
      <input type="text" id="code" name="code" inputmode="numeric" autocomplete="one-time-code"
             pattern="[0-9]{6}" maxlength="6" required placeholder="123456" autofocus>
    </div>
    <button type="submit">Se connecter</button>
  </form>
  ${restartControl(p)}
`;

export const otpLoginTemplate = (p: OtpLoginParams): string => {
  const content = `
    ${p.message ? `<div class="flash">${escapeHtml(p.message)}</div>` : ''}
    ${p.step === 'code' ? codeSection(p) : requestSection(p)}
  `;

  return getWebTemplate(`Connexion — ${p.serviceName}`, p.serviceName, content, ADDITIONAL_CSS);
};
