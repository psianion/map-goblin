import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConnectorProperties } from './ConnectorProperties'
import { useStore } from '@/store/store'
import { undoManager } from '@/store/undoManager'
import { AddChildCommand } from '@/store/commands'
import type { ConnectorChild } from '@/shared/types'
import type { DungeonLayer } from '@/store/types'

function dungeon(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon')
  if (!l) throw new Error('no dungeon layer')
  return l
}

function connector(): ConnectorChild {
  const c = dungeon().children.find((x): x is ConnectorChild => x.childType === 'connector')
  if (!c) throw new Error('no connector child')
  return c
}

const JOINT: ConnectorChild = {
  id: 'joint-1',
  name: 'North Passage',
  childType: 'connector',
  visible: true,
  kind: 'arch',
  state: 'open',
  isSecret: false,
  contours: [[[0, 0], [2, 0], [2, 1], [0, 1]]],
}

function renderPanel() {
  return render(<ConnectorProperties layerId={dungeon().id} childId="joint-1" />)
}

describe('ConnectorProperties', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault()
    undoManager.clear()
    undoManager.execute(new AddChildCommand('Add connector', dungeon().id, JOINT))
  })

  it('shows no state control for an arch — an arch is always open', () => {
    renderPanel()
    expect(screen.getByDisplayValue('North Passage')).toBeDefined()
    expect(screen.queryByText('State')).toBeNull()
  })

  it('flips arch to door as one undo entry and shuts it, matching the tool default', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('Connector kind'), { target: { value: 'door' } })
    expect(connector().kind).toBe('door')
    expect(connector().state).toBe('closed')
    undoManager.undo()
    expect(connector().kind).toBe('arch')
    expect(connector().state).toBe('open')
  })

  it('exposes state and secret on a door-kind joint', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('Connector kind'), { target: { value: 'door' } })
    fireEvent.change(screen.getByLabelText('Connector state'), { target: { value: 'locked' } })
    expect(connector().state).toBe('locked')
    fireEvent.click(screen.getByRole('switch', { name: 'Secret passage' }))
    expect(connector().isSecret).toBe(true)
  })

  it('flipping back to arch keeps the shut state for the twin to ignore', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('Connector kind'), { target: { value: 'door' } })
    fireEvent.change(screen.getByLabelText('Connector kind'), { target: { value: 'arch' } })
    expect(connector().kind).toBe('arch')
    expect(connector().state).toBe('closed')
  })
})
