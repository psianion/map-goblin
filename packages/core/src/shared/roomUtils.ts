import type { Room } from './types';

/**
 * Signed area (shoelace). Positive = counter-clockwise winding.
 * Clipper2 emits outer contours positive and holes negative, so the sign
 * is what distinguishes a room from a hole punched in one.
 */
export function signedArea(boundary: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < boundary.length; i++) {
    const [x1, y1] = boundary[i];
    const [x2, y2] = boundary[(i + 1) % boundary.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** Absolute polygon area. */
export function computeArea(boundary: [number, number][]): number {
  return Math.abs(signedArea(boundary));
}

/**
 * Area centroid of a polygon (not the vertex average) — stable when Clipper2
 * inserts extra collinear vertices, which the vertex average is not.
 * Falls back to the vertex average for degenerate (zero-area) input.
 */
export function computeCentroid(boundary: [number, number][]): [number, number] {
  if (boundary.length === 0) return [0, 0];
  const a = signedArea(boundary);
  if (Math.abs(a) > 1e-9) {
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < boundary.length; i++) {
      const [x1, y1] = boundary[i];
      const [x2, y2] = boundary[(i + 1) % boundary.length];
      const cross = x1 * y2 - x2 * y1;
      cx += (x1 + x2) * cross;
      cy += (y1 + y2) * cross;
    }
    return [cx / (6 * a), cy / (6 * a)];
  }
  let sx = 0;
  let sy = 0;
  for (const [x, y] of boundary) {
    sx += x;
    sy += y;
  }
  return [sx / boundary.length, sy / boundary.length];
}

/**
 * Stable room ID: FNV-1a over the centroid quantized to grid cells.
 * Editing walls elsewhere on the map leaves a room's ID untouched, which is
 * what lets user-assigned names survive re-detection.
 *
 * ponytail: two rooms whose centroids land in the same grid cell collide.
 * Mix the rounded area into the key if that ever shows up in practice.
 */
export function computeStableRoomId(centroid: [number, number], gridSize: number): string {
  const g = gridSize > 0 ? gridSize : 1;
  const key = `${Math.round(centroid[0] / g)},${Math.round(centroid[1] / g)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `room-${(h >>> 0).toString(36)}`;
}

/**
 * Narrow-corridor heuristic: long axis more than 3x the short axis, and the
 * short axis no wider than two grid cells.
 *
 * ponytail: axis-aligned bounding box, so a diagonal corridor reads as a room.
 * Swap in a rotating-calipers oriented box if diagonal maps matter.
 */
export function isPathway(boundary: [number, number][], gridSize: number): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of boundary) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  if (short < 0.01) return false;
  return long / short > 3 && short <= 2 * gridSize;
}

/**
 * The ring a room occupies: the face `syncRooms` derived for it, else the hand-traced
 * `boundary` an image-only map's room carries, else nothing. Every reader of a room's
 * extent goes through this, so none of them cares which of the two it was.
 */
export function roomFace(room: Pick<Room, 'face' | 'boundary'>): [number, number][] {
  return room.face ?? room.boundary ?? [];
}

/** Even-odd point-in-ring test. A point exactly on an edge may land either way. */
export function pointInRing(x: number, y: number, ring: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * A point that is inside the ring, for anchoring a room on it. The area centroid when
 * that is inside (the common case, and the most natural place for the badge); for a
 * ring it falls outside of — an L, a crescent, a cave lobe — the middle of the widest
 * span of a horizontal line through the centroid, then through other heights.
 */
export function interiorPoint(ring: readonly [number, number][]): [number, number] {
  const c = computeCentroid(ring as [number, number][]);
  if (ring.length < 3 || pointInRing(c[0], c[1], ring)) return c;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of ring) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  // The centroid's own height first, then heights spreading out from it.
  const heights = [c[1]];
  for (let k = 1; k <= 16; k++) heights.push(minY + ((maxY - minY) * k) / 17);
  let best: [number, number] | null = null;
  let bestWidth = 0;
  for (const y of heights) {
    const xs: number[] = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = xs[i + 1] - xs[i];
      if (w > bestWidth) {
        bestWidth = w;
        best = [(xs[i] + xs[i + 1]) / 2, y];
      }
    }
    // The centroid's height is preferred whenever it crosses the ring at all.
    if (best && y === c[1]) return best;
  }
  return best ?? c;
}

/** A face's identity across rooms: two rooms that claim one face share it. */
export function faceSignature(face: readonly (readonly [number, number])[]): string {
  if (face.length === 0) return '';
  const mid = face[face.length >> 1];
  return `${face.length}:${face[0][0]},${face[0][1]}:${mid[0]},${mid[1]}`;
}

const badgeMemo = new WeakMap<readonly Room[], ReadonlyMap<string, [number, number]>>();
const interiorMemo = new WeakMap<readonly (readonly [number, number])[], [number, number]>();

/**
 * Where each room's number badge (and the name chip under it) sits: a point well inside
 * its face (`interiorPoint`: the centroid when that is inside), not the anchor. The anchor
 * only says which face is the room's, and after a split both halves' anchors can sit right
 * by the divider, where their badges would pile up. A room with no face of its own keeps
 * its anchor: an orphan has nothing else to show, and two rooms on one face would
 * otherwise put both badges on the one spot. Memoised on the rooms array, so the hover
 * pick and the overlay pay for it once per sync.
 */
export function roomBadgePoints(rooms: readonly Room[]): ReadonlyMap<string, [number, number]> {
  const hit = badgeMemo.get(rooms);
  if (hit) return hit;
  const shared = new Map<string, number>();
  for (const r of rooms) {
    if (r.orphaned) continue;
    const sig = faceSignature(roomFace(r));
    if (sig) shared.set(sig, (shared.get(sig) ?? 0) + 1);
  }
  const out = new Map<string, [number, number]>();
  for (const r of rooms) {
    const face = roomFace(r);
    if (r.orphaned || face.length < 3 || (shared.get(faceSignature(face)) ?? 0) > 1) {
      out.set(r.id, r.anchor);
      continue;
    }
    let p = interiorMemo.get(face);
    if (!p) {
      p = interiorPoint(face);
      interiorMemo.set(face, p);
    }
    out.set(r.id, p);
  }
  badgeMemo.set(rooms, out);
  return out;
}

/** One room's badge point (see `roomBadgePoints`), read against the layer's rooms. */
export function roomBadgePoint(rooms: readonly Room[], room: Room): [number, number] {
  return roomBadgePoints(rooms).get(room.id) ?? room.anchor;
}

/**
 * Rooms in reading order: top to bottom, then left to right, by where each sits
 * (its centroid when known, else its anchor). Rows are a cell tall so rooms whose
 * centres differ by a fraction still read left to right.
 */
export function readingOrder<R extends Pick<Room, 'anchor' | 'centroid'>>(rooms: readonly R[]): R[] {
  const at = (r: R): [number, number] => r.centroid ?? r.anchor;
  return [...rooms].sort((a, b) => {
    const [ax, ay] = at(a);
    const [bx, by] = at(b);
    const row = Math.floor(ay) - Math.floor(by);
    return row !== 0 ? row : ax - bx;
  });
}

/** The next free room number on a layer: one past the highest in use. */
export function nextRoomNumber(rooms: readonly Pick<Room, 'number'>[] | undefined): number {
  let max = 0;
  for (const r of rooms ?? []) if (typeof r.number === 'number' && r.number > max) max = r.number;
  return max + 1;
}

/**
 * The derived half of a room for one face: centroid, area and the corridor flag.
 * What `syncRooms` writes beside the face.
 */
export function faceMetrics(
  face: [number, number][],
  gridSize: number,
): { centroid: [number, number]; area: number; isPathway: boolean } {
  return { centroid: computeCentroid(face), area: computeArea(face), isPathway: isPathway(face, gridSize) };
}
