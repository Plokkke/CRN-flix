import { LiveDownload } from '@/services/download-live-state';

const BAR_SLOTS = 12;
const BYTE_UNITS = ['o', 'Ko', 'Mo', 'Go', 'To'];

/** Order Fetchr reports downloads in is arbitrary; surface what is moving first. */
const STATUS_ORDER: Record<string, number> = {
  downloading: 0,
  extracting: 1,
  resolving: 2,
  queued: 3,
  suspended: 4,
  failed: 5,
  completed: 6,
};

const STATUS_LABELS: Record<string, string> = {
  queued: '⏳ En attente',
  resolving: '🔍 Résolution',
  suspended: '⏸️ En pause',
  extracting: '📦 Extraction',
};

export function formatBytes(bytes: number | null): string {
  if (bytes === null) {
    return '?';
  }

  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const decimals = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(decimals).replace('.', ',')} ${BYTE_UNITS[unit]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || seconds <= 0) {
    return '—';
  }
  if (seconds < 60) {
    return `${seconds} s`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

export function progressBar(ratio: number | null): string {
  const clamped = ratio === null ? 0 : Math.min(1, Math.max(0, ratio));
  const filled = Math.round(clamped * BAR_SLOTS);
  return `${'▰'.repeat(filled)}${'▱'.repeat(BAR_SLOTS - filled)}`;
}

/** Prefers the media identity carried in the download metadata over the raw archive name. */
export function downloadLabel({ fileName, metadata }: LiveDownload): string {
  if (!metadata?.title) {
    return fileName;
  }

  const year = metadata.year ? ` (${metadata.year})` : '';
  const episode =
    metadata.season && metadata.episode
      ? ` — S${metadata.season.padStart(2, '0')}E${metadata.episode.padStart(2, '0')}`
      : '';
  return `${metadata.title}${year}${episode}`;
}

export function downloadStatusLine(download: LiveDownload): string {
  if (download.status === 'failed') {
    return `❌ Échec — ${download.error ?? 'erreur inconnue'}`;
  }
  if (download.status === 'completed') {
    return `✅ Terminé — ${formatBytes(download.size)}`;
  }
  if (download.status !== 'downloading') {
    return STATUS_LABELS[download.status] ?? download.status;
  }

  const percent = download.progress === null ? '—' : `${Math.round(download.progress * 100)} %`;
  const volume = `${formatBytes(download.downloaded)} / ${formatBytes(download.size)}`;
  return `${progressBar(download.progress)} ${percent}\n${volume} · ${formatSpeed(download.speed)} · ~${formatEta(download.eta)}`;
}

export function sortForDisplay(downloads: LiveDownload[]): LiveDownload[] {
  return [...downloads].sort((left, right) => {
    const byStatus = (STATUS_ORDER[left.status] ?? 9) - (STATUS_ORDER[right.status] ?? 9);
    return byStatus !== 0 ? byStatus : downloadLabel(left).localeCompare(downloadLabel(right));
  });
}

export function countActive(downloads: LiveDownload[]): number {
  return downloads.filter(({ status }) => status !== 'completed' && status !== 'failed').length;
}
