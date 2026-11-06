import * as _ from 'lodash';

import { PlanLabel } from '@crn-flix/planner';

import { formatBytes } from '@/helpers/format';
import { displayTitle, MediaEntity } from '@/services/database/medias';
import { PlannedDownloadEntity } from '@/services/database/planned-downloads';
import { UserEntity } from '@/services/database/users';
import { actionDisplayLink } from '@/services/indexer-link';
import {
  OPERATIONS_BY_CATEGORY,
  TicketCategory,
  TicketEntity,
  IdentitySubmitted,
  TicketPayloadMap,
  TicketStatus,
  TicketTone,
  TicketView,
} from '@/services/tickets/model';

/** Subject rows loaded by the adapters; absent when the subject was deleted meanwhile. */
export type TicketContext = {
  action?: PlannedDownloadEntity | null;
  user?: UserEntity | null;
};

const LABEL_NAMES: Record<PlanLabel, string> = {
  [PlanLabel.Starved]: '🔴 starved',
  [PlanLabel.Needed]: '🟠 needed',
  [PlanLabel.Deferred]: '⚪ deferred',
};

const LABEL_TONES: Record<PlanLabel, TicketTone> = {
  [PlanLabel.Starved]: 'danger',
  [PlanLabel.Needed]: 'warning',
  [PlanLabel.Deferred]: 'muted',
};

/** "S1E1-E8, S2E1" — consecutive episodes collapsed per season. */
export function formatCoveredEpisodes(medias: MediaEntity[]): string {
  const episodes = medias
    .filter((m) => m.seasonNumber !== null && m.episodeNumber !== null)
    .sort((a, b) => a.seasonNumber! - b.seasonNumber! || a.episodeNumber! - b.episodeNumber!);

  const ranges: string[] = [];
  let start: MediaEntity | null = null;
  let previous: MediaEntity | null = null;

  const flush = (): void => {
    if (!start || !previous) {
      return;
    }
    const base = `S${start.seasonNumber}E${start.episodeNumber}`;
    ranges.push(previous === start ? base : `${base}-E${previous.episodeNumber}`);
  };

  for (const episode of episodes) {
    const consecutive =
      previous &&
      episode.seasonNumber === previous.seasonNumber &&
      episode.episodeNumber === previous.episodeNumber! + 1;
    if (!consecutive) {
      flush();
      start = episode;
    }
    previous = episode;
  }
  flush();

  return ranges.join(', ');
}

export function actionTitle(action: PlannedDownloadEntity): string {
  const media = action.medias?.[0];
  const showTitle = (media && displayTitle(media)) ?? action.showImdbId ?? 'Inconnu';
  switch (action.scope.kind) {
    case 'movie':
      return `${showTitle}${media?.year ? ` (${media.year})` : ''} — film`;
    case 'episode':
      return `${showTitle} S${action.scope.season}E${action.scope.episode}`;
    case 'season':
      return `${showTitle} — pack S${action.scope.season}`;
    case 'series':
      return `${showTitle} — pack série`;
  }
}

export function isFullyRejected(action: PlannedDownloadEntity): boolean {
  return action.coveredStatuses.length > 0 && action.coveredStatuses.every((status) => status === 'rejected');
}

function describeAlternative(alternative: PlannedDownloadEntity['alternatives'][number]): string {
  const scope =
    alternative.scope.kind === 'season'
      ? `pack S${alternative.scope.season}`
      : alternative.scope.kind === 'series'
        ? 'pack série'
        : alternative.scope.kind === 'episode'
          ? `S${alternative.scope.season}E${alternative.scope.episode}`
          : 'film';
  const size = formatBytes(alternative.sizeBytes);
  return `${scope} — ${alternative.quality}/${alternative.language}${size ? ` — ${size}` : ''}`;
}

function closedView(ticket: TicketEntity): TicketView {
  return {
    title: ticket.title,
    tone: ticket.status === TicketStatus.Resolved ? 'success' : 'muted',
    fields: ticket.resolution ? [{ name: 'Résolution', value: ticket.resolution }] : [],
    footer: null,
    operations: [],
  };
}

function downloadActionView(ticket: TicketEntity, action: PlannedDownloadEntity): TicketView {
  const rejected = isFullyRejected(action);
  const fields: TicketView['fields'] = [
    { name: 'Priorité', value: LABEL_NAMES[action.label] },
    { name: 'Qualité', value: `${action.quality} · ${action.language}` },
  ];

  const size = formatBytes(action.sizeBytes);
  if (size) {
    fields.push({ name: 'Taille', value: size });
  }
  if (action.scope.kind !== 'movie') {
    const covered = formatCoveredEpisodes(action.medias ?? []);
    if (covered) {
      fields.push({ name: 'Épisodes manquants couverts', value: covered.slice(0, 1024) });
    }
  }
  if (action.userNames?.length) {
    fields.push({ name: 'Users', value: action.userNames.join(', ').slice(0, 1024) });
  }
  const imdbId = action.showImdbId ?? action.medias?.[0]?.imdbId;
  if (imdbId) {
    fields.push({ name: 'IMDb', value: imdbId });
  }
  fields.push({ name: 'Lien', value: `[Telecharger](${actionDisplayLink(action)})` });
  if (action.alternatives.length > 0) {
    fields.push({
      name: 'Ou sinon',
      value: action.alternatives
        .map((alt) => `• ${describeAlternative(alt)}`)
        .join('\n')
        .slice(0, 1024),
    });
  }

  const operations = OPERATIONS_BY_CATEGORY[TicketCategory.DownloadAction].filter((op) =>
    rejected ? op !== 'reject' : op !== 'restore',
  );

  return {
    title: actionTitle(action),
    tone: rejected ? 'danger' : LABEL_TONES[action.label],
    fields,
    footer: 'Repondre avec une URL pour lancer un telechargement manuel',
    operations,
  };
}

function userApprovalView(ticket: TicketEntity, user: UserEntity | null | undefined): TicketView {
  return {
    title: ticket.title,
    tone: 'info',
    fields: user ? [{ name: _.capitalize(user.messagingKey), value: user.messagingId }] : [],
    footer: null,
    operations: OPERATIONS_BY_CATEGORY[TicketCategory.UserApproval],
  };
}

const IDENTITY_ANSWERS = "l'IMDb ID (tt…), l'URL IMDb et/ou l'URL de la fiche TMDB";

/** What the admin already gave: the next answer only has to complete it. */
function submittedFields(payload: IdentitySubmitted): TicketView['fields'] {
  const given = [payload.submitted?.imdbId, payload.submitted?.reference].filter(Boolean).join(' + ');
  return given ? [{ name: 'Déjà fourni', value: given }] : [];
}

function identificationFailureView(ticket: TicketEntity): TicketView {
  const payload = ticket.payload as TicketPayloadMap[TicketCategory.IdentificationFailure];
  return {
    title: ticket.title,
    tone: 'danger',
    fields: [
      { name: 'Package', value: payload.packageName.slice(0, 1024) },
      { name: 'Fichiers', value: payload.failedFiles.join('\n').slice(0, 1024) },
      { name: 'Erreur', value: payload.errorMessage.slice(0, 1024) },
      ...submittedFields(payload),
    ],
    footer: `Répondre avec ${IDENTITY_ANSWERS} pour relancer`,
    operations: OPERATIONS_BY_CATEGORY[TicketCategory.IdentificationFailure],
  };
}

function pipelineFailureView(ticket: TicketEntity): TicketView {
  const payload = ticket.payload as TicketPayloadMap[TicketCategory.PipelineFailure];
  return {
    title: ticket.title,
    tone: 'danger',
    fields: [
      { name: 'Fichiers', value: payload.fileNames.slice(0, 1024) },
      { name: 'Étape', value: payload.failedStep },
      { name: 'Erreur', value: payload.errorMessage.slice(0, 1024) },
    ],
    footer: 'Dead-letter — résolution manuelle uniquement',
    operations: OPERATIONS_BY_CATEGORY[TicketCategory.PipelineFailure],
  };
}

const DESTINATION_LABELS = {
  rules: 'Selon les règles (restreint → ma collection)',
  standard: 'Étagère standard',
  kids: 'Étagère enfants',
  personal: 'Ma collection',
};

function manualDownloadView(ticket: TicketEntity): TicketView {
  const payload = ticket.payload as TicketPayloadMap[TicketCategory.ManualDownload];
  const fields: TicketView['fields'] = [{ name: 'URL', value: payload.url.slice(0, 1024) }];
  if (payload.imdbId) {
    fields.push({ name: 'IMDb', value: payload.imdbId });
  }
  if (payload.lastError) {
    fields.push({ name: 'Erreur', value: payload.lastError.slice(0, 1024) });
  }
  fields.push({ name: 'Destination', value: DESTINATION_LABELS[payload.destination ?? 'rules'] });
  fields.push(...submittedFields(payload));
  return {
    title: ticket.title,
    tone: payload.lastError ? 'danger' : 'info',
    fields,
    footer: `Répondre avec ${IDENTITY_ANSWERS} pour forcer l'identification`,
    operations: OPERATIONS_BY_CATEGORY[TicketCategory.ManualDownload],
  };
}

function missingImdbView(ticket: TicketEntity): TicketView {
  const payload = ticket.payload as TicketPayloadMap[TicketCategory.MissingImdb];
  return {
    title: ticket.title,
    tone: 'warning',
    fields: [
      { name: 'Type', value: payload.kind === 'show' ? 'Série' : 'Film' },
      { name: 'Médias en attente', value: String(payload.mediaIds.length) },
      ...submittedFields(payload),
    ],
    footer: `Répondre avec ${IDENTITY_ANSWERS} pour débloquer la recherche`,
    operations: OPERATIONS_BY_CATEGORY[TicketCategory.MissingImdb],
  };
}

function integrationFailureView(ticket: TicketEntity): TicketView {
  const payload = ticket.payload as TicketPayloadMap[TicketCategory.IntegrationFailure];
  return {
    title: ticket.title,
    tone: 'danger',
    fields: [
      { name: 'Intégration', value: payload.integration },
      { name: 'Appel', value: payload.operation },
      { name: 'Erreur', value: payload.errorMessage.slice(0, 1024) },
      { name: 'Depuis', value: payload.firstSeenAt },
    ],
    footer: "L'API a changé : adapter le plugin. Se résout seul après une heure d'appels réussis",
    operations: OPERATIONS_BY_CATEGORY[TicketCategory.IntegrationFailure],
  };
}

const APPEAL_KINDS = { contest: 'Contestation (la règle s’applique à tort)', exemption: 'Demande de dérogation' };

function policyAppealView(ticket: TicketEntity): TicketView {
  const payload = ticket.payload as TicketPayloadMap[TicketCategory.PolicyAppeal];
  return {
    title: ticket.title,
    tone: 'warning',
    fields: [
      { name: 'Abonné', value: payload.userName },
      { name: 'Titre', value: `${payload.title} (${payload.imdbId})` },
      { name: 'Démarche', value: APPEAL_KINDS[payload.kind] },
      { name: 'Motivation', value: payload.motivation.slice(0, 1024) },
      ...payload.refusals.map((refusal) => ({
        name: `Refus : ${refusal.ruleName}`,
        value: refusal.summary.slice(0, 1024),
      })),
    ],
    footer:
      'Accorder = sa collection personnelle seulement · Exclure = la règle ne vise plus ce titre, pour tous · Répondre dans le fil',
    operations: OPERATIONS_BY_CATEGORY[TicketCategory.PolicyAppeal],
  };
}

export function buildTicketView(ticket: TicketEntity, context: TicketContext = {}): TicketView {
  if (ticket.status !== TicketStatus.Open) {
    return closedView(ticket);
  }

  switch (ticket.category) {
    case TicketCategory.DownloadAction:
      return context.action ? downloadActionView(ticket, context.action) : closedView(ticket);
    case TicketCategory.UserApproval:
      return userApprovalView(ticket, context.user);
    case TicketCategory.IdentificationFailure:
      return identificationFailureView(ticket);
    case TicketCategory.PipelineFailure:
      return pipelineFailureView(ticket);
    case TicketCategory.ManualDownload:
      return manualDownloadView(ticket);
    case TicketCategory.MissingImdb:
      return missingImdbView(ticket);
    case TicketCategory.PolicyAppeal:
      return policyAppealView(ticket);
    case TicketCategory.IntegrationFailure:
      return integrationFailureView(ticket);
  }
}

/** Human labels used by both adapters when rendering operation controls. */
export { OPERATION_LABELS } from '@crn-flix/contracts';
