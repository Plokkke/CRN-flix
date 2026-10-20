import { LoginStep, otpLoginTemplate } from './otp-login';

export interface UserLoginParams {
  serviceName: string;
  step: LoginStep;
  message?: string;
  basePath: string;
  expiresInMinutes: number;
}

export const userLoginTemplate = ({ basePath, expiresInMinutes, ...params }: UserLoginParams): string =>
  otpLoginTemplate({
    ...params,
    title: 'Mon espace',
    requestHint:
      'Indiquez votre pseudo : un code et un lien de connexion vous seront envoyés par email ou en message privé Discord, selon votre inscription.',
    codeHint: `Entrez le code reçu, ou cliquez sur le lien du message. Il expire dans ${expiresInMinutes} minutes.`,
    requestAction: `${basePath}/login/request`,
    verifyAction: `${basePath}/login/verify`,
    restartPath: `${basePath}/login`,
    identifier: { name: 'username', label: 'Pseudo :', placeholder: 'Votre pseudo' },
  });
