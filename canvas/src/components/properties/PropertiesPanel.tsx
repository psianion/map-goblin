import { useStore } from '@/store/store'
import { useShallow } from 'zustand/react/shallow'
import { selectActiveLayer, selectSelectedIds, selectChildById } from '@/store/selectors'
import { LayerProperties } from './LayerProperties'
import { BackgroundProperties } from './BackgroundProperties'
import { TerrainProperties } from './TerrainProperties'
import { LightProperties } from './LightProperties'
import { DoorProperties } from './DoorProperties'
import { ZoneProperties } from './ZoneProperties'
import { ShapeTextureProperties } from './ShapeTextureProperties'
import { TextProperties } from './TextProperties'
import { TransformSection } from './TransformSection'
import { RoomPanel } from './RoomPanel'
import { PropertyField } from './PropertyField'
import { EnvironmentSection } from './EnvironmentSection'
import { SelectInput } from '@/components/inputs/SelectInput'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { Grid3x3 } from 'lucide-react'
import { TERRAIN_PANEL_ID } from '@/store/types'
import type { DungeonLayer, BackgroundLayer, LightChild, TextChild, GridConfig } from '@/store/types'

interface SectionControl {
  openSections?: Set<string>
  onToggleSection?: (id: string) => void
}

// Grid settings — wired directly to store actions (no undo — unlike Ambient below, these
// are cheap display toggles users flip freely rather than authored map state).
// ponytail: renderer only draws square grids in one look (dots in the void, lines on the
// map); mapSettings.gridType (hex/iso) is dead-letter, so no shape or style selector here.
function GridSection({ openSections, onToggleSection }: SectionControl) {
  const grid = useStore(useShallow((s) => s.grid))
  const setGridVisible = useStore((s) => s.setGridVisible)
  const setSnapEnabled = useStore((s) => s.setSnapEnabled)
  const setSnapDivision = useStore((s) => s.setSnapDivision)

  return (
    <CollapsibleSection
      id="grid"
      title="Grid"
      icon={Grid3x3}
      defaultOpen={false}
      isOpen={openSections?.has('grid')}
      onToggle={onToggleSection}
      headerExtra={
        <div className="pr-2">
          <ToggleSwitch checked={grid.visible} onChange={setGridVisible} label="Show grid" />
        </div>
      }
    >
      <div className="flex flex-col gap-2 pt-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-panel-label uppercase text-text-muted">Snap to Grid</span>
          <ToggleSwitch checked={grid.snapEnabled} onChange={setSnapEnabled} label="Snap to grid" />
        </div>
        <PropertyField label="Subdivisions">
          <SelectInput
            value={String(grid.snapDivision)}
            onChange={(v) => setSnapDivision(Number(v) as GridConfig['snapDivision'])}
            options={[1, 2, 3, 4, 6, 8].map((n) => ({ value: String(n), label: `1/${n}` }))}
          />
        </PropertyField>
      </div>
    </CollapsibleSection>
  )
}

export function PropertiesPanel({ openSections, onToggleSection }: SectionControl) {
  const activeLayerId = useStore((s) => s.ui.activeLayerId)
  const activeLayer = useStore(selectActiveLayer)
  const selectedIds = useStore(useShallow(selectSelectedIds))

  // Read first selected child from the store (selector handles deep search)
  const firstSelectedId = selectedIds[0] ?? null
  const selectedChild = useStore((s) =>
    firstSelectedId ? selectChildById(s, firstSelectedId) : undefined,
  )

  // Terrain row selected — selectActiveLayer finds nothing for the sentinel
  // (harmless: no layer has that id), so it's checked explicitly, after every
  // hook above has run unconditionally. Gated on no selection: picking a
  // door/light/shape on canvas while the Terrain row is still "active" must
  // fall through to the selection branches below, not pin Terrain forever.
  if (activeLayerId === TERRAIN_PANEL_ID && selectedIds.length === 0) {
    return (
      <div className="flex flex-col pt-2">
        <TerrainProperties openSections={openSections} onToggleSection={onToggleSection} />
        <GridSection openSections={openSections} onToggleSection={onToggleSection} />
        <EnvironmentSection openSections={openSections} onToggleSection={onToggleSection} />
      </div>
    )
  }

  // If first selected child is a door, show door properties
  if (selectedChild?.childType === 'door' && activeLayer) {
    return (
      <div className="flex flex-col pt-2">
        <DoorProperties layerId={activeLayer.id} childId={selectedChild.id} />
        <GridSection openSections={openSections} onToggleSection={onToggleSection} />
        <EnvironmentSection openSections={openSections} onToggleSection={onToggleSection} />
      </div>
    )
  }

  // If first selected child is a zone, show zone + trigger properties
  if (selectedChild?.childType === 'zone' && activeLayer) {
    return (
      <div className="flex flex-col pt-2">
        <ZoneProperties layerId={activeLayer.id} childId={selectedChild.id} />
        <GridSection openSections={openSections} onToggleSection={onToggleSection} />
        <EnvironmentSection openSections={openSections} onToggleSection={onToggleSection} />
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
        <GridSection openSections={openSections} onToggleSection={onToggleSection} />
        <EnvironmentSection openSections={openSections} onToggleSection={onToggleSection} />
      </div>
    )
  }

  // If first selected child is a text label, show label properties
  if (selectedChild?.childType === 'text') {
    return (
      <div className="flex flex-col pt-2">
        <TextProperties
          label={selectedChild as TextChild}
          onDeselect={() => useStore.getState().setSelectedIds([])}
          openSections={openSections}
          onToggleSection={onToggleSection}
        />
        <TransformSection
          child={selectedChild as TextChild}
          openSections={openSections}
          onToggleSection={onToggleSection}
        />
        <GridSection openSections={openSections} onToggleSection={onToggleSection} />
        <EnvironmentSection openSections={openSections} onToggleSection={onToggleSection} />
      </div>
    )
  }

  // Assets had no properties at all — numeric transform is their panel.
  if (selectedChild?.childType === 'asset') {
    return (
      <div className="flex flex-col pt-2">
        <TransformSection
          child={selectedChild}
          openSections={openSections}
          onToggleSection={onToggleSection}
        />
        <GridSection openSections={openSections} onToggleSection={onToggleSection} />
        <EnvironmentSection openSections={openSections} onToggleSection={onToggleSection} />
      </div>
    )
  }

  if (!activeLayer) {
    return (
      <div className="flex flex-col pt-2">
        <p className="px-3 py-2 text-panel-body text-text-muted">No layer selected.</p>
        <GridSection openSections={openSections} onToggleSection={onToggleSection} />
        <EnvironmentSection openSections={openSections} onToggleSection={onToggleSection} />
      </div>
    )
  }

  if (activeLayer.type === 'dungeon') {
    const dungeonLayer = activeLayer as DungeonLayer
    return (
      <div className="flex flex-col">
        <LayerProperties layer={dungeonLayer} openSections={openSections} onToggleSection={onToggleSection} />
        <ShapeTextureProperties layer={dungeonLayer} openSections={openSections} onToggleSection={onToggleSection} />
        <RoomPanel layer={dungeonLayer} openSections={openSections} onToggleSection={onToggleSection} />
        <GridSection openSections={openSections} onToggleSection={onToggleSection} />
        <EnvironmentSection openSections={openSections} onToggleSection={onToggleSection} />
      </div>
    )
  }

  if (activeLayer.type === 'background') {
    return (
      <div className="flex flex-col pt-2">
        <BackgroundProperties layer={activeLayer as BackgroundLayer} openSections={openSections} onToggleSection={onToggleSection} />
        <GridSection openSections={openSections} onToggleSection={onToggleSection} />
        <EnvironmentSection openSections={openSections} onToggleSection={onToggleSection} />
      </div>
    )
  }

  return (
    <div className="flex flex-col pt-2">
      <p className="px-3 py-2 text-panel-body text-text-muted">No properties for this layer type.</p>
      <EnvironmentSection openSections={openSections} onToggleSection={onToggleSection} />
    </div>
  )
}
