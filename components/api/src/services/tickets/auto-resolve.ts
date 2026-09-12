import { DownloadJobStatus } from '@/services/database/download-jobs';
import { PlannedDownloadStatus } from '@/services/database/planned-downloads';

export type ActionResolution = { close: boolean; resolution?: string };

/**
 * A download-action ticket mirrors its planned_download lifecycle.
 * Exception: an expired action whose covered requests were ALL rejected stays open so the
 * admin keeps the Restore lever.
 */
export function downloadActionResolution(status: PlannedDownloadStatus, coveredStatuses: string[]): ActionResolution {
  switch (status) {
    case PlannedDownloadStatus.Done:
      return { close: true, resolution: 'Téléchargement abouti' };
    case PlannedDownloadStatus.Superseded:
      return { close: true, resolution: 'Remplacée par le planner' };
    case PlannedDownloadStatus.Expired: {
      const allRejected = coveredStatuses.length > 0 && coveredStatuses.every((s) => s === 'rejected');
      return allRejected ? { close: false } : { close: true, resolution: 'Expirée — plus rien à couvrir' };
    }
    case PlannedDownloadStatus.Proposed:
    case PlannedDownloadStatus.Downloading:
      return { close: false };
  }
}

export function identificationFailureResolved(jobStatus: DownloadJobStatus): boolean {
  return jobStatus === DownloadJobStatus.Completed;
}

/** Failures the admin can fix with an IMDb id; anything else is a dead-letter pipeline failure. */
export function isIdentificationError(errorMessage: string): boolean {
  return errorMessage.includes('Identification failed') || errorMessage.includes('Cannot identify');
}
