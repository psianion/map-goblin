// v6 — the `mark` channel: pings, rulers, templates and drawings, relayed to the session and
// never stored (plan 4.3). The wire is untrusted, so a mark is rebuilt here field by field;
// the Broadcaster relays only what this returns.

import type { Mark, MarkEvent, MarkPoint, Role } from '@dnd/core/src/shared/protocol'

/** The table client's own lifetimes (shell/marks), so both ends drop a mark together. */
export const MARK_TTL_MS = { ping: 3000, ruler: 1500, template: 30_000, draw: 10_000 } as const
export const DRAW_TTL_MIN_MS = 1000
export const DRAW_TTL_MAX_MS = 60_000
export const DRAW_POINTS_MAX = 500
/** Far beyond any map; a coordinate past it is garbage, not a place. */
const COORD_MAX = 100_000
const SIZE_MAX = 1000

const SHAPES = ['circle', 'cone', 'square', 'line'] as const

const coord = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= COORD_MAX

function point(v: unknown): MarkPoint | null {
  if (typeof v !== 'object' || v === null) return null
  const { x, y } = v as Record<string, unknown>
  return coord(x) && coord(y) ? { x, y } : null
}

/** The mark rebuilt from the wire, with its lifetime; or the reason it was refused. */
export function parseMark(raw: unknown, role: Role): { mark: Mark; ttlMs: number } | { error: string } {
  if (typeof raw !== 'object' || raw === null) return { error: 'mark must be an object' }
  const m = raw as Record<string, unknown>
  const dmOnly = (what: string) => ({ error: `only the DM may ${what}` })
  switch (m.kind) {
    case 'ping': {
      if (!coord(m.x) || !coord(m.y)) return { error: 'ping needs a point' }
      if (m.pull === true && role !== 'dm') return dmOnly('pull cameras')
      return { mark: { kind: 'ping', x: m.x, y: m.y, ...(m.pull === true ? { pull: true } : {}) }, ttlMs: MARK_TTL_MS.ping }
    }
    case 'ruler': {
      const from = point(m.from)
      const to = point(m.to)
      if (!from || !to) return { error: 'ruler needs from and to' }
      return { mark: { kind: 'ruler', from, to }, ttlMs: MARK_TTL_MS.ruler }
    }
    case 'template': {
      if (role !== 'dm') return dmOnly('place templates')
      const origin = point(m.origin)
      const shape = SHAPES.find((s) => s === m.shape)
      const size = m.size
      if (!origin || !shape || typeof size !== 'number' || !(size > 0) || size > SIZE_MAX) {
        return { error: 'template needs a shape, an origin and a size' }
      }
      const toward = m.toward === undefined ? null : point(m.toward)
      return {
        mark: { kind: 'template', shape, origin, size, ...(toward ? { toward } : {}) },
        ttlMs: MARK_TTL_MS.template,
      }
    }
    case 'draw': {
      if (role !== 'dm') return dmOnly('draw')
      if (!Array.isArray(m.points) || m.points.length < 2 || m.points.length > DRAW_POINTS_MAX) {
        return { error: `draw needs 2..${DRAW_POINTS_MAX} points` }
      }
      const points: [number, number][] = []
      for (const p of m.points) {
        if (!Array.isArray(p) || p.length !== 2 || !coord(p[0]) || !coord(p[1])) return { error: 'draw has a bad point' }
        points.push([p[0], p[1]])
      }
      const asked = typeof m.ttl === 'number' && Number.isFinite(m.ttl) ? m.ttl : MARK_TTL_MS.draw
      const ttl = Math.max(DRAW_TTL_MIN_MS, Math.min(DRAW_TTL_MAX_MS, asked))
      return { mark: { kind: 'draw', points, ttl }, ttlMs: ttl }
    }
    default:
      return { error: 'unknown mark kind' }
  }
}

let minted = 0

/** The relayed frame: stamped with who sent it, when, and on which scene. */
export function markEvent(mark: Mark, ttlMs: number, from: string, sceneId: string | null): MarkEvent {
  minted += 1
  const at = Date.now()
  return { id: `m${at.toString(36)}${minted.toString(36)}`, from, at, sceneId, ttlMs, mark }
}
