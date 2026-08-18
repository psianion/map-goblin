// The recap accumulator (plan §4): one state machine fed the observer's event stream, read
// two ways — `live()` drives the session embed, `recap()` is what the session-end post and
// the sessions row are built from. Pure and synchronous; the only clock it sees is the one
// passed in.
//
// The split that matters is live vs cumulative. A reconnect delivers a fresh `session-state`
// snapshot, and that snapshot *replaces* the live view (who is here, which scene) because
// the events that changed it were missed. Cumulative counters are never replaced — the
// recap of a table that dropped once is still the recap of the whole table.

import type { DoorFlags, DoorsState, GoblinEvent, SessionState } from './observer'

export interface LiveView {
  /** Connected players, in join order. The DM is not one of them. */
  players: string[]
  sceneName: string | null
  dmConnected: boolean
}

export interface RecapStats {
  scenes: string[]
  doorsOpened: number
  durationMs: number
  players: string[]
  peakPlayers: number
}

export interface SessionStats {
  apply: (event: GoblinEvent) => void
  live: () => LiveView
  recap: (endedAt: number) => RecapStats
}

export function createSessionStats(startedAt: number): SessionStats {
  const sceneNames = new Map<string, string>()
  // Insertion-ordered sets: a recap reads as the evening did, not alphabetically.
  const scenesVisited = new Set<string>()
  const everPresent = new Set<string>()
  let present = new Set<string>()
  let peakPlayers = 0
  let doorsOpened = 0
  let sceneName: string | null = null
  let dmConnected = false
  /** Null means "no baseline" — the next doors state is recorded, not counted. */
  let openDoors: Record<string, Record<string, boolean>> | null = null

  function visit(sceneId: string | null): void {
    if (!sceneId) return
    sceneName = sceneNames.get(sceneId) ?? sceneId
    scenesVisited.add(sceneName)
  }

  function join(name: string): void {
    present.add(name)
    everPresent.add(name)
    peakPlayers = Math.max(peakPlayers, present.size)
  }

  function resync(state: SessionState): void {
    for (const scene of state.scenes ?? []) sceneNames.set(scene.id, scene.name)
    present = new Set()
    dmConnected = false
    for (const player of state.players ?? []) {
      if (player.role === 'dm') {
        dmConnected ||= player.connected
        continue
      }
      if (player.connected) join(player.name)
    }
    visit(state.activeSceneId)
    // Whatever doors did while the socket was down is unknowable, so the snapshot's door
    // state (or the next update, if it carries none) becomes the new baseline. Better to
    // miss opens than to count a whole scene's worth of them at once.
    openDoors = asDoorsState(state.modules?.doors) ? snapshotOf(state.modules!.doors as DoorsState) : null
  }

  function countOpens(state: DoorsState): void {
    const next = snapshotOf(state)
    if (openDoors !== null) {
      for (const [sceneId, doors] of Object.entries(next)) {
        for (const [doorId, open] of Object.entries(doors)) {
          // Only a proven closed → open transition counts. A door first seen already open
          // was opened before the bot could watch it.
          if (open && openDoors[sceneId]?.[doorId] === false) doorsOpened += 1
        }
      }
    }
    openDoors = next
  }

  return {
    apply: (event) => {
      switch (event.type) {
        case 'session-state':
          resync(event.state)
          return
        case 'player-joined':
          if (event.player.role === 'dm') dmConnected = true
          else join(event.player.name)
          return
        case 'player-left':
          if (event.player.role === 'dm') dmConnected = false
          else present.delete(event.player.name)
          return
        case 'scene-changed':
          visit(event.sceneId)
          return
        case 'doors':
          countOpens(event.state)
          return
        case 'dm-disconnected':
          dmConnected = false
          return
        case 'dm-reconnected':
          dmConnected = true
          return
        default:
          return
      }
    },

    live: () => ({ players: [...present], sceneName, dmConnected }),

    recap: (endedAt) => ({
      scenes: [...scenesVisited],
      doorsOpened,
      durationMs: Math.max(0, endedAt - startedAt),
      players: [...everPresent],
      peakPlayers,
    }),
  }
}

function asDoorsState(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'byScene' in value
}

/** Door flags flattened to the one bit the recap counts. */
function snapshotOf(state: DoorsState): Record<string, Record<string, boolean>> {
  const out: Record<string, Record<string, boolean>> = {}
  for (const [sceneId, doors] of Object.entries(state.byScene ?? {})) {
    out[sceneId] = Object.fromEntries(
      Object.entries(doors as Record<string, DoorFlags>).map(([id, flags]) => [id, flags.open === true]),
    )
  }
  return out
}
