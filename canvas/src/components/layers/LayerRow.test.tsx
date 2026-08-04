import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import { LayerRow } from './LayerRow'
import { useStore } from '@/store/store'
import { undoManager } from '@/store/undoManager'
import { createDungeonLayer } from '@/store/factories'
import type { DungeonLayer, Layer } from '@/store/types'

function dungeonLayers(): DungeonLayer[] {
  return useStore.getState().layers.filter((l): l is DungeonLayer => l.type === 'dungeon')
}

function renderRow(layer: Layer) {
  return render(
    <DndContext>
      <SortableContext items={[layer.id]}>
        <LayerRow layer={layer} isActive={false} />
      </SortableContext>
    </DndContext>,
  )
}

// D1: the eye icon used to render from EFFECTIVE visibility while the click
// wrote AUTHORED visibility — during solo, a non-soloed row showed EyeOff
// and clicking it hid the layer for real instead of just reading "soloed
// away". Icon/title now track layer.visible; row dimming (untested here,
// covered by the CSS-class assertion below) still tracks effective.
describe('LayerRow — solo eye semantics (D1)', () => {
  beforeEach(() => {
    undoManager.clear()
    useStore.getState().resetToDefault()
  })

  it('eye icon and data-visible reflect authored visibility even when solo-hidden', () => {
    const layer2 = createDungeonLayer('Layer 2')
    useStore.getState().addLayer(layer2)
    const [layer1] = dungeonLayers()
    useStore.getState().toggleSoloLayer(layer1.id) // layer2 effectively hidden, authored visible=true

    renderRow(layer2)
    const eye = screen.getByTestId('layer-visibility-toggle')
    expect(eye.getAttribute('data-visible')).toBe('true')
    expect(eye.getAttribute('data-effective')).toBe('false')
    expect(eye.getAttribute('title')).toMatch(/^Hide layer/)
  })

  it('row dims via effective visibility while solo-hidden', () => {
    const layer2 = createDungeonLayer('Layer 2')
    useStore.getState().addLayer(layer2)
    const [layer1] = dungeonLayers()
    useStore.getState().toggleSoloLayer(layer1.id)

    renderRow(layer2)
    expect(screen.getByTestId('layer-row').className).toContain('opacity-80')
  })

  it('clicking the eye on a non-soloed row during solo clears solo and never writes visible', () => {
    const layer2 = createDungeonLayer('Layer 2')
    useStore.getState().addLayer(layer2)
    const [layer1] = dungeonLayers()
    useStore.getState().toggleSoloLayer(layer1.id)

    renderRow(layer2)
    fireEvent.click(screen.getByTestId('layer-visibility-toggle'))

    expect(useStore.getState().ui.solo).toBeNull()
    expect(useStore.getState().layers.find((l) => l.id === layer2.id)?.visible).toBe(true)
  })

  it('clicking the soloed layer\'s own eye also just clears solo, keeping it visible', () => {
    const [layer1] = dungeonLayers()
    useStore.getState().toggleSoloLayer(layer1.id)

    renderRow(layer1)
    fireEvent.click(screen.getByTestId('layer-visibility-toggle'))

    expect(useStore.getState().ui.solo).toBeNull()
    expect(useStore.getState().layers.find((l) => l.id === layer1.id)?.visible).toBe(true)
  })

  it('eye click toggles visibility normally when solo is not active', () => {
    const [layer1] = dungeonLayers()
    renderRow(layer1)
    fireEvent.click(screen.getByTestId('layer-visibility-toggle'))
    expect(useStore.getState().layers.find((l) => l.id === layer1.id)?.visible).toBe(false)
  })

  // F5: background is exempt from solo (always effectively visible), so its
  // eye must keep toggling its own visibility during solo instead of reading
  // as a solo control — the clearSolo-and-return branch only applies to
  // dungeon layers.
  it('clicking the background eye during solo toggles its own visibility, not just solo', () => {
    const [layer1] = dungeonLayers()
    useStore.getState().toggleSoloLayer(layer1.id)
    const bg = useStore.getState().layers.find((l) => l.type === 'background')!

    renderRow(bg)
    fireEvent.click(screen.getByTestId('layer-visibility-toggle'))

    // toggleVisibility() is an explicit visibility edit — it drops solo as a
    // side effect the same way it does everywhere else (see toggleVisibility's
    // own comment), the fix here is only that background's visibility itself
    // actually flips instead of the click being swallowed as a solo-exit.
    expect(useStore.getState().layers.find((l) => l.id === bg.id)?.visible).toBe(false)
  })
})

// D2: deleteLayer used to have no guard at all — a locked layer could be
// deleted straight through the context menu.
describe('LayerRow — locked layer delete guard (D2)', () => {
  beforeEach(() => {
    undoManager.clear()
    useStore.getState().resetToDefault()
  })

  it('blocks delete and warns when the layer is locked', () => {
    const [layer1] = dungeonLayers()
    useStore.getState().updateLayer(layer1.id, { locked: true })
    // Re-read after the update — updateLayer produces a new layer object
    // (immer), so the pre-update `layer1` reference would render stale.
    renderRow(dungeonLayers()[0])

    fireEvent.contextMenu(screen.getByTestId('layer-row'))
    const deleteItem = screen.getByText('Delete Layer')
    fireEvent.click(deleteItem)

    expect(useStore.getState().layers.some((l) => l.id === layer1.id)).toBe(true)
  })

  it('deletes normally when unlocked', () => {
    const [layer1] = dungeonLayers()
    renderRow(layer1)

    fireEvent.contextMenu(screen.getByTestId('layer-row'))
    fireEvent.click(screen.getByText('Delete Layer'))

    expect(useStore.getState().layers.some((l) => l.id === layer1.id)).toBe(false)
  })

  // F3: delete used to route through blockedLayerReason, which also refuses
  // an effectively-hidden (non-soloed) layer with "Layer is hidden" — but
  // deleting a layer you aren't currently looking at is legitimate and
  // undoable, so only a lock should stop it.
  it('deletes a non-soloed (effectively hidden) unlocked layer', () => {
    const layer2 = createDungeonLayer('Layer 2')
    useStore.getState().addLayer(layer2)
    const [layer1] = dungeonLayers()
    useStore.getState().toggleSoloLayer(layer1.id) // layer2 is now effectively hidden

    renderRow(useStore.getState().layers.find((l) => l.id === layer2.id) as DungeonLayer)

    fireEvent.contextMenu(screen.getByTestId('layer-row'))
    fireEvent.click(screen.getByText('Delete Layer'))

    expect(useStore.getState().layers.some((l) => l.id === layer2.id)).toBe(false)
  })
})
