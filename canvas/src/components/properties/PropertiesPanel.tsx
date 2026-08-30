import { useStore } from '@/store/store'
import { useShallow } from 'zustand/react/shallow'
import { selectActiveLayer, selectSelectedIds, selectChildById, selectLayers, groupMembers, selectLayerForChild } from '@/store/selectors'
import { blockedLayerReason } from '@dnd/core/src/engine/tools/layerGuard'
import { undoManager } from '@/store/undoManager'
import { createDissolveGroupCommand } from '@/store/commands'
import { selectionGroup } from '@/canvas/groupActions'
import { Button } from '@/components/ui/button'
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
import { Combine, Folder, Grid3x3 } from 'lucide-react'
import { TERRAIN_PANEL_ID } from '@/store/types'
import type { DungeonLayer, BackgroundLayer, LightChild, TextChild, GridConfig, ChildGroupInfo } from '@/store/types'

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

/**
 * Shown when the selection IS a group, exactly. Identity plus the one verb the
 * canvas gizmo can't do — transforms stay on the gizmo, so there's nothing
 * else to put here.
 */
function GroupSection({ layer, group, count }: { layer: DungeonLayer; group: ChildGroupInfo; count: number }) {
  const Icon = group.merged ? Combine : Folder
  return (
    <div className="px-3 py-2 border-b border-border-subtle">
      <div className="flex items-center gap-2">
        <Icon size={12} className="text-text-muted shrink-0" />
        <span className="font-display text-panel-label uppercase tracking-wider text-text-muted">
          {group.merged ? 'Merged' : 'Group'}
        </span>
        <span className="text-panel-body text-text-primary truncate">{group.name}</span>
        <span className="text-panel-small text-text-muted tabular-nums ml-auto">
          {count} {count === 1 ? 'object' : 'objects'}
        </span>
      </div>
      {/* Merging costs individual editing — say so where the Unmerge button is. */}
      {group.merged && (
        <p className="mt-1 text-panel-small text-text-muted">
          Members move and edit as one object. Unmerge to edit individually.
        </p>
      )}
      <Button
        variant="secondary"
        size="sm"
        className="mt-2 w-full"
        onClick={() => {
          const cmd = createDissolveGroupCommand(useStore.getState().layers, layer.id, group.id)
          if (cmd) undoManager.execute(cmd)
        }}
      >
        {group.merged ? 'Unmerge' : 'Ungroup'}
      </Button>
    </div>
  )
}

/** Says why the inputs below it are inert, in the panel's own hint voice. */
function LockedNote({ reason }: { reason: string }) {
  return <p className="px-3 pb-1 text-panel-small text-text-muted">{reason}</p>
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

  // Selection that IS exactly one group's members — the group is the object,
  // so it gets its own panel instead of the first member's.
  // Subscribed (not just read) so the section re-renders on group edits;
  // selectionGroup itself reads the store snapshot.
  useStore(useShallow(selectLayers))
  const found = selectionGroup()
  const memberCount = found ? groupMembers(found.layer, found.group.id).length : 0
  // selectionGroup accepts a PARTIAL selection inside one group; the panel
  // only speaks for the group when the whole group is what's selected.
  const groupMatch =
    found && memberCount === selectedIds.length ? { ...found, count: memberCount } : null

  // A child on a locked layer stays panel-selectable on purpose — you can read
  // its numbers — but its inputs must not still write. Resolved per selected
  // child, not off activeLayer: panel selection can point at another layer's
  // child. Recomputed on every layer edit via the selectLayers subscription
  // above.
  const blockedReason = (() => {
    const state = useStore.getState()
    for (const id of selectedIds) {
      const owner = selectLayerForChild(state, id)
      if (!owner) continue
      const reason = blockedLayerReason(owner)
      if (reason) return reason
    }
    return null
  })()
  const locked = blockedReason !== null

  if (groupMatch) {
    return (
      <div className="flex flex-col pt-2">
        <GroupSection {...groupMatch} />
        <GridSection openSections={openSections} onToggleSection={onToggleSection} />
        <EnvironmentSection openSections={openSections} onToggleSection={onToggleSection} />
      </div>
    )
  }

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
        {blockedReason && <LockedNote reason={blockedReason} />}
        <DoorProperties layerId={activeLayer.id} childId={selectedChild.id} disabled={locked} />
        <GridSection openSections={openSections} onToggleSection={onToggleSection} />
        <EnvironmentSection openSections={openSections} onToggleSection={onToggleSection} />
      </div>
    )
  }

  // If first selected child is a zone, show zone + trigger properties
  if (selectedChild?.childType === 'zone' && activeLayer) {
    return (
      <div className="flex flex-col pt-2">
        {blockedReason && <LockedNote reason={blockedReason} />}
        <ZoneProperties layerId={activeLayer.id} childId={selectedChild.id} disabled={locked} />
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
        {blockedReason && <LockedNote reason={blockedReason} />}
        <LightProperties
          light={lightChild}
          onDeselect={() => useStore.getState().setSelectedIds([])}
          openSections={openSections}
          onToggleSection={onToggleSection}
          disabled={locked}
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
        {blockedReason && <LockedNote reason={blockedReason} />}
        <TextProperties
          label={selectedChild as TextChild}
          onDeselect={() => useStore.getState().setSelectedIds([])}
          openSections={openSections}
          onToggleSection={onToggleSection}
          disabled={locked}
        />
        <TransformSection
          child={selectedChild as TextChild}
          openSections={openSections}
          onToggleSection={onToggleSection}
          disabled={locked}
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
        {blockedReason && <LockedNote reason={blockedReason} />}
        <TransformSection
          child={selectedChild}
          openSections={openSections}
          onToggleSection={onToggleSection}
          disabled={locked}
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
