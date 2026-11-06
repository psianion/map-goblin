// The crossings module (plan §7): how the table plays the raised edges of a scene's map right
// now. The map authors each cliff's and slope's crossing kind and each kind's
// `blocks`; the DM changes either live, mid-session, and the change travels over the socket
// like a door's state and is kept with the campaign's module state. Everyone reads the same
// rules: the chip a player's drag shows names the kind and its note, so nothing is redacted.

import { type GameModule, type ModuleContext } from '../contract'
import { ID_MAX, Reject, bad, bool, obj, str } from '../tokens/validate'

/** One scene's live overrides. Absent keys fall back to the map. */
export interface SceneCrossings {
  /** A plateau's id → the crossing kind id the DM picked for it at the table. */
  edges: Record<string, string>
  /** A crossing kind id → whether it refuses a player's move, as the DM switched it. */
  blocks: Record<string, boolean>
}

export interface CrossingsState {
  byScene: Record<string, SceneCrossings>
}

type Ctx = ModuleContext<CrossingsState>
type Payload = Record<string, unknown>

const EMPTY: SceneCrossings = { edges: {}, blocks: {} }

/** A scene's overrides, empty when the DM has changed nothing. */
export function sceneCrossings(state: CrossingsState | null | undefined, sceneId: string | null): SceneCrossings {
  return (sceneId && state?.byScene[sceneId]) || EMPTY
}

export const crossingsModule: GameModule<CrossingsState> = {
  name: 'crossings',
  commands: {
    'set-edge': ['dm'],
    'set-blocks': ['dm'],
  },
  initialState: { byScene: {} },

  handler(action, payload, ctx) {
    try {
      run(action, obj(payload ?? {}, 'payload'), ctx)
    } catch (err) {
      if (err instanceof Reject) return { code: err.code, message: err.message }
      throw err
    }
  },
}

function run(action: string, p: Payload, ctx: Ctx): void {
  const sceneId = p.sceneId === undefined ? ctx.activeSceneId : str(p.sceneId, 'sceneId', ID_MAX)
  if (!sceneId) bad('no sceneId in the payload and no active scene')
  const scene = sceneCrossings(ctx.state, sceneId)
  let next: SceneCrossings
  switch (action) {
    case 'set-edge': {
      // `crossingId: null` hands the edge back to the map's own kind.
      const targetId = str(p.targetId, 'targetId', ID_MAX)
      const edges = { ...scene.edges }
      if (p.crossingId === null) delete edges[targetId]
      else edges[targetId] = str(p.crossingId, 'crossingId', ID_MAX)
      next = { ...scene, edges }
      break
    }
    case 'set-blocks': {
      const kindId = str(p.kindId, 'kindId', ID_MAX)
      const blocks = { ...scene.blocks }
      if (p.blocks === null) delete blocks[kindId]
      else blocks[kindId] = bool(p.blocks, 'blocks')
      next = { ...scene, blocks }
      break
    }
    default:
      bad(`crossings has no action '${action}'`)
  }
  ctx.setState({ ...ctx.state, byScene: { ...ctx.state.byScene, [sceneId]: next } })
}

/** The head word of a move refused at a raised edge: `CROSSING_BLOCKED <kindId>: <words>`. */
export const CROSSING_BLOCKED = 'CROSSING_BLOCKED'

/** The refusal a blocked crossing answers with: the kind's name and the DM's note, as the chip says. */
export function crossingRefusalMessage(kind: { id: string; name: string; note?: string }): string {
  return `${CROSSING_BLOCKED} ${kind.id}: ${kind.name}${kind.note ? ` — ${kind.note}` : ''}`
}
