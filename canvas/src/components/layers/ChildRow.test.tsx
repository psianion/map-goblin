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

// K1: row keyboard contract, same shape as LayerRow's.
describe('ChildRow — row keyboard contract (K1)', () => {
  beforeEach(() => {
    undoManager.clear()
    useStore.getState().resetToDefault()
  })

  it('is a treeitem, roving-tabbable only when selected', () => {
    const layer = createDungeonLayer('Layer 1')
    const a = asset('asset-1')
    layer.children = [a]
    useStore.getState().addLayer(layer)

    renderChild(a, findDungeonLayer(layer.id))
    const row = screen.getByTestId('child-row')
    expect(row.getAttribute('role')).toBe('treeitem')
    expect(row.getAttribute('aria-selected')).toBe('false')
    expect(row.getAttribute('tabindex')).toBe('-1')
  })

  it('Enter selects the child', () => {
    const layer = createDungeonLayer('Layer 1')
    const a = asset('asset-1')
    layer.children = [a]
    useStore.getState().addLayer(layer)

    renderChild(a, findDungeonLayer(layer.id))
    fireEvent.keyDown(screen.getByTestId('child-row'), { key: 'Enter' })
    expect(useStore.getState().selection.selectedIds).toEqual([a.id])
  })

  it('F2 starts rename', () => {
    const layer = createDungeonLayer('Layer 1')
    const a = asset('asset-1')
    layer.children = [a]
    useStore.getState().addLayer(layer)

    renderChild(a, findDungeonLayer(layer.id))
    fireEvent.keyDown(screen.getByTestId('child-row'), { key: 'F2' })
    expect(screen.getByLabelText(`Rename ${a.name}`)).toBeTruthy()
  })

  it('Space toggles visibility', () => {
    const layer = createDungeonLayer('Layer 1')
    const a = asset('asset-1')
    layer.children = [a]
    useStore.getState().addLayer(layer)

    renderChild(a, findDungeonLayer(layer.id))
    fireEvent.keyDown(screen.getByTestId('child-row'), { key: ' ' })
    expect(findDungeonLayer(layer.id).children[0].visible).toBe(false)
  })

  it('Delete removes an unlocked child', () => {
    const layer = createDungeonLayer('Layer 1')
    const a = asset('asset-1')
    layer.children = [a]
    useStore.getState().addLayer(layer)

    renderChild(a, findDungeonLayer(layer.id))
    fireEvent.keyDown(screen.getByTestId('child-row'), { key: 'Delete' })
    expect(findDungeonLayer(layer.id).children).toHaveLength(0)
  })

  it('Delete is blocked on a locked layer, same as the menu path', () => {
    const layer = createDungeonLayer('Layer 1')
    const a = asset('asset-1')
    layer.children = [a]
    useStore.getState().addLayer(layer)
    useStore.getState().updateLayer(layer.id, { locked: true })
    const warn = vi.spyOn(notify, 'warning').mockImplementation(() => {})

    renderChild(a, findDungeonLayer(layer.id))
    fireEvent.keyDown(screen.getByTestId('child-row'), { key: 'Delete' })
    expect(findDungeonLayer(layer.id).children).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith('Layer is locked')

    warn.mockRestore()
  })

  // Same nested-control guard as LayerRow — see its test for why this matters.
  it('ignores keys that bubble up from the eye button, not the row itself', () => {
    const layer = createDungeonLayer('Layer 1')
    const a = asset('asset-1')
    layer.children = [a]
    useStore.getState().addLayer(layer)

    renderChild(a, findDungeonLayer(layer.id))
    const eyeButton = screen.getAllByRole('button').find((b) => b.getAttribute('aria-label') === `Hide ${a.name}`)!
    fireEvent.keyDown(eyeButton, { key: ' ' })
    expect(findDungeonLayer(layer.id).children[0].visible).toBe(true)
  })
})
