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
import { useStore } from '@/store/store'
import { useShallow } from 'zustand/react/shallow'
import type { Layer } from '@/store/types'
import { LayerHeader } from './LayerHeader'
import { LayerRow } from './LayerRow'
import { ReorderLayerCommand } from '@/store/commands'
import { undoManager } from '@/store/undoManager'

const selectLayers = (s: { layers: Layer[] }) => s.layers
const selectActiveLayerId = (s: { ui: { activeLayerId: string } }) => s.ui.activeLayerId

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
