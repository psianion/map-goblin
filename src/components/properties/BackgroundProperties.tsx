import { useStore } from '@/store/store';
import type { BackgroundLayer } from '@/store/types';
import { PropertyField } from './PropertyField';
import { ColorField } from '@/components/inputs/ColorField';

interface BackgroundPropertiesProps {
  layer: BackgroundLayer;
}

export function BackgroundProperties({ layer }: BackgroundPropertiesProps) {
  const updateLayer = useStore((s) => s.updateLayer);

  return (
    <div className="flex flex-col gap-3 p-3">
      <span className="text-panel-heading uppercase text-text-secondary tracking-wider">
        Background
      </span>

      <PropertyField label="Background Color">
        <ColorField
          value={layer.backgroundColor}
          onChange={(c) =>
            updateLayer(layer.id, {
              backgroundColor: c,
            } as Partial<BackgroundLayer>)
          }
        />
      </PropertyField>
    </div>
  );
}
