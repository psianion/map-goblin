// Wire payloads are untrusted: every field that reaches `setState` (and therefore the
// persisted row and every other client) is parsed here first. Also home to the D13 snap
// and the `canOccupy` seam S3's fog tightens.

import type { CommandError, Viewer } from '../contract'
import { DOOR_CLOSED, DOOR_LOCKED, refusal } from '../doors/types'
import { CONDITIONS, HP_MAX, type Condition } from '../initiative/types'
import {
  MOVE_BLOCKED,
  OUTSIDE_MAP,
  ROOM_UNEXPLORED,
  SIZE_CELLS,
  type Disposition,
  type HpVisibility,
  type Nameplate,
  type SceneVision,
  type Token,
  type TokenDef,
  type TokenEffect,
  type TokenKind,
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
  const say = (code: string, subjectId: string | null = null): string =>
    refusal(code, subjectId, 'that space cannot be occupied')

  // Off every authored room. Unzoned map is the DM's alone (D6) — except in vision mode,
  // where ground the party has been shown is ground they may stand on (`openGround`). A
  // map whose rooms do not touch (an outdoor pad and a cave mouth with unzoned yards
  // between them) is otherwise two islands no player can cross, however much the DM
  // reveals: the room graph has no edge to walk along and the reveal has no room to land
  // in. `openGround` is absent in rooms mode, so D6 is untouched there.
  if (room === null) return scene.openGround?.(pos.x, pos.y) ? null : say(OUTSIDE_MAP)
  if (scene.occupiable.has(room)) return null

  // A door the party could name is the most useful thing to say, so the door's id rides
  // along and the client turns it into the name it holds. `door-locked` is the doors
  // module's own constant on purpose: a move stopped by a locked door is the same fact as a
  // toggle stopped by one, and the client already has words for it.
  const edge = scene.blockedEdge?.(room)
  if (edge) return say(edge.kind === 'locked-door' ? DOOR_LOCKED : DOOR_CLOSED, edge.doorId)

  // No door explains it. Somewhere they have seen but cannot reach is blocked; somewhere
  // they have never seen is not a place they know to walk into.
  return say(scene.visible.has(room) ? MOVE_BLOCKED : ROOM_UNEXPLORED)
}

export function parseSight(v: unknown): TokenDef['sight'] {
  if (v === null) return null
  const o = obj(v, 'sight')
  return {
    range: num(o.range, 'sight.range'),
    angle: num(o.angle, 'sight.angle'),
    visionMode: oneOf(o.visionMode, VISION_MODES, 'sight.visionMode'),
  }
}

export const SHEET_NAME_MAX = 60
export const SHEET_ID_MAX = 40
export const SHEET_URL_MAX = 300

/** `avatar` only survives as any `https://` link (or overlong) — DDB serves portraits from CDN
 *  hosts, and it's stored, never rendered, so a wide host allowlist there is not a clickable-
 *  link risk. */
function httpsUrl(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.length > 0 && v.length <= max && v.startsWith('https://')
    ? v
    : undefined
}

/** `url` is what `PlayerList`/`MePanel` render as a clickable anchor next to the player's own
 *  name — anything but D&D Beyond's own domain would let a player publish an arbitrary link to
 *  every seat at the table under their character's name, so this is host-locked rather than
 *  just scheme-checked. */
const DNDBEYOND_URL = /^https:\/\/(www\.)?dndbeyond\.com\//
function dndbeyondUrl(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.length > 0 && v.length <= max && DNDBEYOND_URL.test(v)
    ? v
    : undefined
}

/**
 * A player's D&D Beyond sheet, captured off a Beyond20 payload and stashed on the token that
 * claims it — display/link data only, never re-derived from or trusted for anything else.
 * Unlike `parseSight`/`parseLight`, a bad `name` does not reject the whole command: it returns
 * `undefined` so the caller decides (`update` refuses an explicit-but-nameless sheet, the same
 * way it refuses any other malformed field). `id`/`url`/`avatar` are each optional and dropped
 * independently when invalid rather than sinking a sheet that otherwise has a good name.
 */
export function parseSheet(v: unknown): Token['sheet'] {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined
  const o = v as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (!name || name.length > SHEET_NAME_MAX) return undefined
  const id =
    typeof o.id === 'string' && o.id.length > 0 && o.id.length <= SHEET_ID_MAX ? o.id : undefined
  const url = dndbeyondUrl(o.url, SHEET_URL_MAX)
  const avatar = httpsUrl(o.avatar, SHEET_URL_MAX)
  return { name, ...(id ? { id } : {}), ...(url ? { url } : {}), ...(avatar ? { avatar } : {}) }
}

export function parseLight(v: unknown): TokenDef['light'] {
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
/** `null` clears pack art; absent leaves it alone (parseDefFields' base fallback). */
function parsePackAsset(v: unknown): TokenDef['packAsset'] {
  if (v === null) return undefined
  const o = obj(v, 'packAsset')
  return { packId: str(o.packId, 'packAsset.packId', ID_MAX), assetId: str(o.assetId, 'packAsset.assetId', ID_MAX) }
}

export const KINDS: readonly TokenKind[] = ['pc', 'npc', 'monster']
export const NAMEPLATES: readonly Nameplate[] = ['hover', 'always', 'never']
export const HP_VISIBILITY: readonly HpVisibility[] = ['dm', 'owner', 'all']
export const AC_MAX = 99
export const SPEED_MAX = 999
export const EFFECT_NAME_MAX = 40
export const EFFECTS_MAX = 20
export const ROUNDS_MAX = 999

function whole(v: unknown, field: string, min: number, max: number): number {
  const n = num(v, field)
  if (!Number.isInteger(n) || n < min || n > max) bad(`${field} must be a whole number in ${min}..${max}`)
  return n
}

/** `{max, current?}`; `current` defaults to `max` and is clamped into `0..max`. */
export function parseHp(v: unknown): { current: number; max: number } {
  const o = obj(v, 'hp')
  const max = whole(o.max, 'hp.max', 1, HP_MAX)
  const current = o.current === undefined ? max : whole(o.current, 'hp.current', -HP_MAX, HP_MAX)
  return { current: Math.max(0, Math.min(max, current)), max }
}

export function parseCondition(v: unknown, field = 'name'): Condition {
  return oneOf(v, CONDITIONS, field)
}

export function parseConditions(v: unknown): string[] {
  if (!Array.isArray(v)) bad('conditions must be an array')
  return [...new Set(v.map((c, i) => parseCondition(c, `conditions[${i}]`)))]
}

export function parseEffects(v: unknown): TokenEffect[] {
  if (!Array.isArray(v) || v.length > EFFECTS_MAX) bad(`effects must be an array of at most ${EFFECTS_MAX}`)
  return v.map((raw, i) => {
    const o = obj(raw, `effects[${i}]`)
    return {
      name: str(o.name, `effects[${i}].name`, EFFECT_NAME_MAX),
      roundsLeft: whole(o.roundsLeft, `effects[${i}].roundsLeft`, 1, ROUNDS_MAX),
    }
  })
}

export function parseAc(v: unknown): number {
  return whole(v, 'ac', 0, AC_MAX)
}

export function parseSpeed(v: unknown): number {
  return whole(v, 'speed', 0, SPEED_MAX)
}

/**
 * Table v2 — a def or token with every new field filled: `kind` npc, `nameplate` hover,
 * `showHp` dm, no conditions, no effects. Rows written before the fields existed read through
 * this (the server's tokens validator and session spawn call it on old `TokenDef` rows).
 * Pure; returns the same object when nothing was missing.
 */
export function normalizeTokenDef<T extends TokenDef>(def: T): T & Required<Pick<TokenDef, 'kind' | 'nameplate' | 'showHp' | 'conditions' | 'effects'>> {
  if (def.kind && def.nameplate && def.showHp && def.conditions && def.effects) {
    return def as T & Required<Pick<TokenDef, 'kind' | 'nameplate' | 'showHp' | 'conditions' | 'effects'>>
  }
  return {
    ...def,
    kind: def.kind ?? 'npc',
    nameplate: def.nameplate ?? 'hover',
    showHp: def.showHp ?? 'dm',
    conditions: def.conditions ?? [],
    effects: def.effects ?? [],
  }
}

/** Optional numeric/owner fields: present in the payload wins (`null` clears), else the base. */
function optional<T>(p: Record<string, unknown>, key: string, base: T | undefined, parse: (v: unknown) => T): T | undefined {
  if (p[key] === undefined) return base
  return p[key] === null ? undefined : parse(p[key])
}

export function parseDefFields(p: Record<string, unknown>, base?: TokenDef): DefFields {
  const packAsset = p.packAsset !== undefined ? parsePackAsset(p.packAsset) : base?.packAsset
  const hp = optional(p, 'hp', base?.hp, parseHp)
  const ac = optional(p, 'ac', base?.ac, parseAc)
  const speed = optional(p, 'speed', base?.speed, parseSpeed)
  const ownerIdentityId = optional(p, 'ownerIdentityId', base?.ownerIdentityId, (v) => str(v, 'ownerIdentityId', ID_MAX))
  const ownerName = optional(p, 'ownerName', base?.ownerName, (v) => str(v, 'ownerName', NAME_MAX))
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
    ...(packAsset ? { packAsset } : {}),
    kind: p.kind !== undefined ? oneOf(p.kind, KINDS, 'kind') : (base?.kind ?? 'npc'),
    nameplate: p.nameplate !== undefined ? oneOf(p.nameplate, NAMEPLATES, 'nameplate') : (base?.nameplate ?? 'hover'),
    showHp: p.showHp !== undefined ? oneOf(p.showHp, HP_VISIBILITY, 'showHp') : (base?.showHp ?? 'dm'),
    conditions: p.conditions !== undefined ? parseConditions(p.conditions) : (base?.conditions ?? []),
    effects: p.effects !== undefined ? parseEffects(p.effects) : (base?.effects ?? []),
    ...(hp ? { hp } : {}),
    ...(ac !== undefined ? { ac } : {}),
    ...(speed !== undefined ? { speed } : {}),
    ...(ownerIdentityId ? { ownerIdentityId } : {}),
    ...(ownerName ? { ownerName } : {}),
  }
}
