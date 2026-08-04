import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LayerPanel } from './LayerPanel'
import { resolveReorder } from './resolveReorder'
import { useStore } from '@/store/store'
import { undoManager } from '@/store/undoManager'
import { createDungeonLayer } from '@/store/factories'
import type { DungeonLayer } from '@/store/types'

function dungeonLayers(): DungeonLayer[] {
  return useStore.getState().layers.filter((l): l is DungeonLayer => l.type === 'dungeon')
}

// D2: drag-reorder used to have no lock check at all.
describe('resolveReorder', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault()
  })

  it('is a no-op when dropped on itself', () => {
    const [layer1] = dungeonLayers()
    expect(resolveReorder(useStore.getState().layers, layer1.id, layer1.id)).toBeNull()
  })

  it('blocks when the dragged layer is locked', () => {
    const layer2 = createDungeonLayer('Layer 2')
    useStore.getState().addLayer(layer2)
    useStore.getState().updateLayer(layer2.id, { locked: true })
    const [layer1] = dungeonLayers()

    const result = resolveReorder(useStore.getState().layers, layer2.id, layer1.id)
    expect(result).toEqual({ blocked: true })
  })

  it('computes actual array indices from visual (reversed) order, offset by the pinned background', () => {
    const layer2 = createDungeonLayer('Layer 2') // array: [bg, layer1, layer2]
    useStore.getState().addLayer(layer2)
    const [layer1] = dungeonLayers()

    // Visually layer2 is on top (index 0), layer1 below it (index 1).
    // Dragging layer2 onto layer1's slot should target actual index 1 (layer1's slot).
    const result = resolveReorder(useStore.getState().layers, layer2.id, layer1.id)
    expect(result).toEqual({ blocked: false, fromActual: 2, toActual: 1 })
  })

  // D6: the offset used to be a hardcoded +1 for exactly one pinned
  // background layer — this constructs a layers array with two pinned
  // (non-dungeon-type) entries ahead of the user stack to prove the offset
  // is actually derived from the count, not assumed.
  it('offset scales with more than one pinned non-dungeon layer', () => {
    const [layer1] = dungeonLayers()
    const layer2 = createDungeonLayer('Layer 2')
    const bg = useStore.getState().layers.find((l) => l.type === 'background')!
    const layers = [bg, { ...bg, id: 'bg-2' }, layer1, layer2]

    const result = resolveReorder(layers, layer2.id, layer1.id)
    expect(result).toEqual({ blocked: false, fromActual: 3, toActual: 2 })
  })
})

describe('LayerPanel — empty state', () => {
  beforeEach(() => {
    undoManager.clear()
    useStore.getState().resetToDefault()
  })

  it('shows a quiet empty state when there are no user layers', () => {
    for (const l of dungeonLayers()) useStore.getState().removeLayer(l.id)
    render(<LayerPanel />)
    expect(screen.getByText(/No layers yet/)).toBeDefined()
  })

  it('does not show the empty state when a dungeon layer exists', () => {
    render(<LayerPanel />)
    expect(screen.queryByText(/No layers yet/)).toBeNull()
  })
})

describe('LayerPanel — Terrain row context menu (D5c)', () => {
  beforeEach(() => {
    undoManager.clear()
    useStore.getState().resetToDefault()
  })

  it('opens a menu with Hide/Show and Reset opacity instead of the native menu', () => {
    render(<LayerPanel />)
    fireEvent.contextMenu(screen.getByTestId('terrain-row'))
    expect(screen.getByText('Hide')).toBeDefined()
    expect(screen.getByText('Reset opacity')).toBeDefined()
  })

  it('Reset opacity sets terrain opacity back to 1', () => {
    useStore.getState().setTerrainData({ opacity: 0.4 })
    render(<LayerPanel />)
    fireEvent.contextMenu(screen.getByTestId('terrain-row'))
    fireEvent.click(screen.getByText('Reset opacity'))
    expect(useStore.getState().mapSettings.terrain?.opacity).toBe(1)
  })
})

describe('LayerPanel — arrow navigation (K1)', () => {
  beforeEach(() => {
    undoManager.clear()
    useStore.getState().resetToDefault()
  })

  it('ArrowDown/ArrowUp/Home/End traverse reversed layers, then Terrain, then Background', () => {
    // Store order is [background, layer1, layer2] — the panel shows user
    // layers reversed (layer2 on top, visually and in the DOM), then the
    // pinned Terrain row, then the pinned Background row.
    const layer2 = createDungeonLayer('Layer 2')
    useStore.getState().addLayer(layer2)
    render(<LayerPanel />)

    const tree = screen.getByRole('tree')
    const rows = Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'))
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Layer 2', 'Layer 1', 'Terrain', 'Background',
    ])

    rows[0].focus()
    for (let i = 1; i < rows.length; i++) {
      fireEvent.keyDown(tree, { key: 'ArrowDown' })
      expect(document.activeElement).toBe(rows[i])
    }
    // Clamps at the end — one more ArrowDown stays put on Background.
    fireEvent.keyDown(tree, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[3])

    fireEvent.keyDown(tree, { key: 'Home' })
    expect(document.activeElement).toBe(rows[0])
    fireEvent.keyDown(tree, { key: 'End' })
    expect(document.activeElement).toBe(rows[3])
    fireEvent.keyDown(tree, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(rows[2])
  })

  // handleTreeKeyDown bails when document.activeElement isn't one of the
  // treeitems it tracks (current < 0) — the rename <input> is exactly that
  // case, and arrow keys there belong to text-cursor movement, not the tree.
  it('does not steal ArrowDown from a focused rename input', () => {
    const [layer1] = dungeonLayers()
    render(<LayerPanel />)
    const row = screen.getAllByTestId('layer-row').find((r) => r.getAttribute('aria-label') === layer1.name)!
    fireEvent.keyDown(row, { key: 'F2' })

    const input = screen.getByLabelText(`Rename ${layer1.name}`)
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(input)
  })
})
