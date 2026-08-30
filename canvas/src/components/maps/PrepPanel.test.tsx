import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PrepPanel } from './PrepPanel'
import { useStore } from '@/store/store'
import type { DungeonLayer, RoomNote, TriggerDef } from '@/store/types'

const zone = (id: string, name: string, shape: DungeonLayer['children'][number] extends never ? never : unknown) =>
  ({ id, name, childType: 'zone', visible: true, shape }) as DungeonLayer['children'][number]

function seedLayers() {
  const layer = {
    id: 'l1',
    type: 'dungeon',
    name: 'Dungeon',
    children: [
      zone('z-guard', 'Guard post', { kind: 'circle', position: { x: 10, y: 10 }, radius: 3 }),
      zone('z-shrine', 'Old shrine', { kind: 'point', position: { x: 50, y: 50 } }),
    ],
    // One room around the guard post only — the shrine pin sits outside every room.
    rooms: [{ id: 'r1', boundary: [[0, 0], [20, 0], [20, 20], [0, 20]] }],
  } as unknown as DungeonLayer
  useStore.setState({ layers: [layer] })
}

const trigger = (over: Partial<TriggerDef> & Pick<TriggerDef, 'id' | 'when'>): TriggerDef => ({
  name: over.id,
  actions: [],
  once: true,
  enabled: true,
  ...over,
})

const note = (over: Partial<RoomNote> & Pick<RoomNote, 'id' | 'zoneId'>): RoomNote => ({
  title: 'Note',
  body: '',
  imageKeys: [],
  showOnReveal: false,
  ...over,
})

describe('PrepPanel', () => {
  beforeEach(() => {
    cleanup()
    useStore.getState().resetToDefault()
    useStore.setState({ prep: null })
  })

  it('shows the zone-tool empty state with no prep', () => {
    render(<PrepPanel />)
    expect(screen.getByTestId('prep-panel-empty')).not.toBeNull()
    expect(screen.getByText(/Zone tool/)).not.toBeNull()
  })

  it('groups rows by zone, summarizes, and badges Pops and Inert', () => {
    seedLayers()
    useStore.setState({
      prep: {
        version: 2,
        triggers: [
          trigger({
            id: 't-trap',
            name: 'Bear trap',
            when: { kind: 'enter-region', zoneId: 'z-guard' },
            actions: [{ kind: 'trap', text: 'Snap!', save: { ability: 'dex', dc: 13 }, damage: '2d6' }],
          }),
          trigger({
            id: 't-ambush',
            name: 'Goblin ambush',
            when: { kind: 'enter-region', zoneId: 'z-guard' },
            actions: [
              {
                kind: 'encounter',
                name: 'Goblin ambush',
                spawn: true,
                seedInitiative: true,
                monsters: [
                  { id: 'm1', name: 'Skirmisher', count: 3 },
                  { id: 'm2', name: 'Warg', count: 1 },
                ],
              },
            ],
          }),
          // A room-revealed pin outside every room — the client-side inert mirror.
          trigger({
            id: 't-orphan',
            name: 'Brazier lights',
            when: { kind: 'room-revealed', zoneId: 'z-shrine' },
          }),
          // Anchor gone entirely.
          trigger({ id: 't-lost', name: 'Lost trigger', when: { kind: 'enter-region', zoneId: 'z-gone' } }),
        ],
        notes: [
          note({ id: 'n1', zoneId: 'z-guard', title: 'Read-aloud: first sight', showOnReveal: true, imageKeys: ['k1'] }),
        ],
      },
    })

    render(<PrepPanel />)

    expect(screen.getByText('Guard post')).not.toBeNull()
    expect(screen.getByText('Old shrine')).not.toBeNull()
    expect(screen.getByText('Deleted zone')).not.toBeNull()

    expect(screen.getByText('Enter region → Trap · DC 13 DEX · 2d6')).not.toBeNull()
    expect(screen.getByText('Enter region → 3× Skirmisher, 1× Warg')).not.toBeNull()

    expect(screen.getByText('Read-aloud: first sight')).not.toBeNull()
    expect(screen.getByText('Pops')).not.toBeNull()
    expect(screen.getByText('Note · DM only · 1 image')).not.toBeNull()

    // Inert rows show the reason where the summary would be.
    expect(screen.getAllByText('Inert')).toHaveLength(2)
    expect(screen.getByText('pin not inside a room')).not.toBeNull()
    expect(screen.getByText('zone deleted')).not.toBeNull()
  })

  it('clicking a row selects its zone and opens the right panel', () => {
    seedLayers()
    useStore.setState({
      prep: {
        version: 2,
        triggers: [
          trigger({ id: 't1', name: 'Bear trap', when: { kind: 'enter-region', zoneId: 'z-guard' } }),
        ],
        notes: [],
      },
    })
    useStore.setState((s) => ({ ui: { ...s.ui, rightPanelOpen: false } }) as never)

    render(<PrepPanel />)
    fireEvent.click(screen.getByText('Bear trap'))

    expect(useStore.getState().selection.selectedIds).toEqual(['z-guard'])
    expect(useStore.getState().ui.rightPanelOpen).toBe(true)
  })
})
