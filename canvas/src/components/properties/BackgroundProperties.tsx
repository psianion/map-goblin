import { useStore } from '@/store/store'
import type { BackgroundLayer } from '@/store/types'
import { PropertyField } from './PropertyField'
import { ColorField } from '@/components/inputs/ColorField'
import { ColorChip } from '@/components/inputs/ColorChip'
import { SliderInput } from '@/components/inputs/SliderInput'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { PaintBucket } from 'lucide-react'
import { PropertyCommand } from '@/store/commands'
import { undoManager } from '@/store/undoManager'

interface BackgroundPropertiesProps {
  layer: BackgroundLayer
  openSections?: Set<string>
  onToggleSection?: (id: string) => void
}

export function BackgroundProperties({ layer, openSections, onToggleSection }: BackgroundPropertiesProps) {
  const updateLayer = useStore((s) => s.updateLayer)

  // Live preview via the raw action, one undo entry on release — mirrors LayerProperties.
  const commitOpacity = (newPct: number, startPct: number) => {
    const newVal = newPct / 100
    const startVal = startPct / 100
    if (newVal === startVal) return
    undoManager.execute(new PropertyCommand(
      'Background opacity',
      { type: 'layer', layerId: layer.id },
      { opacity: startVal },
      { opacity: newVal },
    ))
  }

  const commitColor = (newColor: string, startColor: string) => {
    if (newColor === startColor) return
    undoManager.execute(new PropertyCommand(
      'Background color',
      { type: 'layer', layerId: layer.id },
      { backgroundColor: startColor },
      { backgroundColor: newColor },
    ))
  }

  return (
    <CollapsibleSection
      id="bg"
      title="Background"
      icon={PaintBucket}
      defaultOpen={true}
      isOpen={openSections?.has('bg')}
      onToggle={onToggleSection}
      preview={
        <ColorChip color={layer.backgroundColor} size="sm" />
      }
    >
      <div className="flex flex-col gap-2 pt-2">
        <PropertyField label="Background Color">
          <ColorField
            value={layer.backgroundColor}
            onChange={(c) =>
              updateLayer(layer.id, { backgroundColor: c } as Partial<BackgroundLayer>)
            }
            onChangeCommit={commitColor}
          />
        </PropertyField>
        <PropertyField label="Opacity">
          <SliderInput
            value={Math.round(layer.opacity * 100)}
            rawValue={layer.opacity * 100}
            min={0}
            max={100}
            step={1}
            onChange={(pct) => updateLayer(layer.id, { opacity: pct / 100 })}
            onChangeCommit={commitOpacity}
            unit="%"
          />
        </PropertyField>
      </div>
    </CollapsibleSection>
  )
}
