import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { Mountain, Eye, EyeOff } from 'lucide-react'
import { useStore } from '@/store/store'
import { useShallow } from 'zustand/react/shallow'
import { TERRAIN_PANEL_ID, type Layer } from '@/store/types'
import { LayerHeader } from './LayerHeader'
import { LayerRow } from './LayerRow'
import { ReorderLayerCommand, TerrainAppearanceCommand } from '@/store/commands'
import { undoManager } from '@/store/undoManager'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { notify } from '@/lib/toast'
import { priorActiveLayerRef } from '@/components/toolbar/toolConstants'
import { ContextMenu, useContextMenu, type ContextMenuItem } from '@/components/ui/context-menu'
import { resolveReorder } from './resolveReorder'

const selectLayers = (s: { layers: Layer[] }) => s.layers
const selectActiveLayerId = (s: { ui: { activeLayerId: string } }) => s.ui.activeLayerId

/**
 * Pinned row for the map's global terrain paint — not a Layer, so it can't
 * reuse LayerRow (no drag, no lock, no children, no delete). Same visual
 * shape as the pinned Background row below it: name column padded out to the
 * same width the drag-handle/chevron/lock spacers give every other row.
 */
function TerrainRow({ isActive }: { isActive: boolean }) {
  const setActiveLayerId = useStore((s) => s.setActiveLayerId)
  const setSelectedIds = useStore((s) => s.setSelectedIds)
  const terrainVisible = useStore((s) => s.mapSettings.terrain?.visible ?? true)
  const terrainOpacity = useStore((s) => s.mapSettings.terrain?.opacity ?? 1)
  const menu = useContextMenu()

  const setTerrainVisible = (next: boolean) => {
    undoManager.execute(new TerrainAppearanceCommand(
      { visible: terrainVisible },
      { visible: next },
    ))
  }

  const resetOpacity = () => {
    if (terrainOpacity === 1) return
    undoManager.execute(new TerrainAppearanceCommand(
      { opacity: terrainOpacity },
      { opacity: 1 },
    ))
  }

  const menuItems: ContextMenuItem[] = [
    { label: terrainVisible ? 'Hide' : 'Show', onSelect: () => setTerrainVisible(!terrainVisible) },
    { label: 'Reset opacity', onSelect: resetOpacity, disabled: terrainOpacity === 1 },
  ]

  return (
    <div
      data-testid="terrain-row"
      className={cn(
        'gg-row flex items-center gap-1 px-1 py-1.5 cursor-pointer',
        isActive && 'bg-surface-3',
        // opacity-80, matching LayerRow — see index.css's --text-dim comment.
        !terrainVisible && 'opacity-80',
      )}
      onClick={() => {
        // Remember what was active so Escape can put it back (D5b) — only on
        // the transition into terrain, so re-clicking terrain while already
        // on it doesn't overwrite the layer to restore to with itself.
        const current = useStore.getState().ui.activeLayerId
        if (current !== TERRAIN_PANEL_ID) priorActiveLayerRef.current = current
        setActiveLayerId(TERRAIN_PANEL_ID)
        setSelectedIds([])
      }}
      onContextMenu={menu.open}
    >
      <span className="w-[14px]" />
      <span className="w-4" />
      <Mountain size={14} className="text-text-muted shrink-0" />
      <span className="flex-1 min-w-0 truncate text-panel-body text-text-primary">Terrain</span>
      <span className="w-6" />
      <Button
        variant="ghost"
        size="icon-xs"
        data-testid="layer-visibility-toggle"
        data-visible={terrainVisible}
        onClick={(e) => {
          e.stopPropagation()
          setTerrainVisible(!terrainVisible)
        }}
        className="text-text-muted hover:text-text-primary"
        title={terrainVisible ? 'Hide terrain' : 'Show terrain'}
        aria-label={terrainVisible ? 'Hide terrain' : 'Show terrain'}
        aria-pressed={terrainVisible}
      >
        {terrainVisible ? <Eye size={14} /> : <EyeOff size={14} />}
      </Button>
      <ContextMenu pos={menu.pos} onClose={menu.close} items={menuItems} />
    </div>
  )
}

export function LayerPanel() {
  const layers = useStore(useShallow(selectLayers))
  const activeLayerId = useStore(selectActiveLayerId)

  // Background is pinned at index 0 — separate it
  const backgroundLayer = layers.find((l) => l.type === 'background')
  // User layers in reverse (top = last in array = first visually)
  const userLayers = layers.filter((l) => l.type !== 'background').reverse()

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const result = resolveReorder(layers, active.id as string, over.id as string)
    if (!result) return
    if (result.blocked) {
      notify.warning('Layer is locked')
      return
    }
    undoManager.execute(new ReorderLayerCommand('Reorder layers', result.fromActual, result.toActual))
  }

  return (
    <div className="flex flex-col">
      <LayerHeader />
      <hr className="border-border-subtle mx-2" />

      <DndContext
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={userLayers.map((l) => l.id)}
          strategy={verticalListSortingStrategy}
        >
          {userLayers.map((layer) => (
            <LayerRow
              key={layer.id}
              layer={layer}
              isActive={layer.id === activeLayerId}
            />
          ))}
        </SortableContext>
      </DndContext>

      {userLayers.length === 0 && (
        <p className="px-3 py-2 text-panel-body text-text-muted">
          No layers yet — add one to start drawing.
        </p>
      )}

      <hr className="border-border-subtle mx-2" />
      <TerrainRow isActive={activeLayerId === TERRAIN_PANEL_ID} />

      {backgroundLayer && (
        <>
          <hr className="border-border-subtle mx-2" />
          <LayerRow
            layer={backgroundLayer}
            isActive={backgroundLayer.id === activeLayerId}
          />
        </>
      )}
    </div>
  )
}
