import { ServiceIdentity } from '@crn-flix/contracts';

import { ServiceNotice } from '@/services/messaging/user';

export const NOTICE_PRESETS = ['outage', 'restored', 'user-space'] as const;
export type NoticePreset = (typeof NOTICE_PRESETS)[number];

export const isNoticePreset = (value: unknown): value is NoticePreset => NOTICE_PRESETS.includes(value as NoticePreset);

export const PRESET_LABELS: Record<NoticePreset, string> = {
  outage: 'Interruption de service',
  restored: 'Remise en service',
  'user-space': 'Nouveau : votre espace',
};

const builders: Record<NoticePreset, (ctx: ServiceIdentity) => ServiceNotice> = {
  outage: ({ serviceName }) => ({
    subject: `${serviceName} : interruption de service`,
    title: 'Interruption de service en cours',
    tone: 'warning',
    paragraphs: [
      `Suite à un incident technique, le service ${serviceName} est actuellement indisponible. Le retour à la normale est prévu le lundi 14 septembre dans la soirée.`,
      'Nous vous informerons par ce même canal dès la remise en service.',
      "Aucune action n'est nécessaire de votre part : vos demandes en cours sont conservées et seront traitées dès la reprise.",
      'Merci de votre compréhension.',
    ],
  }),
  restored: ({ serviceName, playerUrl }) => ({
    subject: `${serviceName} : le service est de retour`,
    title: 'Le service est de nouveau disponible',
    tone: 'success',
    paragraphs: [
      `L'incident technique est résolu : ${serviceName} est de nouveau accessible.`,
      'Vos demandes en cours ont été conservées et les téléchargements reprennent normalement. Si certains contenus tardent à apparaître, un peu de patience : le rattrapage est en cours.',
      'Merci pour votre patience et votre compréhension.',
    ],
    cta: { label: `Accéder à ${serviceName}`, url: playerUrl },
  }),
  'user-space': ({ serviceName, userSpaceUrl }) => ({
    subject: `${serviceName} : suivez vos demandes depuis votre espace`,
    title: 'Nouveau : votre espace pour suivre vos demandes',
    tone: 'info',
    paragraphs: [
      `Vous pouvez désormais suivre toutes vos demandes ${serviceName} depuis votre espace personnel : ce qui est en attente, ce qui est déjà disponible, ce qui a été refusé, et la progression des téléchargements en cours.`,
      'Pour vous connecter, saisissez simplement votre pseudo : vous recevrez par email un code et un lien de connexion, sans mot de passe à retenir.',
      `Vos demandes se font toujours de la même manière, depuis votre watchlist Trakt. L'espace sert uniquement à suivre où elles en sont.`,
    ],
    cta: { label: 'Accéder à mon espace', url: userSpaceUrl },
  }),
};

export const buildPresetNotice = (preset: NoticePreset, ctx: ServiceIdentity): ServiceNotice => builders[preset](ctx);
