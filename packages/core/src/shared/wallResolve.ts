import type { DungeonLayer } from '../store/types';
import type { DoorChild, WallSegment } from './types';
import { snapToNearestWall } from './wallSnap';
import {
  authoredBoundaries,
  authoredRing,
  connectorChildren,
  connectorToDoor,
  spansInside,
} from './authoredRooms';

/**
 * A wall the rest of the engine can consume: a standalone `WallSegment` or one
 * edge of a `mergedFloor` ring, promoted to a real wall. Resolved in one place so
 * occlusion, lighting, the door tool and the renderers all agree on what a wall
 * is instead of each extracting edges its own way. Rooms are places, not walls:
 * nothing about a room occludes.
 */
export interface ResolvedWall extends WallSegment {
  kind: 'standalone' | 'floor';
  /** Index into `mergedFloor`. Floor kind only — the ring's stone edits key on it. */
  ring?: number;
  /** Index of this edge within its ring. Floor kind only. */
  edge?: number;
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

/**
 * Every wall on a layer: standalone segments and one wall per floor-ring edge.
 * Promoting the ring edges here rather than at either sweep is what makes the
 * referee's sweep and the table's mask occlude on the same union: both read
 * `extractWallSegments`, which reads this.
 */
export function resolveWalls(layer: DungeonLayer): ResolvedWall[] {
  return memo(wallMemo, layer.id, [layer.standaloneWalls, layer.mergedFloor, layer.children], () => {
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
          ring,
          edge,
        });
      }
    }
    return walls;
  });
}

/**
 * The doorways connectors cut in the room boundaries they cross, in the shape
 * `buildOcclusionSegments` splits a wall with.
 *
 * The blob∩wall span replaces a wall door's `position`/`width` — same machinery, a
 * truer span, and it needs no re-anchoring at all: a connector cuts every edge it
 * actually swallows, in *both* the rooms it joins, rather than the one wall a
 * projection found nearest. Two boundaries that only touch are pierced by nothing
 * and stay mutually opaque (O4), because a span the blob does not cover simply is
 * not returned.
 *
 * Every wall, not only a drawn room's: a blob is the opening, so a real wall or a
 * floor ring lying across the doorway is part of that doorway exactly as it is for
 * a wall door's aperture (O3). Anything the blob does not swallow is untouched.
 *
 * State gating is the door's own, untouched: `getDoorOcclusion` reads the twin,
 * so an arch is always open and a door-kind joint opens and shuts with the state
 * the table wrote onto the child.
 */
export function connectorApertures(
  layer: DungeonLayer,
  walls: readonly ResolvedWall[],
): DoorChild[] {
  const children = layer.children ?? [];
  const joints = connectorChildren(children).filter((c) => c.visible !== false);
  if (joints.length === 0) return [];
  const boundaries = authoredBoundaries(children);
  const doors: DoorChild[] = [];
  for (const connector of joints) {
    const blob = authoredRing(connector);
    if (blob.length < 3) continue;
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of blob) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const twin = connectorToDoor(connector, boundaries);
    for (const wall of walls) {
      const a = wall.points[0];
      const b = wall.points[wall.points.length - 1];
      // ponytail: box reject first. A cave layer carries thousands of ring edges and a
      // blob touches a handful; without this the clip runs against every one of them.
      if (Math.max(a[0], b[0]) < minX || Math.min(a[0], b[0]) > maxX) continue;
      if (Math.max(a[1], b[1]) < minY || Math.min(a[1], b[1]) > maxY) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < APERTURE_MIN_SPAN) continue;
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      for (const [t0, t1] of spansInside(a, b, blob)) {
        const width = (t1 - t0) * len;
        if (width < APERTURE_MIN_SPAN) continue;
        const m = (t0 + t1) / 2;
        doors.push({
          ...twin,
          wallId: wall.id,
          position: [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m],
          angle,
          width,
        });
      }
    }
  }
  return doors;
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
 * How far *sideways* off the door another wall may stand and still be searched
 * as part of the same doorway: half the door's width, plus half a cell of slack.
 * This is the perpendicular reach only — how much of a wall it finds gets cut is
 * decided by `apertureOnWall`, which clips to the door's own span.
 *
 * ponytail: the slack is the calibration knob. It exists because a hand-drawn map
 * leaves a gap between where a floor shape stops and the wall its door sits in —
 * `vision-two-rooms` leaves exactly one cell — and the `mergedFloor` ring edge in
 * that gap is a solid occluder like any other. Widening it costs nothing along
 * the wall now; it only reaches further across the gap.
 */
const APERTURE_SLACK = 0.5;

/** Past this much sine between them, two walls are not the same doorway. ~14°. */
const APERTURE_PARALLEL = 0.25;

/** Shorter than this, an overlap is float noise at an abutment, not a doorway. */
const APERTURE_MIN_SPAN = 1e-6;

/**
 * The stretch of `wall` the door's own span covers, expressed as the door
 * `buildOcclusionSegments` would cut it out with — centre and width of the
 * overlap between the door's span projected onto the wall's chord and the chord
 * itself. `null` when the two only abut.
 *
 * This is what stops the aperture from being a whole-wall toggle. The occlusion
 * split projects the door centre onto the wall *clamped to its ends*, so a jamb
 * that merely starts where the door stops would take a full door's width of hole
 * anchored at that end — the entire flanking segment swinging transparent with
 * the door. Clipped to the span, a jamb overlaps by nothing and stays solid,
 * while a ring edge running past the doorway gets a hole exactly the doorway
 * wide and stays solid either side of it.
 */
function apertureOnWall(
  r: ResolvedDoor,
  wall: ResolvedWall,
): { position: [number, number]; width: number } | null {
  const a = wall.points[0];
  const b = wall.points[wall.points.length - 1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < APERTURE_MIN_SPAN) return null;
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  const half = r.door.width / 2;
  const dx = Math.cos(r.angle) * half;
  const dy = Math.sin(r.angle) * half;
  const along = (x: number, y: number) => (x - a[0]) * ux + (y - a[1]) * uy;
  const s1 = along(r.position[0] - dx, r.position[1] - dy);
  const s2 = along(r.position[0] + dx, r.position[1] + dy);
  const lo = Math.max(0, Math.min(s1, s2));
  const hi = Math.min(len, Math.max(s1, s2));
  if (hi - lo < APERTURE_MIN_SPAN) return null;
  const mid = (lo + hi) / 2;
  return { position: [a[0] + ux * mid, a[1] + uy * mid], width: hi - lo };
}

/**
 * Resolved doors in the shape `buildOcclusionSegments` groups by: `wallId` is
 * the resolved wall's, `position` is the projected one. Detached doors are
 * dropped so a door with no wall never blocks light from nowhere.
 *
 * `walls` opts a caller into the *aperture* rule, and only the occlusion path
 * wants it: a doorway is a gap in the geometry, not a gap in one wall. A door
 * resolves onto exactly one wall, so on a map whose floor stops short of the wall
 * its door is in, the ring edges either side of that wall stayed solid and the
 * door opened onto nothing — the referee's sweep and the table's mask both
 * stopped at the floor's edge no matter what the DM did with the door. Every wall
 * running the same way as the door and inside its aperture is pierced by it, so
 * they open and shut together — but only across the door's own span, never along
 * their whole length. A wall crossing the jamb at an angle is a different wall
 * and is left alone.
 */
export function toOcclusionDoors(
  resolved: ResolvedDoor[],
  walls: ResolvedWall[] = [],
): DoorChild[] {
  const doors: DoorChild[] = [];
  for (const r of resolved) {
    if (r.detached) continue;
    doors.push({ ...r.door, wallId: r.wall!.id, position: r.position, angle: r.angle });
    const reach = r.door.width / 2 + APERTURE_SLACK;
    for (const wall of walls) {
      if (wall.id === r.wall!.id) continue;
      const snap = snapToNearestWall(r.position, [wall], reach);
      if (!snap || Math.abs(Math.sin(snap.angle - r.angle)) > APERTURE_PARALLEL) continue;
      const cut = apertureOnWall(r, wall);
      if (!cut) continue;
      doors.push({ ...r.door, wallId: wall.id, ...cut, angle: snap.angle });
    }
  }
  return doors;
}

/** How far off a door's line another wall may lie and still be part of the same run. */
const RUN_LINE_SLACK = 0.05;
/** Past this much sine between them, two walls do not run the same way. ~1°. */
const RUN_PARALLEL = 0.02;

/** A 2-point wall lying on the door's own line, as its span along that line. */
function onDoorLine(
  wall: ResolvedWall,
  origin: [number, number],
  angle: number,
): [number, number] | null {
  if (wall.points.length !== 2) return null;
  const [a, b] = wall.points;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < APERTURE_MIN_SPAN) return null;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  if (Math.abs((ux * (b[1] - a[1]) - uy * (b[0] - a[0])) / len) > RUN_PARALLEL) return null;
  const off = (p: [number, number]) => ux * (p[1] - origin[1]) - uy * (p[0] - origin[0]);
  if (Math.abs(off(a)) > RUN_LINE_SLACK || Math.abs(off(b)) > RUN_LINE_SLACK) return null;
  const along = (p: [number, number]) => (p[0] - origin[0]) * ux + (p[1] - origin[1]) * uy;
  const s = along(a);
  const e = along(b);
  return [Math.min(s, e), Math.max(s, e)];
}

/**
 * The widest a door may be where it sits, cells.
 *
 * A door no wider than its own wall slides along it to fit, so the wall's length
 * is always room enough. Past that the door sits centred on its wall (see
 * `resolveDoor`), and it may keep growing over every wall that carries on along
 * the same line without a break: a doorway drawn as its own short piece between
 * two longer ones (fieldstone-keep, emberhold-crypt) opens into them, and they
 * are cut to match (`doorOpeningCuts`). The run is measured both ways from the
 * wall's middle and the nearer end wins, so the door never hangs past either.
 * A bent wall keeps its own length. Infinity for a detached door.
 */
export function doorOpeningLimit(resolved: ResolvedDoor, walls: ResolvedWall[]): number {
  const host = resolved.wall;
  if (!host) return Infinity;
  const own = polylineLength(host.points);
  if (host.points.length !== 2) return own;
  const [a, b] = host.points;
  const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const spans = walls
    .map((w) => onDoorLine(w, mid, angle))
    .filter((s): s is [number, number] => s !== null);
  let lo = -own / 2;
  let hi = own / 2;
  for (let grew = true; grew; ) {
    grew = false;
    for (const [s, e] of spans) {
      if (s <= hi + RUN_LINE_SLACK && e > hi + APERTURE_MIN_SPAN) {
        hi = e;
        grew = true;
      }
      if (e >= lo - RUN_LINE_SLACK && s < lo - APERTURE_MIN_SPAN) {
        lo = s;
        grew = true;
      }
    }
  }
  return Math.max(own, 2 * Math.min(-lo, hi));
}

/**
 * The widest the door `doorId` on `layer` may be (see `doorOpeningLimit`);
 * Infinity when it is not a wall door or has no wall.
 */
export function doorOpeningLimitOn(layer: DungeonLayer, doorId: string): number {
  const walls = resolveWalls(layer);
  const r = resolveDoors(layer, walls).find((d) => d.door.id === doorId);
  return r ? doorOpeningLimit(r, walls) : Infinity;
}

/**
 * Every stretch of wall a door's opening takes out of the drawn walls: its own
 * wall across the door's whole width, and each wall lying on the same line that
 * the opening reaches into, clipped to the part it covers. A door wider than its
 * own short wall therefore cuts its neighbours too, and a floor edge running
 * under a drawn wall opens with it. Same shape `buildOcclusionSegments` takes,
 * with `ring` set on floor-ring edges. Empty for a detached door.
 */
export function doorOpeningCuts(
  resolved: ResolvedDoor,
  walls: ResolvedWall[],
): { wallId: string; position: [number, number]; width: number; ring?: number }[] {
  const host = resolved.wall;
  if (!host) return [];
  const cuts: { wallId: string; position: [number, number]; width: number; ring?: number }[] = [
    { wallId: host.id, position: resolved.position, width: resolved.door.width, ring: host.ring },
  ];
  for (const wall of walls) {
    if (wall.id === host.id || !onDoorLine(wall, resolved.position, resolved.angle)) continue;
    const cut = apertureOnWall(resolved, wall);
    if (cut) cuts.push({ wallId: wall.id, ...cut, ring: wall.ring });
  }
  return cuts;
}

/**
 * Where `door` lands when dragged to `point` on `wall` — the same projection and
 * end clamp a resolve applies, so what a drag commits is what the next render
 * draws. The door tool's drag is the only caller; everything else resolves.
 */
export function projectDoorOnto(
  door: DoorChild,
  wall: ResolvedWall,
  point: [number, number],
): ResolvedDoor {
  return resolveDoor(
    { ...door, position: point, wallId: wall.id },
    [wall],
    new Map([[wall.id, wall]]),
  );
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

/**
 * Total arc length of a wall's polyline. Exported because "how long is this
 * wall" is the door tool's auto-fit and too-wide question too, and measuring it
 * end-to-end there would cut the corners off a chained wall.
 */
export function polylineLength(points: [number, number][]): number {
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
