import { useStore } from '@/store/store'
import type { BackgroundLayer } from '@/store/types'
import { PropertyField } from './PropertyField'
import { ColorField } from '@/components/inputs/ColorField'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { PaintBucket } from 'lucide-react'

interface BackgroundPropertiesProps {
  layer: BackgroundLayer
  openSections?: Set<string>
  onToggleSection?: (id: string) => void
}

export function BackgroundProperties({ layer, openSections, onToggleSection }: BackgroundPropertiesProps) {
  const updateLayer = useStore((s) => s.updateLayer)

  return (
    <CollapsibleSection
      id="bg"
      title="Background"
      icon={PaintBucket}
      defaultOpen={true}
      isOpen={openSections?.has('bg')}
      onToggle={onToggleSection}
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
