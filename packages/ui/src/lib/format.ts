/** "3m ago" style timestamps for the home page cards and the publish dialog. */
export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Stored sizes for the import report: "640 KB", "4.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 24-hour clock. */
export const hhmm = (minutes: number): string => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Where a download stands: the counts the loading screen and the download pill read. */
export interface LoadProgress {
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
}

/** 0..1 by bytes when the sizes are known, else by files; null while nothing is counted yet. */
export function progressFraction(p: LoadProgress | null | undefined): number | null {
  if (!p || p.filesTotal <= 0) return null;
  const f = p.bytesTotal > 0 ? p.bytesDone / p.bytesTotal : p.filesDone / p.filesTotal;
  return Math.min(1, Math.max(0, f));
}

/** "12 of 40 files · 3.1 MB of 7.8 MB". */
export function progressDetail(p: LoadProgress): string {
  const files = `${p.filesDone} of ${p.filesTotal} files`;
  return p.bytesTotal > 0 ? `${files} · ${formatBytes(p.bytesDone)} of ${formatBytes(p.bytesTotal)}` : files;
}
