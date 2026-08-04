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

// H1: delete used to leave focus nowhere once the row unmounted. Needs a
// real role="tree" ancestor to find a neighbor in (same as LayerRow's H1
// tests). This static list doesn't reactively drop the deleted row from the
// DOM the way a real expanded LayerRow would (it isn't subscribed to the
// store), so assertions target the captured neighbor element itself rather
// than a single-match query.
describe('ChildRow — delete focus handoff (H1)', () => {
  beforeEach(() => {
    undoManager.clear()
    useStore.getState().resetToDefault()
  })

  function renderTree(children: AssetChild[], layer: DungeonLayer) {
    return render(
      <div role="tree">
        <DndContext>
          <SortableContext items={children.map((c) => c.id)}>
            {children.map((c) => (
              <ChildRow key={c.id} child={c} layer={layer} />
            ))}
          </SortableContext>
        </DndContext>
      </div>,
    )
  }

  it('focuses the next row after deleting a row that has one', () => {
    const layer = createDungeonLayer('Layer 1')
    const a1 = asset('asset-1')
    const a2 = asset('asset-2')
    layer.children = [a1, a2]
    useStore.getState().addLayer(layer)

    renderTree([a1, a2], findDungeonLayer(layer.id))
    const rows = screen.getAllByTestId('child-row')
    fireEvent.keyDown(rows[0], { key: 'Delete' })

    expect(findDungeonLayer(layer.id).children).toHaveLength(1)
    expect(document.activeElement).toBe(rows[1])
  })

  it('falls back to the previous row when deleting the last row', () => {
    const layer = createDungeonLayer('Layer 1')
    const a1 = asset('asset-1')
    const a2 = asset('asset-2')
    layer.children = [a1, a2]
    useStore.getState().addLayer(layer)

    renderTree([a1, a2], findDungeonLayer(layer.id))
    const rows = screen.getAllByTestId('child-row')
    fireEvent.keyDown(rows[1], { key: 'Delete' })

    expect(findDungeonLayer(layer.id).children).toHaveLength(1)
    expect(document.activeElement).toBe(rows[0])
  })
})

// L4: the context menu portal sits inside the row's React tree, so an
// un-stopped click on a menu item bubbled up to the row's own onClick —
// clicking Delete removed the child, then the row's handleClick re-added
// its (now-deleted) id to selectedIds.
describe('ChildRow — menu click does not bubble to the row (L4)', () => {
  beforeEach(() => {
    undoManager.clear()
    useStore.getState().resetToDefault()
  })

  it('menu Delete leaves selectedIds without the deleted id', () => {
    const layer = createDungeonLayer('Layer 1')
    const a = asset('asset-1')
    layer.children = [a]
    useStore.getState().addLayer(layer)
    useStore.getState().setSelectedIds([a.id])

    renderChild(a, findDungeonLayer(layer.id))
    fireEvent.contextMenu(screen.getByTestId('child-row'))
    fireEvent.click(screen.getByText('Delete'))

    expect(useStore.getState().selection.selectedIds).not.toContain(a.id)
  })
})
