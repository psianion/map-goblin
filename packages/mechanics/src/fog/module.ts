// The fog module (§2.2, D1). Every command is DM-only — fog is the DM's instrument, and
// role gating is data the registry checks before the handler runs, so what is left here is
// the extra validation: the level must be one the map actually has, and a cell must be on it.
//
// Levels and floor live in the map file, not in module state, so the module is built with
// lookups the server backs with its map store — the same shape `scenesModule(stores)` uses.

import { dropScene, type GameModule, type ModuleContext } from '../contract'
import { FOG_LAYER_TYPES, FOG_LOOK_RANGES, type FogLayer, type FogLook } from '@dnd/core/src/shared/fogLook.ts'
import { actorOf, logged, type LogEntry } from '../log'
import { ID_MAX, Reject, bad, bool, num, obj, oneOf, str } from '../tokens/validate'
import {
  REGION_CELL_MAX,
  clearCells,
  fillRegion,
  rebaseRegion,
  setCells,
  toBytes,
  type Cell,
  type Frame,
  type RegionMask,
} from './region'
import { FOG_BRUSH_OPS, clearedOn, sceneFogOf, type FogState, type SceneFog } from './types'

export * from './light'
export * from './region'
export * from './types'

/**
 * The scene's cell-snapped confining rectangle, which is what a region cell is counted from.
 * Injected rather than imported: measuring it needs the map document, and mechanics does not
 * read files (D2/D3). Null for a scene with no map, which is a scene with no region either.
 */
export type SceneFrame = (campaignId: string, sceneId: string) => Frame | null

/**
 * Fog rework — the level ids of a scene's map, which key the cleared record. Injected like
 * {@link SceneFrame}. Empty for a scene with no map.
 */
export type SceneLevels = (campaignId: string, sceneId: string) => readonly string[]

/**
 * Fog rework — whether a world point is ground, or within one cell of it, on one level: what the
 * brush's `clear` may open there. Injected like {@link SceneFrame}.
 */
export type SceneFloorOn = (campaignId: string, sceneId: string, levelId: string, x: number, y: number) => boolean

type Ctx = ModuleContext<FogState>
type Payload = Record<string, unknown>

export function fogModule(
  frameOf: SceneFrame = () => null,
  levelsOf: SceneLevels = () => [],
  floorOnOf: SceneFloorOn = () => false,
): GameModule<FogState> {
  const cells: CellLookups = { frameOf, levelsOf, floorOnOf }
  return {
    name: 'fog',
    commands: {
      'set-on': ['dm'],
      'clear-all': ['dm'],
      'fog-all': ['dm'],
      restore: ['dm'],
      'set-auto-explore': ['dm'],
      'set-fog-look': ['dm'],
      'region-set': ['dm'],
      // `auto-explore` is deliberately absent: it is the server's own write (the sweep a
      // token move earned), reachable only through `dispatchInternal`, exactly the way
      // `triggers.event` is. Leaving it out of this map *is* its access control.
    },
    initialState: { byScene: {} },
    forgetScene: dropScene,

    handler(action, payload, ctx) {
      try {
        run(action, obj(payload ?? {}, 'payload'), ctx, cells)
      } catch (err) {
        if (err instanceof Reject) return { code: err.code, message: err.message }
        throw err
      }
    },
  }
}

/** What the cleared record's commands measure a scene by. */
interface CellLookups {
  frameOf: SceneFrame
  levelsOf: SceneLevels
  floorOnOf: SceneFloorOn
}

/**
 * Fog rework — the commands of the one model: the switch, the brush, the two bulk acts, their
 * undo, the party's own sight, and the two settings.
 *
 * Every write re-bases each level's record onto the current frame first (`rebaseRegion`), so
 * a republish that moved the map keeps cleared ground where it was on the map.
 */
function run(action: string, p: Payload, ctx: Ctx, cells: CellLookups): void {
  switch (action) {
    case 'set-on': {
      const sceneId = sceneOf(p, ctx)
      const scene = sceneFogOf(ctx.state, sceneId)
      const on = bool(p.on, 'on')
      // Only turning it on needs a record to play by; turning it off always works.
      if (on && !rebaseRegion(undefined, frameFor(ctx, sceneId, cells.frameOf))) {
        bad('that scene is too large to fog: it is over 512 by 512 cells')
      }
      return setScene(ctx, sceneId, { ...scene, on }, { action: on ? 'turned-fog-on' : 'turned-fog-off' })
    }
    case 'region-set': {
      const sceneId = sceneOf(p, ctx)
      const scene = sceneFogOf(ctx.state, sceneId)
      const frame = frameFor(ctx, sceneId, cells.frameOf)
      const levelId = levelOf(p, ctx, sceneId, cells)
      const op = oneOf(p.op, FOG_BRUSH_OPS, 'op')
      const mask = rebaseRegion(clearedOn(scene, levelId), frame)
      if (!mask) bad('that scene is too large to keep fog for')
      const stroke = parseCells(p.cells, mask)
      // `clear` opens only ground the level has, plus the one-cell band its wall art sits on;
      // the rest of the stroke is dropped rather than refused, since the DM aims at a chamber,
      // not at its outline. `fog` is unfiltered: covering void costs nothing.
      const next =
        op === 'clear'
          ? setCells(
              mask,
              stroke.filter(([col, row]) =>
                cells.floorOnOf(ctx.campaignId, sceneId, levelId, mask.minX + col + 0.5, mask.minY + row + 0.5),
              ),
            )
          : clearCells(mask, stroke)
      return setScene(ctx, sceneId, withCleared(scene, { ...scene.cleared, [levelId]: next }), { action: 'changed-fog' })
    }
    case 'clear-all': {
      const sceneId = sceneOf(p, ctx)
      const scene = sceneFogOf(ctx.state, sceneId)
      const empty = rebaseRegion(undefined, frameFor(ctx, sceneId, cells.frameOf))
      if (!empty) bad('that scene is too large to keep fog for')
      // One byte fill per level rather than a floor walk: cells off the ground are never stood
      // on or drawn, so a full record and a floor-only one show the players the same map.
      const cleared: Record<string, RegionMask> = {}
      for (const levelId of cells.levelsOf(ctx.campaignId, sceneId)) cleared[levelId] = fillRegion(empty)
      return setScene(ctx, sceneId, withCleared(scene, cleared), { action: 'cleared-all' })
    }
    case 'fog-all': {
      const sceneId = sceneOf(p, ctx)
      const scene = sceneFogOf(ctx.state, sceneId)
      return setScene(ctx, sceneId, withCleared(scene, {}), { action: 'fogged-all' })
    }
    case 'restore': {
      const sceneId = sceneOf(p, ctx)
      const scene = sceneFogOf(ctx.state, sceneId)
      const frame = frameFor(ctx, sceneId, cells.frameOf)
      const levels = cells.levelsOf(ctx.campaignId, sceneId)
      const cleared: Record<string, RegionMask> = {}
      for (const [levelId, raw] of Object.entries(obj(p.cleared, 'cleared'))) {
        oneOf(levelId, levels, 'cleared key')
        const mask = rebaseRegion(parseMask(raw, `cleared.${levelId}`), frame)
        if (mask) cleared[levelId] = mask
      }
      return setScene(ctx, sceneId, withCleared(scene, cleared), { action: 'changed-fog' })
    }
    // Server-internal (see `commands` above): the cells one party sweep just earned, per level,
    // applied as ONE write so persistence, the broadcast, D5's geometry delta and the retract
    // re-sends all ride the path a DM's own clear rides.
    case 'auto-explore': {
      const sceneId = sceneOf(p, ctx)
      const scene = sceneFogOf(ctx.state, sceneId)
      const frame = frameFor(ctx, sceneId, cells.frameOf)
      const levels = cells.levelsOf(ctx.campaignId, sceneId)
      const cleared = { ...scene.cleared }
      for (const [levelId, raw] of Object.entries(obj(p.byLevel, 'byLevel'))) {
        oneOf(levelId, levels, 'byLevel key')
        const mask = rebaseRegion(cleared[levelId], frame)
        if (!mask) continue
        cleared[levelId] = setCells(mask, parseCells(raw, mask))
      }
      // No log line: the map opening as the party walks is the map, not an act to read back.
      return setScene(ctx, sceneId, withCleared(scene, cleared))
    }
    case 'set-auto-explore': {
      const sceneId = sceneOf(p, ctx)
      const scene = sceneFogOf(ctx.state, sceneId)
      return setScene(ctx, sceneId, {
        ...scene,
        autoExplore: bool(p.autoExplore, 'autoExplore'),
      })
    }
    // No log line: this changes how the cloud looks, not what the party has seen, and every
    // seat renders its own copy of it. `{ look: null }` clears the override back to the map's
    // authored default (`fogLookOf`); the object form is field-by-field, so a single slider
    // drag sends just the field it moved.
    // A patch merges into the override already on the scene: the panel sends only the
    // field it moved (one dial per debounce window), so replacing the whole override with
    // the patch would drop every earlier pick — a base colour set a moment before a layer
    // tint went back to the map's default. `null` is the one payload that clears.
    case 'set-fog-look': {
      const sceneId = sceneOf(p, ctx)
      const scene = sceneFogOf(ctx.state, sceneId)
      const look = parseFogLook(p.look)
      return setScene(ctx, sceneId, { ...scene, look: look ? { ...scene.look, ...look } : undefined })
    }
    default:
      bad(`fog has no action '${action}'`)
  }
}

/** The scene with its cleared record replaced; an empty record is stored as none. */
function withCleared(scene: SceneFog, cleared: Record<string, RegionMask>): SceneFog {
  const { cleared: _old, ...rest } = scene
  return Object.keys(cleared).length > 0 ? { ...rest, cleared } : rest
}

/** The level a brush stroke names: one the scene's map has. */
function levelOf(p: Payload, ctx: Ctx, sceneId: string, cells: CellLookups): string {
  return oneOf(p.levelId, cells.levelsOf(ctx.campaignId, sceneId), 'levelId')
}

/**
 * A cell record off the wire (`restore`): four whole numbers and bits of exactly the length they
 * call for, so a hand-made record cannot write past its own grid.
 */
function parseMask(value: unknown, field: string): RegionMask {
  const o = obj(value, field)
  const whole = (v: unknown, name: string): number => {
    const n = num(v, `${field}.${name}`)
    if (!Number.isInteger(n)) bad(`${field}.${name} must be a whole number`)
    return n
  }
  const [minX, minY, cols, rows] = [whole(o.minX, 'minX'), whole(o.minY, 'minY'), whole(o.cols, 'cols'), whole(o.rows, 'rows')]
  if (cols < 0 || rows < 0 || cols * rows > REGION_CELL_MAX) bad(`${field} is not a cell record this scene can hold`)
  const bits = typeof o.bits === 'string' ? o.bits : bad(`${field}.bits must be a string`)
  let length: number
  try {
    length = toBytes(bits).length
  } catch {
    bad(`${field}.bits must be base64`)
  }
  if (length !== Math.ceil((cols * rows) / 8)) bad(`${field}.bits does not fit ${cols} by ${rows} cells`)
  return { minX, minY, cols, rows, bits }
}

function frameFor(ctx: Ctx, sceneId: string, frameOf: SceneFrame): Frame {
  const frame = frameOf(ctx.campaignId, sceneId)
  if (!frame) bad('that scene has no map to measure cells against')
  return frame
}

/** `[col, row]` pairs off the wire, bounds-checked against the mask they are about to hit. */
function parseCells(value: unknown, region: RegionMask): Cell[] {
  if (!Array.isArray(value)) bad('cells must be an array of [col, row] pairs')
  return value.map((raw, i): Cell => {
    if (!Array.isArray(raw) || raw.length !== 2) bad(`cells[${i}] must be [col, row]`)
    const col = num(raw[0], `cells[${i}][0]`)
    const row = num(raw[1], `cells[${i}][1]`)
    if (!Number.isInteger(col) || !Number.isInteger(row)) bad(`cells[${i}] must be whole cells`)
    if (col < 0 || row < 0 || col >= region.cols || row >= region.rows) {
      bad(`cells[${i}] is outside the scene`)
    }
    return [col, row]
  })
}

/** Payload scene, else the table's active scene; a command with neither is nonsense. */
function sceneOf(p: Payload, ctx: Ctx): string {
  const sceneId = p.sceneId === undefined ? ctx.activeSceneId : str(p.sceneId, 'sceneId', ID_MAX)
  if (!sceneId) bad('no sceneId in the payload and no active scene')
  return sceneId
}

// `set-fog-look` (D7). No clamp helper exists in `tokens/validate` — every numeric field of
// `FogLook` gets its own range check here, by hand, against the bounds the plan settled on.
const HEX_COLOR = /^#[0-9a-f]{6}$/i

function hexColor(v: unknown, field: string): string {
  const s = str(v, field, 7)
  if (!HEX_COLOR.test(s)) bad(`${field} must be a #rrggbb colour`)
  return s
}

function ranged(v: unknown, field: string, { min, max }: { min: number; max: number }): number {
  const n = num(v, field)
  if (n < min || n > max) bad(`${field} must be between ${min} and ${max}`)
  return n
}

function parseFogLayer(v: unknown, i: number): FogLayer {
  const o = obj(v, `look.layers[${i}]`)
  return {
    type: oneOf(o.type, FOG_LAYER_TYPES, `look.layers[${i}].type`),
    tint: hexColor(o.tint, `look.layers[${i}].tint`),
    strength: ranged(o.strength, `look.layers[${i}].strength`, FOG_LOOK_RANGES.strength),
    scale: ranged(o.scale, `look.layers[${i}].scale`, FOG_LOOK_RANGES.scale),
    speed: ranged(o.speed, `look.layers[${i}].speed`, FOG_LOOK_RANGES.speed),
    angle: ranged(o.angle, `look.layers[${i}].angle`, FOG_LOOK_RANGES.angle),
  }
}

function parseFogLayers(v: unknown): [FogLayer, FogLayer, FogLayer] {
  if (!Array.isArray(v) || v.length !== 3) bad('look.layers must be exactly 3 layers')
  return [parseFogLayer(v[0], 0), parseFogLayer(v[1], 1), parseFogLayer(v[2], 2)]
}

/**
 * The DM's live override, or the clear signal. `null` is the whole payload — clears `look`
 * back to the map's authored default. The object form validates only the fields it carries
 * (every one of `FogLook` is optional here), so a slider debounced client-side can send just
 * the field it moved without re-sending the rest of the cloud.
 */
function parseFogLook(v: unknown): Partial<FogLook> | null {
  if (v === null) return null
  const o = obj(v, 'look')
  const out: Partial<FogLook> = {}
  if (o.base !== undefined) out.base = hexColor(o.base, 'look.base')
  if (o.layers !== undefined) out.layers = parseFogLayers(o.layers)
  if (o.wind !== undefined) out.wind = ranged(o.wind, 'look.wind', FOG_LOOK_RANGES.wind)
  if (o.fade !== undefined) out.fade = ranged(o.fade, 'look.fade', FOG_LOOK_RANGES.fade)
  if (o.veil !== undefined) out.veil = ranged(o.veil, 'look.veil', FOG_LOOK_RANGES.veil)
  if (o.glow !== undefined) out.glow = ranged(o.glow, 'look.glow', FOG_LOOK_RANGES.glow)
  if (o.heavy !== undefined) out.heavy = bool(o.heavy, 'look.heavy')
  return out
}

type Line = Omit<LogEntry, 'id' | 'at' | 'sceneId' | 'actor'>

/** `line` omitted = a change the table has no business reading about (`set-auto-explore`). */
function setScene(ctx: Ctx, sceneId: string, scene: SceneFog, line?: Line): void {
  ctx.setState({
    ...ctx.state,
    byScene: { ...ctx.state.byScene, [sceneId]: scene },
    log: line ? logged(ctx.state.log, { ...line, actor: actorOf(ctx), sceneId }) : ctx.state.log,
  })
}
