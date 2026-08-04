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

// K1: row keyboard contract — Enter/F2/Space/Delete on the focused row div.
// Guarded on target===currentTarget in the handler, so these fire the keydown
// directly on the row element (as focus + a real keypress would put it),
// not via fireEvent bubbling from a nested button.
describe('LayerRow — row keyboard contract (K1)', () => {
  beforeEach(() => {
    undoManager.clear()
    useStore.getState().resetToDefault()
  })

  it('is a treeitem, roving-tabbable only when active', () => {
    const [layer1] = dungeonLayers()
    renderRow(layer1)
    const row = screen.getByTestId('layer-row')
    expect(row.getAttribute('role')).toBe('treeitem')
    expect(row.getAttribute('aria-selected')).toBe('false')
    expect(row.getAttribute('tabindex')).toBe('-1')
  })

  it('is tabIndex 0 and aria-selected when active', () => {
    const [layer1] = dungeonLayers()
    render(
      <DndContext>
        <SortableContext items={[layer1.id]}>
          <LayerRow layer={layer1} isActive={true} />
        </SortableContext>
      </DndContext>,
    )
    const row = screen.getByTestId('layer-row')
    expect(row.getAttribute('aria-selected')).toBe('true')
    expect(row.getAttribute('tabindex')).toBe('0')
  })

  it('Enter selects the layer', () => {
    const layer2 = createDungeonLayer('Layer 2')
    useStore.getState().addLayer(layer2)
    renderRow(layer2)
    fireEvent.keyDown(screen.getByTestId('layer-row'), { key: 'Enter' })
    expect(useStore.getState().ui.activeLayerId).toBe(layer2.id)
  })

  it('F2 starts rename — the row switches to the editable name input', () => {
    const [layer1] = dungeonLayers()
    renderRow(layer1)
    fireEvent.keyDown(screen.getByTestId('layer-row'), { key: 'F2' })
    expect(screen.getByLabelText(`Rename ${layer1.name}`)).toBeTruthy()
  })

  it('Space toggles visibility', () => {
    const [layer1] = dungeonLayers()
    renderRow(layer1)
    fireEvent.keyDown(screen.getByTestId('layer-row'), { key: ' ' })
    expect(useStore.getState().layers.find((l) => l.id === layer1.id)?.visible).toBe(false)
  })

  it('Delete removes an unlocked layer', () => {
    const [layer1] = dungeonLayers()
    renderRow(layer1)
    fireEvent.keyDown(screen.getByTestId('layer-row'), { key: 'Delete' })
    expect(useStore.getState().layers.some((l) => l.id === layer1.id)).toBe(false)
  })

  it('Delete is a no-op on the background row', () => {
    const bg = useStore.getState().layers.find((l) => l.type === 'background')!
    renderRow(bg)
    fireEvent.keyDown(screen.getByTestId('layer-row'), { key: 'Delete' })
    expect(useStore.getState().layers.some((l) => l.id === bg.id)).toBe(true)
  })

  // Guard: a keydown bubbling up from a nested control (e.g. the eye button,
  // which is itself focusable by click) must not re-trigger the row's own
  // shortcut — that's the exact double-fire shape ToggleSwitch had (K4).
  it('ignores keys that bubble up from a nested control, not the row itself', () => {
    const [layer1] = dungeonLayers()
    renderRow(layer1)
    const eyeButton = screen.getByTestId('layer-visibility-toggle')
    fireEvent.keyDown(eyeButton, { key: ' ' })
    // toggleVisibility only fired via the row handler if target===currentTarget
    // failed to guard — it shouldn't have fired at all here (no click, no
    // native activation simulated by fireEvent).
    expect(useStore.getState().layers.find((l) => l.id === layer1.id)?.visible).toBe(true)
  })

  it('ArrowRight expands a dungeon layer with children, ArrowLeft collapses it', () => {
    const layer = createDungeonLayer('Layer 2')
    layer.children = [{
      id: 'c1', name: 'c1', childType: 'shape', visible: true, geometry: [], style: {} as never,
    } as never]
    useStore.getState().addLayer(layer)
    renderRow(useStore.getState().layers.find((l) => l.id === layer.id) as DungeonLayer)

    const row = screen.getByTestId('layer-row')
    fireEvent.keyDown(row, { key: 'ArrowRight' })
    expect(useStore.getState().ui.expandedLayerIds).toContain(layer.id)
    fireEvent.keyDown(row, { key: 'ArrowLeft' })
    expect(useStore.getState().ui.expandedLayerIds).not.toContain(layer.id)
  })

  // M3 (APG treeview contract): ArrowLeft on a child moves focus up to its
  // parent layer row.
  it('ArrowLeft on an expanded child row moves focus to the parent layer row', () => {
    const layer = createDungeonLayer('Layer 2')
    layer.children = [{
      id: 'c1', name: 'c1', childType: 'shape', visible: true, geometry: [], style: {} as never,
    } as never]
    useStore.getState().addLayer(layer)
    renderRow(useStore.getState().layers.find((l) => l.id === layer.id) as DungeonLayer)

    const row = screen.getByTestId('layer-row')
    fireEvent.keyDown(row, { key: 'ArrowRight' })
    const childRow = screen.getByTestId('child-row')
    fireEvent.keyDown(childRow, { key: 'ArrowLeft' })

    expect(document.activeElement).toBe(row)
  })
})

// H1: delete used to leave focus wherever the row happened to be, which was
// nowhere once the row unmounted — focus dropped to <body>. Needs a real
// role="tree" ancestor to find a neighbor in (the same query
// LayerPanel's own arrow-key handler uses), so these render their own tree
// container rather than using the bare renderRow() helper above. This static
// list doesn't reactively drop the deleted row from the DOM the way the real
// LayerPanel would (it isn't subscribed to the store), so assertions target
// the captured neighbor element itself rather than a single-match query.
describe('LayerRow — delete focus handoff (H1)', () => {
  beforeEach(() => {
    undoManager.clear()
    useStore.getState().resetToDefault()
  })

  function renderTree(layers: Layer[]) {
    return render(
      <div role="tree">
        <DndContext>
          <SortableContext items={layers.map((l) => l.id)}>
            {layers.map((l) => (
              <LayerRow key={l.id} layer={l} isActive={false} />
            ))}
          </SortableContext>
        </DndContext>
      </div>,
    )
  }

  it('focuses the next row after deleting a row that has one', () => {
    const layer2 = createDungeonLayer('Layer 2')
    useStore.getState().addLayer(layer2)
    const [layer1, layer2Live] = dungeonLayers()
    renderTree([layer1, layer2Live])

    const rows = screen.getAllByTestId('layer-row')
    fireEvent.keyDown(rows[0], { key: 'Delete' })

    expect(useStore.getState().layers.some((l) => l.id === layer1.id)).toBe(false)
    expect(document.activeElement).toBe(rows[1])
  })

  it('falls back to the previous row when deleting the last row', () => {
    const layer2 = createDungeonLayer('Layer 2')
    useStore.getState().addLayer(layer2)
    const [layer1, layer2Live] = dungeonLayers()
    renderTree([layer1, layer2Live])

    const rows = screen.getAllByTestId('layer-row')
    fireEvent.keyDown(rows[1], { key: 'Delete' })

    expect(useStore.getState().layers.some((l) => l.id === layer2Live.id)).toBe(false)
    expect(document.activeElement).toBe(rows[0])
  })
})

// H1: rename via the context menu races the menu's own focus-restore
// against InlineEditableName's autoFocus input — the input has to win.
describe('LayerRow — rename via context menu focus race (H1)', () => {
  beforeEach(() => {
    undoManager.clear()
    useStore.getState().resetToDefault()
  })

  it('lands focus on the rename input, not back on the row', () => {
    const [layer1] = dungeonLayers()
    renderRow(layer1)
    const row = screen.getByTestId('layer-row')
    row.focus()

    fireEvent.contextMenu(row)
    fireEvent.click(screen.getByText('Rename'))

    expect(document.activeElement).toBe(screen.getByLabelText(`Rename ${layer1.name}`))
  })

  it('Escape-cancel out of rename returns focus to the row', () => {
    const [layer1] = dungeonLayers()
    renderRow(layer1)
    const row = screen.getByTestId('layer-row')
    fireEvent.keyDown(row, { key: 'F2' })

    const input = screen.getByLabelText(`Rename ${layer1.name}`)
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(document.activeElement).toBe(row)
  })
})
