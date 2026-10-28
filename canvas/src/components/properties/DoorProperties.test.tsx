import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DoorProperties } from './DoorProperties'
import { useStore } from '@/store/store'
import { undoManager } from '@/store/undoManager'
import { AddChildCommand } from '@/store/commands'
import type { DoorChild } from '@/shared/types'
import type { DungeonLayer } from '@/store/types'

function dungeon(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon')
  if (!l) throw new Error('no dungeon layer')
  return l
}

const WALL_DOOR: DoorChild = {
  id: 'door-1',
  name: 'Cell Door',
  childType: 'door',
  visible: true,
  wallId: '',
  position: [4, 4],
  angle: 0,
  width: 1,
  style: 'single',
  state: 'closed',
  isSecret: false,
}

describe('DoorProperties — a door on a wall', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault()
    undoManager.clear()
    undoManager.execute(new AddChildCommand('Place door', dungeon().id, WALL_DOOR))
  })

  it('keeps its width row and its state row', () => {
    render(<DoorProperties layerId={dungeon().id} childId="door-1" />)
    expect(screen.getByText('Width')).toBeDefined()
    expect(screen.getByText('State')).toBeDefined()
  })

  it('drops the state row once it is an archway', () => {
    render(<DoorProperties layerId={dungeon().id} childId="door-1" />)
    fireEvent.change(screen.getByLabelText('Door style'), {
      target: { value: 'archway' },
    })
    expect(screen.queryByText('State')).toBeNull()
  })
})
