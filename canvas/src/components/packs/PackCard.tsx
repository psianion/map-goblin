import { cn } from '@/lib/utils';
import type { PackSummary, PackUpdateInfo } from '@/store/types';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface PackCardProps {
  pack: PackSummary;
  update?: PackUpdateInfo;
  onUninstall?: (packId: string) => void;
  onUpdate?: (packId: string) => void;
}

export function PackCard({ pack, update, onUninstall, onUpdate }: PackCardProps) {
  return (
    <div className="flex flex-col gap-1.5 rounded border border-border bg-muted/20 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-foreground truncate">
              {pack.name}
            </span>
            {pack.bundled && (
              <span className="shrink-0 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
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

      {update && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-accent">
            v{update.currentVersion} → v{update.availableVersion}
          </span>
          {onUpdate && (
            <button
              onClick={() => onUpdate(pack.packId)}
              className={cn(
                'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
                'bg-accent text-accent-foreground hover:bg-accent/80',
              )}
            >
              Update
            </button>
          )}
        </div>
      )}

      {!pack.bundled && onUninstall && (
        <button
          onClick={() => onUninstall(pack.packId)}
          className={cn(
            'self-start rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
            'text-muted-foreground hover:bg-destructive/20 hover:text-destructive',
          )}
        >
          Uninstall
        </button>
      )}
    </div>
  );
}
