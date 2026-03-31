import { useStore } from '@/store/store'
import { useShallow } from 'zustand/react/shallow'
import { selectActiveLayer, selectSelectedIds, selectChildById } from '@/store/selectors'
import { LayerProperties } from './LayerProperties'
import { BackgroundProperties } from './BackgroundProperties'
import { LightProperties } from './LightProperties'
import { DoorProperties } from './DoorProperties'
import { ShapeTextureProperties } from './ShapeTextureProperties'
import { PropertyField } from './PropertyField'
import { ColorField } from '@/components/inputs/ColorField'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { Lightbulb } from 'lucide-react'
import type { DungeonLayer, BackgroundLayer, LightChild } from '@/store/types'

interface SectionControl {
  openSections?: Set<string>
  onToggleSection?: (id: string) => void
}

function AmbientSection({ openSections, onToggleSection }: SectionControl) {
  const ambientLight = useStore((s) => s.mapSettings.ambientLight)
  return (
    <CollapsibleSection
      id="ambient"
      title="Ambient"
      icon={Lightbulb}
      defaultOpen={false}
      isOpen={openSections?.has('ambient')}
      onToggle={onToggleSection}
    >
      <div className="flex flex-col gap-2 pt-2">
        <PropertyField label="Ambient Color">
          <div data-testid="ambient-color-swatch">
            <ColorField
              value={ambientLight}
              onChange={(c) => useStore.getState().setAmbientLight(c)}
            />
          </div>
        </PropertyField>
      </div>
    </CollapsibleSection>
  )
}

export function PropertiesPanel({ openSections, onToggleSection }: SectionControl) {
  const activeLayer = useStore(selectActiveLayer)
  const selectedIds = useStore(useShallow(selectSelectedIds))

  // Read first selected child from the store (selector handles deep search)
  const firstSelectedId = selectedIds[0] ?? null
  const selectedChild = useStore((s) =>
    firstSelectedId ? selectChildById(s, firstSelectedId) : undefined,
  )

  // If first selected child is a door, show door properties
  if (selectedChild?.childType === 'door' && activeLayer) {
    return (
      <div className="flex flex-col pt-2">
        <DoorProperties layerId={activeLayer.id} childId={selectedChild.id} />
        <AmbientSection openSections={openSections} onToggleSection={onToggleSection} />
      </div>
    )
  }

  // If first selected child is a light, show light properties
  if (selectedChild?.childType === 'light') {
    const lightChild = selectedChild as LightChild
    return (
      <div className="flex flex-col pt-2">
        <LightProperties
          light={lightChild}
          onDeselect={() => useStore.getState().setSelectedIds([])}
          openSections={openSections}
          onToggleSection={onToggleSection}
        />
        <AmbientSection openSections={openSections} onToggleSection={onToggleSection} />
      </div>
    )
  }

  if (!activeLayer) {
    return (
      <div className="flex flex-col pt-2">
        <p className="px-3 py-2 text-panel-body text-text-muted">No layer selected.</p>
        <AmbientSection openSections={openSections} onToggleSection={onToggleSection} />
      </div>
    )
  }

  if (activeLayer.type === 'dungeon') {
    const dungeonLayer = activeLayer as DungeonLayer
    return (
      <div className="flex flex-col">
        <LayerProperties layer={dungeonLayer} openSections={openSections} onToggleSection={onToggleSection} />
        <ShapeTextureProperties layer={dungeonLayer} openSections={openSections} onToggleSection={onToggleSection} />
        <AmbientSection openSections={openSections} onToggleSection={onToggleSection} />
      </div>
    )
  }

  if (activeLayer.type === 'background') {
    return (
      <div className="flex flex-col pt-2">
        <BackgroundProperties layer={activeLayer as BackgroundLayer} openSections={openSections} onToggleSection={onToggleSection} />
        <AmbientSection openSections={openSections} onToggleSection={onToggleSection} />
      </div>
    )
  }

  return (
    <div className="flex flex-col pt-2">
      <p className="px-3 py-2 text-panel-body text-text-muted">No properties for this layer type.</p>
      <AmbientSection openSections={openSections} onToggleSection={onToggleSection} />
    </div>
  )
}
