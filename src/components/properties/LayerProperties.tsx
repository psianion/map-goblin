import { useStore } from '@/store/store';
import type { DungeonLayer } from '@/store/types';
import { PropertyField } from './PropertyField';
import { ColorField } from '@/components/inputs/ColorField';

interface LayerPropertiesProps {
  layer: DungeonLayer;
}

export function LayerProperties({ layer }: LayerPropertiesProps) {
  const updateLayer = useStore((s) => s.updateLayer);

  return (
    <div className="flex flex-col gap-3 p-3">
      <span className="text-panel-heading uppercase text-text-secondary tracking-wider">
        Layer
      </span>

      <PropertyField label="Floor Color">
        <ColorField
          value={layer.style.floorColor}
          onChange={(c) =>
            updateLayer(layer.id, {
              style: { ...layer.style, floorColor: c },
            } as Partial<DungeonLayer>)
          }
        />
      </PropertyField>

      <PropertyField label="Wall Color">
        <ColorField
          value={layer.style.wallColor}
          onChange={(c) =>
            updateLayer(layer.id, {
              style: { ...layer.style, wallColor: c },
            } as Partial<DungeonLayer>)
          }
        />
      </PropertyField>
    </div>
  );
}
