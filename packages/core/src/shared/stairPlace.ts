// Where the Door tool's Stairs style lays a flight, and where its Opening style makes a cave mouth
// in a cliff: the plateau or pit edge under the pointer (its drawn ring, or the cliff's saved rock
// line where it has one), and a run of whole cells along that edge of the plateau's own outline, as
// wide as asked. Pure: the tool and its tests read it.

import type { DungeonLayer } from '../store/types';
import type { CliffEntrance, PlateauChild, StairSpan } from './types';
import type { Polygon } from '../types/geometry';
import { edgeOf, layerPlateaus, shapeRing, stairFlights, type EntranceInfo, type StairFlight } from './plateaus';
import { alongRock } from './rockLines';

type Vec = [number, number];

/** How near an edge (or its rock) the pointer must be to lay stairs on it, cells. */
const EDGE_REACH = 0.75;
/** How near a plateau's own outline a band edge counts as on it, cells: the union's snap. */
const ON_OUTLINE = 0.02;
/** Slack on whole cells. */
const EPS = 1e-6;

function segDist(p: Vec, a: readonly number[], b: readonly number[]): { d: number; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return { d: Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t)), t };
}

/** What a click with the Stairs style would lay. */
export interface StairPlan {
  plateau: PlateauChild;
  span: Omit<StairSpan, 'id' | 'kit'>;
  /** The flight it would stand as; null where the span has no drop under it. */
  flight: StairFlight | null;
  /** Laid on no other stairs of the plateau, with a drop under it. */
  valid: boolean;
  /** Why it may not be laid, where the tool says so: a sharp corner in its stretch. */
  why?: string;
}

/** What the tool says where a flight would run round a sharp corner. */
export const STAIRS_CORNER = 'Stairs can’t turn a sharp corner. Place them where the edge runs smoother.';

/** The ring and edge of `plateau`'s own outline the segment a–b lies along, and where that edge starts along the ring. */
function outlineEdge(plateau: PlateauChild, a: Vec, b: Vec): { ring: number; p: Vec; q: Vec; s0: number } | null {
  const mid: Vec = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  for (let k = 0; k < plateau.contours.length; k++) {
    if ((plateau.contours[k]?.length ?? 0) < 3) continue;
    const ring = shapeRing(plateau, k);
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i] as Vec;
      const q = ring[(i + 1) % ring.length] as Vec;
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (L > EPS && segDist(mid, p, q).d <= ON_OUTLINE && segDist(a, p, q).d <= ON_OUTLINE && segDist(b, p, q).d <= ON_OUTLINE) return { ring: k, p, q, s0: s };
      s += L;
    }
  }
  return null;
}

/**
 * The flight a click at `point` would lay: on the nearest raised edge within reach (its rock
 * line's stretch where the cliff saved one), `width` whole cells along the plateau's own outline
 * edge it lies on, centred on the pointer as near as whole cells from the edge's start allow. An
 * edge shorter than the width takes as many whole cells as it holds. `ignore` is a span of the
 * same plateau being moved: it is no obstacle. Null off every edge, or on one shorter than a cell.
 */
export function stairSpanAt(layer: Pick<DungeonLayer, 'children' | 'rockLines'> & { mergedFloor?: Polygon[] | null }, point: Vec, width: number, ignore?: string): StairPlan | null {
  const hit = spanAt(layer, point, () => width, () => true);
  if (!hit) return null;
  const { owner, span } = hit;
  const others = (owner.stairs ?? []).filter((s) => s.id !== ignore);
  const overlaps = occupied(owner, ignore).some((s) => s.ring === span.ring && s.from < span.to - EPS && s.to > span.from + EPS);
  const probe = { ...owner, stairs: [...others, { ...span, id: '\u0000plan' }] } as PlateauChild;
  const flight = stairFlights({ children: layer.children.map((c) => (c === owner ? probe : c)), mergedFloor: layer.mergedFloor }).find((f) => f.span.id === '\u0000plan') ?? null;
  if (hit.corner) return { plateau: owner, span, flight, valid: false, why: STAIRS_CORNER };
  return { plateau: owner, span, flight, valid: !overlaps && flight !== null };
}

/** The stretches of `plateau`'s edge its stairs and cave mouths hold, but the one `ignore` names. */
const occupied = (plateau: PlateauChild, ignore?: string): { ring: number; from: number; to: number }[] =>
  [...(plateau.stairs ?? []), ...(plateau.entrances ?? [])].filter((s) => s.id !== ignore);

/**
 * The span a click at `point` would take on the nearest raised edge within reach whose plateau
 * `accept`s it (its rock line's stretch where the cliff saved one): `width(plateau)` whole cells
 * along the plateau's own outline edge it lies on, centred on the pointer as near as whole cells
 * from the edge's start allow. An edge shorter than the width takes as many whole cells as it
 * holds. Null off every edge, or on one shorter than a cell.
 */
function spanAt(
  layer: Pick<DungeonLayer, 'children' | 'rockLines'>,
  point: Vec,
  width: (plateau: PlateauChild) => number,
  accept: (plateau: PlateauChild) => boolean,
): { owner: PlateauChild; span: Omit<StairSpan, 'id' | 'kit'>; corner?: true } | null {
  let best: { d: number; a: Vec; b: Vec; owner: PlateauChild } | null = null;
  for (const band of layerPlateaus(layer).bands) {
    band.rings.forEach((ring, ri) => {
      const edges = band.edges[ri];
      if (!edges.some((e) => e.drop !== 0 && e.owner && accept(e.owner))) return;
      const consider = (i: number, d: number) => {
        const e = edges[i];
        if (e.drop === 0 || !e.owner || !accept(e.owner) || (best && best.d <= d)) return;
        best = { d, a: ring[i] as Vec, b: ring[(i + 1) % ring.length] as Vec, owner: e.owner };
      };
      ring.forEach((a, i) => consider(i, segDist(point, a, ring[(i + 1) % ring.length]).d));
      // On the cliff's rock as drawn, where its line was saved: that is where the eye sees the edge.
      const laid = alongRock(ring, true, layer.rockLines);
      if (laid.replaced.length > 0) laid.segs.forEach((i, j) => consider(i, segDist(point, laid.points[j], laid.points[(j + 1) % laid.points.length]).d));
    });
  }
  if (!best) return null;
  const hit = best as { d: number; a: Vec; b: Vec; owner: PlateauChild };
  if (hit.d > EDGE_REACH) return null;
  const edge = outlineEdge(hit.owner, hit.a, hit.b);
  if (!edge) return null;
  const { p, q } = edge;
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const cells = Math.floor(L + EPS);
  const asked = Math.max(1, Math.round(width(hit.owner)));
  const t = segDist(point, p, q).t * L;
  // An edge too short for the width, on a curve (a brushed outline's many short edges): the
  // stretch round the pointer whose ends lie the width apart.
  if (cells < asked) {
    const arc = arcSpan(shapeRing(hit.owner, edge.ring), edge.s0 + t, asked);
    if (arc && !arc.corner) return { owner: hit.owner, span: { ring: edge.ring, from: arc.from, to: arc.to } };
    // Round a sharp corner, with no whole cell of edge to fall back on: refused, and why.
    if (arc && cells < 1) return { owner: hit.owner, span: { ring: edge.ring, from: arc.from, to: arc.to }, corner: true };
  }
  if (cells < 1) return null;
  const w = Math.min(cells, asked);
  const start = Math.max(0, Math.min(cells - w, Math.round(t - w / 2)));
  return { owner: hit.owner, span: { ring: edge.ring, from: edge.s0 + start, to: edge.s0 + start + w } };
}

/** A vertex turning more than this, degrees, is a corner a span on a curve never runs round. */
const CURVE_CORNER_DEG = 40;

/**
 * The stretch of `ring` round `s` (a length along it) whose ends lie exactly `w` apart, as far
 * along it either side of `s`: a span on a curve, as wide across as asked. Near the ring's seam
 * (its first point), where a span cannot run on past it, the stretch is slid along to end there.
 * `corner` where that stretch runs round a corner. Null where nowhere comes `w` across.
 */
function arcSpan(ring: Polygon, s: number, w: number): { from: number; to: number; corner?: true } | null {
  const n = ring.length;
  if (n < 3) return null;
  const cum = [0];
  for (let i = 0; i < n; i++) cum.push(cum[i] + Math.hypot(ring[(i + 1) % n][0] - ring[i][0], ring[(i + 1) % n][1] - ring[i][1]));
  const total = cum[n];
  const at = (d: number): Vec => {
    let i = 0;
    while (i < n - 1 && cum[i + 1] < d) i++;
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const f = Math.max(0, Math.min(1, (d - cum[i]) / (cum[i + 1] - cum[i] || 1)));
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  };
  const apart = (x: number, y: number): number => {
    const [a, b] = [at(x), at(y)];
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  };
  /** How far along from `d0`, `dir` 1 on or -1 back, the ring first comes `w` across; null past the seam. */
  const reach = (d0: number, dir: 1 | -1, start: number): number | null => {
    let lo = 0;
    let hi = start;
    while (apart(d0, d0 + dir * hi) < w - EPS) {
      lo = hi;
      hi += w / 4;
      if (d0 + dir * hi < 0 || d0 + dir * hi > total) return null;
    }
    for (let k = 0; k < 40 && hi - lo > 1e-6; k++) {
      const mid = (lo + hi) / 2;
      if (apart(d0, d0 + dir * mid) < w) lo = mid;
      else hi = mid;
    }
    return hi;
  };
  // Widened about `s` until it is `w` across, then halved down onto it.
  let lo = w / 2;
  let hi = w / 2;
  let fits = true;
  while (apart(s - hi, s + hi) < w - EPS) {
    hi += w / 4;
    if (s - hi < 0 || s + hi > total) {
      fits = false;
      break;
    }
  }
  if (s - hi < 0 || s + hi > total) fits = false;
  let from: number;
  let to: number;
  if (fits) {
    for (let k = 0; k < 40 && hi - lo > 1e-6; k++) {
      const mid = (lo + hi) / 2;
      if (apart(s - mid, s + mid) < w) lo = mid;
      else hi = mid;
    }
    [from, to] = [s - hi, s + hi];
  } else if (s < total / 2) {
    // By the seam's start: from it on.
    const len = reach(0, 1, w / 2);
    if (len === null) return null;
    [from, to] = [0, len];
  } else {
    // By the seam's end: back from it.
    const len = reach(total, -1, w / 2);
    if (len === null) return null;
    [from, to] = [total - len, total];
  }
  const round = (x: number): number => Math.round(x * 1e6) / 1e6;
  // No corner inside it.
  for (let i = 1; i < n; i++) {
    if (cum[i] <= from + EPS || cum[i] >= to - EPS) continue;
    const [a, v, b] = [ring[i - 1], ring[i], ring[(i + 1) % n]];
    const turn = Math.abs(Math.atan2((v[0] - a[0]) * (b[1] - v[1]) - (v[1] - a[1]) * (b[0] - v[0]), (v[0] - a[0]) * (b[0] - v[0]) + (v[1] - a[1]) * (b[1] - v[1])));
    if (turn > (CURVE_CORNER_DEG * Math.PI) / 180) return { from: round(from), to: round(to), corner: true };
  }
  return { from: round(from), to: round(to) };
}

/** What a click with the Opening style would make on a cliff edge: a cave mouth. */
export interface EntrancePlan {
  plateau: PlateauChild;
  span: Omit<CliffEntrance, 'id' | 'piece' | 'mouth'>;
  /** It would stand as this (its mouth the span's middle third); null where it has no drop under it. */
  info: EntranceInfo | null;
  /** Laid on no stairs or other mouth of the plateau, with a drop under it. */
  valid: boolean;
}

/**
 * The cave mouth a click at `point` would make with the Opening style: on the nearest cliff edge
 * within reach, as stairs snap (`stairSpanAt`), `width(plateau)` whole cells wide. `ignore` is a
 * mouth of the same plateau being moved. Null off every cliff edge.
 */
export function entranceSpanAt(
  layer: Pick<DungeonLayer, 'children' | 'rockLines'>,
  point: Vec,
  width: (plateau: PlateauChild) => number,
  ignore?: string,
): EntrancePlan | null {
  const hit = spanAt(layer, point, width, (p) => edgeOf(p) === 'cliff');
  if (!hit) return null;
  const { owner, span } = hit;
  const overlaps = occupied(owner, ignore).some((s) => s.ring === span.ring && s.from < span.to - EPS && s.to > span.from + EPS);
  const others = (owner.entrances ?? []).filter((s) => s.id !== ignore);
  const probe = { ...owner, entrances: [...others, { ...span, id: '\u0000plan' }] } as PlateauChild;
  const info = layerPlateaus({ children: layer.children.map((c) => (c === owner ? probe : c)) }).entrances.find((e) => e.span.id === '\u0000plan') ?? null;
  return { plateau: owner, span, info, valid: !hit.corner && !overlaps && info !== null };
}

/** How near a cave mouth's span, across the edge, a point picks it, cells. */
const MOUTH_PICK = 0.6;

/** The cave mouth under `point`: within reach of its span's line. */
export function entranceAt(layer: Pick<DungeonLayer, 'children'>, point: Vec): { plateau: PlateauChild; span: CliffEntrance } | null {
  if (!layer.children.some((c) => c.childType === 'plateau' && (c.entrances?.length ?? 0) > 0)) return null;
  for (const e of layerPlateaus(layer).entrances) {
    const [a, b] = [e.line[0], e.line[e.line.length - 1]];
    const w = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (w < EPS) continue;
    const u: Vec = [(b[0] - a[0]) / w, (b[1] - a[1]) / w];
    const rel: Vec = [point[0] - a[0], point[1] - a[1]];
    const along = rel[0] * u[0] + rel[1] * u[1];
    const across = Math.abs(rel[0] * u[1] - rel[1] * u[0]);
    if (along >= 0 && along <= w && across <= MOUTH_PICK) return { plateau: e.plateau, span: e.span };
  }
  return null;
}

/** The outline a picked cave mouth is shown by: its span, MOUTH_PICK either side of the edge. */
export function entranceFootprint(e: Pick<EntranceInfo, 'line'>): Polygon {
  const [a, b] = [e.line[0], e.line[e.line.length - 1]];
  const w = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const n: Vec = [((b[1] - a[1]) / w) * MOUTH_PICK, (-(b[0] - a[0]) / w) * MOUTH_PICK];
  return [
    [a[0] + n[0], a[1] + n[1]],
    [b[0] + n[0], b[1] + n[1]],
    [b[0] - n[0], b[1] - n[1]],
    [a[0] - n[0], a[1] - n[1]],
  ];
}

/** The stairs under `point`: on its flight, or within reach of its span's line. */
export function stairsAt(layer: Pick<DungeonLayer, 'children'> & { mergedFloor?: Polygon[] | null }, point: Vec): { plateau: PlateauChild; span: StairSpan } | null {
  for (const f of stairFlights(layer)) {
    const [a, b] = f.top;
    const w = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (w < EPS) continue;
    const u: Vec = [(b[0] - a[0]) / w, (b[1] - a[1]) / w];
    const rel: Vec = [point[0] - a[0], point[1] - a[1]];
    const along = rel[0] * u[0] + rel[1] * u[1];
    const down = rel[0] * f.down[0] + rel[1] * f.down[1];
    if (along >= 0 && along <= w && down >= -0.25 && down <= f.length) return { plateau: f.plateau, span: f.span };
  }
  return null;
}


/**
 * `span` made `width` whole cells wide, keeping its start where the edge it lies on allows (an
 * edge shorter than the width takes as many cells as it holds). Null where the wider span would
 * run onto other stairs of the plateau, or the span lies on no edge of its outline.
 */
export function resizeStairs(plateau: PlateauChild, span: StairSpan, width: number): StairSpan | null {
  return resized(plateau, span, width);
}

/** `span` (a cave mouth) made `width` whole cells wide, as `resizeStairs` makes stairs; its hollow is left to be worked out again. */
export function resizeEntrance(plateau: PlateauChild, span: CliffEntrance, width: number): CliffEntrance | null {
  const next = resized(plateau, span, width);
  if (!next) return null;
  const rest: CliffEntrance = { ...next };
  delete rest.mouth;
  return rest;
}

function resized<T extends { id: string; ring: number; from: number; to: number }>(plateau: PlateauChild, span: T, width: number): T | null {
  if ((plateau.contours[span.ring]?.length ?? 0) < 3) return null;
  const ring = shapeRing(plateau, span.ring);
  const mid = (span.from + span.to) / 2;
  let s0 = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (mid >= s0 - EPS && mid <= s0 + L + EPS) {
      const cells = Math.floor(L + EPS);
      const asked = Math.max(1, Math.round(width));
      // On a curve, the stretch round the span's middle that is that wide across (as a click lays it).
      const found = cells < asked ? arcSpan(ring, mid, asked) : null;
      const arc = found && !found.corner ? found : null;
      if (!arc && cells < 1) return null;
      const w = Math.min(cells, asked);
      const start = Math.max(0, Math.min(cells - w, Math.round(span.from - s0)));
      const next = arc ? { ...span, from: arc.from, to: arc.to } : { ...span, from: s0 + start, to: s0 + start + w };
      const overlaps = occupied(plateau, span.id).some((s) => s.ring === span.ring && s.from < next.to - EPS && s.to > next.from + EPS);
      return overlaps ? null : next;
    }
    s0 += L;
  }
  return null;
}
