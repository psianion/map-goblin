// Plateaus: relief drawn over floors or terrain, stacked inside one another, and the bands
// of equal height they merge into. Pure: the renderer, the lights, the table and the card
// all read the same answers from here. Plateaus never touch the floor union, walls or rooms.
//
// The rules:
// - A plateau's parent is the innermost plateau on the same layer whose outline holds its
//   centroid (ties: the smallest area). Heights add up along that chain: the absolute height.
// - Plateaus merge only with plateaus of the same absolute height: one band per height.
// - The drop at a point of a band's edge is the band's height minus the height of the
//   surface just outside: positive faces outward (a plateau), negative inward (a pit).

import type { DungeonLayer } from '../store/types';
import type { CrossingKind, OpeningChild, PlateauChild, RingGeometry } from './types';
import type { Polygon } from '../types/geometry';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import { flattenRing } from './bezier';
import { ringOwner } from './wallLook';
import { DEFAULT_SIGHT_DROP_CELLS } from './crossingKinds';

export type EdgeKind = PlateauChild['edge'];

/** Brightness added to a band's floor per cell of height, and the most it adds. */
export const TIER_STEP = 0.07;
export const TIER_CAP = 0.35;

/** How far outside an edge the surface below it is probed, in cells. */
const PROBE = 0.05;

type Transform = NonNullable<RingGeometry['transform']>;

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

/** Ring `i` of a ring child in world space: curves flattened, transform applied. */
export function shapeRing(shape: RingGeometry, i = 0): Polygon {
  let pts = flattenRing(shape.contours[i], shape.tangents?.[i]);
  if (shape.transform) pts = applyShapeTransform(pts, shape.transform);
  return pts;
}

/** The edge a plateau's ring meets lower ground with. */
export const edgeOf = (plateau: Pick<PlateauChild, 'edge'>): EdgeKind => plateau.edge ?? 'cliff';

/** A plateau's own height in whole cells; 0 when it has none. */
export const ownHeight = (plateau: Pick<PlateauChild, 'height'>): number =>
  Number.isFinite(plateau.height) ? Math.round(plateau.height) : 0;

/** The layer's visible plateaus. */
export function plateausOf(layer: Pick<DungeonLayer, 'children'>): PlateauChild[] {
  return layer.children.filter((c): c is PlateauChild => c.childType === 'plateau' && c.visible);
}

/** True when any visible plateau on the layer has a height: the only case anything here changes. */
export function hasPlateaus(layer: Pick<DungeonLayer, 'children'>): boolean {
  return layer.children.some((c) => c.childType === 'plateau' && c.visible && ownHeight(c) !== 0);
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
  shape: PlateauChild;
  /** The raised plateau this one stands on, or null on the ground. */
  parent: PlateauChild | null;
  /** The raised plateaus from the outermost down to this one (itself included when it has a height). */
  chain: PlateauChild[];
  /** Absolute height in cells: the sum of `height` along the chain. */
  height: number;
  /** The plateau's outline, flattened and transformed. */
  outline: Polygon;
  area: number;
}

/**
 * Each visible plateau's place in the stack: parent, chain and absolute height. A plateau only
 * ever stands on a larger one (or an equal one drawn before it), so a chain always ends.
 */
export function plateauChains(shapes: readonly PlateauChild[]): Map<string, PlateauInfo> {
  const live = shapes.filter((s) => s.visible !== false && (s.contours[0]?.length ?? 0) >= 3);
  const geo = live.map((s) => {
    const outline = shapeRing(s, 0);
    return { s, outline, area: Math.abs(signedArea(outline)), c: centroidOf(outline) };
  });
  const raised = geo.map((g, i) => ({ ...g, i })).filter((g) => ownHeight(g.s) !== 0);

  const parentOf = new Map<string, PlateauChild | null>();
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

/** The absolute height of plateau `id` on its layer (0 for an unknown id). */
export function absoluteHeight(layer: Pick<DungeonLayer, 'children'>, id: string): number {
  return layerPlateaus(layer).infos.get(id)?.height ?? 0;
}

// ─── Bands ─────────────────────────────────────────────────

export interface BandEdge {
  /** The band's plateau this edge belongs to. */
  owner: PlateauChild | null;
  edge: EdgeKind;
  /** Band height minus the surface just outside, in cells. */
  drop: number;
}

export interface PlateauBand {
  /** Absolute height, cells. */
  height: number;
  /** Longest raised chain among its plateaus: bands draw in this order, then by height. */
  depth: number;
  shapes: PlateauChild[];
  /**
   * The union of the band's plateaus, holes subtracted. Wound so the band's outside is on the
   * LEFT of travel (outer rings positive, holes negative): the cave kit's void side.
   */
  rings: Polygon[];
  /** Per ring, per edge (vertex i to i + 1, wrapping). */
  edges: BandEdge[][];
}

export interface LayerPlateaus {
  infos: Map<string, PlateauInfo>;
  /** Raised bands in draw order (depth, then height). Empty on a flat layer. */
  bands: PlateauBand[];
}

/** Union of rings: outers unioned, holes subtracted. */
export function unionShapes(shapes: readonly RingGeometry[]): Polygon[] {
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
 * The surface height at a point: the deepest raised plateau holding it (the one drawn last on
 * a tie), else the ground, 0.
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

/** The layer's nesting and bands, built from its plateau children, cached on its children array. */
export function layerPlateaus(layer: Pick<DungeonLayer, 'children'>): LayerPlateaus {
  const hit = memo.get(layer.children);
  if (hit) return hit;
  const shapes = plateausOf(layer);
  const infos = plateauChains(shapes);
  const byHeight = new Map<number, PlateauChild[]>();
  for (const s of shapes) {
    const info = infos.get(s.id);
    if (!info || info.chain.length === 0) continue;
    const list = byHeight.get(info.height);
    if (list) list.push(s);
    else byHeight.set(info.height, [s]);
  }

  const bands: PlateauBand[] = [];
  for (const [height, members] of byHeight) {
    const rings = orient(unionShapes(members).filter((r) => r.length >= 3));
    const depth = Math.max(...members.map((s) => infos.get(s.id)?.chain.length ?? 1));
    const edges = rings.map((r) =>
      r.map((a, i) => {
        const b = r[(i + 1) % r.length];
        const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const owner = members.length === 1 ? members[0] : ringOwner([a, mid, b], members);
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        // Outside is on the left of travel: (dy, -dx) in screen space, y down.
        const ox = mid[0] + ((b[1] - a[1]) / len) * PROBE;
        const oy = mid[1] - ((b[0] - a[0]) / len) * PROBE;
        return { owner, edge: owner ? edgeOf(owner) : 'cliff', drop: height - surfaceHeightAt(infos, ox, oy) } as BandEdge;
      }),
    );
    bands.push({ height, depth, shapes: members, rings, edges });
  }
  bands.sort((a, b) => a.depth - b.depth || a.height - b.height);

  const out: LayerPlateaus = { infos, bands };
  memo.set(layer.children, out);
  return out;
}

/** True when a point lies on a band (inside its union). */
export function inBand(band: PlateauBand, x: number, y: number): boolean {
  return inRings(x, y, band.rings);
}

// ─── Edges, sight and crossing ─────────────────────────────

/** One run of consecutive band-ring edges with the same owner, kind and drop sign. */
export interface EdgeRun {
  band: PlateauBand;
  ring: number;
  owner: PlateauChild | null;
  edge: EdgeKind;
  /** Largest |drop| along the run, signed by the run's side (all its edges share a sign). */
  drop: number;
  /** The run's points, in the ring's own (outside-left) order. Closed runs repeat no point. */
  points: Polygon;
  /** The whole ring is this one run. */
  closed: boolean;
}

/**
 * A band's rings cut into runs where the owner, the edge kind or the side of the drop
 * changes. Edges with no drop (flush with the ground outside) are left out.
 */
export function edgeRuns(band: PlateauBand): EdgeRun[] {
  const runs: EdgeRun[] = [];
  band.rings.forEach((ring, ri) => {
    const edges = band.edges[ri];
    const n = ring.length;
    const keyOf = (e: BandEdge) => (e.drop === 0 ? null : `${e.owner?.id}|${e.edge}|${Math.sign(e.drop)}`);
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
  owner: Pick<PlateauChild, 'sightOverride'> | null,
  edge: EdgeKind,
  drop: number,
  sightDropCells: number = DEFAULT_SIGHT_DROP_CELLS,
): boolean {
  if (owner?.sightOverride === 'hide') return true;
  if (owner?.sightOverride === 'show') return false;
  return edge === 'cliff' && Math.abs(drop) >= Math.max(1, sightDropCells);
}

/** The largest |drop| along the edges a shape owns, for the card's Auto answer. */
export function shapeDrop(layer: Pick<DungeonLayer, 'children'>, plateauId: string): number {
  let most = 0;
  for (const band of layerPlateaus(layer).bands) {
    for (const ring of band.edges) {
      for (const e of ring) if (e.owner?.id === plateauId && Math.abs(e.drop) > Math.abs(most)) most = e.drop;
    }
  }
  return most;
}

/** The crossing kind an edge kind takes when its shape names none. */
export function defaultCrossingId(edge: EdgeKind): string {
  return edge === 'cliff' ? 'climb' : edge === 'slope' ? 'difficult' : 'free';
}

/** A shape's crossing kind id: its own, else its edge kind's default. */
export function crossingIdOf(shape: Pick<PlateauChild, 'crossingId' | 'edge'>): string {
  return shape.crossingId ?? defaultCrossingId(edgeOf(shape));
}

/** The brightness a band's floor is lifted (or, below ground, lowered) by: ±7 % a cell, capped. */
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
  opening: Pick<OpeningChild, 'hostId' | 't'>,
): OpeningFrame | null {
  const plateaus = layerPlateaus(layer);
  const info = plateaus.infos.get(opening.hostId);
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
  /** Where the gap comes from: `opening:<id>`. */
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

/** Everything that opens a raised ring on this layer: its openings. */
export function ringGaps(layer: Pick<DungeonLayer, 'children'>, extra: readonly RingGap[] = []): RingGap[] {
  return [...openingGaps(layer), ...extra];
}

/** Whether a point on a ring lies inside any gap (within half its width). */
export function inGap(gaps: readonly RingGap[], x: number, y: number): boolean {
  return gaps.some((g) => Math.hypot(x - g.position[0], y - g.position[1]) <= g.width / 2);
}

// ─── Sight ─────────────────────────────────────────────────

/** A raised edge that hides its top from below: blocks only an origin on its `direction` side. */
export interface CliffOccluder {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The low side, walking (x1, y1) → (x2, y2) in screen space: what `blocksFrom` reads. */
  direction: 'left' | 'right';
}

/** The parts of a→b farther than each gap's half-width from the gap's centre. */
function outsideGaps(a: Vec, b: Vec, gaps: readonly RingGap[]): [number, number][] {
  let keep: [number, number][] = [[0, 1]];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-12) return [];
  for (const g of gaps) {
    // |a + u(b - a) - c|² = r²: the stretch of the edge inside the gap's circle.
    const fx = a[0] - g.position[0];
    const fy = a[1] - g.position[1];
    const r = g.width / 2;
    const B = 2 * (fx * dx + fy * dy);
    const C = fx * fx + fy * fy - r * r;
    const disc = B * B - 4 * L2 * C;
    if (disc <= 0) continue;
    const s = Math.sqrt(disc);
    const u0 = (-B - s) / (2 * L2);
    const u1 = (-B + s) / (2 * L2);
    keep = keep.flatMap(([k0, k1]): [number, number][] => {
      const out: [number, number][] = [];
      if (u0 > k0) out.push([k0, Math.min(k1, u0)]);
      if (u1 < k1) out.push([Math.max(k0, u1), k1]);
      return out.filter(([p, q]) => q - p > 1e-6);
    });
  }
  return keep;
}

/**
 * The raised edges of a layer that hide what is above them from below (`edgeHides`), counting
 * cliffs from `minDrop` cells up, as one-way segments blocking from the low side, with
 * openings cut out. Sight passes the map's `sightDropCells`; light passes
 * 1, so a lamp below never lights a top. A plateau's ring has its low side on the left of
 * travel (outside); a pit's on the right.
 */
export function cliffOccluders(
  layer: Pick<DungeonLayer, 'children'>,
  minDrop: number = DEFAULT_SIGHT_DROP_CELLS,
): CliffOccluder[] {
  if (!hasPlateaus(layer)) return [];
  const gaps = ringGaps(layer);
  const out: CliffOccluder[] = [];
  for (const band of layerPlateaus(layer).bands) {
    band.rings.forEach((ring, ri) => {
      band.edges[ri].forEach((e, i) => {
        if (e.drop === 0 || !edgeHides(e.owner, e.edge, e.drop, minDrop)) return;
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        for (const [u0, u1] of outsideGaps(a, b, gaps)) {
          out.push({
            x1: a[0] + (b[0] - a[0]) * u0,
            y1: a[1] + (b[1] - a[1]) * u0,
            x2: a[0] + (b[0] - a[0]) * u1,
            y2: a[1] + (b[1] - a[1]) * u1,
            direction: e.drop > 0 ? 'left' : 'right',
          });
        }
      });
    });
  }
  return out;
}

// ─── The table: where a token stands, and what it crosses ──

/**
 * How high a point stands: on a stairs, ramp or ladder, part way down it; else its surface.
 */
export function elevationAt(layer: Pick<DungeonLayer, 'children'>, x: number, y: number): number {
  if (!hasPlateaus(layer)) return 0;
  const plateaus = layerPlateaus(layer);
  for (const c of layer.children) {
    if (c.childType !== 'opening' || !c.visible) continue;
    const f = openingFrame(layer, c);
    if (!f) continue;
    const dx = x - f.position[0];
    const dy = y - f.position[1];
    const s = dx * f.along[0] + dy * f.along[1];
    const t = dx * f.downhill[0] + dy * f.downhill[1];
    const reach = Math.max(1, f.drop);
    if (Math.abs(s) > c.width / 2 || t < -0.25 || t > reach) continue;
    const high = surfaceHeightAt(
      plateaus.infos,
      f.position[0] - f.downhill[0] * PROBE,
      f.position[1] - f.downhill[1] * PROBE,
    );
    return high - f.drop * Math.max(0, Math.min(1, t / reach));
  }
  return surfaceHeightAt(plateaus.infos, x, y);
}

/** The same across a level's layers: the topmost layer that raises or sinks the point decides. */
export function elevationAtLayers(layers: readonly Pick<DungeonLayer, 'children'>[], x: number, y: number): number {
  for (let i = layers.length - 1; i >= 0; i--) {
    const h = elevationAt(layers[i], x, y);
    if (h !== 0) return h;
  }
  return 0;
}

/**
 * What the table plays at a raised edge right now: per target (a plateau's id or an opening's
 * id) the crossing kind the DM picked live, and per kind whether it refuses a move. Both
 * fall back to the map's own.
 */
export interface CrossingOverrides {
  edges?: Readonly<Record<string, string>>;
  blocks?: Readonly<Record<string, boolean>>;
}

/** One raised edge a move goes over. */
export interface Crossing {
  position: Vec;
  /** What was crossed: an edge kind, or an opening in one. */
  via: 'cliff' | 'slope' | 'none' | 'opening';
  /** The plateau (edges) or opening whose crossing rule applies. */
  targetId: string;
  kindId: string;
  /** The kind as the map lists it, or null when the id names none. */
  kind: CrossingKind | null;
  /** The kind refuses a player's move (the live switch if the DM flipped it). */
  blocks: boolean;
  /** Show the chip: always on a cliff; elsewhere only when the kind is not Free. */
  chip: boolean;
  /** The move went from the high side to the low side. */
  down: boolean;
  /** 0..1 along the move. */
  at: number;
}

export const FREE_CROSSING = 'free';

function segHit(p: Vec, q: Vec, a: Vec, b: Vec): { t: number; u: number } | null {
  const rx = q[0] - p[0];
  const ry = q[1] - p[1];
  const sx = b[0] - a[0];
  const sy = b[1] - a[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((a[0] - p[0]) * sy - (a[1] - p[1]) * sx) / den;
  const u = ((a[0] - p[0]) * ry - (a[1] - p[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}

/**
 * Every raised edge (cliff, slope or bare) the straight move `from` → `to` crosses on one
 * layer, in order along the move, with the crossing rule that applies there: an opening's
 * where the move passes through one, else the edge's plateau's (its own, a live override, or
 * the edge kind's default). Walls are the walls' business and are not listed.
 */
export function crossingsAlong(
  layer: Pick<DungeonLayer, 'children'>,
  from: Vec,
  to: Vec,
  kinds: readonly CrossingKind[],
  overrides: CrossingOverrides = {},
): Crossing[] {
  if (!hasPlateaus(layer) || (from[0] === to[0] && from[1] === to[1])) return [];
  const gaps = ringGaps(layer);
  const openings = new Map<string, OpeningChild>();
  for (const c of layer.children) if (c.childType === 'opening') openings.set(c.id, c);
  const out: Crossing[] = [];
  for (const band of layerPlateaus(layer).bands) {
    band.rings.forEach((ring, ri) => {
      band.edges[ri].forEach((e, i) => {
        if (e.drop === 0 || !e.owner) return;
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const hit = segHit(from, to, a, b);
        if (!hit) return;
        const position: Vec = [from[0] + (to[0] - from[0]) * hit.t, from[1] + (to[1] - from[1]) * hit.t];
        const gap = gaps.find((g) => Math.hypot(position[0] - g.position[0], position[1] - g.position[1]) <= g.width / 2);
        const opening = gap?.id.startsWith('opening:') ? openings.get(gap.id.slice('opening:'.length)) : undefined;
        // Outside is the left of travel along the ring: (dy, -dx). Moving outward on a plateau
        // (or inward into a pit) is going down.
        const outward = (to[0] - from[0]) * (b[1] - a[1]) - (to[1] - from[1]) * (b[0] - a[0]) > 0;
        const down = e.drop > 0 ? outward : !outward;
        const targetId = opening ? opening.id : e.owner.id;
        const via: Crossing['via'] = opening ? 'opening' : (e.edge as 'cliff' | 'slope' | 'none');
        const kindId = overrides.edges?.[targetId] ?? (opening ? opening.crossingId ?? FREE_CROSSING : crossingIdOf(e.owner));
        const kind = kinds.find((k) => k.id === kindId) ?? null;
        const blocks = overrides.blocks?.[kindId] ?? kind?.blocks ?? false;
        if (out.some((o) => o.targetId === targetId && Math.abs(o.at - hit.t) < 1e-6)) return;
        out.push({ position, via, targetId, kindId, kind, blocks, chip: via === 'cliff' || kindId !== FREE_CROSSING, down, at: hit.t });
      });
    });
  }
  return out.sort((p, q) => p.at - q.at);
}

/** `crossingsAlong` over a level's layers. */
export function crossingsAlongLayers(
  layers: readonly Pick<DungeonLayer, 'children'>[],
  from: Vec,
  to: Vec,
  kinds: readonly CrossingKind[],
  overrides: CrossingOverrides = {},
): Crossing[] {
  return layers.flatMap((l) => crossingsAlong(l, from, to, kinds, overrides)).sort((p, q) => p.at - q.at);
}

/** A raised top that hides from below: its height and its outline (outer rings only). */
export interface HiddenTop {
  height: number;
  rings: Polygon[];
}

/**
 * The plateau tops on a layer that an eye on lower ground cannot see: every band with an
 * edge that falls away from it far enough to hide (`edgeHides`, drop > 0; a pit hides nothing
 * from above). The table's fog keeps these under cover for a seat with no eye up there.
 */
export function hiddenTops(
  layer: Pick<DungeonLayer, 'children'>,
  sightDropCells: number = DEFAULT_SIGHT_DROP_CELLS,
): HiddenTop[] {
  if (!hasPlateaus(layer)) return [];
  const out: HiddenTop[] = [];
  for (const band of layerPlateaus(layer).bands) {
    const hides = band.edges.some((ring) =>
      ring.some((e) => e.drop > 0 && edgeHides(e.owner, e.edge, e.drop, sightDropCells)),
    );
    if (!hides) continue;
    const rings = band.rings.filter((r) => signedArea(r) > 0);
    if (rings.length > 0) out.push({ height: band.height, rings });
  }
  return out;
}
