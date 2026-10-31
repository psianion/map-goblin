// Doorway sealing: the wall pieces either side of a door meet its jambs exactly.
//
// A doorway is often its own short wall piece between two longer ones on the same
// line (fieldstone-keep, emberhold-crypt): the door hangs on that piece, and its
// neighbours stop where the piece starts. Narrow the door and the piece's leftover
// ends were wall nobody could see (too short for a stone or a rock) and a gap the
// eye read as open; widen it and the neighbours had to be cut at render time only.
//
// So the data follows the door. On each side where a collinear piece bounds the
// doorway, the door's own piece ends at the door's edge and the neighbour runs up
// to meet it: it grows when the door narrows, it is trimmed when the door widens
// or slides toward it. The opening in the walls is then the door's width exactly,
// for the renderer, the lighting sweep, fog, the table and the bot alike, because
// they all read the same walls. Nothing turns a corner and nothing reaches past
// the two immediate neighbours.
//
// Pure: takes a layer, returns what to write.

import type { DungeonLayer } from '../store/types';
import type { DoorChild, WallSegment } from './types';

type Pt = [number, number];

/** How close an endpoint must sit to another to count as joined, cells. */
const JOIN = 0.05;
/** How far off the door's line a neighbour may lie, cells, and how far from parallel (sine). */
const LINE_SLACK = 0.05;
const PARALLEL = 0.02;
/**
 * A stretch of the door's own piece left beside it up to this long, with a neighbour
 * past it, is doorway, not wall: it is folded into the neighbour. Longer, and the
 * piece is a wall in its own right with a door in it; its end there stays put.
 */
const DOORWAY_SLACK = 1;
/** The shortest a neighbour may be trimmed to, so it is still a wall. */
const MIN_NEIGHBOUR = 0.5;

interface Side {
  /** Index of the neighbour in `standaloneWalls`. */
  index: number;
  /** Which of its two points touches the doorway piece. */
  near: 0 | 1;
  /** Its far end, along the door's axis. */
  far: number;
}

/** The doorway a door sits in: its piece, the axis along it, and the pieces bounding it. */
export interface Doorway {
  wallIndex: number;
  origin: Pt;
  dir: Pt;
  length: number;
  /** Where the door's centre sits along the axis now. */
  centre: number;
  lo: Side | null;
  hi: Side | null;
  /** The span the door may take: past the bounding ends into each neighbour, else the piece's own ends. */
  min: number;
  max: number;
}

const along = (o: Pt, d: Pt, p: Pt) => (p[0] - o[0]) * d[0] + (p[1] - o[1]) * d[1];
const off = (o: Pt, d: Pt, p: Pt) => d[0] * (p[1] - o[1]) - d[1] * (p[0] - o[0]);

/**
 * The doorway `doorId` sits in, or null when there is nothing to seal: the door is
 * not on a straight drawn wall (a floor or room edge is drawn from the shapes, and
 * its opening is exact already), or no collinear piece bounds it. `width` is the
 * width to ask about (the door's own when absent): a door widened toward a
 * neighbour comes to be bounded by it.
 */
export function findDoorway(layer: DungeonLayer, doorId: string, width?: number): Doorway | null {
  const door = layer.children.find((c): c is DoorChild => c.id === doorId && c.childType === 'door');
  if (!door) return null;
  const walls = layer.standaloneWalls ?? [];
  const wallIndex = walls.findIndex((w) => w.id === door.wallId);
  const host = walls[wallIndex];
  if (!host || host.points.length !== 2) return null;
  const [a, b] = host.points as [Pt, Pt];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < JOIN) return null;
  const dir: Pt = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  // Where the resolver puts the door (resolveDoor): inside its piece, centred when wider.
  const w = width ?? door.width;
  const half = w / 2;
  const centre = w >= length ? length / 2 : Math.min(length - half, Math.max(half, along(a, dir, door.position)));

  const sideAt = (end: number, outward: 1 | -1): Side | null => {
    let best: Side | null = null;
    walls.forEach((w, index) => {
      if (index === wallIndex || w.points.length !== 2) return;
      const [p, q] = w.points as [Pt, Pt];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < JOIN) return;
      if (Math.abs(dir[0] * (q[1] - p[1]) - dir[1] * (q[0] - p[0])) / len > PARALLEL) return;
      if (Math.abs(off(a, dir, p)) > LINE_SLACK || Math.abs(off(a, dir, q)) > LINE_SLACK) return;
      const tp = along(a, dir, p);
      const tq = along(a, dir, q);
      const near: 0 | 1 | null = Math.abs(tp - end) <= JOIN ? 0 : Math.abs(tq - end) <= JOIN ? 1 : null;
      if (near === null) return;
      const far = near === 0 ? tq : tp;
      // It must run away from the piece, not back over it.
      if ((far - end) * outward <= JOIN) return;
      if (!best || Math.abs(far - end) > Math.abs(best.far - end)) best = { index, near, far };
    });
    return best;
  };

  const loNear = sideAt(0, -1);
  const hiNear = sideAt(length, 1);
  // A neighbour bounds the doorway only where the door all but reaches the piece's end.
  const lo = loNear && centre - half <= DOORWAY_SLACK ? loNear : null;
  const hi = hiNear && length - (centre + half) <= DOORWAY_SLACK ? hiNear : null;
  if (!lo && !hi) return null;
  return {
    wallIndex,
    origin: a,
    dir,
    length,
    centre,
    lo,
    hi,
    min: lo ? lo.far + MIN_NEIGHBOUR : 0,
    max: hi ? hi.far - MIN_NEIGHBOUR : length,
  };
}

/**
 * The door's host when it is the door's own piece: a drawn, straight (two-point) wall no
 * longer than the door plus `DOORWAY_SLACK`, as a free-standing door is placed on. Such a
 * door turns by turning its piece, and goes with it when deleted. Null otherwise (a long
 * wall, a floor or room edge, no door).
 */
export function isOwnPiece(layer: DungeonLayer, doorId: string): WallSegment | null {
  const door = layer.children.find((c): c is DoorChild => c.id === doorId && c.childType === 'door');
  const host = door && (layer.standaloneWalls ?? []).find((w) => w.id === door.wallId);
  if (!door || !host || host.points.length !== 2) return null;
  const [a, b] = host.points;
  return Math.hypot(b[0] - a[0], b[1] - a[1]) <= door.width + DOORWAY_SLACK + 1e-6 ? host : null;
}

/**
 * A door on its own piece turned to `angle` (radians): the piece's two ends turned about
 * the door's centre (where the resolver puts it on the piece), and the door's stored angle
 * and centre. Null when the door is not on its own piece.
 */
export function turnOwnPiece(
  layer: DungeonLayer,
  doorId: string,
  angle: number,
): { wallId: string; before: Pt[]; after: Pt[]; door: Pick<DoorChild, 'angle' | 'position'> } | null {
  const host = isOwnPiece(layer, doorId);
  const door = layer.children.find((c): c is DoorChild => c.id === doorId && c.childType === 'door');
  if (!host || !door) return null;
  const [a, b] = host.points as [Pt, Pt];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < JOIN) return null;
  const dir: Pt = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  const half = door.width / 2;
  const t = door.width >= length ? length / 2 : Math.min(length - half, Math.max(half, along(a, dir, door.position)));
  const c: Pt = [a[0] + dir[0] * t, a[1] + dir[1] * t];
  const [ux, uy] = [Math.cos(angle), Math.sin(angle)];
  return {
    wallId: host.id,
    before: [[...a], [...b]],
    after: [
      [c[0] - ux * t, c[1] - uy * t],
      [c[0] + ux * (length - t), c[1] + uy * (length - t)],
    ],
    door: { angle, position: c },
  };
}

/**
 * Whether a point is over the doorway's run: within `reach` of its line, and along it no
 * further than `reach` past the span the door may take. A door dragged there slides in
 * its doorway; dragged anywhere else it is re-anchored like any other door.
 */
export function overDoorway(d: Doorway, p: Pt, reach: number): boolean {
  const t = along(d.origin, d.dir, p);
  return Math.abs(off(d.origin, d.dir, p)) <= reach && t >= d.min - reach && t <= d.max + reach;
}

/** The widest the door may be in its doorway: the whole span it may take. */
export function doorwayRoom(layer: DungeonLayer, doorId: string): number | null {
  const d = findDoorway(layer, doorId);
  return d ? d.max - d.min : null;
}

export interface DoorwaySeal {
  /** The door's new width and centre. */
  door: Pick<DoorChild, 'width' | 'position'>;
  /** Every wall whose points change, before and after. */
  walls: { id: string; before: Pt[]; after: Pt[] }[];
}

/**
 * The door at `width`, centred at `at` (a world point projected onto its wall; its
 * current centre when absent), sealed into its doorway: its own piece spans it
 * exactly on each bounding side, and the neighbour there runs up to its edge. The
 * door slides to stay within the span it may take. Null when there is no doorway
 * to seal (see `findDoorway`); the caller then writes the door alone.
 */
export function sealDoorway(
  layer: DungeonLayer,
  doorId: string,
  next: { width?: number; at?: Pt },
): DoorwaySeal | null {
  const door = layer.children.find((c): c is DoorChild => c.id === doorId && c.childType === 'door');
  const d = door && findDoorway(layer, doorId, next.width ?? door.width);
  if (!d || !door) return null;
  const width = Math.min(next.width ?? door.width, d.max - d.min);
  const wanted = next.at ? along(d.origin, d.dir, next.at) : d.centre;
  const centre = Math.min(d.max - width / 2, Math.max(d.min + width / 2, wanted));
  const s = centre - width / 2;
  const e = centre + width / 2;
  const at = (t: number): Pt => [d.origin[0] + d.dir[0] * t, d.origin[1] + d.dir[1] * t];

  const walls = layer.standaloneWalls;
  const out: DoorwaySeal['walls'] = [];
  const write = (w: WallSegment, after: Pt[]) => {
    const before = w.points as Pt[];
    if (before.every((p, i) => Math.hypot(p[0] - after[i][0], p[1] - after[i][1]) < 1e-9)) return;
    out.push({ id: w.id, before: before.map((p) => [...p] as Pt), after });
  };
  const host = walls[d.wallIndex];
  // The piece keeps its drawn direction: lo is its first point, hi its second.
  write(host, [d.lo ? at(s) : at(0), d.hi ? at(e) : at(d.length)]);
  for (const [side, edge] of [[d.lo, s], [d.hi, e]] as const) {
    if (!side) continue;
    const w = walls[side.index];
    const pts = (w.points as Pt[]).map((p) => [...p] as Pt);
    pts[side.near] = at(edge);
    write(w, pts);
  }
  return { door: { width, position: at(centre) }, walls: out };
}
