import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ShapeTextureProperties } from './ShapeTextureProperties'
import { useStore } from '@/store/store'
import { undoManager } from '@/store/undoManager'
import type { DungeonLayer, ShapeChild } from '@/store/types'

// The real picker paints pack thumbnails, and jsdom has no 2D context. Nothing
// here is about thumbnails — swap it for a button that reports the chosen id.
vi.mock('./TexturePicker', () => ({
  TexturePicker: ({
    value,
    onChange,
  }: {
    value?: string
    onChange: (v: string | undefined) => void
  }) => (
    <button data-testid="texture-picker" onClick={() => onChange('cave-floor-b-02')}>
      {value ?? 'none'}
    </button>
  ),
}))

function dungeon(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon')
  if (!l) throw new Error('no dungeon layer')
  return l
}

function shape(id: string, offsetX: number): ShapeChild {
  return {
    id,
    name: id,
    childType: 'shape',
    visible: true,
    shapeType: 'rectangle',
    contours: [[[0, 0], [4, 0], [4, 4], [0, 4]]],
    roughnessEnabled: false,
    textureId: 'large-flagstone-a-01',
    textureScale: 0.25,
    textureOffsetX: offsetX,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
  }
}

function shapeById(id: string): ShapeChild {
  const c = dungeon().children.find((x) => x.id === id)
  if (!c || c.childType !== 'shape') throw new Error(`no shape ${id}`)
  return c
}

function renderPanel() {
  const { rerender } = render(
    <ShapeTextureProperties
      layer={dungeon()}
      openSections={new Set(['texture-fill'])}
      onToggleSection={() => {}}
    />,
  )
  // The panel reads its values off the `layer` prop, so the live edit has to be
  // fed back in the way the real parent does — otherwise the commit-on-blur sees
  // an unchanged value and never fires.
  return () =>
    rerender(
      <ShapeTextureProperties
        layer={dungeon()}
        openSections={new Set(['texture-fill'])}
        onToggleSection={() => {}}
      />,
    )
}

describe('ShapeTextureProperties — texture edits are undoable', () => {
  beforeEach(() => {
    undoManager.clear()
    useStore.getState().resetToDefault()
    // Two shapes that do NOT share an offset. One shared value would hide the
    // defect this file exists for.
    useStore.getState().addChild(dungeon().id, shape('a', 1))
    useStore.getState().addChild(dungeon().id, shape('b', 7))
  })

  it('undo restores each shape its own previous offset, not the panel value', () => {
    const sync = renderPanel()

    // The Offset X box shows the first shape's value.
    const input = screen
      .getAllByRole('spinbutton')
      .find((el) => (el as HTMLInputElement).value === '1') as HTMLInputElement
    expect(input).toBeTruthy()

    act(() => {
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: '5' } })
    })
    sync()

    // Live edit reached every shape...
    expect(shapeById('a').textureOffsetX).toBe(5)
    expect(shapeById('b').textureOffsetX).toBe(5)

    act(() => {
      fireEvent.blur(input)
    })

    // ...and the commit recorded exactly one undo entry for it.
    expect(undoManager.canUndo()).toBe(true)

    act(() => {
      undoManager.undo()
    })

    // The whole point: 'b' goes back to 7, not to the 1 the panel was showing.
    expect(shapeById('a').textureOffsetX).toBe(1)
    expect(shapeById('b').textureOffsetX).toBe(7)
  })

  it('a live drag with no commit leaves the store consistent to undo later', () => {
    const sync = renderPanel()
    const input = screen
      .getAllByRole('spinbutton')
      .find((el) => (el as HTMLInputElement).value === '1') as HTMLInputElement

    act(() => {
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: '3' } })
    })
    sync()
    act(() => {
      fireEvent.blur(input)
    })
    act(() => {
      undoManager.undo()
    })
    act(() => {
      undoManager.redo()
    })

    expect(shapeById('a').textureOffsetX).toBe(3)
    expect(shapeById('b').textureOffsetX).toBe(3)
  })
})
