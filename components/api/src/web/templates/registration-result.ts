import { escapeHtml, getInfoBox, getWebTemplate } from '@crn-flix/design-system';

export type RegistrationOutcome = { succeeded: true } | { succeeded: false; reason: string };

export interface RegistrationResultParams {
  serviceName: string;
  formUrl: string;
  outcome: RegistrationOutcome;
}

const successContent = (serviceName: string): string =>
  getInfoBox(
    `<h2>Demande envoyée ✅</h2>
     <p>Merci ! Votre demande d'inscription à ${escapeHtml(serviceName)} a bien été transmise.</p>
     <p>Un administrateur va la valider. Vous recevrez ensuite par email vos identifiants et tout ce qu'il faut pour commencer.</p>`,
    'success',
  );

const failureContent = (reason: string, formUrl: string): string =>
  getInfoBox(
    `<h2>Inscription impossible ❌</h2>
     <p>${escapeHtml(reason)}</p>
     <p><a href="${formUrl}">Revenir au formulaire</a></p>`,
    'warning',
  );

export const registrationResultTemplate = ({ serviceName, formUrl, outcome }: RegistrationResultParams): string =>
  getWebTemplate(
    `Inscription - ${serviceName}`,
    serviceName,
    outcome.succeeded ? successContent(serviceName) : failureContent(outcome.reason, formUrl),
  );
