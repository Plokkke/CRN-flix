import { LoginStep, otpLoginTemplate } from './otp-login';

export type AdminLoginStep = LoginStep;

export interface AdminLoginParams {
  serviceName: string;
  step: AdminLoginStep;
  message?: string;
}

export const adminLoginTemplate = (params: AdminLoginParams): string =>
  otpLoginTemplate({
    ...params,
    title: 'Accès administrateur',
    requestHint: 'Un code à 6 chiffres va vous être envoyé en message privé sur Discord.',
    codeHint: 'Entrez le code reçu en message privé sur Discord. Il expire dans 10 minutes.',
    requestAction: '/admin/login/request',
    verifyAction: '/admin/login/verify',
    restartPath: '/admin/login/request',
  });
