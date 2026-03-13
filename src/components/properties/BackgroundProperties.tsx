import { useStore } from '@/store/store'
import type { BackgroundLayer } from '@/store/types'
import { PropertyField } from './PropertyField'
import { ColorField } from '@/components/inputs/ColorField'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { PaintBucket } from 'lucide-react'

interface BackgroundPropertiesProps {
  layer: BackgroundLayer
}

export function BackgroundProperties({ layer }: BackgroundPropertiesProps) {
  const updateLayer = useStore((s) => s.updateLayer)

  return (
    <CollapsibleSection
      id="background"
      title="Background"
      icon={PaintBucket}
      defaultOpen={true}
      preview={
        <span
          className="w-[14px] h-[14px] rounded-[2px] border border-border-default"
          style={{ backgroundColor: layer.backgroundColor }}
        />
      }
    >
      <div className="flex flex-col gap-2 pt-2">
        <PropertyField label="Background Color">
          <ColorField
            value={layer.backgroundColor}
            onChange={(c) =>
              updateLayer(layer.id, { backgroundColor: c } as Partial<BackgroundLayer>)
            }
          />
        </PropertyField>
      </div>
    </CollapsibleSection>
  )
}
