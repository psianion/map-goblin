// Region memory (S3 P1) — one bit per grid cell, row-major from the scene frame's
// (minX, minY), packed into base64 bytes. Bytes and ORs, nothing else: the server
// accumulates the party's sweeps into this record and P2's client mask reads the very same
// bytes, so the two cannot drift into two ideas of what has been seen.
//
// Pure and dependency-free on purpose (D2) — the only geometry here is a point-in-polygon
// test on cell centres.

// The one base64 codec both runtimes this package targets already have (Node ≥16 and every
// browser). `lib` here is ES2022 with no DOM and no node types (see tsconfig), so they are
// declared rather than hand-rolled — a hand-rolled codec would be forty lines of the same
// thing with more places to be wrong.
declare const atob: (data: string) => string
declare const btoa: (data: string) => string

/**
 * A scene's confining rectangle, cell-snapped. Core's `WorldBounds` satisfies it as-is —
 * declared here rather than imported for the reason `FogRoom` is (D2): reaching into
 * `@dnd/core/src/shared/mapBounds` drags `store/types` and its DOM types in with it, and
 * this package compiles without a DOM on purpose.
 */
export interface Frame {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** `[col, row]`, relative to the mask's own origin. */
export type Cell = [number, number]

export interface RegionMask {
  /** World position of cell (0, 0) — the frame's own origin. */
  minX: number
  minY: number
  cols: number
  rows: number
  /** base64 of `ceil(cols * rows / 8)` bytes, row-major, LSB first within a byte. */
  bits: string
}

export function toBytes(bits: string): Uint8Array {
  const raw = atob(bits)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

export function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += String.fromCharCode(byte)
  return btoa(out)
}

/**
 * ponytail: 512×512 cells is the ceiling, because the mask is rebroadcast whole on every
 * write. 262144 cells is 32768 bytes ≈ 43692 chars of base64 — and that is *one* record.
 *
 * What has to fit the frame the socket caps at 256KiB is the whole fog slice, which is every
 * record the viewer is allowed to hold. A player holds one: `redact` maps their own onto
 * `region` and strips `regions` whole. The DM in individual share holds the party record plus
 * one per seat — ~43KB × (seats + 1), which passes 262144 bytes at five seats — and the slice
 * is `byScene` entire, so a campaign's second vision scene multiplies it again.
 *
 * So the honest reading is that this constant bounds one record and does not bound the frame:
 * a full-size map is a DM-socket problem at an ordinary table long before a bigger map is. It
 * still buys the thing it was written for — a scene past it keeps no region record at all,
 * rather than one record nothing can receive. The frame is what region *deltas* buy (broadcast
 * the cells a write turned on, not the whole mask), and the DM's (seats + 1) multiplication is
 * the trigger to go write them, not a bigger cap here.
 */
export const REGION_CELL_MAX = 512 * 512

/**
 * An empty mask sized to the frame. A 100×100 scene is 1250 bytes of base64. Undefined past
 * `REGION_CELL_MAX` — a stray far-off asset can stretch a frame to thousands of cells a side,
 * and a scene with no region record still fogs by room like every scene did before P1.
 */
export function regionOf(frame: Frame): RegionMask | undefined {
  const cols = Math.max(0, Math.round(frame.maxX - frame.minX))
  const rows = Math.max(0, Math.round(frame.maxY - frame.minY))
  if (cols * rows > REGION_CELL_MAX) return undefined
  return {
    minX: frame.minX,
    minY: frame.minY,
    cols,
    rows,
    bits: toBase64(new Uint8Array(Math.ceil((cols * rows) / 8))),
  }
}

/**
 * The mask a cell command writes into, always in the *current* frame's coordinates —
 * `stored` when it still describes this frame, a fresh empty one when it does not, and
 * undefined for a frame past `REGION_CELL_MAX`, which holds no region record at all.
 *
 * ponytail: a republish that moves or resizes the map starts the region over rather than
 * re-basing the old bits onto the new origin. The room record — the one that decides what
 * geometry a player holds — survives it untouched; region memory is presentation, and
 * re-basing it is worth writing the day a DM complains.
 */
export function regionFor(stored: RegionMask | undefined, frame: Frame): RegionMask | undefined {
  const fresh = regionOf(frame)
  return fresh &&
    stored &&
    stored.minX === fresh.minX &&
    stored.minY === fresh.minY &&
    stored.cols === fresh.cols &&
    stored.rows === fresh.rows
    ? stored
    : fresh
}

/**
 * ponytail: decodes the whole mask for one bit. Fine for a single probe (a test, a hover);
 * anything asking about a batch goes through `setCells`/`clearCells`, which decode once.
 */
export function getCell(region: RegionMask | undefined, col: number, row: number): boolean {
  if (!region || col < 0 || row < 0 || col >= region.cols || row >= region.rows) return false
  const bit = row * region.cols + col
  return (toBytes(region.bits)[bit >>> 3] & (1 << (bit & 7))) !== 0
}

/** The mask with `cells` turned on. Out-of-bounds cells are ignored, not an error. */
export function setCells(region: RegionMask, cells: readonly Cell[]): RegionMask {
  return write(region, cells, true)
}

/** …and off, which is the fog brush's hide stroke (P4). */
export function clearCells(region: RegionMask, cells: readonly Cell[]): RegionMask {
  return write(region, cells, false)
}

function write(region: RegionMask, cells: readonly Cell[], on: boolean): RegionMask {
  const bytes = toBytes(region.bits)
  for (const [col, row] of cells) {
    if (col < 0 || row < 0 || col >= region.cols || row >= region.rows) continue
    const bit = row * region.cols + col
    if (on) bytes[bit >>> 3] |= 1 << (bit & 7)
    else bytes[bit >>> 3] &= ~(1 << (bit & 7))
  }
  return { ...region, bits: toBase64(bytes) }
}

/**
 * `base` with every bit `other` holds turned on — the whole of P5's share-flip merge, in one
 * primitive, because a region record is bytes and a merge of two of them is an OR (§1).
 *
 * Frames that disagree are left alone rather than re-based, which is the rule `regionFor`
 * already applies to a stored mask: every record on one scene is minted from that scene's
 * frame, so two of them only differ after a republish moved the map — and a republish is
 * exactly what starts the record over.
 */
export function orRegion(base: RegionMask, other: RegionMask | undefined): RegionMask {
  if (
    !other ||
    other.minX !== base.minX ||
    other.minY !== base.minY ||
    other.cols !== base.cols ||
    other.rows !== base.rows
  ) {
    return base
  }
  const bytes = toBytes(base.bits)
  const add = toBytes(other.bits)
  // A record whose byte count disagrees is refused whole, exactly as a disagreeing frame is.
  // It cannot be minted here — `regionOf` derives the length from cols × rows and every write
  // re-encodes the same array — so a mismatch is a corrupted or hand-made record, and merging
  // its prefix would write another mask's cells into this one on the strength of four numbers
  // that happen to line up. (It would not *eat* the base's tail: `bytes[i] |= undefined` is
  // `| 0`, a no-op. The partial merge is the part worth refusing.) Byte count and not base64
  // length, because 4 chars of base64 can be 1, 2 or 3 bytes.
  if (add.length !== bytes.length) return base
  for (let i = 0; i < bytes.length; i++) bytes[i] |= add[i]
  return { ...base, bits: toBase64(bytes) }
}

/**
 * The cells a sweep polygon covers, judged by their centres — the same rule room membership
 * uses, so a token and the cell it stands on never disagree about which side of a wall they
 * are on. Bounded by the polygon's own box, so a 6-cell sight radius walks ~150 cells and
 * not the whole map.
 */
export function cellsCoveredByPolygon(polygon: readonly [number, number][], frame: Frame): Cell[] {
  const covered: Cell[] = []
  if (polygon.length < 3) return covered
  const cols = Math.max(0, Math.round(frame.maxX - frame.minX))
  const rows = Math.max(0, Math.round(frame.maxY - frame.minY))

  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of polygon) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }

  const from = (v: number) => Math.max(0, Math.floor(v))
  for (let row = from(minY - frame.minY); row < Math.min(rows, Math.ceil(maxY - frame.minY)); row++) {
    for (let col = from(minX - frame.minX); col < Math.min(cols, Math.ceil(maxX - frame.minX)); col++) {
      if (pointInPolygon(polygon, frame.minX + col + 0.5, frame.minY + row + 0.5)) {
        covered.push([col, row])
      }
    }
  }
  return covered
}

/** Ray casting — the one geometry primitive the region record needs. */
export function pointInPolygon(polygon: readonly [number, number][], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
