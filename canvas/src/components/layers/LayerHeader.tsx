import { Plus } from 'lucide-react';
import { useStore } from '@/store/store';
import { createDungeonLayer } from '@/store/factories';
import { AddLayerCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { notify } from '@/lib/toast';
import type { Layer } from '@/store/types';

// Deletes can leave gaps (e.g. "Layer 2" removed) — deriving from the count
// of surviving layers reused names ("Layer 2" again). Deriving from the
// highest existing "Layer N" suffix instead means a name is only ever
// reused if nothing else took it.
function nextLayerName(layers: Layer[]): string {
  const maxSuffix = layers.reduce((max, l) => {
    const m = l.type === 'dungeon' ? /^Layer (\d+)$/.exec(l.name) : null;
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  return `Layer ${maxSuffix + 1}`;
}

export function LayerHeader() {
  const handleAddLayer = () => {
    const layer = createDungeonLayer(nextLayerName(useStore.getState().layers));
    undoManager.execute(new AddLayerCommand('Add layer', layer));
    useStore.getState().setActiveLayerId(layer.id);
    notify.subtle('Layer added', { icon: 'plus' });
  };

  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="font-display text-tab-label uppercase tracking-wider text-text-muted">Layers</span>
      <button
        title="Add layer"
        aria-label="Add layer"
        onClick={handleAddLayer}
        className="w-7 h-7 rounded-sm flex items-center justify-center bg-transparent hover:bg-surface-2 text-text-muted hover:text-text-primary border border-transparent hover:border-border-default transition-colors"
      >
        <Plus size={14} strokeWidth={2} />
      </button>
    </div>
  );
}
