// Legacy readers for drawn rooms and connectors.
//
// Rooms are anchored places now (shared/types.ts `Room`) and nothing authors a
// RoomChild or a ConnectorChild any more: the room migration removes both from a
// map when it is opened. What is left here reads them on documents that have not
// been through it yet — the session server's stored maps until they are
// republished — so a connector there still plays as the door it was drawn as.

import type { ConnectorChild, DoorChild, DoorStyle, RoomChild } from './types';
import { flattenRing } from './bezier';
import { computeCentroid } from './roomUtils';

/** Any child as a document holds it: legacy kinds included, which `AnyChild` no longer names. */
export type LegacyChild = { childType: string; visible?: boolean };

/**
 * The outer ring as downstream geometry sees it: curves flattened, transform baked.
 *
 * Flatten first, bake second — the reverse of `childTransform.effectiveContours`, and the
 * same answer either way: the bake is affine, so it commutes with the subdivision. Doing it
 * in this order is what keeps this module free of `engine/`, which matters because the
 * session server reads it and pulling `engine/tools` in drags the whole editor (and the DOM
 * it types against) behind it.
 *
 * ponytail: the flattening tolerance is therefore measured before the scale. A connector
 * blown up ten times reads a shade coarser; bake first if that ever shows.
 */
export function authoredRing(child: RoomChild | ConnectorChild): [number, number][] {
  const ring = flattenRing(child.contours[0] ?? [], child.tangents?.[0]);
  const t = child.transform;
  if (!t) return ring;
  const [cos, sin] = [Math.cos(t.rotate), Math.sin(t.rotate)];
  return ring.map(([px, py]): [number, number] => {
    const [sx, sy] = [px * t.scale[0], py * t.scale[1]];
    return [cos * sx - sin * sy + t.translate[0], sin * sx + cos * sy + t.translate[1]];
  });
}

const SPAN_EPS = 1e-9;

function pointInRing(x: number, y: number, ring: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The stretches of the segment `a`→`b` that run inside `ring`, as parameter
 * intervals along it. This is the doorway: where a connector's blob swallows a
 * stretch of a room's boundary, that stretch is not wall, it is the opening.
 *
 * Cut the segment at every crossing, then keep the pieces whose midpoint is
 * inside — the textbook clip, and exact for the concave freehand loops the room
 * tool draws, which a convex-only method would get wrong.
 *
 * ponytail: O(edges) per query, no index. A map holds a handful of connectors and
 * the promotion is memoized per layer; index the ring if that stops being true.
 */
export function spansInside(
  a: readonly [number, number],
  b: readonly [number, number],
  ring: readonly [number, number][],
): [number, number][] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const cuts = [0, 1];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < SPAN_EPS) continue;
    const t = ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / den;
    const u = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / den;
    if (t > SPAN_EPS && t < 1 - SPAN_EPS && u >= 0 && u <= 1) cuts.push(t);
  }
  cuts.sort((m, n) => m - n);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [t0, t1] = [cuts[i], cuts[i + 1]];
    if (t1 - t0 < SPAN_EPS) continue;
    const m = (t0 + t1) / 2;
    if (!pointInRing(a[0] + dx * m, a[1] + dy * m, ring)) continue;
    const last = out[out.length - 1];
    if (last && t0 - last[1] < SPAN_EPS) last[1] = t1;
    else out.push([t0, t1]);
  }
  return out;
}

/**
 * Every doorway a connector cuts: one entry per stretch of a room boundary its
 * blob swallows, in the shape the occlusion split already reads a door in.
 */
export function connectorCrossings(
  child: ConnectorChild,
  boundaries: readonly (readonly [number, number][])[],
): { position: [number, number]; angle: number; width: number }[] {
  const blob = authoredRing(child);
  const out: { position: [number, number]; angle: number; width: number }[] = [];
  if (blob.length < 3) return out;
  for (const ring of boundaries) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < SPAN_EPS) continue;
      for (const [t0, t1] of spansInside(a, b, blob)) {
        const m = (t0 + t1) / 2;
        out.push({
          position: [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m],
          angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
          width: (t1 - t0) * len,
        });
      }
    }
  }
  return out;
}

/**
 * Where a connector's door mark is drawn, and how wide.
 *
 * A wall door anchors on its wall; a connector has none, so the boundary it
 * crosses answers for it: the widest stretch of room edge its blob swallows is
 * the doorway, and the mark sits in the middle of that, along it. Which also
 * settles the twin's re-anchoring — sitting *on* a boundary edge, the nearest
 * wall to it is its own doorway, not whatever real wall happened to stand near
 * the blob's middle.
 *
 * With no boundary crossed — a joint drawn in the void, or a caller with no rooms
 * to hand — the blob still answers for itself: its centroid, the direction it is
 * longest in, and how far it runs that way.
 */
export function connectorAnchor(
  child: ConnectorChild,
  boundaries: readonly (readonly [number, number][])[] = [],
): {
  position: [number, number];
  angle: number;
  width: number;
} {
  let best: { position: [number, number]; angle: number; width: number } | null = null;
  for (const cross of connectorCrossings(child, boundaries)) {
    if (!best || cross.width > best.width) best = cross;
  }
  if (best) return best;
  const ring = authoredRing(child);
  if (ring.length < 2) return { position: ring[0] ?? [0, 0], angle: 0, width: 1 };
  const [cx, cy] = computeCentroid(ring);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of ring) {
    const dx = x - cx;
    const dy = y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const [ux, uy] = [Math.cos(angle), Math.sin(angle)];
  let lo = Infinity;
  let hi = -Infinity;
  for (const [x, y] of ring) {
    const t = (x - cx) * ux + (y - cy) * uy;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  return { position: [cx, cy], angle, width: Math.max(hi - lo, 1e-6) };
}

/**
 * The connector as the door lane reads it — the whole of C1/C3 in one shape.
 *
 * Everything that plays a door already speaks `DoorChild`: the scene index, the live
 * state machine, the redactor's `doorKept`/`facing`, the table's glyph and its
 * double-click. Handing them a door twin rather than teaching each one about blobs is
 * why none of them changes. `kind:'arch'` is `'archway'`, which the existing machinery
 * already forces open, refuses commands on and draws no mark for.
 *
 * `wallId` is the floor-anchored door's own `''`: there is no wall to point at, and the
 * anchor above is the whole of what places it.
 */
export function connectorToDoor(
  child: ConnectorChild,
  boundaries: readonly (readonly [number, number][])[] = [],
): DoorChild {
  return {
    id: child.id,
    name: child.name,
    childType: 'door',
    visible: child.visible,
    wallId: '',
    ...connectorAnchor(child, boundaries),
    style: connectorStyle(child),
    state: child.state,
    isSecret: child.isSecret,
    roomA: child.roomA ?? null,
    roomB: child.roomB ?? null,
  };
}

/**
 * The `kind` a blob of this style is. Style is the authored truth after the
 * doors merge — an archway is the always-open arch, every other style shuts —
 * and `kind` is derived from it on every write, kept only for wire compat
 * (legacy children carry kind with no style; `connectorToDoor` maps them).
 */
export function connectorKindForStyle(style: DoorStyle): 'arch' | 'door' {
  return style === 'archway' ? 'arch' : 'door';
}

/**
 * The style a blob reads as. New blobs carry it outright; a map drawn before
 * styles were authoritative carries only `kind` — an arch is an archway,
 * anything else the default leaf — exactly as the door twin ships it.
 */
export function connectorStyle(child: ConnectorChild): DoorStyle {
  return child.kind === 'arch' ? 'archway' : child.style ?? 'single';
}

/** Every legacy RoomChild on a layer, in child order. */
export function authoredRoomChildren(children: readonly LegacyChild[]): RoomChild[] {
  return children.filter((c) => c.childType === 'room') as unknown as RoomChild[];
}

/** Every legacy ConnectorChild on a layer, in child order. */
export function connectorChildren(children: readonly LegacyChild[]): ConnectorChild[] {
  return children.filter((c) => c.childType === 'connector') as unknown as ConnectorChild[];
}

/** The legacy drawn rooms' outer rings, ready for geometry — the occluders and the doorways. */
export function authoredBoundaries(children: readonly LegacyChild[]): [number, number][][] {
  return authoredRoomChildren(children)
    .filter((room) => room.visible !== false)
    .map(authoredRing);
}
