import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { LayerProperties } from './LayerProperties'
import { useStore } from '@/store/store'
import { undoManager } from '@/store/undoManager'
import type { DungeonLayer } from '@/store/types'

function dungeon(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon')
  if (!l) throw new Error('no dungeon layer')
  return l
}

// PropertyField wires its label to the field via aria-labelledby on a
// role="group" wrapper (arbitrary children rule out a real htmlFor — see
// PropertyField.tsx) — the group carries the accessible name, not the input
// inside it, so tests reach the control through the named group.
function wallWidthSlider() {
  return within(screen.getByRole('group', { name: 'Wall Width' })).getByRole('slider')
}

// D4: Floor Color, Wall Width, Wall Tint, Edge Transition width, and
// Roughness amplitude used to route through the no-undo `patch()` only —
// releasing the slider/picker left nothing on the undo stack. Wall Width is
// the representative case here; the rest share the same commitStyleField
// wiring (PropertyCommand on release, patch() still driving the live drag).
describe('LayerProperties — layer-style undo (D4)', () => {
  beforeEach(() => {
    undoManager.clear()
    useStore.getState().resetToDefault()
  })

  it('live-previews during drag with no undo entry, then commits one entry on release', () => {
    render(
      <LayerProperties layer={dungeon()} openSections={new Set(['walls'])} onToggleSection={() => {}} />,
    )
    const slider = wallWidthSlider()
    const startWidth = dungeon().style.wallWidth
    const nextWidth = Number((startWidth + 0.05).toFixed(2))

    fireEvent.pointerDown(slider)
    fireEvent.change(slider, { target: { value: String(nextWidth) } })
    expect(dungeon().style.wallWidth).toBeCloseTo(nextWidth)
    expect(undoManager.canUndo()).toBe(false)

    fireEvent.pointerUp(slider, { target: { value: String(nextWidth) } })
    expect(undoManager.canUndo()).toBe(true)

    undoManager.undo()
    expect(dungeon().style.wallWidth).toBeCloseTo(startWidth)
  })

  it('does not commit when the value returns to its start (no-op release)', () => {
    render(
      <LayerProperties layer={dungeon()} openSections={new Set(['walls'])} onToggleSection={() => {}} />,
    )
    const slider = wallWidthSlider()
    const startWidth = dungeon().style.wallWidth

    fireEvent.pointerDown(slider)
    fireEvent.pointerUp(slider, { target: { value: String(startWidth) } })
    expect(undoManager.canUndo()).toBe(false)
  })
})
