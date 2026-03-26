import { Plus } from 'lucide-react';
import { useStore } from '@/store/store';
import { createDungeonLayer } from '@/store/factories';
import { AddLayerCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { notify } from '@/lib/toast';

export function LayerHeader() {
  const layerCount = useStore((s) => s.layers.filter((l) => l.type === 'dungeon').length);

  const handleAddLayer = () => {
    const layer = createDungeonLayer(`Layer ${layerCount + 1}`);
    undoManager.execute(new AddLayerCommand('Add layer', layer));
    useStore.getState().setActiveLayerId(layer.id);
    notify.subtle('Layer added', { icon: 'plus' });
  };

  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="font-display text-tab-label uppercase tracking-wider text-text-muted">Layers</span>
      <button
        title="Add layer"
        onClick={handleAddLayer}
        className="w-7 h-7 rounded-sm flex items-center justify-center bg-transparent hover:bg-surface-2 text-text-muted hover:text-text-primary border border-transparent hover:border-border-default transition-colors"
      >
        <Plus size={14} strokeWidth={2} />
      </button>
    </div>
  );
}
