// Plateaus: floor shapes with a height, stacked inside one another, and the bands of
// equal height they merge into. Pure: the floor union, the renderer, the lights and the
// card all read the same answers from here.
//
// The rules (plan §3.2):
// - A shape's parent is the innermost floor shape on the same layer that has a height and
//   whose outline holds the shape's centroid (ties: the smallest area). Heights add up
//   along that chain: the absolute height.
// - Shapes merge only with shapes of the same absolute height: one band per height. Shapes
//   with no height and no raised parent are the ground, which is the layer's merged floor
//   exactly as it always was.
// - The drop at a point of a band's edge is the band's height minus the height of the
//   surface just outside: positive faces outward (a plateau), negative inward (a pit).
// - A band ring whose owning shape has edge 'wall' (the default) is a raised room: its
//   walls, rooms and doors work as on the ground. Every other ring is a cliff, a slope or a
//   bare edge, and never makes a room.

import type { DungeonLayer, ShapeChild } from '../store/types';
import type { OpeningChild } from './types';
import type { Polygon } from '../types/geometry';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import { flattenRing } from './bezier';
import { ringOwner } from './wallLook';
import { DEFAULT_SIGHT_DROP_CELLS } from './crossingKinds';

export type EdgeKind = 'wall' | 'cliff' | 'slope' | 'none';

/** Brightness added to a band's floor per cell of height, and the most it adds. */
export const TIER_STEP = 0.03;
export const TIER_CAP = 0.12;

/** How far outside an edge the surface below it is probed, in cells. */
const PROBE = 0.05;

type Transform = NonNullable<ShapeChild['transform']>;

/** A shape's transform applied to ring points: scale, then rotate, then translate. */
export function applyShapeTransform(pts: Polygon, t: Transform): Polygon {
  return pts.map(([x, y]) => {
    let px = x * t.scale[0];
    let py = y * t.scale[1];
    const cos = Math.cos(t.rotate);
    const sin = Math.sin(t.rotate);
    const rx = px * cos - py * sin;
    const ry = px * sin + py * cos;
    px = rx + t.translate[0];
    py = ry + t.translate[1];
    return [px, py] as [number, number];
  });
}

/** Ring `i` of a shape as the floor union sees it: curves flattened, transform applied. */
export function shapeRing(shape: ShapeChild, i = 0): Polygon {
  let pts = flattenRing(shape.contours[i], shape.tangents?.[i]);
  if (shape.transform) pts = applyShapeTransform(pts, shape.transform);
  return pts;
}

/** The edge a shape's ring meets lower ground with. */
export const edgeOf = (shape: Pick<ShapeChild, 'edge'>): EdgeKind => shape.edge ?? 'wall';

/** A shape's own height in whole cells; 0 when it has none. */
export const ownHeight = (shape: Pick<ShapeChild, 'height'>): number =>
  Number.isFinite(shape.height) ? Math.round(shape.height as number) : 0;

/** True when any visible floor on the layer has a height: the only case anything here changes. */
export function hasPlateaus(layer: Pick<DungeonLayer, 'children'>): boolean {
  return layer.children.some((c) => c.childType === 'shape' && c.visible && ownHeight(c as ShapeChild) !== 0);
}

function signedArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function centroidOf(poly: Polygon): [number, number] {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of poly) {
      sx += x;
      sy += y;
    }
    return [sx / poly.length, sy / poly.length];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const c = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * c;
    cy += (y1 + y2) * c;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

export function pointInPoly(x: number, y: number, poly: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside a set of rings by even-odd: holes count as outside. */
function inRings(x: number, y: number, rings: readonly Polygon[]): boolean {
  let n = 0;
  for (const r of rings) if (r.length >= 3 && pointInPoly(x, y, r)) n++;
  return n % 2 === 1;
}

// ─── Nesting ───────────────────────────────────────────────

export interface PlateauInfo {
  shape: ShapeChild;
  /** The raised shape this one stands on, or null on the ground. */
  parent: ShapeChild | null;
  /** The raised shapes from the outermost down to this one (itself included when it has a height). */
  chain: ShapeChild[];
  /** Absolute height in cells: the sum of `height` along the chain. */
  height: number;
  /** The shape's outline, flattened and transformed. */
  outline: Polygon;
  area: number;
}

/**
 * Each visible floor's place in the stack: parent, chain and absolute height. A shape only
 * ever stands on a larger one (or an equal one drawn before it), so a chain always ends.
 */
export function plateauChains(shapes: readonly ShapeChild[]): Map<string, PlateauInfo> {
  const live = shapes.filter((s) => s.visible !== false && (s.contours[0]?.length ?? 0) >= 3);
  const geo = live.map((s) => {
    const outline = shapeRing(s, 0);
    return { s, outline, area: Math.abs(signedArea(outline)), c: centroidOf(outline) };
  });
  const raised = geo.map((g, i) => ({ ...g, i })).filter((g) => ownHeight(g.s) !== 0);

  const parentOf = new Map<string, ShapeChild | null>();
  geo.forEach((g, i) => {
    let best: (typeof raised)[number] | null = null;
    for (const h of raised) {
      if (h.s === g.s) continue;
      const larger = h.area > g.area + 1e-9 || (Math.abs(h.area - g.area) <= 1e-9 && h.i < i);
      if (!larger || !pointInPoly(g.c[0], g.c[1], h.outline)) continue;
      if (!best || h.area < best.area - 1e-9) best = h;
    }
    parentOf.set(g.s.id, best ? best.s : null);
  });

  const out = new Map<string, PlateauInfo>();
  const visit = (k: number): PlateauInfo => {
    const g = geo[k];
    const hit = out.get(g.s.id);
    if (hit) return hit;
    const parent = parentOf.get(g.s.id) ?? null;
    const up = parent ? visit(geo.findIndex((x) => x.s === parent)) : null;
    const chain = [...(up?.chain ?? []), ...(ownHeight(g.s) !== 0 ? [g.s] : [])];
    const info: PlateauInfo = {
      shape: g.s,
      parent,
      chain,
      height: chain.reduce((sum, s) => sum + ownHeight(s), 0),
      outline: g.outline,
      area: g.area,
    };
    out.set(g.s.id, info);
    return info;
  };
  geo.forEach((_, k) => visit(k));
  return out;
}

/** The absolute height of floor `shapeId` on its layer (0 for ground or an unknown id). */
export function absoluteHeight(layer: Pick<DungeonLayer, 'children'>, shapeId: string): number {
  return layerPlateaus(layer).infos.get(shapeId)?.height ?? 0;
}

// ─── Bands ─────────────────────────────────────────────────

export interface BandEdge {
  /** The band's shape this edge belongs to. */
  owner: ShapeChild | null;
  edge: EdgeKind;
  /** Band height minus the surface just outside, in cells. */
  drop: number;
}

export interface PlateauBand {
  /** Absolute height, cells. */
  height: number;
  /** Longest raised chain among its shapes: bands draw in this order, then by height. */
  depth: number;
  shapes: ShapeChild[];
  /**
   * The union of the band's shapes, holes subtracted. Wound so the band's outside is on the
   * LEFT of travel (outer rings positive, holes negative): the cave kit's void side.
   */
  rings: Polygon[];
  /** Per ring, the edge kind of its owning shape (the whole ring's): 'wall' rings are raised rooms. */
  ringEdge: EdgeKind[];
  /** Per ring, per edge (vertex i to i + 1, wrapping). */
  edges: BandEdge[][];
}

export interface LayerPlateaus {
  infos: Map<string, PlateauInfo>;
  /** Floors with no raised chain: the ground, the layer's merged floor. */
  ground: ShapeChild[];
  /** Raised bands in draw order (depth, then height). Empty on a flat layer. */
  bands: PlateauBand[];
}

/** Union of rings the way the merged floor does it: outers unioned, holes subtracted. */
export function unionShapes(shapes: readonly ShapeChild[]): Polygon[] {
  const outer: Polygon[] = [];
  const holes: Polygon[] = [];
  for (const s of shapes) {
    for (let i = 0; i < s.contours.length; i++) (i === 0 ? outer : holes).push(shapeRing(s, i));
  }
  if (outer.length === 0) return [];
  let merged = outer.length === 1 ? [outer[0]] : clipper2Engine.union(outer, []);
  if (holes.length > 0) merged = clipper2Engine.difference(merged, holes);
  return merged;
}

/** Wind rings so whatever is outside the set lies on the left of travel. */
function orient(rings: Polygon[]): Polygon[] {
  return rings.map((r, i) => {
    if (r.length < 3) return r;
    let depth = 0;
    for (let j = 0; j < rings.length; j++) if (j !== i && rings[j].length >= 3 && pointInPoly(r[0][0], r[0][1], rings[j])) depth++;
    const hole = depth % 2 === 1;
    return signedArea(r) > 0 !== hole ? r : [...r].reverse();
  });
}

/**
 * The surface height at a point: the deepest raised floor holding it (the one drawn last on
 * a tie), else the ground, 0. Void outside every floor reads as 0 too.
 */
export function surfaceHeightAt(infos: Map<string, PlateauInfo>, x: number, y: number): number {
  let best: PlateauInfo | null = null;
  for (const info of infos.values()) {
    if (info.chain.length === 0) continue;
    if (!pointInPoly(x, y, info.outline)) continue;
    if (!best || info.chain.length >= best.chain.length) best = info;
  }
  return best ? best.height : 0;
}

const memo = new WeakMap<readonly unknown[], LayerPlateaus>();

/** The layer's nesting and bands, cached on its children array. */
export function layerPlateaus(layer: Pick<DungeonLayer, 'children'>): LayerPlateaus {
  const hit = memo.get(layer.children);
  if (hit) return hit;
  const shapes = layer.children.filter((c): c is ShapeChild => c.childType === 'shape' && c.visible);
  const infos = plateauChains(shapes);
  const ground: ShapeChild[] = [];
  const byHeight = new Map<number, ShapeChild[]>();
  for (const s of shapes) {
    const info = infos.get(s.id);
    if (!info || info.chain.length === 0) {
      ground.push(s);
      continue;
    }
    const list = byHeight.get(info.height);
    if (list) list.push(s);
    else byHeight.set(info.height, [s]);
  }

  const bands: PlateauBand[] = [];
  for (const [height, members] of byHeight) {
    const rings = orient(unionShapes(members).filter((r) => r.length >= 3));
    const depth = Math.max(...members.map((s) => infos.get(s.id)?.chain.length ?? 1));
    const ringEdge = rings.map((r) => {
      const owner = members.length === 1 ? members[0] : ringOwner(r, members);
      return owner ? edgeOf(owner) : 'wall';
    });
    const edges = rings.map((r) =>
      r.map((a, i) => {
        const b = r[(i + 1) % r.length];
        const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const owner = members.length === 1 ? members[0] : ringOwner([a, mid, b], members);
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        // Outside is on the left of travel: (dy, -dx) in screen space, y down.
        const ox = mid[0] + ((b[1] - a[1]) / len) * PROBE;
        const oy = mid[1] - ((b[0] - a[0]) / len) * PROBE;
        return { owner, edge: owner ? edgeOf(owner) : 'wall', drop: height - surfaceHeightAt(infos, ox, oy) } as BandEdge;
      }),
    );
    bands.push({ height, depth, shapes: members, rings, ringEdge, edges });
  }
  bands.sort((a, b) => a.depth - b.depth || a.height - b.height);

  const out: LayerPlateaus = { infos, ground, bands };
  memo.set(layer.children, out);
  return out;
}

/** True when a point lies on a band (inside its union). */
export function inBand(band: PlateauBand, x: number, y: number): boolean {
  return inRings(x, y, band.rings);
}

/** The raised rings that are rooms: band rings whose owner keeps its walls. */
export function wallBandRings(plateaus: LayerPlateaus): Polygon[] {
  return plateaus.bands.flatMap((b) => b.rings.filter((_, i) => b.ringEdge[i] === 'wall'));
}

// ─── Edges, sight and crossing ─────────────────────────────

/** One run of consecutive band-ring edges with the same owner, kind and drop sign. */
export interface EdgeRun {
  band: PlateauBand;
  ring: number;
  owner: ShapeChild | null;
  edge: EdgeKind;
  /** Largest |drop| along the run, signed by the run's side (all its edges share a sign). */
  drop: number;
  /** The run's points, in the ring's own (outside-left) order. Closed runs repeat no point. */
  points: Polygon;
  /** The whole ring is this one run. */
  closed: boolean;
}

/**
 * A band's non-wall rings cut into runs where the owner, the edge kind or the side of the
 * drop changes. Edges with no drop (flush with the ground outside) are left out.
 */
export function edgeRuns(band: PlateauBand): EdgeRun[] {
  const runs: EdgeRun[] = [];
  band.rings.forEach((ring, ri) => {
    if (band.ringEdge[ri] === 'wall') return;
    const edges = band.edges[ri];
    const n = ring.length;
    const keyOf = (e: BandEdge) => (e.drop === 0 || e.edge === 'wall' ? null : `${e.owner?.id}|${e.edge}|${Math.sign(e.drop)}`);
    const keys = edges.map(keyOf);
    if (keys.every((k) => k !== null && k === keys[0])) {
      const drop = edges.reduce((m, e) => (Math.abs(e.drop) > Math.abs(m) ? e.drop : m), 0);
      runs.push({ band, ring: ri, owner: edges[0].owner, edge: edges[0].edge, drop, points: ring, closed: true });
      return;
    }
    // Start where the key changes so no run straddles the seam.
    let start = keys.findIndex((k, i) => k !== keys[(i - 1 + n) % n]);
    if (start < 0) start = 0;
    let cur: { key: string; from: number; drop: number; e: BandEdge } | null = null;
    const flush = (to: number) => {
      if (!cur) return;
      const pts: Polygon = [];
      for (let k = cur.from; k <= to + 1; k++) pts.push(ring[k % n]);
      runs.push({ band, ring: ri, owner: cur.e.owner, edge: cur.e.edge, drop: cur.drop, points: pts, closed: false });
      cur = null;
    };
    for (let k = start; k < start + n; k++) {
      const i = k % n;
      const key = keys[i];
      if (cur && key !== cur.key) flush(k - 1);
      if (key === null) continue;
      if (!cur) cur = { key, from: k, drop: 0, e: edges[i] };
      if (Math.abs(edges[i].drop) > Math.abs(cur.drop)) cur.drop = edges[i].drop;
    }
    flush(start + n - 1);
  });
  return runs;
}

/**
 * Whether a raised edge hides what is above it from below. The shape's override decides
 * when it has one; otherwise a cliff hides once its drop reaches the map's threshold, and
 * slopes and bare edges never do.
 */
export function edgeHides(
  owner: Pick<ShapeChild, 'sightOverride'> | null,
  edge: EdgeKind,
  drop: number,
  sightDropCells: number = DEFAULT_SIGHT_DROP_CELLS,
): boolean {
  if (edge === 'wall') return false;
  if (owner?.sightOverride === 'hide') return true;
  if (owner?.sightOverride === 'show') return false;
  return edge === 'cliff' && Math.abs(drop) >= Math.max(1, sightDropCells);
}

/** The largest |drop| along the edges a shape owns, for the card's Auto answer. */
export function shapeDrop(layer: Pick<DungeonLayer, 'children'>, shapeId: string): number {
  let most = 0;
  for (const band of layerPlateaus(layer).bands) {
    for (const ring of band.edges) {
      for (const e of ring) if (e.owner?.id === shapeId && Math.abs(e.drop) > Math.abs(most)) most = e.drop;
    }
  }
  return most;
}

/** The crossing kind an edge kind takes when its shape names none. */
export function defaultCrossingId(edge: EdgeKind): string {
  return edge === 'cliff' ? 'climb' : edge === 'slope' ? 'difficult' : 'free';
}

/** A shape's crossing kind id: its own, else its edge kind's default. */
export function crossingIdOf(shape: Pick<ShapeChild, 'crossingId' | 'edge'>): string {
  return shape.crossingId ?? defaultCrossingId(edgeOf(shape));
}

/** The brightness a band's floor is lifted (or, below ground, lowered) by: ±3 % a cell, capped. */
export function tierLift(height: number): number {
  return Math.max(-TIER_CAP, Math.min(TIER_CAP, height * TIER_STEP));
}

// ─── Openings and gaps ─────────────────────────────────────

type Vec = [number, number];

/** The point at fraction `t` (0..1) of a closed ring's perimeter, and the ring's direction there. */
export function pointAlongRing(ring: Polygon, t: number): { p: Vec; dir: Vec } | null {
  const n = ring.length;
  if (n < 2) return null;
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.hypot(ring[(i + 1) % n][0] - ring[i][0], ring[(i + 1) % n][1] - ring[i][1]);
  if (total <= 0) return null;
  let s = (((t % 1) + 1) % 1) * total;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len <= 0) continue;
    if (s <= len || i === n - 1) {
      const u = Math.min(1, s / len);
      return { p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], dir: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] };
    }
    s -= len;
  }
  return null;
}

/** The fraction of a closed ring's perimeter nearest (x, y), and how far away that is. */
export function ringParamAt(ring: Polygon, x: number, y: number): { t: number; dist: number } {
  const n = ring.length;
  let total = 0;
  let best = { s: 0, dist: Infinity };
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const u = len2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2)) : 0;
    const d = Math.hypot(x - (a[0] + dx * u), y - (a[1] + dy * u));
    if (d < best.dist) best = { s: total + Math.sqrt(len2) * u, dist: d };
    total += Math.sqrt(len2);
  }
  return { t: total > 0 ? best.s / total : 0, dist: best.dist };
}

/** Where an opening sits and which way is down: along its ring, and across it toward the low side. */
export interface OpeningFrame {
  position: Vec;
  /** Unit direction of the ring at the opening. */
  along: Vec;
  /** Unit direction from the high side to the low side. */
  downhill: Vec;
  /** Height of the high side minus the low side, cells (at least 0). */
  drop: number;
}

export function openingFrame(
  layer: Pick<DungeonLayer, 'children'>,
  opening: Pick<OpeningChild, 'shapeId' | 't'>,
): OpeningFrame | null {
  const plateaus = layerPlateaus(layer);
  const info = plateaus.infos.get(opening.shapeId);
  if (!info || info.outline.length < 3) return null;
  const at = pointAlongRing(info.outline, opening.t);
  if (!at) return null;
  let out: Vec = [at.dir[1], -at.dir[0]];
  if (pointInPoly(at.p[0] + out[0] * PROBE, at.p[1] + out[1] * PROBE, info.outline)) out = [-out[0], -out[1]];
  const below = surfaceHeightAt(plateaus.infos, at.p[0] + out[0] * PROBE, at.p[1] + out[1] * PROBE);
  const drop = info.height - below;
  const downhill: Vec = drop >= 0 ? out : [-out[0], -out[1]];
  return { position: at.p, along: at.dir, downhill, drop: Math.abs(drop) };
}

/** A stretch of a raised ring left open: no cliff art laid, no sight blocked, free to cross. */
export interface RingGap {
  /** Where the gap comes from: `opening:<id>`, or a bridge landing. */
  id: string;
  position: Vec;
  /** Cells along the ring. */
  width: number;
}

/** Every visible opening on the layer as a gap in its ring. */
export function openingGaps(layer: Pick<DungeonLayer, 'children'>): RingGap[] {
  const gaps: RingGap[] = [];
  for (const c of layer.children) {
    if (c.childType !== 'opening' || !c.visible) continue;
    const frame = openingFrame(layer, c);
    if (frame) gaps.push({ id: `opening:${c.id}`, position: frame.position, width: c.width });
  }
  return gaps;
}

/**
 * Bridge landings: a path end resting on a cliff ring opens it like an opening does (plan
 * §5.4). Paths own their landings, so this is the seam they plug into; until then a ring has
 * no landing gaps.
 */
export function landingGaps(_layer: Pick<DungeonLayer, 'children'>): RingGap[] {
  return [];
}

/** Everything that opens a raised ring on this layer: openings and bridge landings. */
export function ringGaps(layer: Pick<DungeonLayer, 'children'>, extra: readonly RingGap[] = []): RingGap[] {
  return [...openingGaps(layer), ...landingGaps(layer), ...extra];
}

/** Whether a point on a ring lies inside any gap (within half its width). */
export function inGap(gaps: readonly RingGap[], x: number, y: number): boolean {
  return gaps.some((g) => Math.hypot(x - g.position[0], y - g.position[1]) <= g.width / 2);
}

// ─── Waterfalls (the seam water paths and lakes call) ──────

/** A place where water leaves a raised edge: drawn by `drawWaterfall` (plateauRenderer.ts). */
export interface FallSpan {
  /** The stretch of edge the water falls over, in ring order. */
  a: Vec;
  b: Vec;
  /** Unit direction from the high side to the low side. */
  downhill: Vec;
  /** Cells fallen. */
  drop: number;
}

/** Each raised (non-wall) edge of the layer with its downhill direction. */
function fallEdges(layer: Pick<DungeonLayer, 'children'>): FallSpan[] {
  const out: FallSpan[] = [];
  for (const band of layerPlateaus(layer).bands) {
    band.rings.forEach((ring, ri) => {
      if (band.ringEdge[ri] === 'wall') return;
      band.edges[ri].forEach((e, i) => {
        if (e.drop === 0 || e.edge === 'wall') return;
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1e-9) return;
        // Outside is the left of travel; a plateau falls outward, a pit inward.
        const s = Math.sign(e.drop);
        out.push({ a, b, downhill: [((b[1] - a[1]) / len) * s, (-(b[0] - a[0]) / len) * s], drop: Math.abs(e.drop) });
      });
    });
  }
  return out;
}

/**
 * Where a polyline (a water path's centreline) crosses a raised edge going downhill: one
 * span per crossing, `width` cells wide along the edge, centred on the crossing.
 */
export function cliffCrossings(layer: Pick<DungeonLayer, 'children'>, points: readonly Vec[], width = 1): FallSpan[] {
  const out: FallSpan[] = [];
  for (const edge of fallEdges(layer)) {
    const ex = edge.b[0] - edge.a[0];
    const ey = edge.b[1] - edge.a[1];
    const elen = Math.hypot(ex, ey);
    for (let i = 0; i + 1 < points.length; i++) {
      const [px, py] = points[i];
      const dx = points[i + 1][0] - px;
      const dy = points[i + 1][1] - py;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((edge.a[0] - px) * ey - (edge.a[1] - py) * ex) / den;
      const u = ((edge.a[0] - px) * dy - (edge.a[1] - py) * dx) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      if (dx * edge.downhill[0] + dy * edge.downhill[1] <= 0) continue;
      const cx = px + dx * t;
      const cy = py + dy * t;
      const h = width / 2 / elen;
      out.push({
        a: [cx - ex * h, cy - ey * h],
        b: [cx + ex * h, cy + ey * h],
        downhill: edge.downhill,
        drop: edge.drop,
      });
    }
  }
  return out;
}

/** The raised edges a closed outline (a raised pool's shore) runs along within `tol` cells. */
export function cliffSpansNear(layer: Pick<DungeonLayer, 'children'>, outline: Polygon, tol = 0.1): FallSpan[] {
  const near = (x: number, y: number): boolean => {
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      const u = len2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2)) : 0;
      if (Math.hypot(x - (a[0] + dx * u), y - (a[1] + dy * u)) <= tol) return true;
    }
    return false;
  };
  return fallEdges(layer).filter(
    (e) => near(e.a[0], e.a[1]) && near(e.b[0], e.b[1]) && near((e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2),
  );
}
