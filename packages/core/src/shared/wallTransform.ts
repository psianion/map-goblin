// Moving, turning, mirroring and resizing drawn walls as whole objects.
//
// A drawn wall stores only its line: its stones (or a cave kit's rock) are laid from the
// points every render, and its hand edits (`nodeEdits`, `spanEdits`, `nodeInserts`) are
// keyed by `t` along the line, so they ride along unchanged under any point map. Doors hang
// on a wall by `wallId` and an authored `position` and `angle`: they go through the same
// map, and every doorway they sit in is sealed again afterwards, so the jambs stay closed.
//
// Pure: takes a layer, returns what to write.

import type { DungeonLayer } from '../store/types';
import type { AnyChild, DoorChild, WallSegment } from './types';
import { sealDoorway } from './doorwaySeal';

export type Pt = [number, number];
export type PointMap = (p: Pt) => Pt;

/** The wall's line through `map`. */
export function mapWallPoints(points: readonly Pt[], map: PointMap): Pt[] {
  return points.map((p) => map([p[0], p[1]]));
}

/**
 * A door's authored centre and angle through `map`: the centre is mapped, and the angle is
 * the direction a unit step along it ends up pointing, so a mirror or a stretch turns it
 * the way the wall under it turns.
 */
export function mapDoorPose(door: Pick<DoorChild, 'position' | 'angle'>, map: PointMap): { position: Pt; angle: number } {
  const p = map([door.position[0], door.position[1]]);
  const q = map([door.position[0] + Math.cos(door.angle), door.position[1] + Math.sin(door.angle)]);
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const angle = Math.hypot(dx, dy) > 1e-12 ? Math.atan2(dy, dx) : door.angle;
  return { position: p, angle };
}

/** A mirror about the vertical (`h`) or horizontal (`v`) line through (cx, cy). */
export function mirrorMap(axis: 'h' | 'v', cx: number, cy: number): PointMap {
  return axis === 'h' ? ([x, y]) => [2 * cx - x, y] : ([x, y]) => [x, 2 * cy - y];
}

/** The centre of the box around a wall's line. */
export function wallCentre(points: readonly Pt[]): Pt {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return points.length ? [(minX + maxX) / 2, (minY + maxY) / 2] : [0, 0];
}

export interface WallEditPlan {
  /** Every wall whose points change, before and after. */
  walls: { id: string; before: Pt[]; after: Pt[] }[];
  /** Every door whose fields change: the keys written, before and after. */
  doors: { id: string; before: Partial<DoorChild>; after: Partial<DoorChild> }[];
}

const samePts = (a: readonly Pt[], b: readonly Pt[]): boolean =>
  a.length === b.length && a.every((p, i) => Math.abs(p[0] - b[i][0]) < 1e-9 && Math.abs(p[1] - b[i][1]) < 1e-9);

/**
 * What `layer` looks like after each wall in `moves` goes through its map: the walls' new
 * lines, the doors bound to them carried along, and then every one of those doors sealed
 * into its doorway on the moved layer (a neighbour still joined to a moved doorway piece is
 * trimmed or grown to meet the door). The plan is the difference from `layer`.
 */
export function planWallEdits(layer: DungeonLayer, moves: ReadonlyMap<string, PointMap>): WallEditPlan {
  const after: DungeonLayer = {
    ...layer,
    standaloneWalls: layer.standaloneWalls.map((w) => {
      const map = moves.get(w.id);
      return map ? { ...w, points: mapWallPoints(w.points, map) } : w;
    }),
    children: layer.children.map((c) => {
      if (c.childType !== 'door') return c;
      const map = moves.get(c.wallId);
      return map ? { ...c, ...mapDoorPose(c, map) } : c;
    }),
  };
  // Seal every carried door, one after another, on the layer as it stands by then.
  for (const door of after.children) {
    if (door.childType !== 'door' || !moves.has(door.wallId)) continue;
    const seal = sealDoorway(after, door.id, {});
    if (!seal) continue;
    after.children = after.children.map((c) => (c.id === door.id ? ({ ...(c as DoorChild), ...seal.door } as AnyChild) : c));
    after.standaloneWalls = after.standaloneWalls.map((w) => {
      const s = seal.walls.find((x) => x.id === w.id);
      return s ? { ...w, points: s.after.map((p) => [p[0], p[1]] as Pt) } : w;
    });
  }

  const plan: WallEditPlan = { walls: [], doors: [] };
  layer.standaloneWalls.forEach((w, i) => {
    const next = after.standaloneWalls[i];
    if (!samePts(w.points, next.points)) {
      plan.walls.push({ id: w.id, before: w.points.map((p) => [p[0], p[1]] as Pt), after: next.points });
    }
  });
  layer.children.forEach((c, i) => {
    if (c.childType !== 'door') return;
    const next = after.children[i] as DoorChild;
    const before: Partial<DoorChild> = {};
    const out: Partial<DoorChild> = {};
    if (!samePts([c.position], [next.position])) {
      before.position = [c.position[0], c.position[1]];
      out.position = [next.position[0], next.position[1]];
    }
    if (Math.abs(c.angle - next.angle) > 1e-9) {
      before.angle = c.angle;
      out.angle = next.angle;
    }
    if (Math.abs(c.width - next.width) > 1e-9) {
      before.width = c.width;
      out.width = next.width;
    }
    if (Object.keys(out).length > 0) plan.doors.push({ id: c.id, before, after: out });
  });
  return plan;
}

/** The doors hanging on `wallId`. */
export function doorsOnWall(layer: Pick<DungeonLayer, 'children'>, wallId: string): DoorChild[] {
  return layer.children.filter((c): c is DoorChild => c.childType === 'door' && c.wallId === wallId);
}

/** A copy of `wall` under a new id, keeping every field and hand edit. */
export function copyWall(wall: WallSegment, id: string, map?: PointMap): WallSegment {
  const copy = structuredClone(wall);
  copy.id = id;
  delete copy.locked;
  if (map) copy.points = mapWallPoints(copy.points, map);
  return copy;
}
