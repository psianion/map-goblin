// A drawn wall on a cave band layer: which stretches a banded floor ring
// already carries (no second row of rock beside the ring's), and which side of
// the line is void, read from where the floor is rather than from the hand
// that drew it.
import { describe, it, expect } from 'vitest';
import { layBandChain, orientRings, planDrawnBand, ringCoincidences, type BandRingRef } from './caveBandRenderer';
import type { Polygon } from '../types/geometry';
import type { Vec } from './caveWalk';
import type { DoorGap } from './wallNodeRenderer';

const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
/** The Fieldstone Keep's merged floor: the rooms' block plus the courtyard below its west half. */
const KEEP: Polygon = [
  [2, 2],
  [58, 2],
  [58, 43],
  [26, 43],
  [26, 58],
  [2, 58],
];
const ringsOf = (polys: Polygon[]): BandRingRef[] => orientRings(polys).map((poly, ring) => ({ ring, poly }));
const keepRings = ringsOf([KEEP]);
const reversed = (p: Polygon): Polygon => [...p].reverse();
const area = (p: Polygon): number =>
  p.reduce((s, [x, y], i) => s + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0) / 2;
/** The void side of an open run as laid: left of travel, (t.y, -t.x) in y-down. */
const voidNormal = (run: Polygon): Vec => {
  const a = run[0];
  const b = run[run.length - 1];
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l];
};

describe('ringCoincidences', () => {
  it('finds a wall lying along a ring edge, across the edge split points', () => {
    const hits = ringCoincidences([[2, 2], [2, 43]], keepRings);
    expect(hits.length).toBeGreaterThan(0);
    expect(Math.min(...hits.map((h) => h.from))).toBeCloseTo(0);
    expect(Math.max(...hits.map((h) => h.to))).toBeCloseTo(41);
    expect(hits.every((h) => h.ring === 0)).toBe(true);
  });

  it('takes a line within the tolerance, not one a band width off', () => {
    expect(ringCoincidences([[2.1, 5], [2.1, 20]], keepRings).length).toBe(1);
    expect(ringCoincidences([[2.6, 5], [2.6, 20]], keepRings)).toEqual([]);
  });

  it('ignores a wall that only meets the edge end on, or crosses it', () => {
    expect(ringCoincidences([[17, 2], [17, 13]], keepRings)).toEqual([]);
    expect(ringCoincidences([[0, 10], [5, 12]], keepRings)).toEqual([]);
  });

  it('finds only the shared part of a wall that runs on past a ring corner', () => {
    const hits = ringCoincidences([[9, 43], [58, 43]], keepRings);
    expect(hits.length).toBe(1);
    expect(hits[0].from).toBeCloseTo(17);
    expect(hits[0].to).toBeCloseTo(49);
  });
});

describe('planDrawnBand: shared edges', () => {
  it('leaves a wall drawn exactly on the ring edge to the ring', () => {
    expect(planDrawnBand([[2, 2], [2, 43]], [KEEP], keepRings).runs).toEqual([]);
    expect(planDrawnBand([[2, 2], [58, 2]], [KEEP], keepRings).runs).toEqual([]);
  });

  it('keeps the stretch past the ring corner, ending where the ring takes over', () => {
    const { runs } = planDrawnBand([[9, 43], [58, 43]], [KEEP], keepRings);
    expect(runs.length).toBe(1);
    const xs = runs[0].points.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(9);
    expect(Math.max(...xs)).toBeCloseTo(26.4);
    // floor both sides of the kept stretch: the divider's side, not the run-on's
    expect(voidNormal(runs[0].points)[1]).toBeCloseTo(-1);
    // no gap and no overlap at the hand-over
    expect(layBandChain(runs[0].points).length).toBeGreaterThan(0);
  });

  it('hands a door on a shared stretch to the ring, and keeps one off it', () => {
    const gaps: DoorGap[] = [
      { wallId: 'w', position: [40, 43], width: 2 },
      { wallId: 'w', position: [15, 43], width: 2 },
    ];
    const { ringGaps } = planDrawnBand([[9, 43], [58, 43]], [KEEP], keepRings, gaps);
    expect(ringGaps).toEqual([{ wallId: 'w', position: [40, 43], width: 2, ring: 0 }]);
  });

  it('keeps the whole wall when no ring carries a band', () => {
    const { runs } = planDrawnBand([[2, 2], [2, 43]], [KEEP], []);
    expect(runs.length).toBe(1);
    expect(runs[0].points.length).toBe(2);
  });

  it('splits a loop that shares one side with a ring into the open rest', () => {
    const loop: Polygon = [[2, 10], [8, 10], [8, 20], [2, 20], [2, 10]];
    const { runs } = planDrawnBand(loop, [KEEP], keepRings);
    expect(runs.length).toBeGreaterThan(0);
    for (const r of runs) {
      expect(r.closed).toBe(false);
      // along x = 2 only the short run-on into the ring's stretch
      for (let i = 0; i + 1 < r.points.length; i++) {
        const [a, b] = [r.points[i], r.points[i + 1]];
        if (Math.abs(a[0] - 2) < 1e-6 && Math.abs(b[0] - 2) < 1e-6) {
          expect(Math.abs(b[1] - a[1])).toBeLessThanOrEqual(0.4 + 1e-9);
        }
      }
    }
  });
});

describe('planDrawnBand: which side is void', () => {
  const room = rect(0, 0, 10, 10);

  it('puts the void away from the floor whichever way the wall was drawn', () => {
    for (const line of [
      [[10.4, 1], [10.4, 9]],
      [[10.4, 9], [10.4, 1]],
    ] as Polygon[]) {
      const { runs } = planDrawnBand(line, [room], []);
      expect(runs.length).toBe(1);
      expect(voidNormal(runs[0].points)[0]).toBeCloseTo(1);
    }
  });

  it('lays the same rock for a wall drawn in either direction', () => {
    for (const line of [
      [[10.4, 1], [10.4, 9]],
      [[3, 5], [8, 5]],
      [[-2, -1], [7, 13]],
      [[1, 2], [6, 2], [6, 8]],
    ] as Polygon[]) {
      const a = planDrawnBand(line, [room], []);
      const b = planDrawnBand(reversed(line), [room], []);
      expect(b).toEqual(a);
      expect(a.runs.flatMap((r) => layBandChain(r.points))).toEqual(b.runs.flatMap((r) => layBandChain(r.points)));
    }
  });

  it('gives a divider with floor on both sides, or a wall in the open, the void to the top left', () => {
    const vertical = planDrawnBand([[5, 1], [5, 9]], [room], []).runs[0].points;
    expect(voidNormal(vertical)[0]).toBeCloseTo(-1);
    const horizontal = planDrawnBand([[9, 5], [1, 5]], [room], []).runs[0].points;
    expect(voidNormal(horizontal)[1]).toBeCloseTo(-1);
    const open = planDrawnBand([[30, 30], [30, 40]], [room], []).runs[0].points;
    expect(voidNormal(open)[0]).toBeCloseTo(-1);
  });

  it('turns the band where the floor changes sides along the wall', () => {
    const other = rect(10.8, 10, 20, 20);
    const { runs } = planDrawnBand([[10.4, 0.5], [10.4, 19.5]], [room, other], []);
    expect(runs.length).toBe(2);
    const sides = runs.map((r) => {
      const ys = r.points.map((p) => p[1]);
      return { y: (Math.min(...ys) + Math.max(...ys)) / 2, vx: voidNormal(r.points)[0] };
    });
    sides.sort((p, q) => p.y - q.y);
    expect(sides[0].vx).toBeCloseTo(1); // beside the first room: void east
    expect(sides[1].vx).toBeCloseTo(-1); // beside the second: void west
  });

  it('keeps one side for a wall that runs on off the end of its floor', () => {
    const { runs } = planDrawnBand([[10.4, 2], [10.4, 15]], [room], []);
    expect(runs.length).toBe(1);
    expect(voidNormal(runs[0].points)[0]).toBeCloseTo(1);
  });

  it('stands a loop drawn inside a room as a pillar: void inside', () => {
    const pillar: Polygon = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
    for (const loop of [pillar, reversed(pillar)]) {
      const { runs } = planDrawnBand(loop, [room], []);
      expect(runs.length).toBe(1);
      expect(runs[0].closed).toBe(true);
      expect(area(runs[0].points)).toBeLessThan(0);
    }
  });

  it('rings a loop drawn round a floor with the void outside', () => {
    const { runs } = planDrawnBand([[-0.4, -0.4], [10.4, -0.4], [10.4, 10.4], [-0.4, 10.4], [-0.4, -0.4]], [room], []);
    expect(area(runs[0].points)).toBeGreaterThan(0);
  });
});
