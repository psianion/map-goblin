// Wire payloads are untrusted: every field that reaches `setState` (and therefore the
// persisted row and every other client) is parsed here first. Also home to the D13 snap
// and the `canOccupy` seam S3's fog tightens.

import type { CommandError, Viewer } from '../contract'
import { DOOR_LOCKED } from '../doors/types'
import {
  MOVE_BLOCKED,
  OUTSIDE_MAP,
  ROOM_UNEXPLORED,
  SIZE_CELLS,
  type Disposition,
  type SceneVision,
  type Token,
  type TokenDef,
  type TokenSize,
} from './types'

export const NAME_MAX = 60
export const ID_MAX = 64
export const COLOR_MAX = 32
// ponytail: flat caps, not quotas — library + instances share one JSON row per campaign
// (D5/D12), so the thing worth bounding is total row size. Revisit if a table shows up.
export const LIBRARY_MAX = 500
export const SCENE_TOKENS_MAX = 500

export const SIZES = Object.keys(SIZE_CELLS) as TokenSize[]
export const DISPOSITIONS: readonly Disposition[] = ['friendly', 'neutral', 'hostile']
const VISION_MODES: readonly NonNullable<TokenDef['sight']>['visionMode'][] = [
  'normal',
  'darkvision',
]

/** A refusal on its way out to the sender; the handler turns it into a CommandError. */
export class Reject extends Error {
  readonly code: CommandError['code']
  constructor(code: CommandError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export function bad(message: string): never {
  throw new Reject('invalid-command', message)
}

export function denied(message: string): never {
  throw new Reject('unauthorized', message)
}

export function str(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) {
    bad(`${field} must be a string of 1..${max} characters`)
  }
  return v
}

export function num(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) bad(`${field} must be a finite number`)
  return v
}

export function bool(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') bad(`${field} must be a boolean`)
  return v
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    bad(`${field} must be one of: ${allowed.join(', ')}`)
  }
  return v as T
}

export function obj(v: unknown, field: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) bad(`${field} must be an object`)
  return v as Record<string, unknown>
}

function nullableId(v: unknown, field: string): string | null {
  return v === null ? null : str(v, field, ID_MAX)
}

/**
 * D13: odd-width tokens sit on cell centres, even-width ones on cell intersections. Tiny
 * renders at half a cell but snaps like a 1×1 (ponytail: half-cell snapping when someone
 * asks for it).
 */
export function snap(v: number, size: TokenSize): number {
  const cells = Math.max(1, SIZE_CELLS[size])
  return cells % 2 === 1 ? Math.floor(v) + 0.5 : Math.round(v)
}

/**
 * S3 D8 — where a player token may stand. Unzoned map is the DM's alone (D6), a room
 * nobody has ever seen is not somewhere to walk into, and with concealment on neither is
 * one the party cannot reach. A re-hidden room the party is standing in stays occupiable:
 * the DM plunging them into darkness must not also freeze them (D7).
 *
 * The DM is fenced by none of it, and a scene with no authored rooms (`scene` null) has no
 * fog to enforce. Called on every place and move — module.test.ts pins the call site.
 */
export function canOccupy(
  token: Token,
  pos: { x: number; y: number },
  scene: SceneVision | null,
  role: Viewer['role'],
): boolean {
  // Delegates rather than repeating the rule: `occupyRefusal` answers the same question
  // with the cause attached, and two copies of "where may a token stand" would drift.
  return occupyRefusal(token, pos, scene, role) === null
}

/**
 * The same question as `canOccupy`, answered with the reason instead of a boolean —
 * `null` when the space is fine.
 *
 * `canOccupy` collapsed locked door, closed door, unexplored room and unzoned map into one
 * sentence, so the player got "that space cannot be occupied" whichever it was and could
 * not tell a door they could open from a wall. Every cause below is already sitting in the
 * data the check reads; only the boolean return threw them away.
 *
 * The message keeps "that space cannot be occupied" verbatim after the prefix. That string
 * is what the shipped client matches to decide a refusal is a move refusal at all, so the
 * wire stays backward compatible and the prefix is purely additive.
 */
export function occupyRefusal(
  _token: Token,
  pos: { x: number; y: number },
  scene: SceneVision | null,
  role: Viewer['role'],
): string | null {
  if (role === 'dm' || !scene) return null
  const room = scene.roomAt(pos.x, pos.y)
  const say = (code: string): string => `${code}: that space cannot be occupied`

  // Off every authored room. Unzoned map is the DM's alone (D6).
  if (room === null) return say(OUTSIDE_MAP)
  if (scene.occupiable.has(room)) return null

  // A door the party could name is the most useful thing to say. `door-locked` is the
  // doors module's own constant on purpose: a move stopped by a locked door is the same
  // fact as a toggle stopped by one, and the client already has words for it.
  const edge = scene.blockedEdge?.(room)
  if (edge === 'locked-door') return say(DOOR_LOCKED)
  if (edge === 'closed-door') return say(MOVE_BLOCKED)

  // No door explains it. Somewhere they have seen but cannot reach is blocked; somewhere
  // they have never seen is not a place they know to walk into.
  return say(scene.visible.has(room) ? MOVE_BLOCKED : ROOM_UNEXPLORED)
}

function parseSight(v: unknown): TokenDef['sight'] {
  if (v === null) return null
  const o = obj(v, 'sight')
  return {
    range: num(o.range, 'sight.range'),
    angle: num(o.angle, 'sight.angle'),
    visionMode: oneOf(o.visionMode, VISION_MODES, 'sight.visionMode'),
  }
}

function parseLight(v: unknown): TokenDef['light'] {
  if (v === null) return null
  const o = obj(v, 'light')
  return {
    dim: num(o.dim, 'light.dim'),
    bright: num(o.bright, 'light.bright'),
    color: str(o.color, 'light.color', COLOR_MAX),
    angle: num(o.angle, 'light.angle'),
  }
}

export type DefFields = Omit<TokenDef, 'id'>

/**
 * The fields a def and a placed instance share. `base` is the def being patched (library
 * upsert) or instantiated (place); anything the payload omits falls back to it, then to a
 * default. Only `name` has no default.
 */
export function parseDefFields(p: Record<string, unknown>, base?: TokenDef): DefFields {
  return {
    name: p.name !== undefined ? str(p.name, 'name', NAME_MAX) : (base?.name ?? bad('name is required')),
    imageAssetId:
      p.imageAssetId !== undefined
        ? nullableId(p.imageAssetId, 'imageAssetId')
        : (base?.imageAssetId ?? null),
    size: p.size !== undefined ? oneOf(p.size, SIZES, 'size') : (base?.size ?? 'medium'),
    disposition:
      p.disposition !== undefined
        ? oneOf(p.disposition, DISPOSITIONS, 'disposition')
        : (base?.disposition ?? 'neutral'),
    sight: p.sight !== undefined ? parseSight(p.sight) : (base?.sight ?? null),
    light: p.light !== undefined ? parseLight(p.light) : (base?.light ?? null),
  }
}
