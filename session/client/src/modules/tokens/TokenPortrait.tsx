import { cn } from '@dnd/ui';
import { initials } from './TokenRenderer';
import { usePortrait } from './portrait';

/** A token's face: its uploaded art, else its initials on a panel disc. */
export function TokenPortrait({
  name,
  assetId,
  className,
}: {
  name: string;
  assetId: string | null | undefined;
  className?: string;
}) {
  const url = usePortrait(assetId);
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-pill border border-line bg-panel-3 text-xs font-medium text-text-2',
        className ?? 'size-8',
      )}
    >
      {url ? <img src={url} alt="" className="size-full object-cover" /> : initials(name)}
    </span>
  );
}
