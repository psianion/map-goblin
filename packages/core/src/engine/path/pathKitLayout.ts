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

/** One edge unit a kit may lay. `size` is its footprint across, cells. */
export interface EdgeUnit {
  key: string;
  weight: number;
  /** Cells to the next unit. */
  spacing: number;
  /** Most the unit turns off the tangent either way, radians. */
  jitter: number;
  size: number;
}

/** One unit laid: its centre, its turn (radians) and its footprint across (cells). */
export interface UnitPlacement {
  key: string;
  x: number;
  y: number;
  rotation: number;
  size: number;
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
 * ends, where units are dropped rather than faded.
 */
export function edgeWalk(
  rings: readonly Polygon[],
  units: readonly EdgeUnit[],
  seed: string,
  paths: readonly PathChild[] = [],
): UnitPlacement[] {
  if (units.length === 0) return [];
  const out: UnitPlacement[] = [];
  const room = new Room(Math.max(0.5, ...units.map((u) => u.size)));
  const minSpacing = Math.min(...units.map((u) => u.spacing));
  rings.forEach((ring, ri) => {
    const n = ring.length;
    if (n < 3) return;
    const cum = [0];
    for (let i = 0; i < n; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[(i + 1) % n];
      cum.push(cum[i] + Math.hypot(bx - ax, by - ay));
    }
    const total = cum[n];
    if (total < 1e-6) return;
    const rand = seededRandom(`${seed}|${ri}`);
    let seg = 0;
    const at = (s: number): { x: number; y: number; angle: number } => {
      while (seg < n - 1 && cum[seg + 1] < s) seg++;
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
      for (let k = 0; k < ROOM_TRIES && s < total; k++) {
        const p = at(s);
        const u: UnitPlacement = { key: unit.key, x: p.x, y: p.y, rotation: p.angle + turn, size: unit.size };
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
