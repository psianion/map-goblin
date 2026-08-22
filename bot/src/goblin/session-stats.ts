// The recap accumulator (plan §4): one state machine fed the observer's event stream, read
// two ways — `live()` drives the session embed, `recap()` is what the session-end post and
// the sessions row are built from. Pure and synchronous; the only clock it sees is the one
// passed in.
//
// The split that matters is live vs cumulative. A reconnect delivers a fresh `session-state`
// snapshot, and that snapshot *replaces* the live view (who is here, which scene) because
// the events that changed it were missed. Cumulative counters are never replaced — the
// recap of a table that dropped once is still the recap of the whole table.

import type { MapToken } from '../render/map-svg'
import type { DoorFlags, DoorsState, GoblinEvent, SessionState, TokensState, WireToken } from './observer'

export interface LiveView {
  /** Connected players, in join order. The DM is not one of them. */
  players: string[]
  sceneName: string | null
  /** The scene `/map` and the recap snapshot default to (plan §7). */
  sceneId: string | null
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
  /** The last known token positions for a scene — the map snapshot's overlay. Empty until
   * the `tokens` module has said something about that scene. */
  tokens: (sceneId: string) => MapToken[]
}

/** SIZE_CELLS on the game side. Re-declared, like every other wire constant here. */
const SIZE_CELLS: Record<string, number> = {
  tiny: 0.5,
  small: 1,
  medium: 1,
  large: 2,
  huge: 3,
  gargantuan: 4,
}

const DISPOSITIONS = new Set(['friendly', 'neutral', 'hostile'])

/** Wire token → what the schematic draws. Hidden tokens are *kept*: the bot watches with the
 * DM's seat, and the renderer is what drops them from a player-facing sheet (map-svg.ts). */
function toMapTokens(scene: Record<string, WireToken>): MapToken[] {
  return Object.values(scene ?? {}).map((token) => ({
    id: String(token.id),
    name: String(token.name ?? ''),
    x: Number(token.x) || 0,
    y: Number(token.y) || 0,
    cells: SIZE_CELLS[token.size] ?? 1,
    disposition: (DISPOSITIONS.has(token.disposition) ? token.disposition : 'neutral') as MapToken['disposition'],
    hidden: token.hidden === true,
  }))
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
  let sceneId: string | null = null
  let dmConnected = false
  /** Latest positions per scene. Replaced wholesale — the module sends its whole state. */
  const tokensByScene = new Map<string, MapToken[]>()
  /** Null means "no baseline" — the next doors state is recorded, not counted. */
  let openDoors: Record<string, Record<string, boolean>> | null = null

  function visit(id: string | null): void {
    if (!id) return
    sceneId = id
    sceneName = sceneNames.get(id) ?? id
    scenesVisited.add(sceneName)
  }

  function ingestTokens(state: TokensState | undefined): void {
    for (const [scene, tokens] of Object.entries(state?.byScene ?? {}))
      tokensByScene.set(scene, toMapTokens(tokens))
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
    openDoors = hasByScene(state.modules?.doors) ? snapshotOf(state.modules!.doors as DoorsState) : null
    // Positions, unlike door counts, are pure "latest wins" — a snapshot is simply the truth.
    if (hasByScene(state.modules?.tokens)) ingestTokens(state.modules!.tokens as TokensState)
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
        case 'tokens':
          ingestTokens(event.state)
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

    live: () => ({ players: [...present], sceneName, sceneId, dmConnected }),

    tokens: (scene) => tokensByScene.get(scene) ?? [],

    recap: (endedAt) => ({
      scenes: [...scenesVisited],
      doorsOpened,
      durationMs: Math.max(0, endedAt - startedAt),
      players: [...everPresent],
      peakPlayers,
    }),
  }
}

/** Both module states are keyed the same way; this is the "is that module's state" check. */
function hasByScene(value: unknown): boolean {
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
