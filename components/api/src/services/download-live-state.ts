/** A download as Fetchr describes it, in `download::list` snapshots and `download::registered`. */
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
  metadata?: Record<string, string>;
  downloadedAt: string | null;
  completedAt: string | null;
};

export type FetchrEvent = { topic: string; payload: unknown };

/**
 * Mirrors Fetchr's own view of the download set. `download::list` is the authoritative
 * snapshot replayed on every reconnect, which is why nothing here needs persisting.
 * Returns whether the state actually changed.
 */
export function applyFetchrEvent(live: Map<string, LiveDownload>, { topic, payload }: FetchrEvent): boolean {
  switch (topic) {
    case 'download::list':
      live.clear();
      for (const item of payload as LiveDownload[]) {
        live.set(item.id, item);
      }
      return true;

    case 'download::registered': {
      const item = payload as LiveDownload;
      live.set(item.id, item);
      return true;
    }

    case 'download::progress':
    case 'download::completed':
    case 'download::failed':
      return mergeDownload(live, payload as Partial<LiveDownload> & { id: string }, topic);

    case 'download::canceled':
    case 'download::removed':
      return live.delete((payload as { id: string }).id);

    default:
      return false;
  }
}

function mergeDownload(
  live: Map<string, LiveDownload>,
  payload: Partial<LiveDownload> & { id: string },
  topic: string,
): boolean {
  const previous = live.get(payload.id);
  if (!previous) {
    return false;
  }

  // `completed` and `failed` payloads carry no status field, unlike `progress`.
  const merged = { ...previous, ...payload };
  if (topic === 'download::completed') {
    merged.status = 'completed';
  } else if (topic === 'download::failed') {
    merged.status = 'failed';
  }

  live.set(payload.id, merged);
  return true;
}
