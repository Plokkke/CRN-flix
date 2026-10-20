/**
 * Correlation data attached to a download and echoed back on every event,
 * so the engine can tie a finished file to the request that triggered it.
 */
export type DownloadMetadata = Record<string, string>;

/** A download as the downloader reports it while it runs. */
export type LiveDownload = {
  id: string;
  status: string;
  fileName: string;
  filePaths: string[];
  size: number | null;
  downloaded: number;
  progress: number | null;
  speed: number;
  eta: number | null;
  error: string | null;
  source: string;
  metadata?: DownloadMetadata;
  downloadedAt: string | null;
  completedAt: string | null;
};

export type ResolvedSource = {
  fileName: string;
  size: number | null;
};

export type Unsubscribe = () => void;

/**
 * DRAFT — not wired yet. Fetches a source url into files on disk.
 * The downloader keeps no engine state: it reports completions, the engine persists them.
 */
export interface Downloader {
  readonly name: string;
  canHandle(url: string): Promise<boolean>;
  resolve(url: string): Promise<ResolvedSource>;
  /** Fire-and-forget: progress and completion arrive through the listeners. */
  download(url: string, metadata?: DownloadMetadata): void;
  cancel(downloadId: string): void;
  remove(downloadId: string): void;
  liveDownloads(): LiveDownload[];
  onLiveChanged(listener: () => void): Unsubscribe;
  onCompleted(listener: (download: LiveDownload) => void): Unsubscribe;
}
