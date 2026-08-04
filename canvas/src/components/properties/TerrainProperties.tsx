import { useStore } from '@/store/store'
import { PropertyField } from './PropertyField'
import { SliderInput } from '@/components/inputs/SliderInput'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { Mountain } from 'lucide-react'
import { TerrainAppearanceCommand } from '@/store/commands'
import { undoManager } from '@/store/undoManager'

interface SectionControl {
  openSections?: Set<string>
  onToggleSection?: (id: string) => void
}

/** Properties for the pinned Terrain row — global paint visibility + opacity. */
export function TerrainProperties({ openSections, onToggleSection }: SectionControl) {
  const visible = useStore((s) => s.mapSettings.terrain?.visible ?? true)
  const opacity = useStore((s) => s.mapSettings.terrain?.opacity ?? 1)
  const setTerrainData = useStore((s) => s.setTerrainData)

  const commitOpacity = (newPct: number, startPct: number) => {
    const newVal = newPct / 100
    const startVal = startPct / 100
    if (newVal === startVal) return
    undoManager.execute(new TerrainAppearanceCommand({ opacity: startVal }, { opacity: newVal }))
  }

  return (
    <CollapsibleSection
      id="terrain"
      title="Terrain"
      icon={Mountain}
      defaultOpen={true}
      isOpen={openSections?.has('terrain')}
      onToggle={onToggleSection}
      headerExtra={
        <ToggleSwitch
          checked={visible}
          onChange={(v) =>
            undoManager.execute(new TerrainAppearanceCommand({ visible }, { visible: v }))
          }
          label="Show terrain"
        />
      }
    >
      <div className="flex flex-col gap-2 pt-2">
        <PropertyField label="Opacity">
          <SliderInput
            value={Math.round(opacity * 100)}
            rawValue={opacity * 100}
            min={0}
            max={100}
            step={1}
            onChange={(pct) => setTerrainData({ opacity: pct / 100 })}
            onChangeCommit={commitOpacity}
            unit="%"
          />
        </PropertyField>
      </div>
    </CollapsibleSection>
  )
}
