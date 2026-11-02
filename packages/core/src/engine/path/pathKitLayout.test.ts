import { describe, it, expect, beforeAll } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../../geometry/Clipper2Engine';
import { groupOutline } from '../pathRenderer';
import { bankPieces, edgeWalk, layBank, layPlanks, unitOverlap, POST_SPACING, type EdgeUnit, type PlanksKit, type UnitPlacement } from './pathKitLayout';
import { bandHoles } from '../caveWalk';
import type { PathChild } from '../../shared/types';
import type { Polygon } from '../../types/geometry';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

const road = (id: string, points: { x: number; y: number }[], over: Partial<PathChild> = {}): PathChild => ({
  id,
  name: id,
  childType: 'path',
  visible: true,
  points,
  closed: false,
  width: 2,
  heightMode: 'ground',
  materialId: 'gg-forge:road-dirt',
  tint: '#ffffff',
  opacity: 1,
  offset: 0,
  flip: false,
  edge: 'soft',
  ends: { start: 'cut', end: 'cut', length: 1.5 },
  sort: 'under',
  ...over,
});

/** The road-dirt kit's edge units as the pack ships them, each a one-cell footprint. */
const DIRT: EdgeUnit[] = [
  { key: 'tuft-A', weight: 2, spacing: 1, jitter: 0.5, size: 0.9 },
  { key: 'tuft-B', weight: 2, spacing: 1, jitter: 0.5, size: 0.9 },
  { key: 'pebbles-A', weight: 3, spacing: 0.7, jitter: Math.PI, size: 0.9 },
  { key: 'pebbles-B', weight: 3, spacing: 0.7, jitter: Math.PI, size: 0.9 },
  { key: 'puddle-A', weight: 0.5, spacing: 2.5, jitter: Math.PI, size: 0.9 },
];

/** Distance from a point to the nearest edge of any ring. */
function toOutline(rings: Polygon[], x: number, y: number): number {
  let best = Infinity;
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const [ax, ay] = r[i];
      const [bx, by] = r[(i + 1) % r.length];
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(x - ax - dx * u, y - ay - dy * u));
    }
  }
  return best;
}

/** The worst overlap between any two placed units, as a share of the smaller one's area. */
function worstOverlap(placed: UnitPlacement[]): number {
  let worst = 0;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) worst = Math.max(worst, unitOverlap(placed[i], placed[j]));
  }
  return worst;
}

const cross = () => [road('a', [{ x: -8, y: 0 }, { x: 8, y: 0 }]), road('b', [{ x: 0, y: -8 }, { x: 0, y: 8 }])];

describe('edgeWalk', () => {
  it('lays units on the outline, turned to its tangent within the unit’s jitter', () => {
    const rings = groupOutline([road('a', [{ x: -8, y: 0 }, { x: 8, y: 0 }])]);
    const placed = edgeWalk(rings, DIRT, 'a');
    expect(placed.length).toBeGreaterThan(20);
    for (const p of placed) expect(toOutline(rings, p.x, p.y)).toBeLessThan(1e-6);
    // Along the long straight sides (y = ±1) the tangent is ±x: a tuft (jitter 0.5) sits within 0.5 of it.
    const tufts = placed.filter((p) => p.key.startsWith('tuft') && Math.abs(Math.abs(p.y) - 1) < 1e-6 && Math.abs(p.x) < 6);
    expect(tufts.length).toBeGreaterThan(2);
    for (const t of tufts) {
      const off = Math.abs(Math.atan2(Math.sin(t.rotation), Math.cos(t.rotation)));
      expect(Math.min(off, Math.PI - off)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
    // Both sides of the road carry units.
    expect(placed.some((p) => p.y > 0.99)).toBe(true);
    expect(placed.some((p) => p.y < -0.99)).toBe(true);
  });

  it('picks by weight, seeded by the path id: the same id lays the same units, another id others', () => {
    const rings = groupOutline([road('a', [{ x: -20, y: 0 }, { x: 20, y: 0 }])]);
    const once = edgeWalk(rings, DIRT, 'a');
    expect(edgeWalk(rings, DIRT, 'a')).toEqual(once);
    expect(edgeWalk(rings, DIRT, 'b')).not.toEqual(once);
    const count = (k: string) => once.filter((p) => p.key.startsWith(k)).length;
    // Pebbles weigh 6 of 10.5, puddles 0.5: the heavy ones are laid far more often.
    expect(count('pebbles')).toBeGreaterThan(count('puddle'));
  });

  it('never lets two units overlap by more than 20 % of their area', () => {
    const rings = groupOutline(cross());
    const placed = edgeWalk(rings, DIRT, 'a');
    expect(placed.length).toBeGreaterThan(40);
    expect(worstOverlap(placed)).toBeLessThanOrEqual(0.2);
  });

  it('borders two crossing roads with one continuous run of units and none inside the junction', () => {
    const rings = groupOutline(cross());
    expect(rings).toHaveLength(1);
    const placed = edgeWalk(rings, DIRT, 'a');
    // No unit sits where either road's own outline ran inside the other: the seam is gone.
    for (const p of placed) {
      const inA = Math.abs(p.y) < 1 - 1e-6 && Math.abs(p.x) < 8;
      const inB = Math.abs(p.x) < 1 - 1e-6 && Math.abs(p.y) < 8;
      expect(inA || inB, `unit at ${p.x.toFixed(2)}, ${p.y.toFixed(2)}`).toBe(false);
    }
    // Round the inside corners of the junction, units keep coming: no stretch of border bare
    // for longer than the longest spacing and a collision retry.
    for (const [x, y] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as [number, number][]) {
      expect(placed.some((p) => Math.hypot(p.x - x, p.y - y) < 1.6), `corner ${x}, ${y}`).toBe(true);
    }
  });

  it('drops units toward a fade or taper end instead of fading them', () => {
    const line = [{ x: 0, y: 0 }, { x: 30, y: 0 }];
    const cut = road('a', line);
    const fade = road('a', line, { ends: { start: 'cut', end: 'fade', length: 6 } });
    const near = (placed: UnitPlacement[]) => placed.filter((p) => p.x > 24).length;
    const all = edgeWalk(groupOutline([cut]), DIRT, 'a');
    const dropped = edgeWalk(groupOutline([fade]), DIRT, 'a', [fade]);
    expect(near(dropped)).toBeLessThan(near(all));
    // Away from the end nothing changes.
    expect(dropped.filter((p) => p.x < 20)).toEqual(all.filter((p) => p.x < 20));
  });

  it('re-lays twenty roads in under 5 ms (median)', () => {
    const roads: PathChild[] = [];
    for (let i = 0; i < 10; i++) {
      const at = i * 3 - 15;
      roads.push(road(`h${i}`, [{ x: -20, y: at }, { x: 0, y: at + 2 }, { x: 20, y: at }]));
      roads.push(road(`v${i}`, [{ x: at, y: -20 }, { x: at + 2, y: 0 }, { x: at, y: 20 }]));
    }
    const rings = groupOutline(roads);
    const times: number[] = [];
    let units = 0;
    for (let k = 0; k < 9; k++) {
      const t0 = performance.now();
      units = edgeWalk(rings, DIRT, 'h0', roads).length;
      times.push(performance.now() - t0);
    }
    const median = times.sort((a, b) => a - b)[4];
    console.log(`20 roads: edge walk ${median.toFixed(2)} ms (median of 9), ${units} units`);
    expect(units).toBeGreaterThan(200);
    expect(median).toBeLessThan(5);
  });
});

/** The planks kit as the pack ships it: two plank shapes 1.8 x 0.5 cells, posts, a short end piece. */
const PLANKS: PlanksKit = {
  cross: [
    { key: 'plank-A', weight: 4, length: 1.8, thickness: 0.5 },
    { key: 'plank-B', weight: 4, length: 1.8, thickness: 0.45 },
    { key: 'broken-A', weight: 1, length: 1.8, thickness: 0.45 },
  ],
  post: 'post-A',
  end: { key: 'short-A', length: 0.875 },
};

const bridge = (points: { x: number; y: number; width?: number }[], over: Partial<PathChild> = {}) =>
  road('bridge', points, { materialId: 'gg-forge:planks', sort: 'overhead', ...over });

/** Where a plank's two ends are, at its laid length. */
const plankEnds = (p: { x: number; y: number; rotation: number; scale: number; key: string }) => {
  const half = ((PLANKS.cross.find((c) => c.key === p.key)!.length * p.scale) / 2);
  const dx = Math.cos(p.rotation) * half;
  const dy = Math.sin(p.rotation) * half;
  return [[p.x - dx, p.y - dy], [p.x + dx, p.y + dy]];
};
const thick = (p: { key: string; scale: number }) => PLANKS.cross.find((c) => c.key === p.key)!.thickness * p.scale;

describe('layPlanks', () => {
  it('lays planks across the centreline at the path’s width, turned square to it, end to end with no gap', () => {
    const { planks } = layPlanks(bridge([{ x: 0, y: 0 }, { x: 10, y: 0 }]), PLANKS, 'bridge');
    expect(planks.length).toBeGreaterThan(15);
    for (const p of planks) {
      // Square across a path running along x.
      expect(Math.abs(Math.cos(p.rotation))).toBeLessThan(1e-6);
      const len = PLANKS.cross.find((c) => c.key === p.key)!.length * p.scale;
      expect(len).toBeCloseTo(2, 6);
    }
    const xs = planks.map((p) => p.x);
    expect(xs[0] - thick(planks[0]) / 2).toBeLessThanOrEqual(1e-6);
    expect(xs[xs.length - 1] + thick(planks[planks.length - 1]) / 2).toBeGreaterThanOrEqual(10 - 1e-6);
    for (let i = 1; i < planks.length; i++) {
      expect(xs[i] - xs[i - 1], `gap after plank ${i - 1}`).toBeLessThanOrEqual((thick(planks[i]) + thick(planks[i - 1])) / 2 + 1e-9);
    }
    // Picked by weight, seeded by the id: the same every time, more than one plank shape.
    expect(layPlanks(bridge([{ x: 0, y: 0 }, { x: 10, y: 0 }]), PLANKS, 'bridge').planks).toEqual(planks);
    expect(new Set(planks.map((p) => p.key)).size).toBeGreaterThan(1);
  });

  it('follows the per-point width', () => {
    const { planks } = layPlanks(bridge([{ x: 0, y: 0, width: 2 }, { x: 10, y: 0, width: 3 }]), PLANKS, 'bridge');
    const len = (p: (typeof planks)[number]) => PLANKS.cross.find((c) => c.key === p.key)!.length * p.scale;
    expect(len(planks[0])).toBeLessThan(2.1);
    expect(len(planks[planks.length - 1])).toBeGreaterThan(2.9);
  });

  it('keeps the outer ends touching round a bend', () => {
    const arc = Array.from({ length: 9 }, (_, i) => {
      const a = (i / 8) * (Math.PI / 2);
      return { x: 6 * Math.cos(a), y: 6 * Math.sin(a) };
    });
    const { planks } = layPlanks(bridge(arc), PLANKS, 'bridge');
    for (let i = 1; i < planks.length; i++) {
      const [a0, a1] = plankEnds(planks[i - 1]);
      const [b0, b1] = plankEnds(planks[i]);
      const gap = Math.max(Math.hypot(a0[0] - b0[0], a0[1] - b0[1]), Math.hypot(a1[0] - b1[0], a1[1] - b1[1]));
      expect(gap, `outer gap after plank ${i - 1}`).toBeLessThanOrEqual((thick(planks[i]) + thick(planks[i - 1])) / 2 + 1e-6);
    }
  });

  it('stands rail posts on both edges at the kit spacing, a rope between each two', () => {
    const { posts, ropes } = layPlanks(bridge([{ x: 0, y: 0 }, { x: 10, y: 0 }]), PLANKS, 'bridge');
    const perSide = Math.round(10 / POST_SPACING) + 1;
    expect(posts.filter((p) => p.y > 0)).toHaveLength(perSide);
    expect(posts.filter((p) => p.y < 0)).toHaveLength(perSide);
    for (const p of posts) expect(Math.abs(p.y)).toBeCloseTo(1, 6);
    expect(ropes).toHaveLength(2 * (perSide - 1));
    for (const [a, b] of ropes) expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(10 / (perSide - 1), 6);
  });

  it('sets end pieces across each cut end, none on a fade end, and drops planks toward the fade', () => {
    const line = [{ x: 0, y: 0 }, { x: 20, y: 0 }];
    const cut = layPlanks(bridge(line), PLANKS, 'bridge');
    expect(cut.ends.filter((e) => e.x < 1)).toHaveLength(2);
    expect(cut.ends.filter((e) => e.x > 19)).toHaveLength(2);
    // Two pieces side by side fill the 2-cell width.
    for (const e of cut.ends) expect(0.875 * e.scale).toBeCloseTo(1, 6);
    const faded = layPlanks(bridge(line, { ends: { start: 'cut', end: 'fade', length: 6 } }), PLANKS, 'bridge');
    expect(faded.ends.filter((e) => e.x > 19)).toHaveLength(0);
    expect(faded.ends.filter((e) => e.x < 1)).toHaveLength(2);
    const nearEnd = (r: typeof cut) => r.planks.filter((p) => p.x > 14).length;
    expect(nearEnd(faded)).toBeLessThan(nearEnd(cut));
  });
});

describe('layBank', () => {
  // The water kit's bank straights: two cells and four cells long.
  const BANK = bankPieces([
    { key: 'bank-A', length: 2 },
    { key: 'bank-B', length: 2 },
    { key: 'bank-long-A', length: 4 },
  ]);
  const water = (id: string, points: { x: number; y: number }[], over: Partial<PathChild> = {}) =>
    road(id, points, { materialId: 'gg-forge:water', width: 1.5, ...over });

  it('makes a straight piece of each bank unit, joints at its two ends', () => {
    expect(BANK.map((p) => [p.key, p.chordCells, p.turnDeg])).toEqual([
      ['bank-A', 2, 0],
      ['bank-B', 2, 0],
      ['bank-long-A', 4, 0],
    ]);
  });

  it('chains the bank round a lake and along both banks of a river with no gap', () => {
    const lake = water(
      'lake',
      Array.from({ length: 10 }, (_, i) => ({ x: 20 + 7 * Math.cos((i / 10) * 2 * Math.PI), y: 5 * Math.sin((i / 10) * 2 * Math.PI) })),
      { closed: true, fill: true },
    );
    const river = water('river', [{ x: -20, y: -6 }, { x: -10, y: -2 }, { x: -2, y: -8 }, { x: 6, y: -3 }]);
    for (const p of [lake, river]) {
      const rings = groupOutline([p]);
      const laid = layBank(rings, BANK);
      expect(laid).toHaveLength(rings.length);
      for (const { placed } of laid) {
        expect(placed.length, p.id).toBeGreaterThan(8);
        expect(bandHoles(placed, true), p.id).toEqual([]);
      }
    }
  });

  it('lays a river and the lake it runs into as one bank, none across the mouth', () => {
    const lake = water('lake', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }], { closed: true, fill: true });
    const river = water('river', [{ x: 5, y: 4 }, { x: 5, y: 20 }]);
    const rings = groupOutline([lake, river]);
    expect(rings).toHaveLength(1);
    const [{ placed }] = layBank(rings, BANK);
    expect(bandHoles(placed, true)).toEqual([]);
    // Nothing laid across the river's mouth at the lake's south shore: no piece's chord runs
    // through the water between the river's banks (x 4.25 to 5.75).
    const across = placed.filter((pl) => {
      const mx = (pl.P[0] + pl.Q[0]) / 2;
      const my = (pl.P[1] + pl.Q[1]) / 2;
      return mx > 4.4 && mx < 5.6 && my > 8 && my < 19;
    });
    expect(across).toEqual([]);
  });
});
