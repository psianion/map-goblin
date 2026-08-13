import { cn } from '@/lib/utils';
import type { PackSummary, PackUpdateInfo, PackUpdateState } from '@/store/types';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface PackCardProps {
  pack: PackSummary;
  update?: PackUpdateInfo;
  /** In-flight or finished update for this pack. Undefined when another pack's is. */
  updateState?: PackUpdateState;
  onUninstall?: (packId: string) => void;
  onUpdate?: (packId: string) => void;
  onDismissResult?: () => void;
}

export function PackCard({
  pack,
  update,
  updateState,
  onUninstall,
  onUpdate,
  onDismissResult,
}: PackCardProps) {
  const isUpdating = updateState?.status === 'running';

  return (
    <div className="flex flex-col gap-1.5 rounded border border-border bg-muted/20 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-foreground truncate">{pack.name}</span>
            {pack.bundled && (
              <span className="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
                Built-in
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>v{pack.version}</span>
            <span>{formatBytes(pack.sizeBytes)}</span>
          </div>
        </div>
      </div>

      {update && !updateState && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-accent-active">
            v{update.currentVersion} → v{update.availableVersion}
          </span>
          {onUpdate && (
            <button
              onClick={() => onUpdate(pack.packId)}
              className={cn(
                'shrink-0 rounded px-2 py-0.5 text-[10px] font-medium',
                'bg-accent-active text-on-accent transition-colors duration-150',
                'hover:bg-accent-dim focus-visible:outline-none focus-visible:ring-1',
                'focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface-1',
              )}
            >
              Update
            </button>
          )}
        </div>
      )}

      {isUpdating && (
        // No percentage: updatePack resolves once, with no progress callback to read.
        // A fake bar would be a lie, and a spinner in a 20px row is noise — the button
        // going busy is the honest signal, and it also blocks a second click.
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">Downloading changed files…</span>
          <button
            disabled
            aria-busy="true"
            className={cn(
              'shrink-0 rounded px-2 py-0.5 text-[10px] font-medium',
              'bg-surface-3 text-muted-foreground cursor-default',
            )}
          >
            Updating…
          </button>
        </div>
      )}

      {updateState?.status === 'done' && (
        <div className="flex items-start justify-between gap-2" role="status" aria-live="polite">
          <span className="text-[10px] text-success">
            Updated to v{updateState.version}
            {updateState.changedFiles !== undefined && (
              <span className="text-muted-foreground">
                {' · '}
                {updateState.changedFiles} file{updateState.changedFiles === 1 ? '' : 's'},{' '}
                {formatBytes(updateState.downloadedBytes ?? 0)} downloaded
              </span>
            )}
          </span>
          {onDismissResult && (
            <button
              onClick={onDismissResult}
              aria-label="Dismiss update result"
              className={cn(
                'shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground',
                'transition-colors duration-150 hover:bg-surface-3 hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              )}
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {updateState?.status === 'error' && (
        <div className="flex items-start justify-between gap-2" role="alert">
          <span className="text-[10px] text-destructive">
            Update failed. {updateState.message ?? 'The pack source could not be reached.'}
          </span>
          {onUpdate && (
            <button
              onClick={() => onUpdate(pack.packId)}
              className={cn(
                'shrink-0 rounded px-2 py-0.5 text-[10px] font-medium',
                'bg-surface-3 text-foreground transition-colors duration-150',
                'hover:bg-surface-3/70 focus-visible:outline-none focus-visible:ring-1',
                'focus-visible:ring-ring',
              )}
            >
              Retry
            </button>
          )}
        </div>
      )}

      {!pack.bundled && onUninstall && (
        <button
          onClick={() => onUninstall(pack.packId)}
          disabled={isUpdating}
          className={cn(
            'self-start rounded px-2 py-0.5 text-[10px] font-medium transition-colors duration-150',
            'text-muted-foreground hover:bg-destructive/20 hover:text-destructive',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:pointer-events-none disabled:opacity-40',
          )}
        >
          Uninstall
        </button>
      )}
    </div>
  );
}
