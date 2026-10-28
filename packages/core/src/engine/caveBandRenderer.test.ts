// The live band: what the renderer lays along a ring or a drawn run before a
// single sprite exists. Placement comes from caveWalk.ts, which has its own
// tests; what is checkable here is the part this module adds — the ring's
// handedness, the cut a door makes, and a free-ended run.
import { describe, it, expect } from 'vitest';
import { caveBandPieces, jointsOf } from '../assets/caveWallKit';
import { bandRide, layBandChain, layBandRing, orientRings, sharpCorners } from './caveBandRenderer';
import { resampleClosed, walkClosed } from './caveWalk';
import type { WalkPlacement, Vec } from './caveWalk';
import type { Polygon } from '../types/geometry';
import type { DoorGap } from './wallNodeRenderer';

const dist = (a: Vec, b: Vec): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** A ring wound with positive signed area — floor on the right, the way an outer ring is. */
const circle = (r: number, n = 64, cx = 0, cy = 0): Polygon =>
  Array.from({ length: n }, (_, i): [number, number] => {
    const a = (i / n) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });

/** Largest seam between consecutive pieces, on the joints they actually landed on. */
function worstSeam(placed: WalkPlacement[], ring: boolean): number {
  let worst = 0;
  for (let k = 0; k < placed.length - (ring ? 0 : 1); k++) {
    const a = placed[k];
    const b = placed[(k + 1) % placed.length];
    worst = Math.max(worst, dist(jointsOf(a.piece, a.at)[1], jointsOf(b.piece, b.at)[0]));
  }
  return worst;
}

describe('orientRings', () => {
  it('winds an outer ring positive and a hole inside it negative', () => {
    const outer = circle(8).reverse();
    const hole = circle(2);
    const [o, h] = orientRings([outer, hole]);
    const area = (p: Polygon): number =>
      p.reduce((s, [x, y], i) => s + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0) / 2;
    expect(area(o)).toBeGreaterThan(0);
    expect(area(h)).toBeLessThan(0);
  });
});

describe('layBandRing', () => {
  it('closes a ring with the seams inside the walk gate', () => {
    const placed = layBandRing(circle(7));
    expect(placed.length).toBeGreaterThan(4);
    expect(worstSeam(placed, true)).toBeLessThanOrEqual(0.9);
  });

  it('lays the same ring whichever way its points were listed, once oriented', () => {
    const [flipped] = orientRings([circle(7).reverse()]);
    expect(layBandRing(flipped).length).toBe(layBandRing(circle(7)).length);
  });

  it('stops the rock at a door on the ring', () => {
    const ring = circle(7);
    const gap: DoorGap = { wallId: 'floor:0:0', position: [7, 0], width: 1.5, ring: 0 };
    const placed = layBandRing(ring, [gap]);
    expect(placed.length).toBeGreaterThan(4);
    // Nothing laid may reach into the opening: every joint stays clear of the
    // door by its half width.
    for (const pl of placed) {
      for (const j of jointsOf(pl.piece, pl.at)) {
        expect(dist(j, gap.position)).toBeGreaterThan(0.75);
      }
    }
    // One cut, so the run is open: its two ends are the pieces beside the door.
    expect(worstSeam(placed, false)).toBeLessThanOrEqual(0.9);
  });

  it('ignores a door that is not on this ring', () => {
    const ring = circle(7);
    const elsewhere: DoorGap = { wallId: 'w9', position: [30, 30], width: 1 };
    expect(layBandRing(ring, [elsewhere]).length).toBe(layBandRing(ring).length);
  });
});

describe('layBandChain', () => {
  it('lays an open run end to end with a piece closed onto each tip', () => {
    const run: Polygon = [[0, 0], [6, 0], [12, 3], [18, 3]];
    const placed = layBandChain(run);
    expect(placed.length).toBeGreaterThan(2);
    expect(worstSeam(placed, false)).toBeLessThanOrEqual(0.9);
    const first = jointsOf(placed[0].piece, placed[0].at)[0];
    const last = jointsOf(placed[placed.length - 1].piece, placed[placed.length - 1].at)[1];
    // The band rides BAND_OUT off the drawn line; the ends land near the tips.
    expect(dist(first, [0, 0])).toBeLessThan(1);
    expect(dist(last, [18, 3])).toBeLessThan(1);
  });

  it('draws nothing for a run too short for the smallest stone', () => {
    expect(layBandChain([[0, 0], [0.5, 0]])).toEqual([]);
  });

  it('uses only pieces the kit offers', () => {
    const keys = new Set(caveBandPieces().map((p) => p.key));
    for (const pl of layBandChain([[0, 0], [10, 0]])) expect(keys.has(pl.piece.key)).toBe(true);
  });
});

/** Distance from a point to the segment a-b. */
function segDist(p: Vec, a: Vec, b: Vec): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

describe('sharp floor tips', () => {
  // A spike of floor whose tip turns 150°: no kit bend turns that hard.
  const spike: Polygon = [[0, 0], [8, 1], [0, 3]];

  it('finds the tip sharper than any bend, and no corner on a rectangle', () => {
    const [oriented] = orientRings([spike]);
    const base = resampleClosed(oriented as Vec[], 0.1);
    const tips = sharpCorners(base, true).map((i) => base[i]);
    expect(tips.some((p) => dist(p, [8, 1]) < 0.3)).toBe(true);
    const rect = resampleClosed([[0, 0], [6, 0], [6, 4], [0, 4]], 0.1);
    expect(sharpCorners(rect, true)).toEqual([]);
  });

  it('lays rock over the tip instead of cutting across short of it', () => {
    const [oriented] = orientRings([spike]);
    const placed = layBandRing(oriented);
    // Each piece runs between its two joints; the rock straddles that line, so
    // a tip within a few tenths of one is under stone. The rounded ride used to
    // leave it 0.6 cells out in the open.
    const reach = Math.min(...placed.map((pl) => segDist([8, 1], pl.P, pl.Q)));
    expect(reach).toBeLessThan(0.4);
  });

  it('splits a drawn run at a hairpin into runs that each get rock', () => {
    const placed = layBandChain([[0, 0], [6, 0], [0, 1.5]]);
    expect(placed.length).toBeGreaterThanOrEqual(3);
    const reach = Math.min(...placed.map((pl) => segDist([6, 0], pl.P, pl.Q)));
    expect(reach).toBeLessThan(0.5);
  });
});

describe('holes', () => {
  const outer: Polygon = [[0, 0], [12, 0], [12, 8], [0, 8]];
  const hole: Polygon = [[4, 3], [4, 5.5], [8, 5.5], [8, 3]];

  it('turns a small rectangular hole with outside bends, not straights laid across it', () => {
    // The erased-hole case: 4 x 2.5 cells. The walk used to fall back to
    // straights here and close the ring as an oval blob in the hole's middle.
    const [, h] = orientRings([outer, hole]);
    const placed = layBandRing(h);
    expect(placed.some((pl) => pl.branch === 'fallback')).toBe(false);
    expect(placed.filter((pl) => pl.piece.key.startsWith('outside_bend')).length).toBeGreaterThanOrEqual(3);
    expect(placed.some((pl) => pl.piece.key.startsWith('inside_bend'))).toBe(false);
  });

  it('rides a hole on the void side of its outline, close to it all the way round', () => {
    const [, h] = orientRings([outer, hole]);
    const ride = bandRide(resampleClosed(h as Vec[], 0.1), true);
    const edge = (p: Vec): number =>
      Math.min(...hole.map((a, i) => segDist(p, a as Vec, hole[(i + 1) % hole.length] as Vec)));
    const inside = (p: Vec): boolean => p[0] > 4 && p[0] < 8 && p[1] > 3 && p[1] < 5.5;
    for (const p of ride) {
      expect(inside(p)).toBe(true);
      expect(edge(p)).toBeLessThan(0.5);
    }
  });
});

describe('a plain ring or run', () => {
  // Nothing sharp, nothing turning toward the void: the band must lay exactly
  // what it laid before the tip and hole work, every straight run and bend in
  // the same place, with only a ring's closing piece allowed to overlap more.
  const plain = (r: Polygon): WalkPlacement[] =>
    walkClosed(bandRide(resampleClosed(r as Vec[], 0.1), true), caveBandPieces()).placed;
  const same = (a: WalkPlacement, b: WalkPlacement): boolean =>
    a.piece.key === b.piece.key && dist(a.P, b.P) < 1e-9 && dist(a.Q, b.Q) < 1e-9;

  it('keeps the piece count and every walked piece of a rectangle', () => {
    for (const r of [
      [[0, 0], [12, 0], [12, 8], [0, 8]],
      [[0, 0], [4, 0], [4, 4], [0, 4]],
      [[-6.8, -5.2], [6.8, -5.2], [6.8, 5.2], [-6.8, 5.2]],
    ] as Polygon[]) {
      const [o] = orientRings([r]);
      const before = plain(o);
      const now = layBandRing(o);
      expect(now.length).toBe(before.length);
      now.forEach((pl, k) => {
        if (!pl.branch.startsWith('close')) expect(same(pl, before[k])).toBe(true);
      });
    }
  });

  it('lays a straight drawn run with the plain walk', () => {
    for (const len of [3, 5, 7.5]) {
      const now = layBandChain([[0, 0], [len, 0]]);
      expect(now.length).toBeGreaterThan(0);
      for (const pl of now) expect(pl.at.scale).toBeGreaterThan(0.85);
    }
  });
});
