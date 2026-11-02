// Where a path kit's pieces go. Pure: rings and centrelines in, placements out, so the renderer
// only turns placements into pooled sprites and the tests can measure every rule here.
//
// A kit's look is pieces laid by walkers, never a stroke: edge units walked along an outline,
// picked by weight from a generator seeded by the path's id (so a re-lay of the same geometry
// lays the same units), spaced by the kit, turned to the tangent with the kit's rotation
// jitter, and kept apart by a collision test.

import type { Polygon } from '../../types/geometry';
import type { PathChild } from '../../shared/types';
import { pathCentreline } from '../../geometry/pathGeometry';
import type { CaveKitPiece } from '../../assets/caveWallKit';
import { layBandRing, orientRings } from '../caveBandRenderer';
import type { WalkPlacement } from '../caveWalk';

/** One edge unit a kit may lay. `size` is its footprint across as laid, cells. */
export interface EdgeUnit {
  key: string;
  weight: number;
  /** Cells to the next unit. */
  spacing: number;
  /** Most the unit turns off the tangent either way, radians. */
  jitter: number;
  size: number;
  /** What it is laid at against its painted size; 1 when absent. */
  scale?: number;
}

/** One unit laid: its centre, its turn (radians), its footprint across (cells) and its scale. */
export interface UnitPlacement {
  key: string;
  x: number;
  y: number;
  rotation: number;
  size: number;
  scale?: number;
}

/** How a walk runs: along open lines rather than rings, and how far units stray off the line either way (cells). */
export interface WalkOptions {
  open?: boolean;
  spread?: number;
}

/** Two units may share at most this much of the smaller one's footprint. */
export const MAX_OVERLAP = 0.2;
/** Tries to find room for a unit, each a quarter spacing further on, before it is skipped. */
const ROOM_TRIES = 4;

// ─── Seeded randomness ─────────────────────────────────────

/** FNV-1a over a string. */
export function hashOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** A small seeded generator (mulberry32): the same seed gives the same sequence. */
export function seededRandom(seed: string): () => number {
  let a = hashOf(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One draw by weight. */
export function pickWeighted<T extends { weight: number }>(items: readonly T[], r: number): T {
  const total = items.reduce((s, u) => s + u.weight, 0);
  let at = r * total;
  for (const u of items) {
    at -= u.weight;
    if (at < 0) return u;
  }
  return items[items.length - 1];
}

// ─── Collision ─────────────────────────────────────────────

/** How much of the smaller footprint two units share, 0..1 (footprints as discs). */
export function unitOverlap(a: Pick<UnitPlacement, 'x' | 'y' | 'size'>, b: Pick<UnitPlacement, 'x' | 'y' | 'size'>): number {
  const r1 = a.size / 2;
  const r2 = b.size / 2;
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  if (d >= r1 + r2) return 0;
  const small = Math.min(r1, r2);
  if (d <= Math.abs(r1 - r2)) return 1;
  const lens =
    r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1)) +
    r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2)) -
    0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return lens / (Math.PI * small * small);
}

/** Placed units by grid cell, so a new one is tested only against its neighbours. */
class Room {
  private cells = new Map<string, UnitPlacement[]>();
  private cell: number;
  constructor(cell: number) {
    this.cell = cell;
  }
  private key(i: number, j: number): string {
    return `${i},${j}`;
  }
  fits(u: UnitPlacement): boolean {
    const i0 = Math.floor(u.x / this.cell);
    const j0 = Math.floor(u.y / this.cell);
    for (let i = i0 - 1; i <= i0 + 1; i++) {
      for (let j = j0 - 1; j <= j0 + 1; j++) {
        for (const o of this.cells.get(this.key(i, j)) ?? []) if (unitOverlap(u, o) > MAX_OVERLAP) return false;
      }
    }
    return true;
  }
  add(u: UnitPlacement): void {
    const k = this.key(Math.floor(u.x / this.cell), Math.floor(u.y / this.cell));
    const list = this.cells.get(k);
    if (list) list.push(u);
    else this.cells.set(k, [u]);
  }
}

// ─── Ends that thin out ────────────────────────────────────

/** A fade or taper end: units within `length` of `at` are dropped, more of them nearer the end. */
interface ThinEnd {
  at: [number, number];
  length: number;
}

function thinEnds(paths: readonly PathChild[]): ThinEnd[] {
  const out: ThinEnd[] = [];
  for (const p of paths) {
    if (p.closed || p.ends.length <= 0) continue;
    const line = pathCentreline(p);
    if (line.xy.length < 2) continue;
    if (p.ends.start !== 'cut') out.push({ at: line.xy[0], length: p.ends.length });
    if (p.ends.end !== 'cut') out.push({ at: line.xy[line.xy.length - 1], length: p.ends.length });
  }
  return out;
}

/**
 * Whether a unit at (x, y) survives the thinning ends: kept with a chance that grows from 0 at
 * the end to 1 at `length` from it. The draw is hashed from the position, so dropping one unit
 * never reshuffles another.
 */
export function survivesEnds(ends: readonly ThinEnd[], seed: string, x: number, y: number): boolean {
  for (const e of ends) {
    const d = Math.hypot(x - e.at[0], y - e.at[1]);
    if (d >= e.length) continue;
    const r = hashOf(`${seed}|${Math.round(x * 1000)}|${Math.round(y * 1000)}`) / 4294967296;
    if (r >= d / e.length) return false;
  }
  return true;
}

// ─── The edge walk ─────────────────────────────────────────

/**
 * Edge units along every ring of an outline (a path group's union: both sides of a road, a
 * lake's shore, a moat's two banks). Each ring is walked from its first vertex: a unit picked
 * by weight, set on the line turned to the tangent plus up to its jitter, then the walk moves
 * on by the unit's spacing (±15 %). A unit that would overlap one already laid by more than
 * MAX_OVERLAP tries a little further on, then is skipped. `paths` gives the fade and taper
 * ends, where units are dropped rather than faded. With `open` each line is walked end to end
 * and not closed; with `spread` each unit is pushed off the line by up to that much either way.
 */
export function edgeWalk(
  rings: readonly Polygon[],
  units: readonly EdgeUnit[],
  seed: string,
  paths: readonly PathChild[] = [],
  options: WalkOptions = {},
): UnitPlacement[] {
  if (units.length === 0) return [];
  const out: UnitPlacement[] = [];
  const room = new Room(Math.max(0.5, ...units.map((u) => u.size)));
  const minSpacing = Math.min(...units.map((u) => u.spacing));
  const spread = options.spread ?? 0;
  rings.forEach((ring, ri) => {
    const n = ring.length;
    if (n < (options.open ? 2 : 3)) return;
    // An open line has one segment fewer: no closing segment back to its start.
    const segs = options.open ? n - 1 : n;
    const cum = [0];
    for (let i = 0; i < segs; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[(i + 1) % n];
      cum.push(cum[i] + Math.hypot(bx - ax, by - ay));
    }
    const total = cum[segs];
    if (total < 1e-6) return;
    const rand = seededRandom(`${seed}|${ri}`);
    let seg = 0;
    const at = (s: number): { x: number; y: number; angle: number } => {
      while (seg < segs - 1 && cum[seg + 1] < s) seg++;
      const [ax, ay] = ring[seg];
      const [bx, by] = ring[(seg + 1) % n];
      const len = cum[seg + 1] - cum[seg] || 1;
      const t = Math.max(0, Math.min(1, (s - cum[seg]) / len));
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, angle: Math.atan2(by - ay, bx - ax) };
    };
    let s = rand() * minSpacing;
    while (s < total) {
      const unit = pickWeighted(units, rand());
      const turn = (rand() * 2 - 1) * unit.jitter;
      const off = spread > 0 ? (rand() * 2 - 1) * spread : 0;
      for (let k = 0; k < ROOM_TRIES && s < total; k++) {
        const p = at(s);
        const u: UnitPlacement = {
          key: unit.key,
          x: p.x - Math.sin(p.angle) * off,
          y: p.y + Math.cos(p.angle) * off,
          rotation: p.angle + turn,
          size: unit.size,
          scale: unit.scale ?? 1,
        };
        if (room.fits(u)) {
          room.add(u);
          out.push(u);
          break;
        }
        s += unit.spacing / ROOM_TRIES;
      }
      s += unit.spacing * (0.85 + 0.3 * rand());
    }
  });
  const ends = thinEnds(paths);
  return ends.length === 0 ? out : out.filter((u) => survivesEnds(ends, seed, u.x, u.y));
}

// ─── Planks: the cross walk, rails and ends ────────────────

/** One plank a planks kit may lay: its painted length (across the path) and thickness, cells. */
export interface PlankUnit {
  key: string;
  weight: number;
  length: number;
  thickness: number;
}

/** What a planks kit lays: planks, a rail post, an end piece (its painted width, cells). */
export interface PlanksKit {
  cross: PlankUnit[];
  post?: string;
  end?: { key: string; length: number };
}

/** A piece laid at `scale` times its authored size. */
export interface PiecePlacement {
  key: string;
  x: number;
  y: number;
  rotation: number;
  scale: number;
}

export interface PlanksLayout {
  planks: PiecePlacement[];
  posts: PiecePlacement[];
  /** A rope from post to post, along each edge. */
  ropes: [[number, number], [number, number]][];
  ends: PiecePlacement[];
}

/** Rail posts stand this far apart along the path, cells. */
export const POST_SPACING = 2;
/** A post is laid at this share of its tile: the art is a post top a cell across. */
export const POST_SCALE = 0.5;
/** Each plank laps the last by this share of its thickness, so no light shows between them. */
const PLANK_LAP = 0.1;
/** Narrower than this a plank is not laid (the very tip of a taper). */
const MIN_PLANK = 0.25;

interface LineAt {
  x: number;
  y: number;
  /** Unit tangent. */
  tx: number;
  ty: number;
  width: number;
}

/** A sampler along a path's centreline by arc length. */
function lineSampler(path: PathChild): { length: number; at: (s: number) => LineAt } | null {
  const line = pathCentreline(path);
  const { xy, arc, width } = line;
  if (xy.length < 2 || line.length <= 0) return null;
  return {
    length: line.length,
    at: (s) => {
      let lo = 1;
      let hi = arc.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arc[mid] < s) lo = mid + 1;
        else hi = mid;
      }
      const i = lo;
      const a = xy[i - 1];
      const b = xy[i];
      const span = arc[i] - arc[i - 1] || 1;
      const t = Math.max(0, Math.min(1, (s - arc[i - 1]) / span));
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return {
        x: a[0] + (b[0] - a[0]) * t,
        y: a[1] + (b[1] - a[1]) * t,
        tx: (b[0] - a[0]) / len,
        ty: (b[1] - a[1]) / len,
        width: width[i - 1] + (width[i] - width[i - 1]) * t,
      };
    },
  };
}

/**
 * A planks path (a bridge, a dock): planks laid across the centreline from end to end, each
 * picked by weight (seeded by the path id), turned square to the tangent and scaled so its
 * length is the path's width there; each laps the last a little, and round a bend the step
 * shortens until the outer ends still touch. Rail posts stand on both edges every
 * POST_SPACING with a rope between neighbours, and end pieces sit across each cut end. A fade
 * or taper end drops planks and posts toward the end instead of fading them.
 */
export function layPlanks(path: PathChild, kit: PlanksKit, seed: string): PlanksLayout {
  const out: PlanksLayout = { planks: [], posts: [], ropes: [], ends: [] };
  const line = lineSampler(path);
  if (!line || kit.cross.length === 0) return out;
  const ends = thinEnds([path]);
  const keep = (x: number, y: number) => survivesEnds(ends, seed, x, y);
  const rand = seededRandom(seed);
  const L = line.length;

  // Planks, centre to centre. Each next plank is picked before the step, so the step is half
  // of both thicknesses less the lap.
  const edgesAt = (p: LineAt): [number, number][] => [
    [p.x - p.ty * (p.width / 2), p.y + p.tx * (p.width / 2)],
    [p.x + p.ty * (p.width / 2), p.y - p.tx * (p.width / 2)],
  ];
  const thicknessAt = (plank: PlankUnit, s: number) => (plank.thickness * line.at(s).width) / plank.length;
  let plank = pickWeighted(kit.cross, rand());
  let s = Math.min(L, thicknessAt(plank, 0) / 2);
  for (;;) {
    const c = line.at(s);
    const t = (plank.thickness * c.width) / plank.length;
    if (c.width >= MIN_PLANK && keep(c.x, c.y)) {
      out.planks.push({ key: plank.key, x: c.x, y: c.y, rotation: Math.atan2(c.ty, c.tx) + Math.PI / 2, scale: c.width / plank.length });
    }
    if (s + t / 2 >= L - 1e-9) break;
    const next = pickWeighted(kit.cross, rand());
    const tn = Math.max(thicknessAt(next, s), MIN_PLANK * 0.1);
    const reach = ((Math.max(t, MIN_PLANK * 0.1) + tn) / 2) * (1 - PLANK_LAP);
    let step = reach;
    // Round a bend the outer edge runs longer than the centreline: shorten the step until the
    // next plank's ends are no further from this one's than the centres are.
    for (let k = 0; k < 3; k++) {
      const [a0, a1] = edgesAt(c);
      const [b0, b1] = edgesAt(line.at(Math.min(L, s + step)));
      const outer = Math.max(Math.hypot(b0[0] - a0[0], b0[1] - a0[1]), Math.hypot(b1[0] - a1[0], b1[1] - a1[1]));
      if (outer <= reach + 1e-9) break;
      step *= reach / outer;
    }
    // The last plank lies flush with the end rather than past it.
    s = Math.min(s + step, Math.max(s + 1e-6, L - tn / 2));
    plank = next;
  }

  // Rails: posts on both edges, evenly spread so one stands at each end.
  if (kit.post) {
    const n = Math.max(1, Math.round(L / POST_SPACING));
    for (const side of [1, -1]) {
      let last: [number, number] | null = null;
      for (let k = 0; k <= n; k++) {
        const p = line.at((k * L) / n);
        const x = p.x - p.ty * (p.width / 2) * side;
        const y = p.y + p.tx * (p.width / 2) * side;
        if (!keep(x, y)) {
          last = null;
          continue;
        }
        out.posts.push({ key: kit.post, x, y, rotation: Math.atan2(p.ty, p.tx), scale: POST_SCALE });
        if (last) out.ropes.push([last, [x, y]]);
        last = [x, y];
      }
    }
  }

  // End pieces across each cut end, side by side, boards running along the path.
  if (kit.end && !path.closed) {
    const end = kit.end;
    for (const [kind, s0] of [
      [path.ends.start, 0],
      [path.ends.end, L],
    ] as const) {
      if (kind !== 'cut') continue;
      const p = line.at(s0);
      const count = Math.max(1, Math.round(p.width / end.length));
      const each = p.width / count;
      for (let k = 0; k < count; k++) {
        const off = -p.width / 2 + each * (k + 0.5);
        out.ends.push({
          key: end.key,
          x: p.x - p.ty * off,
          y: p.y + p.tx * off,
          rotation: Math.atan2(p.ty, p.tx) - Math.PI / 2,
          scale: each / end.length,
        });
      }
    }
  }
  return out;
}

// ─── Bands: a water bank ───────────────────────────────────

/** A band kit's straight: its key and painted length, cells. */
export interface BandStraight {
  key: string;
  length: number;
}

/**
 * The cave walk's pieces for a band kit's straights: each a straight with its joints at the two
 * ends of its painted length, on its midline. The kit ships no bends; where the walk turns, the
 * ground strip drawn in the straight's colour under the pieces covers the joint.
 */
export function bankPieces(straights: readonly BandStraight[]): CaveKitPiece[] {
  return straights.map((s) => ({
    key: s.key,
    jointsCells: [
      [-s.length / 2, 0],
      [s.length / 2, 0],
    ],
    chordCells: s.length,
    turnDeg: 0,
  }));
}

/**
 * A bank laid round every ring of a water outline by the cave walk, with the water as the
 * floor and the land as the void: per ring, in ring order, the ring wound the way the walk
 * laid it (void on its left) and the placements.
 */
export function layBank(rings: readonly Polygon[], pieces: CaveKitPiece[]): { ring: Polygon; placed: WalkPlacement[] }[] {
  return orientRings([...rings]).map((ring) => ({ ring, placed: pieces.length === 0 ? [] : layBandRing(ring, [], pieces) }));
}
