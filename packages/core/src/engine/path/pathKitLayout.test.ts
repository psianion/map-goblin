import { describe, it, expect, beforeAll } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../../geometry/Clipper2Engine';
import { groupOutline } from '../pathRenderer';
import { edgeWalk, unitOverlap, type EdgeUnit, type UnitPlacement } from './pathKitLayout';
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
