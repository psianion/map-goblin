import { cn } from '@dnd/ui';
import { initials } from './TokenRenderer';
import { usePortrait } from './portrait';

/**
 * A token's face: its uploaded art, else its initials on a panel disc. A token with a ring of
 * its own wears it here too, so the library, the party list and the cards match the map.
 */
export function TokenPortrait({
  name,
  assetId,
  ring,
  className,
}: {
  name: string;
  assetId: string | null | undefined;
  ring?: string;
  className?: string;
}) {
  const url = usePortrait(assetId);
  const coloured = typeof ring === 'string' && /^#[0-9a-f]{6}$/i.test(ring);
  return (
    <span
      aria-hidden
      data-ring={ring}
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-pill border border-line bg-panel-3 text-xs font-medium text-text-2',
        coloured && 'border-2',
        ring === 'none' && 'border-transparent',
        className ?? 'size-8',
      )}
      style={coloured ? { borderColor: ring } : undefined}
    >
      {url ? <img src={url} alt="" className="size-full object-cover" /> : initials(name)}
    </span>
  );
}
