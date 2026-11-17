// The walk grid (table fix pass §2.1, §2.3): where a player's token may stand and how it gets
// there. The server derives the grid from the map (`session/server/src/fog/walk.ts`); this file
// is the pure half, so the grid, its pass bits and the flood are testable without a map.
//
// One cell per grid square of the scene's frame. A cell is no ground, solid (ground with rock or
// a wall through its centre) or standable. Each cell has a pass bit toward each of its eight
// neighbours: set when the straight step between the two centres touches no blocker. A blocker
// is a wall span, a shut door span (carrying its door id) or a raised edge whose crossing kind
// refuses (carrying its refusal), so a re-flood can open doors or crossings and name what stood
// in the way.

import { DOOR_CLOSED, DOOR_LOCKED, refusal } from '../doors/types'
import { MOVE_BLOCKED, OUTSIDE_MAP, ROOM_UNEXPLORED, SOLID_GROUND } from './types'

/** A line that stops walking. */
export interface WalkBlocker {
  x1: number
  y1: number
  x2: number
  y2: number
  /** A shut door's span: the door's id, so a refusal can name it. */
  doorId?: string
  /** A refusing raised edge: the refusal a move stopped here answers with. */
  crossing?: string
  /**
   * Walls only: how near a cell centre may come before the cell is solid. A door or crossing
   * never makes a cell solid.
   */
  reach?: number
  /** Cave rock only: the reach on the rock's outer side, where `outside(x, y)` holds. */
  outerReach?: number
  outside?: (x: number, y: number) => boolean
}

export const NO_GROUND = 0
export const SOLID = 1
export const STANDABLE = 2

/** Bits of `WalkGrid.edge`: what blocks the step. */
const BY_WALL = 1
const BY_DOOR = 2
const BY_CROSSING = 4

/** The four forward steps; the other four are these read from the neighbour. */
const FORWARD: readonly [number, number][] = [
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
]

export interface WalkGrid {
  minX: number
  minY: number
  cols: number
  rows: number
  /** Per cell: `NO_GROUND`, `SOLID` or `STANDABLE`. */
  cell: Uint8Array
  /** Per cell and forward step (`cell * 4 + k`): what blocks it, as `BY_*` bits; 0 = open. */
  edge: Uint8Array
  /** Edge index → the first door id on it. */
  doors: Map<number, string>
  /** Edge index → the refusal of the first refusing crossing on it. */
  crossings: Map<number, string>
}

/**
 * Builds a grid over the frame. `ground(x, y)` is asked once per cell centre. Blockers are
 * rasterised over their own box, so the cost follows the walls drawn, not the frame's area.
 */
export function buildWalkGrid(
  frame: { minX: number; minY: number; maxX: number; maxY: number },
  ground: (x: number, y: number) => boolean,
  blockers: readonly WalkBlocker[],
): WalkGrid {
  const minX = Math.floor(frame.minX)
  const minY = Math.floor(frame.minY)
  const cols = Math.max(0, Math.ceil(frame.maxX) - minX)
  const rows = Math.max(0, Math.ceil(frame.maxY) - minY)
  const cell = new Uint8Array(cols * rows)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (ground(minX + col + 0.5, minY + row + 0.5)) cell[row * cols + col] = STANDABLE
    }
  }
  const grid: WalkGrid = { minX, minY, cols, rows, cell, edge: new Uint8Array(cols * rows * 4), doors: new Map(), crossings: new Map() }
  for (const b of blockers) addBlocker(grid, b)
  return grid
}

function addBlocker(grid: WalkGrid, b: WalkBlocker): void {
  const { minX, minY, cols, rows, cell, edge } = grid
  const pad = Math.max(1, b.reach ?? 0, b.outerReach ?? 0) + 0.5
  const c0 = Math.max(0, Math.floor(Math.min(b.x1, b.x2) - pad - minX))
  const c1 = Math.min(cols - 1, Math.floor(Math.max(b.x1, b.x2) + pad - minX))
  const r0 = Math.max(0, Math.floor(Math.min(b.y1, b.y2) - pad - minY))
  const r1 = Math.min(rows - 1, Math.floor(Math.max(b.y1, b.y2) + pad - minY))
  const bit = b.doorId ? BY_DOOR : b.crossing ? BY_CROSSING : BY_WALL
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const i = row * cols + col
      const x = minX + col + 0.5
      const y = minY + row + 0.5
      if (bit === BY_WALL && cell[i] === STANDABLE) {
        const reach = b.outerReach !== undefined && b.outside?.(x, y) ? b.outerReach : (b.reach ?? 0)
        if (reach > 0 && distanceToSegment(x, y, b) < reach) cell[i] = SOLID
      }
      for (let k = 0; k < 4; k++) {
        const [dx, dy] = FORWARD[k]
        const nc = col + dx
        const nr = row + dy
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
        if (!touches(x, y, x + dx, y + dy, b)) continue
        const e = i * 4 + k
        edge[e] |= bit
        if (bit === BY_DOOR && !grid.doors.has(e)) grid.doors.set(e, b.doorId!)
        if (bit === BY_CROSSING && !grid.crossings.has(e)) grid.crossings.set(e, b.crossing!)
      }
    }
  }
}

const EPS = 1e-9

/** Whether segment p→q touches blocker a→b, end points included. */
function touches(px: number, py: number, qx: number, qy: number, b: WalkBlocker): boolean {
  const rx = qx - px
  const ry = qy - py
  const sx = b.x2 - b.x1
  const sy = b.y2 - b.y1
  const den = rx * sy - ry * sx
  const ax = b.x1 - px
  const ay = b.y1 - py
  if (Math.abs(den) < EPS) {
    // Parallel: they touch only when collinear and overlapping.
    if (Math.abs(ax * ry - ay * rx) > EPS) return false
    const len = rx * rx + ry * ry
    const t0 = (ax * rx + ay * ry) / len
    const t1 = ((b.x2 - px) * rx + (b.y2 - py) * ry) / len
    return Math.max(t0, t1) >= -EPS && Math.min(t0, t1) <= 1 + EPS
  }
  const t = (ax * sy - ay * sx) / den
  const u = (ax * ry - ay * rx) / den
  return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS
}

function distanceToSegment(x: number, y: number, b: WalkBlocker): number {
  const dx = b.x2 - b.x1
  const dy = b.y2 - b.y1
  const len = dx * dx + dy * dy
  const t = len > 0 ? Math.max(0, Math.min(1, ((x - b.x1) * dx + (y - b.y1) * dy) / len)) : 0
  return Math.hypot(x - (b.x1 + dx * t), y - (b.y1 + dy * t))
}

/** The cell index under a point, or -1 off the grid. */
export function cellAt(grid: WalkGrid, x: number, y: number): number {
  const col = Math.floor(x - grid.minX)
  const row = Math.floor(y - grid.minY)
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return -1
  return row * grid.cols + col
}

/** A cell's centre. */
export function cellCentre(grid: WalkGrid, i: number): { x: number; y: number } {
  return { x: grid.minX + (i % grid.cols) + 0.5, y: grid.minY + Math.floor(i / grid.cols) + 0.5 }
}

/**
 * The cells a token covers standing at (x, y): one for odd widths and tiny, every cell of the
 * square for even ones (D13 snaps those to intersections). -1 for a cell off the grid.
 */
export function coveredCells(grid: WalkGrid, x: number, y: number, cells: number): number[] {
  const width = Math.max(1, Math.round(cells))
  if (width === 1) return [cellAt(grid, x, y)]
  const half = width / 2
  const out: number[] = []
  for (let r = 0; r < width; r++) {
    for (let c = 0; c < width; c++) out.push(cellAt(grid, x - half + c + 0.5, y - half + r + 0.5))
  }
  return out
}

/** The cell a token is flooded from: its centre cell, or for an even width the one up-left of it. */
export function anchorCell(grid: WalkGrid, x: number, y: number, cells: number): number {
  const width = Math.max(1, Math.round(cells))
  return width % 2 === 0 ? cellAt(grid, x - 0.5, y - 0.5) : cellAt(grid, x, y)
}

export interface FloodOptions {
  /** Shut doors let the flood through. */
  doors?: boolean
  /** Refusing crossings let the flood through. */
  crossings?: boolean
}

/**
 * Breadth-first from `start` over standable cells `known` holds, along pass bits, stopping at
 * `target`. The start cell always counts, so a token caught in rock can walk out. Returns the
 * path of edge indices from start to target (empty when start is the target), or null when the
 * target is not reached.
 */
export function floodPath(
  grid: WalkGrid,
  start: number,
  target: number,
  known: (i: number) => boolean,
  open: FloodOptions = {},
): number[] | null {
  if (start < 0 || target < 0) return null
  if (start === target) return []
  const { cols, rows, cell, edge } = grid
  const allowed = BY_WALL | (open.doors ? 0 : BY_DOOR) | (open.crossings ? 0 : BY_CROSSING)
  const n = cols * rows
  // Per cell: the edge index it was reached across + 1 (0 = not reached).
  const via = new Int32Array(n)
  const from = new Int32Array(n)
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0
  queue[tail++] = start
  via[start] = -1
  const usable = (i: number): boolean => cell[i] === STANDABLE && known(i)
  while (head < tail) {
    const i = queue[head++]
    const col = i % cols
    const row = (i - col) / cols
    for (let k = 0; k < 8; k++) {
      const forward = k < 4
      const [dx, dy] = forward ? FORWARD[k] : FORWARD[k - 4]
      const nc = forward ? col + dx : col - dx
      const nr = forward ? row + dy : row - dy
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
      const j = nr * cols + nc
      if (via[j] !== 0) continue
      const e = forward ? i * 4 + k : j * 4 + (k - 4)
      if ((edge[e] & allowed) !== 0) continue
      if (j !== target && !usable(j)) continue
      if (j === target && cell[j] !== STANDABLE) continue
      via[j] = e + 1
      from[j] = i
      if (j === target) {
        const path: number[] = []
        for (let at = target; at !== start; at = from[at]) path.push(via[at] - 1)
        return path.reverse()
      }
      queue[tail++] = j
    }
  }
  return null
}

/** The first door id along a path, among those `held` allows. */
export function firstDoorOn(grid: WalkGrid, path: readonly number[], held: (doorId: string) => boolean): string | null {
  for (const e of path) {
    if ((grid.edge[e] & BY_DOOR) === 0) continue
    const id = grid.doors.get(e)
    if (id && held(id)) return id
  }
  return null
}

/**
 * The first door on the way to an unknown `target`: a flood with shut doors open, over known
 * standable cells until it passes a door and over any standable cell after. Null when the target
 * is reached with no door behind, or not reached.
 */
export function firstDoorToUnknown(grid: WalkGrid, start: number, target: number, known: (i: number) => boolean): string | null {
  if (start < 0 || target < 0 || start === target) return null
  const { cols, rows, cell, edge } = grid
  const n = cols * rows
  // A state is a cell before any door (i) or after one (i + n); `door` holds the first door edge.
  const seen = new Uint8Array(2 * n)
  const door = new Int32Array(2 * n)
  const queue = new Int32Array(2 * n)
  let head = 0
  let tail = 0
  queue[tail++] = start
  seen[start] = 1
  while (head < tail) {
    const s = queue[head++]
    const past = s >= n
    const i = past ? s - n : s
    const col = i % cols
    const row = (i - col) / cols
    for (let k = 0; k < 8; k++) {
      const forward = k < 4
      const [dx, dy] = forward ? FORWARD[k] : FORWARD[k - 4]
      const nc = forward ? col + dx : col - dx
      const nr = forward ? row + dy : row - dy
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
      const j = nr * cols + nc
      const e = forward ? i * 4 + k : j * 4 + (k - 4)
      if ((edge[e] & (BY_WALL | BY_CROSSING)) !== 0 || cell[j] !== STANDABLE) continue
      const first = past ? door[s] : (edge[e] & BY_DOOR) !== 0 ? e : -1
      if (j === target) return first < 0 ? null : (grid.doors.get(first) ?? null)
      if (first < 0 && !known(j)) continue
      const t = first < 0 ? j : j + n
      if (seen[t]) continue
      seen[t] = 1
      door[t] = first
      queue[tail++] = t
    }
  }
  return null
}

/** The refusal of the first refusing crossing along a path. */
export function firstCrossingOn(grid: WalkGrid, path: readonly number[]): string | null {
  for (const e of path) {
    if ((grid.edge[e] & BY_CROSSING) === 0) continue
    const msg = grid.crossings.get(e)
    if (msg) return msg
  }
  return null
}

/** What the server knows about one seat on one level, for {@link walkRefusal}. */
export interface WalkView {
  grid: WalkGrid
  /** Whether the seat (or the party, in party share) knows the ground of a cell (§2.2). */
  known(i: number): boolean
  /** Whether the seat holds this door, so a refusal may name it. */
  heldDoor(doorId: string): boolean
  /** Whether a door is locked right now. */
  doorLocked(doorId: string): boolean
}

const say = (code: string, subjectId: string | null = null): string =>
  refusal(code, subjectId, 'that space cannot be occupied')

/**
 * §2.3 — why a player's token may not stand at `to` (or walk there from `from`), or null.
 * In order: no ground, solid, not known, not reached. An unknown spot names the first door on
 * the way when the seat holds it, else it is unexplored. An unreached spot is flooded again with
 * the doors open, to name the first door on the way the seat holds; then with the crossings
 * open as well, to give the crossing's refusal; else it is plain blocked.
 */
export function walkRefusal(
  view: WalkView,
  from: { x: number; y: number } | null,
  to: { x: number; y: number },
  cells: number,
): string | null {
  const { grid, known } = view
  const covered = coveredCells(grid, to.x, to.y, cells)
  if (covered.some((i) => i < 0 || grid.cell[i] === NO_GROUND)) return say(OUTSIDE_MAP)
  if (covered.some((i) => grid.cell[i] === SOLID)) return say(SOLID_GROUND)
  const start = from ? anchorCell(grid, from.x, from.y, cells) : -1
  const target = anchorCell(grid, to.x, to.y, cells)
  if (covered.some((i) => !known(i))) {
    // Name only a door the seat already holds, so an unknown room behind it leaks nothing.
    const door = firstDoorToUnknown(grid, start, target, known)
    if (door && view.heldDoor(door)) return say(view.doorLocked(door) ? DOOR_LOCKED : DOOR_CLOSED, door)
    return say(ROOM_UNEXPLORED)
  }
  if (!from) return null
  // Off the grid entirely (a token the DM left outside the frame): nothing to walk from.
  if (start < 0) return null
  if (floodPath(grid, start, target, known)) return null
  const withDoors = floodPath(grid, start, target, known, { doors: true })
  if (withDoors) {
    const door = firstDoorOn(grid, withDoors, view.heldDoor)
    if (door) return say(view.doorLocked(door) ? DOOR_LOCKED : DOOR_CLOSED, door)
  }
  const withCrossings = floodPath(grid, start, target, known, { doors: true, crossings: true })
  if (withCrossings) {
    const crossing = firstCrossingOn(grid, withCrossings)
    if (crossing) return crossing
  }
  return say(MOVE_BLOCKED)
}

/**
 * §2.6 — the walk grid cut into connected areas: every standable cell labelled with the area it
 * belongs to (-1 for no ground or solid), joined along pass bits with shut doors closed and
 * crossings open, and known ground ignored. What the party can see behind closed doors is the
 * areas its tokens stand in, so a one-sided door, an archway and a cave mouth all count.
 */
export function walkAreas(grid: WalkGrid): Int32Array {
  const { cols, rows, cell, edge } = grid
  const n = cols * rows
  const label = new Int32Array(n).fill(-1)
  const queue = new Int32Array(n)
  const blocking = BY_WALL | BY_DOOR
  let next = 0
  for (let s = 0; s < n; s++) {
    if (label[s] !== -1 || cell[s] !== STANDABLE) continue
    label[s] = next
    let head = 0
    let tail = 0
    queue[tail++] = s
    while (head < tail) {
      const i = queue[head++]
      const col = i % cols
      const row = (i - col) / cols
      for (let k = 0; k < 8; k++) {
        const forward = k < 4
        const [dx, dy] = forward ? FORWARD[k] : FORWARD[k - 4]
        const nc = forward ? col + dx : col - dx
        const nr = forward ? row + dy : row - dy
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
        const j = nr * cols + nc
        if (label[j] !== -1 || cell[j] !== STANDABLE) continue
        const e = forward ? i * 4 + k : j * 4 + (k - 4)
        if ((edge[e] & blocking) !== 0) continue
        label[j] = next
        queue[tail++] = j
      }
    }
    next++
  }
  return label
}
