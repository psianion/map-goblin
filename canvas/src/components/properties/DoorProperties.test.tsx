import { describe, it, expect, beforeEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { DoorProperties } from './DoorProperties'
import { useStore } from '@/store/store'
import { undoManager } from '@/store/undoManager'
import { AddChildCommand } from '@/store/commands'
import type { ConnectorChild, DoorChild } from '@/shared/types'
import type { DungeonLayer } from '@/store/types'

function dungeon(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon')
  if (!l) throw new Error('no dungeon layer')
  return l
}

function blob(): ConnectorChild {
  const c = dungeon().children.find((x): x is ConnectorChild => x.childType === 'connector')
  if (!c) throw new Error('no blob door')
  return c
}

// A door drawn as a blob between two rooms — no wall, no width, its geometry is
// its size. The panel is the same one a wall door gets.
const JOINT: ConnectorChild = {
  id: 'joint-1',
  name: 'North Passage',
  childType: 'connector',
  visible: true,
  kind: 'arch',
  state: 'open',
  isSecret: false,
  style: 'archway',
  contours: [[[0, 0], [2, 0], [2, 1], [0, 1]]],
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

function renderBlob() {
  return render(<DoorProperties layerId={dungeon().id} childId="joint-1" />)
}

describe('DoorProperties — a door drawn as a blob', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault()
    undoManager.clear()
    undoManager.execute(new AddChildCommand('Place door', dungeon().id, JOINT))
  })

  it('shows no state control for an archway — an archway is always open', () => {
    renderBlob()
    expect(screen.getByDisplayValue('North Passage')).toBeDefined()
    expect(screen.queryByText('State')).toBeNull()
  })

  it('has no width row — its size is the geometry the DM drew', () => {
    renderBlob()
    expect(screen.queryByText('Width')).toBeNull()
  })

  it('flips archway to door as one undo entry and shuts it, matching the tool default', () => {
    renderBlob()
    fireEvent.change(screen.getByLabelText('Door style'), {
      target: { value: 'single' },
    })
    expect(blob().style).toBe('single')
    expect(blob().kind).toBe('door')
    expect(blob().state).toBe('closed')
    act(() => {
      undoManager.undo()
    })
    expect(blob().style).toBe('archway')
    expect(blob().kind).toBe('arch')
    expect(blob().state).toBe('open')
  })

  it('exposes state and secret once it is a real door', () => {
    renderBlob()
    fireEvent.change(screen.getByLabelText('Door style'), {
      target: { value: 'single' },
    })
    fireEvent.change(screen.getByLabelText('Door state'), {
      target: { value: 'locked' },
    })
    expect(blob().state).toBe('locked')
    fireEvent.click(screen.getByRole('switch', { name: 'Secret door' }))
    expect(blob().isSecret).toBe(true)
  })

  it('flipping back to archway reopens it — nothing downstream can hold an arch shut', () => {
    renderBlob()
    fireEvent.change(screen.getByLabelText('Door style'), {
      target: { value: 'single' },
    })
    fireEvent.change(screen.getByLabelText('Door style'), {
      target: { value: 'archway' },
    })
    expect(blob().kind).toBe('arch')
    expect(blob().state).toBe('open')
  })

  it('reads a legacy blob with no style through its kind', () => {
    useStore.getState().resetToDefault()
    undoManager.clear()
    const legacy: ConnectorChild = { ...JOINT }
    delete legacy.style
    undoManager.execute(new AddChildCommand('Place door', dungeon().id, legacy))
    renderBlob()
    expect(screen.getByLabelText('Door style')).toHaveProperty('value', 'archway')
  })
})

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
