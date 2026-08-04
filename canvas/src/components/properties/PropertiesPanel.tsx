import { useStore } from '@/store/store'
import { useShallow } from 'zustand/react/shallow'
import { selectActiveLayer, selectSelectedIds, selectChildById } from '@/store/selectors'
import { LayerProperties } from './LayerProperties'
import { BackgroundProperties } from './BackgroundProperties'
import { TerrainProperties } from './TerrainProperties'
import { LightProperties } from './LightProperties'
import { DoorProperties } from './DoorProperties'
import { ShapeTextureProperties } from './ShapeTextureProperties'
import { TextProperties } from './TextProperties'
import { RoomPanel } from './RoomPanel'
import { PropertyField } from './PropertyField'
import { ColorField } from '@/components/inputs/ColorField'
import { ColorChip } from '@/components/inputs/ColorChip'
import { SelectInput } from '@/components/inputs/SelectInput'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { Lightbulb, Grid3x3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { undoManager } from '@/store/undoManager'
import { SetAmbientLightCommand } from '@/store/commands'
import { TERRAIN_PANEL_ID } from '@/store/types'
import type { DungeonLayer, BackgroundLayer, LightChild, TextChild, GridConfig } from '@/store/types'

/**
 * Quick day/night/color presets for the map's ambient light. Not exhaustive — the custom
 * hex picker below covers everything else. Values are the same "base darkness" the FBO
 * clears to each frame (see LightingRenderer), not a literal sky color.
 */
const AMBIENT_PRESETS: readonly { label: string; color: string }[] = [
  { label: 'Day', color: '#e8e4d8' },
  { label: 'Overcast', color: '#9a9a9a' },
  { label: 'Dusk', color: '#6b5a7a' },
  { label: 'Dungeon', color: '#2d2d44' },
  { label: 'Night', color: '#1a1a2e' },
  { label: 'Moonless', color: '#0a0a0f' },
]

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

function AmbientSection({ openSections, onToggleSection }: SectionControl) {
  const ambientLight = useStore((s) => s.mapSettings.ambientLight)

  // Every ambient change — preset or custom — is one undo step, same as the rest of the
  // properties UI (light color, radius, etc. all commit through undoManager on release).
  const commitAmbient = (newColor: string, startColor: string): void => {
    if (newColor.toLowerCase() === startColor.toLowerCase()) return
    undoManager.execute(new SetAmbientLightCommand(startColor, newColor))
  }

  return (
    <CollapsibleSection
      id="ambient"
      title="Ambient"
      icon={Lightbulb}
      defaultOpen={false}
      isOpen={openSections?.has('ambient')}
      onToggle={onToggleSection}
      preview={<ColorChip color={ambientLight} size="sm" circular />}
    >
      <div className="flex flex-col gap-2 pt-2">
        <PropertyField label="Presets">
          <div className="flex gap-1.5" role="group" aria-label="Ambient light presets">
            {AMBIENT_PRESETS.map((preset) => {
              const active = preset.color.toLowerCase() === ambientLight.toLowerCase()
              return (
                <button
                  key={preset.label}
                  type="button"
                  title={preset.label}
                  aria-label={preset.label}
                  aria-pressed={active}
                  onClick={() => commitAmbient(preset.color, ambientLight)}
                  className={cn(
                    'w-6 h-6 rounded-full border-2 shrink-0 transition-colors',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus',
                    active
                      ? 'border-accent-active'
                      : 'border-border-default hover:border-text-secondary',
                  )}
                  style={{ backgroundColor: preset.color }}
                />
              )
            })}
          </div>
        </PropertyField>

        <PropertyField label="Custom">
          <div data-testid="ambient-color-swatch">
            <ColorField
              value={ambientLight}
              onChange={(c) => useStore.getState().setAmbientLight(c)}
              onChangeCommit={commitAmbient}
            />
          </div>
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
        <AmbientSection openSections={openSections} onToggleSection={onToggleSection} />
      </div>
    )
  }

  // If first selected child is a door, show door properties
  if (selectedChild?.childType === 'door' && activeLayer) {
    return (
      <div className="flex flex-col pt-2">
        <DoorProperties layerId={activeLayer.id} childId={selectedChild.id} />
        <GridSection openSections={openSections} onToggleSection={onToggleSection} />
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
        <GridSection openSections={openSections} onToggleSection={onToggleSection} />
        <AmbientSection openSections={openSections} onToggleSection={onToggleSection} />
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
        <GridSection openSections={openSections} onToggleSection={onToggleSection} />
        <AmbientSection openSections={openSections} onToggleSection={onToggleSection} />
      </div>
    )
  }

  if (!activeLayer) {
    return (
      <div className="flex flex-col pt-2">
        <p className="px-3 py-2 text-panel-body text-text-muted">No layer selected.</p>
        <GridSection openSections={openSections} onToggleSection={onToggleSection} />
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
        <RoomPanel layer={dungeonLayer} openSections={openSections} onToggleSection={onToggleSection} />
        <GridSection openSections={openSections} onToggleSection={onToggleSection} />
        <AmbientSection openSections={openSections} onToggleSection={onToggleSection} />
      </div>
    )
  }

  if (activeLayer.type === 'background') {
    return (
      <div className="flex flex-col pt-2">
        <BackgroundProperties layer={activeLayer as BackgroundLayer} openSections={openSections} onToggleSection={onToggleSection} />
        <GridSection openSections={openSections} onToggleSection={onToggleSection} />
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
