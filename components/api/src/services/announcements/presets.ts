import { ServiceNotice } from '@/services/messaging/user';

export const NOTICE_PRESETS = ['outage', 'restored'] as const;
export type NoticePreset = (typeof NOTICE_PRESETS)[number];

export const isNoticePreset = (value: unknown): value is NoticePreset => NOTICE_PRESETS.includes(value as NoticePreset);

export type PresetContext = { serviceName: string; mediaServerUrl: string };

export const PRESET_LABELS: Record<NoticePreset, string> = {
  outage: 'Interruption de service',
  restored: 'Remise en service',
};

const builders: Record<NoticePreset, (ctx: PresetContext) => ServiceNotice> = {
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
  restored: ({ serviceName, mediaServerUrl }) => ({
    subject: `${serviceName} : le service est de retour`,
    title: 'Le service est de nouveau disponible',
    tone: 'success',
    paragraphs: [
      `L'incident technique est résolu : ${serviceName} est de nouveau accessible.`,
      'Vos demandes en cours ont été conservées et les téléchargements reprennent normalement. Si certains contenus tardent à apparaître, un peu de patience : le rattrapage est en cours.',
      'Merci pour votre patience et votre compréhension.',
    ],
    cta: { label: `Accéder à ${serviceName}`, url: mediaServerUrl },
  }),
};

export const buildPresetNotice = (preset: NoticePreset, ctx: PresetContext): ServiceNotice => builders[preset](ctx);
