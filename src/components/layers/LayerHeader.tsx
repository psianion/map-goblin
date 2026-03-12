import { Plus } from 'lucide-react';
import { useStore } from '@/store/store';
import { createDungeonLayer } from '@/store/factories';
import { AddLayerCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';

export function LayerHeader() {
  const layerCount = useStore((s) => s.layers.filter((l) => l.type === 'dungeon').length);

  const handleAddLayer = () => {
    const layer = createDungeonLayer(`Layer ${layerCount + 1}`);
    undoManager.execute(new AddLayerCommand('Add layer', layer));
    useStore.getState().setActiveLayerId(layer.id);
  };

  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Layers</span>
      <button
        title="Add layer"
        onClick={handleAddLayer}
        className="flex items-center justify-center w-6 h-6 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
      >
        <Plus size={14} strokeWidth={2} />
      </button>
    </div>
  );
}
