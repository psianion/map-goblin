import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import { ChildRow } from './ChildRow'
import { useStore } from '@/store/store'
import { undoManager } from '@/store/undoManager'
import { createDungeonLayer } from '@/store/factories'
import { notify } from '@/lib/toast'
import type { AssetChild, DoorChild, DungeonLayer } from '@/store/types'

function asset(id: string): AssetChild {
  return {
    id,
    name: id,
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId: 'tree-a',
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: 1,
    width: 1,
    height: 1,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
  }
}

function door(id: string): DoorChild {
  return {
    id,
    name: id,
    childType: 'door',
    visible: true,
    wallId: '',
    position: [0, 0],
    angle: 0,
    width: 1,
    style: 'single',
    state: 'closed',
    isSecret: false,
  }
}

function renderChild(child: AssetChild | DoorChild, layer: DungeonLayer) {
  return render(
    <DndContext>
      <SortableContext items={[child.id]}>
        <ChildRow child={child} layer={layer} />
      </SortableContext>
    </DndContext>,
  )
}

function findDungeonLayer(id: string): DungeonLayer {
  return useStore.getState().layers.find((l) => l.id === id) as DungeonLayer
}

describe('ChildRow', () => {
  beforeEach(() => {
    undoManager.clear()
    useStore.getState().resetToDefault()
  })

  it('renders a drag handle for a reorderable (asset) child', () => {
    const layer = createDungeonLayer('Layer 1')
    const a = asset('asset-1')
    layer.children = [a]
    useStore.getState().addLayer(layer)

    renderChild(a, layer)
    expect(screen.getByLabelText(`Reorder ${a.name}`)).toBeTruthy()
  })

  it('renders the spacer instead of a drag handle for a non-reorderable (door) child', () => {
    const layer = createDungeonLayer('Layer 1')
    const d = door('door-1')
    layer.children = [d]
    useStore.getState().addLayer(layer)

    renderChild(d, layer)
    expect(screen.queryByLabelText(`Reorder ${d.name}`)).toBeNull()
  })

  it('blocks duplicate and remove on a locked layer, with a warning', () => {
    const layer = createDungeonLayer('Layer 1')
    const a = asset('asset-1')
    layer.children = [a]
    useStore.getState().addLayer(layer)
    useStore.getState().updateLayer(layer.id, { locked: true })
    const warn = vi.spyOn(notify, 'warning').mockImplementation(() => {})

    renderChild(a, findDungeonLayer(layer.id))
    fireEvent.contextMenu(screen.getByTestId('child-row'))
    fireEvent.click(screen.getByText('Duplicate'))
    expect(findDungeonLayer(layer.id).children).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith('Layer is locked')

    fireEvent.contextMenu(screen.getByTestId('child-row'))
    fireEvent.click(screen.getByText('Delete'))
    expect(findDungeonLayer(layer.id).children).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(2)

    warn.mockRestore()
  })

  it('allows duplicate and remove on a solo-hidden (but unlocked) layer', () => {
    const layer = createDungeonLayer('Layer 1')
    const a = asset('asset-1')
    layer.children = [a]
    useStore.getState().addLayer(layer)
    const [otherLayer] = useStore.getState().layers.filter((l): l is DungeonLayer => l.type === 'dungeon')
    useStore.getState().toggleSoloLayer(otherLayer.id) // solos a different layer, hiding `layer`
    const warn = vi.spyOn(notify, 'warning').mockImplementation(() => {})

    renderChild(a, findDungeonLayer(layer.id))
    fireEvent.contextMenu(screen.getByTestId('child-row'))
    fireEvent.click(screen.getByText('Duplicate'))
    expect(findDungeonLayer(layer.id).children).toHaveLength(2)
    expect(warn).not.toHaveBeenCalled()

    warn.mockRestore()
  })
})
