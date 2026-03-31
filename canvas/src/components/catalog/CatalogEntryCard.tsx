import { cn } from '@/lib/utils';
import type { CatalogEntry } from '@/engine/catalogBrowser';

interface CatalogEntryCardProps {
  entry: CatalogEntry;
  onInstallPack?: (packId: string) => void;
}

export function CatalogEntryCard({ entry, onInstallPack }: CatalogEntryCardProps) {
  return (
    <div className="flex flex-col rounded border border-border bg-muted/20 overflow-hidden">
      {/* Thumbnail */}
      <div className="aspect-square bg-muted/40 flex items-center justify-center">
        {entry.thumbnailUrl ? (
          <img
            src={entry.thumbnailUrl}
            alt={entry.localId}
            className="h-full w-full object-contain"
            loading="lazy"
          />
        ) : (
          <div className="text-[10px] text-muted-foreground text-center px-1 leading-tight">
            {entry.localId.replace(/_/g, ' ')}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-1.5 space-y-1">
        <p className="text-[10px] text-foreground truncate font-medium">
          {entry.localId.replace(/_/g, ' ')}
        </p>
        <div className="flex items-center gap-1 flex-wrap">
          <span
            className={cn(
              'rounded px-1 py-0.5 text-[8px] font-medium',
              entry.type === 'floor' && 'bg-blue-500/20 text-blue-400',
              entry.type === 'wall' && 'bg-orange-500/20 text-orange-400',
              entry.type === 'object' && 'bg-green-500/20 text-green-400',
              entry.type !== 'floor' && entry.type !== 'wall' && entry.type !== 'object' &&
                'bg-muted text-muted-foreground',
            )}
          >
            {entry.type}
          </span>
          {entry.theme && (
            <span className="rounded px-1 py-0.5 text-[8px] bg-muted text-muted-foreground">
              {entry.theme}
            </span>
          )}
        </div>
        <p className="text-[8px] text-muted-foreground truncate">{entry.packId}</p>
        {onInstallPack && (
          <button
            onClick={() => onInstallPack(entry.packId)}
            className="w-full rounded px-1.5 py-0.5 text-[9px] font-medium bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
          >
            Install Pack
          </button>
        )}
      </div>
    </div>
  );
}
