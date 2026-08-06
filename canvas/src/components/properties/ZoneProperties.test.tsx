import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ZoneProperties } from './ZoneProperties'
import { useStore } from '@/store/store'
import { undoManager } from '@/store/undoManager'
import type { DungeonLayer, TriggerDef, ZoneChild } from '@/store/types'

const ZONE: ZoneChild = {
  id: 'zone-1',
  name: 'Zone',
  childType: 'zone',
  visible: true,
  shape: { kind: 'point', position: { x: 1, y: 1 } },
}

function dungeon(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon')
  if (!l) throw new Error('no dungeon layer')
  return l
}

/** Seeds one trigger on ZONE with the given actions and expands it in the rendered panel. */
function renderExpanded(trigger: TriggerDef) {
  useStore.getState().addChild(dungeon().id, ZONE)
  useStore.getState().upsertTrigger(trigger)
  render(<ZoneProperties layerId={dungeon().id} childId={ZONE.id} />)
  fireEvent.click(screen.getByText(trigger.name))
}

const BASE_TRIGGER = {
  id: 't1',
  name: 'Trigger 1',
  when: { kind: 'room-revealed', zoneId: ZONE.id },
  once: true,
  enabled: true,
} as const

describe('ZoneProperties', () => {
  beforeEach(() => {
    undoManager.clear()
    useStore.getState().resetToDefault()
  })

  it('builds the environment action\'s time/weather options from the shared vocab, capitalized (N4)', () => {
    renderExpanded({ ...BASE_TRIGGER, actions: [{ kind: 'environment' }] })

    // `PropertyField`'s own group label also matches "Time"/"Weather" by text, so pin down
    // the actual <select> (the one carrying its own `aria-label`) rather than the group div.
    const time = screen.getAllByLabelText('Time').find((el) => el.tagName === 'SELECT')!
    expect(time.querySelector('option[value="dawn"]')).toHaveProperty('textContent', 'Dawn')
    expect(time.querySelector('option[value="dusk"]')).toHaveProperty('textContent', 'Dusk')

    const weather = screen.getAllByLabelText('Weather').find((el) => el.tagName === 'SELECT')!
    expect(weather.querySelector('option[value="storm"]')).toHaveProperty('textContent', 'Storm')
    expect(weather.querySelector('option[value="snow"]')).toHaveProperty('textContent', 'Snow')
  })

  it('a light action defaults "Show to players" on and writes action.toPlayers when toggled (O1)', () => {
    renderExpanded({
      ...BASE_TRIGGER,
      actions: [{ kind: 'light', lightId: '', on: true }],
    })

    const toggle = screen.getByRole('switch', { name: 'Show to players' })
    expect(toggle).toHaveProperty('ariaChecked', 'true')

    fireEvent.click(toggle)

    const stored = useStore.getState().prep!.triggers[0]!.actions[0]
    expect(stored).toMatchObject({ kind: 'light', toPlayers: false })
    expect(screen.getByRole('switch', { name: 'Show to players' })).toHaveProperty('ariaChecked', 'false')
  })

  it('an explicit toPlayers: false on the light action renders off, not the default', () => {
    renderExpanded({
      ...BASE_TRIGGER,
      actions: [{ kind: 'light', lightId: '', on: true, toPlayers: false }],
    })

    expect(screen.getByRole('switch', { name: 'Show to players' })).toHaveProperty('ariaChecked', 'false')
  })
})
