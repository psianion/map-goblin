// Undo for the DM (table lobby pass §5.1): how a history step lands on the fog slice.
//
// Each level's cleared record is one leaf, and putting one back touches only the cells the
// step itself changed. A whole record put back would also fog every cell the players explored
// since, which is the fault the old Clear all toast had.

import { rebaseRegion, toBase64, toBytes, type Frame, type RegionMask } from './region'

type Path = readonly string[]
type Side = 'before' | 'after'

/**
 * The fog slice's rule for the history diff: walk into every scene and its `cleared` even when
 * one side has none, and stop at a level's record, which {@link mergeCleared} puts back.
 */
export const fogHistory = {
  at(path: Path): 'through' | 'leaf' | undefined {
    if (path.length === 0) return 'through'
    if (path[0] !== 'byScene') return undefined
    if (path.length <= 2) return 'through'
    if (path[2] !== 'cleared') return undefined
    if (path.length === 3) return 'through'
    return path.length === 4 ? 'leaf' : undefined
  },
  apply(current: unknown, change: { before: unknown; after: unknown }, side: Side): unknown {
    return mergeCleared(
      current as RegionMask | undefined,
      change.before as RegionMask | undefined,
      change.after as RegionMask | undefined,
      side,
    )
  },
}

/**
 * `current` with `side`'s bit on every cell where `before` and `after` differ, and its own bit
 * everywhere else. Compared on `current`'s frame, so a republish that moved the map since keeps
 * cells where they are on the map.
 */
export function mergeCleared(
  current: RegionMask | undefined,
  before: RegionMask | undefined,
  after: RegionMask | undefined,
  side: Side,
): RegionMask | undefined {
  const target = side === 'before' ? before : after
  if (!current && !target) return undefined
  const base = (current ?? target)!
  const frame: Frame = { minX: base.minX, minY: base.minY, maxX: base.minX + base.cols, maxY: base.minY + base.rows }
  const length = Math.ceil((base.cols * base.rows) / 8)
  const into = current ? toBytes(current.bits) : new Uint8Array(length)
  const was = bytesOn(before, frame, length)
  const now = bytesOn(after, frame, length)
  const want = side === 'before' ? was : now
  for (let i = 0; i < length; i++) {
    const changed = was[i] ^ now[i]
    if (changed) into[i] = (into[i] & ~changed) | (want[i] & changed)
  }
  return { minX: base.minX, minY: base.minY, cols: base.cols, rows: base.rows, bits: toBase64(into) }
}

function bytesOn(mask: RegionMask | undefined, frame: Frame, length: number): Uint8Array {
  const rebased = mask && rebaseRegion(mask, frame)
  return rebased ? toBytes(rebased.bits) : new Uint8Array(length)
}
