import { DownloadJobStatus } from '@/services/database/download-jobs';
import { PlannedDownloadStatus } from '@/services/database/planned-downloads';
import {
  downloadActionResolution,
  identificationFailureResolved,
  isIdentificationError,
} from '@/services/tickets/auto-resolve';

describe('downloadActionResolution', () => {
  it('keeps live actions open', () => {
    expect(downloadActionResolution(PlannedDownloadStatus.Proposed, []).close).toBe(false);
    expect(downloadActionResolution(PlannedDownloadStatus.Downloading, ['missing']).close).toBe(false);
  });

  it('closes done and superseded actions', () => {
    expect(downloadActionResolution(PlannedDownloadStatus.Done, ['fulfilled'])).toEqual({
      close: true,
      resolution: 'Téléchargement abouti',
    });
    expect(downloadActionResolution(PlannedDownloadStatus.Superseded, ['missing']).close).toBe(true);
  });

  it('closes an expired action whose coverage moved on', () => {
    expect(downloadActionResolution(PlannedDownloadStatus.Expired, ['fulfilled', 'fulfilled']).close).toBe(true);
    expect(downloadActionResolution(PlannedDownloadStatus.Expired, []).close).toBe(true);
  });

  it('keeps an expired action open when every covered request is rejected (restore lever)', () => {
    expect(downloadActionResolution(PlannedDownloadStatus.Expired, ['rejected', 'rejected']).close).toBe(false);
    expect(downloadActionResolution(PlannedDownloadStatus.Expired, ['rejected', 'fulfilled']).close).toBe(true);
  });
});

describe('identificationFailureResolved', () => {
  it('resolves only on completion', () => {
    expect(identificationFailureResolved(DownloadJobStatus.Completed)).toBe(true);
    expect(identificationFailureResolved(DownloadJobStatus.Failed)).toBe(false);
    expect(identificationFailureResolved(DownloadJobStatus.Identifying)).toBe(false);
  });
});

describe('isIdentificationError', () => {
  it('recognizes the two identification failure shapes', () => {
    expect(isIdentificationError('Identification failed for file.mkv')).toBe(true);
    expect(isIdentificationError('Cannot identify file.mkv with IMDb ID tt1')).toBe(true);
  });

  it('treats anything else as a pipeline failure', () => {
    expect(isIdentificationError('No video files found in /downloads/x')).toBe(false);
    expect(isIdentificationError('ENOSPC: no space left on device')).toBe(false);
  });
});
