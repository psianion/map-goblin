import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LayerHeader } from './LayerHeader'
import { useStore } from '@/store/store'
import { undoManager } from '@/store/undoManager'
import type { DungeonLayer } from '@/store/types'

function dungeonLayerNames(): string[] {
  return useStore.getState().layers.filter((l): l is DungeonLayer => l.type === 'dungeon').map((l) => l.name)
}

// K7b: naming used to be `Layer ${count + 1}` — deleting a middle layer
// dropped the count, so the next Add reused a name still on another layer.
describe('LayerHeader — new layer naming (K7b)', () => {
  beforeEach(() => {
    undoManager.clear()
    useStore.getState().resetToDefault()
  })

  it('derives the next name from the highest existing "Layer N" suffix, not the count', () => {
    render(<LayerHeader />)
    const addButton = screen.getByRole('button', { name: 'Add layer' })

    fireEvent.click(addButton) // -> Layer 2 (Layer 1 exists by default)
    fireEvent.click(addButton) // -> Layer 3
    expect(dungeonLayerNames()).toEqual(['Layer 1', 'Layer 2', 'Layer 3'])

    const layer2 = useStore.getState().layers.find((l) => l.name === 'Layer 2')!
    useStore.getState().removeLayer(layer2.id)
    expect(dungeonLayerNames()).toEqual(['Layer 1', 'Layer 3'])

    fireEvent.click(addButton) // count-based naming would collide back into "Layer 3"
    expect(dungeonLayerNames()).toEqual(['Layer 1', 'Layer 3', 'Layer 4'])
  })
})
