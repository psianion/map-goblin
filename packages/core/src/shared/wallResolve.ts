import type { DungeonLayer } from '../store/types';
import type { DoorChild, WallSegment } from './types';
import { snapToNearestWall } from './wallSnap';

/**
 * A wall the rest of the engine can consume: either a standalone `WallSegment`
 * or one edge of a `mergedFloor` ring promoted to a real wall. Resolved in one
 * place so occlusion, lighting, the door tool and the renderers all agree on
 * what a wall is instead of each extracting floor edges its own way.
 */
export interface ResolvedWall extends WallSegment {
  kind: 'standalone' | 'floor';
}

/**
 * A door resolved onto a wall. `position` and `angle` are derived from the
 * projection on every resolve — the copies stored on the child are authored
 * intent, never the truth about where the door is now.
 */
export interface ResolvedDoor {
  door: DoorChild;
  /** `null` when nothing was in range: the door is detached. */
  wall: ResolvedWall | null;
  /** Parametric position along `wall` by arc length. */
  t: number;
  position: [number, number];
  angle: number;
  /** Detached doors stay listed everywhere but are excluded from occlusion. */
  detached: boolean;
}

/**
 * `wallId` of a door anchored to the floor outline. Floor rings are recomputed
 * from the shapes on every change, so there is no stable id to point at — the
 * anchor is the authored position plus projection, nothing more.
 */
export const FLOOR_ANCHORED = '';

/** Re-anchoring range for a door with no usable hint: its own width, min one cell. */
const MIN_ANCHOR_RANGE = 1;

/**
 * Ring edges are named `floor:{ring}:{edge}`, following the `floor:` convention
 * the node-edit overlay already uses for whole rings. Nothing persists these —
 * they are rebuilt every resolve. That is also why the separator differs from
 * the legacy `floor-{ring}-{edge}` wallIds old saves carry: those miss the
 * lookup and re-anchor by projection, which is exactly what they should do.
 */
function floorEdgeId(ring: number, edge: number): string {
  return `floor:${ring}:${edge}`;
}

type Memo<T> = Map<string, { keys: readonly unknown[]; out: T }>;
const wallMemo: Memo<ResolvedWall[]> = new Map();
const doorMemo: Memo<ResolvedDoor[]> = new Map();

/**
 * Per-layer memo keyed on input identity. The store is immer-backed, so a
 * changed reference *is* "the geometry changed" — cheaper than a dirty set
 * because no call site has to remember to invalidate.
 */
function memo<T>(
  store: Memo<T>,
  layerId: string,
  keys: readonly unknown[],
  compute: () => T,
): T {
  const hit = store.get(layerId);
  if (hit && hit.keys.length === keys.length && hit.keys.every((k, i) => k === keys[i])) {
    return hit.out;
  }
  const out = compute();
  store.set(layerId, { keys, out });
  return out;
}

/** Every wall on a layer: standalone segments plus one wall per floor-ring edge. */
export function resolveWalls(layer: DungeonLayer): ResolvedWall[] {
  return memo(wallMemo, layer.id, [layer.standaloneWalls, layer.mergedFloor], () => {
    const walls: ResolvedWall[] = layer.standaloneWalls.map((w) => ({
      ...w,
      kind: 'standalone',
    }));
    const rings = layer.mergedFloor ?? [];
    for (let ring = 0; ring < rings.length; ring++) {
      const poly = rings[ring];
      if (poly.length < 2) continue;
      for (let edge = 0; edge < poly.length; edge++) {
        walls.push({
          id: floorEdgeId(ring, edge),
          points: [poly[edge], poly[(edge + 1) % poly.length]],
          // Floor rings occlude like any solid wall — that is what makes light
          // through an open floor door fall out of the existing split logic.
          wallType: 'normal',
          direction: 'both',
          color: '#000000',
          width: 1,
          roughness: 0,
          kind: 'floor',
        });
      }
    }
    return walls;
  });
}

/** Every door on a layer, projected onto the wall it currently sits on. */
export function resolveDoors(
  layer: DungeonLayer,
  resolvedWalls: ResolvedWall[],
): ResolvedDoor[] {
  return memo(doorMemo, layer.id, [layer.children, resolvedWalls], () => {
    const byId = new Map(resolvedWalls.map((w) => [w.id, w]));
    return layer.children
      .filter((c): c is DoorChild => c.childType === 'door')
      .map((door) => resolveDoor(door, resolvedWalls, byId));
  });
}

/**
 * Resolved doors in the shape `buildOcclusionSegments` groups by: `wallId` is
 * the resolved wall's, `position` is the projected one. Detached doors are
 * dropped so a door with no wall never blocks light from nowhere.
 */
export function toOcclusionDoors(resolved: ResolvedDoor[]): DoorChild[] {
  return resolved
    .filter((r) => !r.detached)
    .map((r) => ({ ...r.door, wallId: r.wall!.id, position: r.position, angle: r.angle }));
}

function resolveDoor(
  door: DoorChild,
  walls: ResolvedWall[],
  byId: Map<string, ResolvedWall>,
): ResolvedDoor {
  // A hinted wall wins while it exists — that is what makes a door follow a node
  // edit for free. Floor doors and legacy `floor-*` ids never hit, so they
  // re-project onto whichever wall is nearest, hence self-heal across re-unions.
  const wall = byId.get(door.wallId) ?? nearestWall(door, walls);
  const snap = wall ? snapToNearestWall(door.position, [wall], Infinity) : null;
  if (!wall || !snap) {
    return {
      door,
      wall: null,
      t: 0,
      position: door.position,
      angle: door.angle,
      detached: true,
    };
  }
  // Keep the whole door on the wall; one wider than its wall sits centred.
  const length = polylineLength(wall.points);
  const half = length > 0 ? Math.min(0.5, door.width / 2 / length) : 0;
  const t = Math.min(1 - half, Math.max(half, snap.t));
  const at = pointAt(wall.points, t);
  return { door, wall, t, position: at.position, angle: at.angle, detached: false };
}

function nearestWall(door: DoorChild, walls: ResolvedWall[]): ResolvedWall | null {
  const snap = snapToNearestWall(
    door.position,
    walls,
    Math.max(door.width, MIN_ANCHOR_RANGE),
  );
  return snap ? walls.find((w) => w.id === snap.wallId) ?? null : null;
}

function polylineLength(points: [number, number][]): number {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    total += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  }
  return total;
}

/** Position and direction at parametric `t` (arc length) along a polyline. */
function pointAt(
  points: [number, number][],
  t: number,
): { position: [number, number]; angle: number } {
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const len = Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
    lengths.push(len);
    total += len;
  }
  let want = t * total;
  for (let i = 0; i < lengths.length; i++) {
    if (want <= lengths[i] || i === lengths.length - 1) {
      const [ax, ay] = points[i];
      const [bx, by] = points[i + 1];
      const f = lengths[i] > 0 ? Math.min(1, want / lengths[i]) : 0;
      return {
        position: [ax + (bx - ax) * f, ay + (by - ay) * f],
        angle: Math.atan2(by - ay, bx - ax),
      };
    }
    want -= lengths[i];
  }
  return { position: [...points[0]], angle: 0 };
}
