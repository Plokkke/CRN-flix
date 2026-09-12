import { DownloadJobEntity, DownloadJobStatus } from '@/services/database/download-jobs';
import { PlannedDownloadEntity, PlannedDownloadStatus } from '@/services/database/planned-downloads';
import { LiveDownload } from '@/services/download-live-state';
import { CANDIDATE_ID_PARAM, IMDB_ID_PARAM } from '@/services/indexer-link';
import { PLANNED_DOWNLOAD_ID_METADATA_KEY, REQUEST_ID_METADATA_KEY } from '@/services/planner/planner';

/** Where a download stands, from proposal to the library. */
export type ExecutionPhase = 'proposed' | 'downloading' | 'extracting' | 'failed';

export type ExecutionView = {
  phase: ExecutionPhase;
  progress: number | null;
  speed: number | null;
  eta: number | null;
  fileName: string | null;
  error: string | null;
};

export const PHASE_LABELS: Record<ExecutionPhase, string> = {
  proposed: 'Planifié',
  downloading: 'Téléchargement',
  extracting: 'Extraction',
  failed: 'Échec',
};

type Metadata = Record<string, string> | null | undefined;

/** Fetchr echoes the engine metadata on downloads and post-download jobs alike. */
const actionIdOf = (metadata: Metadata): string | null =>
  metadata?.[PLANNED_DOWNLOAD_ID_METADATA_KEY] ?? metadata?.[REQUEST_ID_METADATA_KEY] ?? null;

export const downloadActionId = (download: LiveDownload): string | null => actionIdOf(download.metadata);
export const jobActionId = (job: DownloadJobEntity): string | null => actionIdOf(job.metadata);
export const downloadCandidateId = (download: LiveDownload): string | null =>
  download.metadata?.[CANDIDATE_ID_PARAM] ?? null;
export const jobCandidateId = (job: DownloadJobEntity): string | null => job.metadata?.[CANDIDATE_ID_PARAM] ?? null;
export const downloadImdbId = (download: LiveDownload): string | null => download.metadata?.[IMDB_ID_PARAM] ?? null;
export const jobImdbId = (job: DownloadJobEntity): string | null => job.metadata?.[IMDB_ID_PARAM] ?? null;

export const isFailedDownload = (download: LiveDownload): boolean =>
  download.error !== null || download.status === 'failed' || download.status === 'error';

/** Track keys the dashboards poll: an action, or a release launched by hand. */
export const actionTrack = (actionId: string): string => `action:${actionId}`;
export const candidateTrack = (candidateId: string): string => `candidate:${candidateId}`;

export function executionOf(
  status: PlannedDownloadStatus | null,
  download: LiveDownload | null,
  job: DownloadJobEntity | null,
): ExecutionView {
  const base = { progress: null, speed: null, eta: null, fileName: null, error: null };
  if (job && job.status === DownloadJobStatus.Failed) {
    return { ...base, phase: 'failed', fileName: job.packageName, error: job.errorMessage };
  }
  if (job) {
    return { ...base, phase: 'extracting', fileName: job.packageName, progress: 100 };
  }
  if (download) {
    return {
      phase: isFailedDownload(download) ? 'failed' : download.completedAt ? 'extracting' : 'downloading',
      progress: download.progress,
      speed: download.speed,
      eta: download.eta,
      fileName: download.fileName,
      error: download.error,
    };
  }
  return { ...base, phase: status === PlannedDownloadStatus.Downloading ? 'downloading' : 'proposed' };
}

const indexBy = <T>(items: T[], keyOf: (item: T) => string | null): Map<string, T> =>
  new Map(items.flatMap((item) => (keyOf(item) ? [[keyOf(item)!, item] as const] : [])));

/** Execution of every live action and every hand-launched release, keyed by track. */
export function executionByTrack(
  actions: PlannedDownloadEntity[],
  downloads: LiveDownload[],
  jobs: DownloadJobEntity[],
): Record<string, ExecutionView> {
  const downloadByAction = indexBy(downloads, downloadActionId);
  const jobByAction = indexBy(jobs, jobActionId);
  const downloadByCandidate = indexBy(downloads, downloadCandidateId);
  const jobByCandidate = indexBy(jobs, jobCandidateId);

  const entries: [string, ExecutionView][] = actions.map((action) => [
    actionTrack(action.id),
    executionOf(action.status, downloadByAction.get(action.id) ?? null, jobByAction.get(action.id) ?? null),
  ]);
  for (const candidate of new Set([...downloadByCandidate.keys(), ...jobByCandidate.keys()])) {
    entries.push([
      candidateTrack(candidate),
      executionOf(null, downloadByCandidate.get(candidate) ?? null, jobByCandidate.get(candidate) ?? null),
    ]);
  }
  return Object.fromEntries(entries);
}
