/** "8.2 Go" / "650 Mo"; null when unknown. */
export function formatBytes(bytes: number | null): string | null {
  if (bytes === null) {
    return null;
  }
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} Go` : `${(bytes / 1024 ** 2).toFixed(0)} Mo`;
}

/** "il y a 3 h", "il y a 2 j"; null when unknown. */
export function formatAge(date: Date | null, now: Date = new Date()): string | null {
  if (!date) {
    return null;
  }
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 60) {
    return `il y a ${minutes} min`;
  }
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `il y a ${hours} h` : `il y a ${Math.round(hours / 24)} j`;
}
