// Wire payloads are untrusted: every field that reaches `setState` (and therefore the
// persisted row and every other client) is parsed here first. Also home to the D13 snap
// and the `canOccupy` seam S3's fog tightens.

import type { CommandError } from '../contract'
import {
  SIZE_CELLS,
  type Disposition,
  type Token,
  type TokenDef,
  type TokenSize,
  type TokensState,
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
 * D10 seam: S3's fog/terrain rules tighten this. It is called on every place and move so
 * the check site exists before the rule does — module.test.ts pins the call.
 */
export function canOccupy(
  _token: Token,
  _pos: { x: number; y: number },
  _state: TokensState,
): boolean {
  return true
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
