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

  const toggleVisibility = (e: React.MouseEvent) => {
    e.stopPropagation()
    undoManager.execute(new TerrainAppearanceCommand(
      { visible: terrainVisible },
      { visible: !terrainVisible },
    ))
  }

  return (
    <div
      data-testid="terrain-row"
      className={cn(
        'gg-row flex items-center gap-1 px-1 py-1.5 cursor-pointer',
        isActive && 'bg-surface-3',
        !terrainVisible && 'opacity-50',
      )}
      onClick={() => {
        setActiveLayerId(TERRAIN_PANEL_ID)
        setSelectedIds([])
      }}
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
        onClick={toggleVisibility}
        className="text-text-muted hover:text-text-primary"
        title={terrainVisible ? 'Hide terrain' : 'Show terrain'}
      >
        {terrainVisible ? <Eye size={14} /> : <EyeOff size={14} />}
      </Button>
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
    if (!over || active.id === over.id) return

    const userLayerIds = layers.filter((l) => l.type !== 'background').map((l) => l.id)
    // Convert from reversed visual order to actual array index
    const fromVisual = userLayers.findIndex((l) => l.id === active.id)
    const toVisual = userLayers.findIndex((l) => l.id === over.id)

    // Convert visual indices to actual array indices (reverse the reversal)
    const fromActual = userLayerIds.length - 1 - fromVisual + 1 // +1 for background at 0
    const toActual = userLayerIds.length - 1 - toVisual + 1

    undoManager.execute(new ReorderLayerCommand('Reorder layers', fromActual, toActual))
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
