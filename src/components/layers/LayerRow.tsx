import type { Layer } from '@/store/types';
import { cn } from '@/lib/utils';
import { useStore } from '@/store/store';

interface LayerRowProps {
  layer: Layer;
  isActive: boolean;
}

export function LayerRow({ layer, isActive }: LayerRowProps) {
  const setActiveLayerId = useStore((s) => s.setActiveLayerId);
  return (
    <button
      onClick={() => setActiveLayerId(layer.id)}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left',
        isActive ? 'bg-accent/20 text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
      )}
    >
      <span className="truncate">{layer.name}</span>
    </button>
  );
}
