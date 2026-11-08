// Map pins (table v2, Pin tool): a note stuck to a spot on a scene. Persisted per scene; a
// DM-only pin never reaches a player.

import type { GameModule, ModuleContext } from '../contract'
import { ID_MAX, Reject, bad, bool, num, obj, str } from '../tokens/validate'

export interface Pin {
  id: string
  x: number
  y: number
  /** ≤ 200; may be empty. */
  text: string
  dmOnly: boolean
}

export interface PinsState {
  byScene: Record<string, Pin[]>
}

export const PINS_MAX = 200
export const PIN_TEXT_MAX = 200

type Ctx = ModuleContext<PinsState>
type Payload = Record<string, unknown>

let minted = 0
const mint = (): string => {
  minted += 1
  return `pin${Date.now().toString(36)}${minted.toString(36)}`
}

export const pinsModule: GameModule<PinsState> = {
  name: 'pins',
  commands: { add: ['dm'], update: ['dm'], delete: ['dm'] },
  initialState: { byScene: {} },

  handler(action, payload, ctx) {
    try {
      run(action, obj(payload ?? {}, 'payload'), ctx)
    } catch (err) {
      if (err instanceof Reject) return { code: err.code, message: err.message }
      throw err
    }
  },

  redact(state, viewer) {
    if (viewer.role === 'dm') return state
    let touched = false
    const byScene: PinsState['byScene'] = {}
    for (const [sceneId, pins] of Object.entries(state.byScene)) {
      const kept = pins.filter((p) => !p.dmOnly)
      if (kept.length !== pins.length) touched = true
      byScene[sceneId] = kept
    }
    return touched ? { byScene } : state
  },

  forgetScene(state, sceneId) {
    if (!(sceneId in state.byScene)) return state
    const byScene = { ...state.byScene }
    delete byScene[sceneId]
    return { byScene }
  },
}

/** A pin starts blank (the Pin tool drops it, then the DM types); never longer than the cap. */
function text(v: unknown): string {
  if (typeof v !== 'string' || v.length > PIN_TEXT_MAX) bad(`text must be a string of at most ${PIN_TEXT_MAX} characters`)
  return v
}

function sceneOf(p: Payload, ctx: Ctx): string {
  const sceneId = p.sceneId === undefined ? ctx.activeSceneId : str(p.sceneId, 'sceneId', ID_MAX)
  if (!sceneId) bad('no sceneId in the payload and no active scene')
  return sceneId
}

function run(action: string, p: Payload, ctx: Ctx): void {
  const sceneId = sceneOf(p, ctx)
  const pins = ctx.state.byScene[sceneId] ?? []
  const write = (next: Pin[]) => ctx.setState({ byScene: { ...ctx.state.byScene, [sceneId]: next } })
  switch (action) {
    case 'add': {
      if (pins.length >= PINS_MAX) bad(`a scene holds at most ${PINS_MAX} pins`)
      const pin: Pin = {
        id: mint(),
        x: num(p.x, 'x'),
        y: num(p.y, 'y'),
        text: p.text === undefined ? '' : text(p.text),
        dmOnly: p.dmOnly === undefined ? false : bool(p.dmOnly, 'dmOnly'),
      }
      return write([...pins, pin])
    }
    case 'update': {
      const id = str(p.id, 'id', ID_MAX)
      const pin = pins.find((x) => x.id === id) ?? bad('no such pin')
      const next: Pin = {
        ...pin,
        ...(p.x !== undefined ? { x: num(p.x, 'x') } : {}),
        ...(p.y !== undefined ? { y: num(p.y, 'y') } : {}),
        ...(p.text !== undefined ? { text: text(p.text) } : {}),
        ...(p.dmOnly !== undefined ? { dmOnly: bool(p.dmOnly, 'dmOnly') } : {}),
      }
      return write(pins.map((x) => (x.id === id ? next : x)))
    }
    case 'delete': {
      const id = str(p.id, 'id', ID_MAX)
      if (!pins.some((x) => x.id === id)) bad('no such pin')
      return write(pins.filter((x) => x.id !== id))
    }
    default:
      bad(`pins has no action '${action}'`)
  }
}
