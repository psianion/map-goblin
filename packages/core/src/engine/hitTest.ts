import type { AnyChild, LightChild, DungeonLayer, ZoneChild } from '../store/types';
import type { RingGeometry, Room, WallSegment } from '../shared/types';
import { flattenRing } from '../shared/bezier';
import { resolveDoors, resolveWalls } from '../shared/wallResolve';
import { standaloneWallLook } from '../shared/wallLook';
import { projectPointOntoLineSegment } from '../shared/wallSnap';
import { isBandSet } from '../assets/packCatalog';
import { useStore } from '../store/store';
import { isLayerShown } from '../store/selectors';
import { roomIndexOf } from '../shared/roomIndex';
import { roomBadgePoints } from '../shared/roomUtils';

/**
 * Narrow doors stay clickable: a width-1 door's half-width is only 0.5 world
 * units, and anything under this radius is a misclick trap at table zoom.
 * Shared with DoorTool so a door is pickable in exactly the same spots
 * whichever tool is active.
 */
export const DOOR_MIN_HIT_RADIUS = 0.4;

export function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  let inside = false;
  const [px, py] = point;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInShape(shape: RingGeometry, point: [number, number]): boolean {
  let p: [number, number] = point;
  if (shape.transform) {
    const t = shape.transform;
    let [x, y] = [point[0] - t.translate[0], point[1] - t.translate[1]];
    const cos = Math.cos(-t.rotate);
    const sin = Math.sin(-t.rotate);
    [x, y] = [x * cos - y * sin, x * sin + y * cos];
    x /= t.scale[0];
    y /= t.scale[1];
    p = [x, y];
  }
  // Curved edges hit-test against the same flattened ring everything else
  // sees; straight rings pass through flattenRing untouched.
  // Must be inside outer ring
  if (!pointInPolygon(p, flattenRing(shape.contours[0], shape.tangents?.[0]))) return false;
  // Must NOT be inside any hole ring
  for (let i = 1; i < shape.contours.length; i++) {
    if (pointInPolygon(p, flattenRing(shape.contours[i], shape.tangents?.[i]))) return false;
  }
  return true;
}

/**
 * Anything picked as an oriented box: assets and text labels both.
 * Structural rather than a union so a new box-shaped child needs no change here.
 */
interface BoxChild {
  position: { x: number; y: number };
  width: number;
  height: number;
  scale: number;
  rotation: number;
}

export function pointInAsset(asset: BoxChild, point: [number, number]): boolean {
  const halfW = (asset.width * asset.scale) / 2;
  const halfH = (asset.height * asset.scale) / 2;
  const cx = asset.position.x;
  const cy = asset.position.y;
  let [px, py] = [point[0] - cx, point[1] - cy];
  if (asset.rotation !== 0) {
    const cos = Math.cos(-asset.rotation);
    const sin = Math.sin(-asset.rotation);
    [px, py] = [px * cos - py * sin, px * sin + py * cos];
  }
  return Math.abs(px) <= halfW && Math.abs(py) <= halfH;
}

/**
 * Screen-space radius of the light icon drawn by `LightingRenderer` — shared
 * so the hit radius below can't drift from what's actually on screen.
 */
export const LIGHT_ICON_RADIUS_PX = 12;

export function pointInLight(
  light: LightChild,
  point: [number, number],
  zoom?: number,
): boolean {
  const dx = point[0] - light.position.x;
  const dy = point[1] - light.position.y;
  const hitRadius = zoom ? Math.max(0.5, LIGHT_ICON_RADIUS_PX / zoom) : 0.5;
  return dx * dx + dy * dy <= hitRadius * hitRadius;
}

/**
 * Orders children for hit-testing to match draw order: light icons always
 * draw on top of everything (`LightingRenderer`'s overlay pass), then
 * sublayers stack floor < walls < doors < objects(assets) < labels — so the
 * topmost picks must be lights, then labels, then assets, then doors, then
 * everything else (shapes, water) — the flat children array only reflects
 * relative order *within* one of those buckets, not across them.
 */
function bucketChildrenForHitTest(children: AnyChild[]): AnyChild[] {
  const reversed = [...children].reverse();
  const lights = reversed.filter((c) => c.childType === 'light');
  const labels = reversed.filter((c) => c.childType === 'text');
  const assets = reversed.filter((c) => c.childType === 'asset');
  const doors = reversed.filter((c) => c.childType === 'door');
  // Zones draw as the editor's overlay over the floors: under the props, over the walls.
  const zones = reversed.filter((c) => c.childType === 'zone');
  const rest = reversed.filter(
    (c) =>
      c.childType !== 'text' &&
      c.childType !== 'asset' &&
      c.childType !== 'door' &&
      c.childType !== 'light' &&
      c.childType !== 'zone',
  );
  return [...lights, ...labels, ...assets, ...doors, ...zones, ...rest];
}

/**
 * How a pick treats locks and overhead props. An object locked on its own passes the
 * pick through unless `includeLockedObjects` (the Select tool, hover and the right-click
 * menu all include them, flagged `locked` on the hit; `includeLocked` is the older name
 * for the same switch). A locked LAYER is click-through either way. `skipOverhead` leaves
 * overhead props out: the DM is looking under them, or the caller already tried them first.
 */
export interface PickOptions {
  zoom?: number;
  includeLocked?: boolean;
  includeLockedObjects?: boolean;
  skipOverhead?: boolean;
}

/** World radius a point zone answers within. */
export const ZONE_POINT_HIT_RADIUS = 0.35;

const takesLocked = (opts?: PickOptions): boolean => !!(opts?.includeLockedObjects || opts?.includeLocked);

/** Whether a point lies on a zone: in a circle or a rect, or near a point zone. */
export function pointInZone(zone: Pick<ZoneChild, 'shape'>, point: [number, number]): boolean {
  const s = zone.shape;
  if (s.kind === 'rect') {
    return point[0] >= s.x && point[0] <= s.x + s.width && point[1] >= s.y && point[1] <= s.y + s.height;
  }
  const r = s.kind === 'circle' ? s.radius : ZONE_POINT_HIT_RADIUS;
  return Math.hypot(point[0] - s.position.x, point[1] - s.position.y) <= r;
}

/** Every child under `point`, topmost first, in draw order. */
function* childHits(
  children: AnyChild[],
  point: [number, number],
  layer?: DungeonLayer,
  opts?: PickOptions,
): Generator<AnyChild> {
  // Doors hit-test at their *resolved* position (a floor-ring door draws where
  // the resolver projects it, not where it was authored), which needs the whole
  // layer. Resolved lazily, once, only when a door child is actually reached;
  // without a layer the authored position is the best available approximation.
  let doorPositions: Map<string, [number, number]> | null = null;
  for (const child of bucketChildrenForHitTest(children)) {
    // A light switched off still draws its icon — the struck-out bulb `LightingRenderer`
    // swaps in — so it stays pickable. Skipping it made switching one off a one-way trip:
    // the bulb sat there on screen with nothing behind it to click.
    if (!child.visible && child.childType !== 'light') continue;
    if (child.locked && !takesLocked(opts)) continue;
    switch (child.childType) {
      case 'shape':
        if (pointInShape(child, point)) yield child;
        break;
      case 'water':
        if (pointInShape(child, point)) yield child;
        break;
      case 'zone':
        if (pointInZone(child, point)) yield child;
        break;
      case 'asset':
        if (child.overhead && opts?.skipOverhead) break;
        if (pointInAsset(child, point)) yield child;
        break;
      case 'text':
        if (pointInAsset(child, point)) yield child;
        break;
      case 'light':
        if (pointInLight(child, point, opts?.zoom)) yield child;
        break;
      case 'door': {
        if (doorPositions === null) {
          doorPositions = new Map();
          if (layer) {
            for (const r of resolveDoors(layer, resolveWalls(layer))) {
              doorPositions.set(r.door.id, r.position);
            }
          }
        }
        const pos = doorPositions.get(child.id) ?? child.position;
        const dist = Math.hypot(pos[0] - point[0], pos[1] - point[1]);
        if (dist <= Math.max(child.width / 2, DOOR_MIN_HIT_RADIUS)) yield child;
        break;
      }
    }
  }
}

export function hitTestChildren(
  children: AnyChild[],
  point: [number, number],
  layer?: DungeonLayer,
  opts?: PickOptions,
): AnyChild | null {
  for (const child of childHits(children, point, layer, opts)) return child;
  return null;
}

export function hitTestAllLayers(
  layers: DungeonLayer[],
  point: [number, number],
  opts?: PickOptions,
): { child: AnyChild; layerId: string } | null {
  const state = useStore.getState();
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!isLayerShown(state, layer) || layer.locked) continue;
    const hit = hitTestChildren(layer.children, point, layer, opts);
    if (hit) return { child: hit, layerId: layer.id };
  }
  return null;
}

/* ── Drawn walls ─────────────────────────────────────────
 *
 * A drawn wall is not a child: it lives in `standaloneWalls`, so `hitTestChildren` never
 * sees it. The pick below slots walls in between the two halves of the child order: a
 * door, prop, label or light standing on a wall still wins, and the wall wins over the
 * floor it stands on (a floor is a map-sized ring, it would otherwise swallow every
 * click on the stones).
 */

/**
 * How far a drawn cave wall reaches from its line: the rock rides a little more than half
 * a cell either side of it. Narrower than the double-click pick (a whole cell), which only
 * has to land somewhere on the rock, where a plain click also has the floor to answer for.
 */
export const BAND_WALL_REACH = 0.75;

/** Thin walls stay clickable: a 0.1-cell line is a misclick trap at table zoom. */
export const WALL_MIN_HIT_RADIUS = 0.3;

/** Screen pixels a click may miss a wall's drawn edge by and still take it. */
const WALL_HIT_SLOP_PX = 4;

/**
 * Half the drawn thickness of a wall, in world units: its stones' band, or for a cave kit
 * the rock either side of the line. This is the outline the hover and selection trace.
 */
export function wallReach(wall: WallSegment, layer: Pick<DungeonLayer, 'style'>): number {
  const look = standaloneWallLook(wall, layer.style);
  if (isBandSet(look.setId)) return BAND_WALL_REACH;
  return Math.max(look.width / 2, WALL_MIN_HIT_RADIUS);
}

/** Distance from `point` to a wall's polyline. A loop repeats its first point, so it is walked closed. */
export function distanceToWall(wall: Pick<WallSegment, 'points'>, point: [number, number]): number {
  const pts = wall.points;
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.hypot(pts[0][0] - point[0], pts[0][1] - point[1]);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = projectPointOntoLineSegment(point, pts[i], pts[i + 1]).distance;
    if (d < best) best = d;
  }
  return best;
}

/**
 * The drawn wall under `point` on one layer, or null. A layer with its walls switched off
 * has none to give.
 */
export function hitTestWalls(
  layer: DungeonLayer,
  point: [number, number],
  opts?: PickOptions,
): WallSegment | null {
  return wallHits(layer, point, opts)[0] ?? null;
}

/**
 * Every drawn wall whose band reaches `point`, nearest line first (on a tie the later
 * wall, drawn on top). Hidden walls never answer; walls locked on their own only when
 * the pick takes locked objects.
 */
function wallHits(layer: DungeonLayer, point: [number, number], opts?: PickOptions): WallSegment[] {
  if (layer.sublayerVisibility?.walls === false) return [];
  const slop = opts?.zoom ? WALL_HIT_SLOP_PX / opts.zoom : 0;
  const hits: { wall: WallSegment; d: number; i: number }[] = [];
  const walls = layer.standaloneWalls ?? [];
  for (let i = walls.length - 1; i >= 0; i--) {
    const wall = walls[i];
    if (wall.points.length < 2 || wall.visible === false) continue;
    if (wall.locked && !takesLocked(opts)) continue;
    const d = distanceToWall(wall, point);
    if (d <= wallReach(wall, layer) + slop) hits.push({ wall, d, i });
  }
  hits.sort((a, b) => a.d - b.d || b.i - a.i);
  return hits.map((h) => h.wall);
}

/** World-space box around a drawn wall's line, grown by `reach` on every side. */
export function getWallBounds(
  wall: Pick<WallSegment, 'points'>,
  reach = 0,
): { x: number; y: number; width: number; height: number } {
  if (wall.points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let [minX, minY] = wall.points[0];
  let [maxX, maxY] = wall.points[0];
  for (const [x, y] of wall.points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX - reach, y: minY - reach, width: maxX - minX + reach * 2, height: maxY - minY + reach * 2 };
}

/** Whether segment a-b crosses or lies inside the box (Liang-Barsky clip). */
function segmentTouchesBox(
  a: [number, number],
  b: [number, number],
  box: { x: number; y: number; width: number; height: number },
): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a[0] - box.x],
    [dx, box.x + box.width - a[0]],
    [-dy, a[1] - box.y],
    [dy, box.y + box.height - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return true;
}

/**
 * Whether a drawn wall's band touches a box: some piece of its line comes within `reach`
 * of it. The box is grown by the reach, which is exact along its sides and generous by
 * at most `reach` at its corners.
 */
export function wallTouchesRect(
  wall: Pick<WallSegment, 'points'>,
  rect: { x: number; y: number; width: number; height: number },
  reach = 0,
): boolean {
  const box = { x: rect.x - reach, y: rect.y - reach, width: rect.width + reach * 2, height: rect.height + reach * 2 };
  const pts = wall.points;
  if (pts.length === 1) return segmentTouchesBox(pts[0], pts[0], box);
  for (let i = 0; i < pts.length - 1; i++) if (segmentTouchesBox(pts[i], pts[i + 1], box)) return true;
  return false;
}

/**
 * What a click lands on: a child, a drawn wall, or a room (its permanent id; rooms
 * select like anything else). `id` is the one the selection holds.
 */
export type PickHit = (
  | { kind: 'child'; id: string; layerId: string; child: AnyChild }
  | { kind: 'wall'; id: string; layerId: string; wall: WallSegment }
  | { kind: 'room'; id: string; layerId: string; room: Room }
) & {
  /** The object is locked on its own: selectable, never transformed. */
  locked?: boolean;
};

const childHit = (layerId: string, child: AnyChild): PickHit => ({
  kind: 'child',
  id: child.id,
  layerId,
  child,
  ...(child.locked ? { locked: true } : {}),
});

const wallHit = (layerId: string, wall: WallSegment): PickHit => ({
  kind: 'wall',
  id: wall.id,
  layerId,
  wall,
  ...(wall.locked ? { locked: true } : {}),
});

/* ── Rooms ───────────────────────────────────────────────
 *
 * A room is a place, not a thing on the map: it has no art, only the editor's overlay
 * (canvas/src/v2/canvas/roomOverlay.ts). Clicks pick it only where that overlay is
 * mounted, so the v1 editor and the table, which draw no rooms, never select one.
 */

/** Screen radius of a room's number badge, px. The badge picks its room even off any face. */
export const ROOM_BADGE_RADIUS_PX = 11;

let roomPicking: () => boolean = () => false;

/**
 * Whether clicks pick rooms. The host that mounts the room overlay turns it on, with a
 * predicate so it can follow the overlay's own switch.
 */
export function setRoomPicking(on: boolean | (() => boolean)): void {
  roomPicking = typeof on === 'function' ? on : () => on;
}

export function roomPickingEnabled(): boolean {
  return roomPicking();
}

/** The room whose badge sits under `point` at `zoom` (screen px per world unit), or null. */
export function roomBadgeAt(layer: DungeonLayer, point: [number, number], zoom: number): Room | null {
  const rooms = layer.rooms;
  if (!rooms?.length || !(zoom > 0)) return null;
  const r = ROOM_BADGE_RADIUS_PX / zoom;
  // Where the overlay draws each badge (inside the face, not at the anchor).
  const at = roomBadgePoints(rooms);
  let best: Room | null = null;
  let bestD = r;
  for (const room of rooms) {
    const [bx, by] = at.get(room.id) ?? room.anchor;
    const d = Math.hypot(bx - point[0], by - point[1]);
    if (d <= bestD) {
      best = room;
      bestD = d;
    }
  }
  return best;
}

/** The room under `point`: a badge first (an orphan has no face to click), else the face. */
export function hitTestRoom(layer: DungeonLayer, point: [number, number], opts?: { zoom?: number }): Room | null {
  if (!layer.rooms?.length) return null;
  if (opts?.zoom) {
    const badge = roomBadgeAt(layer, point, opts.zoom);
    if (badge) return badge;
  }
  return roomIndexOf(layer.rooms).roomAt(point[0], point[1]);
}

/** Children drawn above the walls: lights, labels, props and doors. */
const ABOVE_WALLS = new Set<AnyChild['childType']>(['light', 'text', 'asset', 'door']);

/** Screen px either side of a zone's outline that still takes it ahead of the walls and rooms. */
const ZONE_EDGE_SLOP_PX = 6;

/**
 * Whether a point lies on a zone's drawn outline (or its centre mark): how a zone is taken
 * where a room or a wall would otherwise answer. Inside, away from the outline, the zone
 * answers only below the rooms (`pointInZone`).
 */
export function pointOnZoneEdge(zone: Pick<ZoneChild, 'shape'>, point: [number, number], zoom?: number): boolean {
  const s = zone.shape;
  const slop = Math.max(0.2, zoom ? ZONE_EDGE_SLOP_PX / zoom : 0.3);
  if (s.kind === 'point') return pointInZone(zone, point);
  if (s.kind === 'circle') {
    const d = Math.hypot(point[0] - s.position.x, point[1] - s.position.y);
    return Math.abs(d - s.radius) <= slop || d <= ZONE_POINT_HIT_RADIUS;
  }
  const [x, y] = point;
  const inOuter = x >= s.x - slop && x <= s.x + s.width + slop && y >= s.y - slop && y <= s.y + s.height + slop;
  const inInner = x > s.x + slop && x < s.x + s.width - slop && y > s.y + slop && y < s.y + s.height - slop;
  return inOuter && !inInner;
}

/**
 * Everything under `point` on one layer, topmost first: what stands on the walls (lights,
 * labels, props, doors), a zone by its outline, the drawn walls, water, the room the point
 * is in (where rooms pick, see `setRoomPicking`; `opts.rooms` overrides), a zone by its
 * area, then the floors.
 */
function* layerHits(layer: DungeonLayer, point: [number, number], opts?: PickOptions & { rooms?: boolean }): Generator<PickHit> {
  const above = layer.children.filter((c) => ABOVE_WALLS.has(c.childType));
  for (const c of childHits(above, point, layer, opts)) yield childHit(layer.id, c);
  const zones = layer.children.filter((c): c is ZoneChild => c.childType === 'zone');
  const zoneHits = [...childHits(zones, point, layer, opts)] as ZoneChild[];
  for (const z of zoneHits) if (pointOnZoneEdge(z, point, opts?.zoom)) yield childHit(layer.id, z);
  const walls = wallHits(layer, point, opts);
  for (const w of walls) yield wallHit(layer.id, w);
  const water = layer.children.filter((c) => c.childType === 'water');
  for (const c of childHits(water, point, layer, opts)) yield childHit(layer.id, c);
  // Where a drawn wall answers, the rooms and floor it stands on are looked for beside it too.
  const beside = walls.flatMap((w) => besideWall(w, layer, point));
  if (opts?.rooms ?? roomPicking()) {
    const room = hitTestRoom(layer, point, opts);
    if (room) yield { kind: 'room', id: room.id, layerId: layer.id, room };
    for (const p of beside) {
      const r = roomIndexOf(layer.rooms ?? []).roomAt(p[0], p[1]);
      if (r) yield { kind: 'room', id: r.id, layerId: layer.id, room: r };
    }
  }
  for (const z of zoneHits) yield childHit(layer.id, z);
  const below = layer.children.filter((c) => !ABOVE_WALLS.has(c.childType) && c.childType !== 'zone' && c.childType !== 'water');
  for (const c of childHits(below, point, layer, opts)) yield childHit(layer.id, c);
  for (const p of beside) for (const c of childHits(below, p, layer, opts)) yield childHit(layer.id, c);
}

/**
 * Where a drawn wall's rooms and floor are looked for: just past its band either side of
 * the middle of its run nearest `point`, then that middle. A point on the wall itself is in
 * neither room it divides (their faces meet on its line), and away from its doorway it is
 * often over no floor at all (a passage wall's ends sit in the rock).
 */
function besideWall(wall: WallSegment, layer: DungeonLayer, point: [number, number]): [number, number][] {
  const pts = wall.points;
  if (pts.length < 2) return [];
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = projectPointOntoLineSegment(point, pts[i], pts[i + 1]).distance;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const [a, b] = [pts[best], pts[best + 1]];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len === 0) return [];
  const off = wallReach(wall, layer) + 0.1;
  const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const [nx, ny] = [(-(b[1] - a[1]) / len) * off, ((b[0] - a[0]) / len) * off];
  return [[mx + nx, my + ny], [mx - nx, my - ny], [mx, my]];
}

/**
 * The pick on one layer, in draw order (see `layerHits`): whatever stands on the walls,
 * a zone by its outline, a drawn wall, water, the room the point is in, a zone by its
 * area, then the floors.
 * Callers decide which layers may answer (hidden, locked).
 */
export function pickInLayer(
  layer: DungeonLayer,
  point: [number, number],
  opts?: PickOptions & { rooms?: boolean },
): PickHit | null {
  for (const hit of layerHits(layer, point, opts)) return hit;
  return null;
}

/**
 * Everything under `point` across the layers, topmost first: overhead props from every
 * layer (unless the DM is looking under them, `ui.seeUnderOverhead`, when they do not
 * answer at all), then each shown, unlocked layer from the top, in `pickInLayer` order.
 */
function* stackHits(layers: DungeonLayer[], point: [number, number], opts?: PickOptions & { rooms?: boolean }): Generator<PickHit> {
  const state = useStore.getState();
  const open = layers.filter((l) => isLayerShown(state, l) && !l.locked);
  if (!state.ui.seeUnderOverhead && !opts?.skipOverhead) {
    for (let i = open.length - 1; i >= 0; i--) {
      const layer = open[i];
      const overhead = layer.children.filter((c) => c.childType === 'asset' && c.overhead);
      if (overhead.length === 0) continue;
      for (const c of childHits(overhead, point, layer, opts)) yield childHit(layer.id, c);
    }
  }
  for (let i = open.length - 1; i >= 0; i--) yield* layerHits(open[i], point, { ...opts, skipOverhead: true });
}

/** Every object under `point`, topmost first, each once: what overlap cycling and "Select behind" walk. */
export function pickStackAt(
  layers: DungeonLayer[],
  point: [number, number],
  opts?: PickOptions & { rooms?: boolean },
): PickHit[] {
  const out: PickHit[] = [];
  const seen = new Set<string>();
  for (const hit of stackHits(layers, point, opts)) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    out.push(hit);
  }
  return out;
}

/**
 * `hitTestAllLayers` with drawn walls and rooms: the top of `pickStackAt`, worked out
 * lazily so a click stops at the first answer.
 */
export function pickAllLayers(
  layers: DungeonLayer[],
  point: [number, number],
  opts?: PickOptions & { rooms?: boolean },
): PickHit | null {
  for (const hit of stackHits(layers, point, opts)) return hit;
  return null;
}

/**
 * The one pick every pointer entry point makes (left press, hover, double-click and
 * right-click) at the raw world point under the pointer: every dungeon layer that is
 * shown and unlocked, objects locked on their own included and flagged.
 */
export function pickAt(point: [number, number], opts: { zoom: number }): PickHit | null {
  const layers = useStore.getState().layers.filter((l): l is DungeonLayer => l.type === 'dungeon');
  return pickAllLayers(layers, point, { zoom: opts.zoom, includeLockedObjects: true });
}

/** `pickStackAt` over the store's dungeon layers, with the same options as `pickAt`. */
export function pickStackAtPoint(point: [number, number], opts: { zoom: number }): PickHit[] {
  const layers = useStore.getState().layers.filter((l): l is DungeonLayer => l.type === 'dungeon');
  return pickStackAt(layers, point, { zoom: opts.zoom, includeLockedObjects: true });
}

/**
 * Returns the axis-aligned bounding box of a child in world space.
 */
export function getChildBounds(child: AnyChild): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  switch (child.childType) {
    case 'shape': {
      // Flattened: a curve can bow past its anchors, and the gizmo/selection
      // box must wrap what is actually drawn.
      let points = flattenRing(child.contours[0], child.tangents?.[0]);
      if (child.transform) {
        const t = child.transform;
        const cos = Math.cos(t.rotate);
        const sin = Math.sin(t.rotate);
        points = points.map(([px, py]): [number, number] => {
          const sx = px * t.scale[0];
          const sy = py * t.scale[1];
          return [
            cos * sx - sin * sy + t.translate[0],
            sin * sx + cos * sy + t.translate[1],
          ];
        });
      }
      if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
      let minX = points[0][0];
      let maxX = points[0][0];
      let minY = points[0][1];
      let maxY = points[0][1];
      for (const [px, py] of points) {
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    // Text labels are boxes with the same fields, so they share this case.
    case 'asset':
    case 'text': {
      const halfW = (child.width * child.scale) / 2;
      const halfH = (child.height * child.scale) / 2;
      if (child.rotation !== 0) {
        // Compute rotated AABB
        const cos = Math.abs(Math.cos(child.rotation));
        const sin = Math.abs(Math.sin(child.rotation));
        const rw = halfW * cos + halfH * sin;
        const rh = halfW * sin + halfH * cos;
        return {
          x: child.position.x - rw,
          y: child.position.y - rh,
          width: rw * 2,
          height: rh * 2,
        };
      }
      return {
        x: child.position.x - halfW,
        y: child.position.y - halfH,
        width: halfW * 2,
        height: halfH * 2,
      };
    }
    case 'light': {
      return {
        x: child.position.x - child.radius,
        y: child.position.y - child.radius,
        width: child.radius * 2,
        height: child.radius * 2,
      };
    }
    case 'door': {
      const halfW = child.width / 2;
      return {
        x: child.position[0] - halfW,
        y: child.position[1] - halfW,
        width: child.width,
        height: child.width,
      };
    }
    case 'water': {
      const points = flattenRing(child.contours[0] ?? [], child.tangents?.[0]);
      if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
      let minX = points[0][0];
      let maxX = points[0][0];
      let minY = points[0][1];
      let maxY = points[0][1];
      for (const [px, py] of points) {
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    case 'zone': {
      const shape = child.shape;
      switch (shape.kind) {
        case 'point':
          // A point has no extent; give it half a cell so marquee/frame logic
          // treats it like the marker the editor overlay draws.
          return { x: shape.position.x - 0.25, y: shape.position.y - 0.25, width: 0.5, height: 0.5 };
        case 'circle':
          return {
            x: shape.position.x - shape.radius,
            y: shape.position.y - shape.radius,
            width: shape.radius * 2,
            height: shape.radius * 2,
          };
        case 'rect':
          return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
      }
    }
  }
}

/**
 * What a child takes up on the map as an object: a light is its marker, one square centred
 * on its position (its radius is light, not the object); every other kind its bounds. A
 * marquee collects by this, a mixed selection's box wraps it, align lines it up.
 */
export function getChildFootprint(child: AnyChild): { x: number; y: number; width: number; height: number } {
  if (child.childType === 'light') return { x: child.position.x - 0.5, y: child.position.y - 0.5, width: 1, height: 1 };
  return getChildBounds(child);
}

/**
 * Does a selection's box wrap its lights by their marker? Yes once it holds two or more
 * members and anything but lights (`others` counts its walls and rooms); a light-only
 * selection keeps its radius box, which the radius handles work on.
 */
export function boxesByFootprint(children: readonly AnyChild[], others = 0): boolean {
  return children.length + others >= 2 && (others > 0 || children.some((c) => c.childType !== 'light'));
}

/**
 * Returns the union AABB of multiple children's bounds (lights by their marker when
 * `footprint`, see getChildFootprint).
 */
export function unionChildBounds(
  children: AnyChild[],
  footprint = false,
): { x: number; y: number; width: number; height: number } | null {
  if (children.length === 0) return null;
  const boundsOf = footprint ? getChildFootprint : getChildBounds;
  const first = boundsOf(children[0]);
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x + first.width;
  let maxY = first.y + first.height;
  for (let i = 1; i < children.length; i++) {
    const b = boundsOf(children[i]);
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Returns true if two AABBs intersect.
 */
export function boundsIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
