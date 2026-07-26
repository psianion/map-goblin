import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { RoomPanel } from './RoomPanel'
import { useStore } from '@/store/store'
import { undoManager } from '@/store/undoManager'
import type { DungeonLayer, Room } from '@/store/types'

const ROOMS: Room[] = [
  {
    id: 'r1',
    name: 'Cave Mouth',
    boundary: [[0, 0], [10, 0], [10, 10], [0, 10]],
    centroid: [5, 5],
    area: 100,
    isPathway: false,
  },
  {
    id: 'r2',
    name: 'Corridor 2',
    boundary: [[0, 0], [10, 0], [10, 1], [0, 1]],
    centroid: [5, 0.5],
    area: 10,
    isPathway: true,
  },
]

function dungeon(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon')
  if (!l) throw new Error('no dungeon layer')
  return l
}

function renderPanel() {
  return render(
    <RoomPanel layer={dungeon()} openSections={new Set(['rooms'])} onToggleSection={() => {}} />,
  )
}

describe('RoomPanel', () => {
  beforeEach(() => {
    undoManager.clear()
    useStore.getState().resetToDefault()
    useStore.getState().setRooms(dungeon().id, ROOMS)
  })

  it('lists detected rooms and badges the pathway', () => {
    renderPanel()
    expect(screen.getByText('Cave Mouth')).toBeDefined()
    expect(screen.getByText('Corridor 2')).toBeDefined()
    expect(screen.getAllByText('pathway')).toHaveLength(1)
  })

  it('prompts to draw walls when nothing is detected', () => {
    useStore.getState().setRooms(dungeon().id, [])
    renderPanel()
    expect(screen.getByText(/draw walls/i)).toBeDefined()
  })

  it('highlights the room on the canvas while hovered', () => {
    renderPanel()
    fireEvent.mouseEnter(screen.getByText('Cave Mouth'))
    expect(useStore.getState().ui.highlightedRoomId).toBe('r1')

    fireEvent.mouseLeave(screen.getByText('Cave Mouth'))
    expect(useStore.getState().ui.highlightedRoomId).toBeNull()
  })

  it('keeps the clicked room highlighted after the pointer leaves', () => {
    renderPanel()
    fireEvent.click(screen.getByText('Cave Mouth'))
    fireEvent.mouseLeave(screen.getByText('Cave Mouth'))
    expect(useStore.getState().ui.highlightedRoomId).toBe('r1')
  })

  it('renames inline, records the override, and undoes', () => {
    renderPanel()
    fireEvent.doubleClick(screen.getByText('Cave Mouth'))

    const input = screen.getByLabelText('Rename Cave Mouth')
    fireEvent.change(input, { target: { value: "Klarg's Cave" } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(dungeon().rooms?.[0].name).toBe("Klarg's Cave")
    expect(dungeon().roomNameOverrides?.r1).toBe("Klarg's Cave")

    act(() => undoManager.undo())
    expect(dungeon().rooms?.[0].name).toBe('Cave Mouth')
  })
})
