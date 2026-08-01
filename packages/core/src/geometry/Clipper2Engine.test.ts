import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule, clipper2Engine } from './Clipper2Engine';
import type { Polygon } from './GeometryEngine';

/**
 * InflatePathsD's trailing parameters are (miterLimit, precision, arcTolerance)
 * — precision is an integer count of decimal places. Passing an arc tolerance
 * like 0.25 in that slot truncates precision to 0, which rounds every offset
 * vertex to whole world units: a 0.5-cell river offsets to nothing at all.
 */
const inflateSpy = vi.fn();

function fakePath(points: [number, number][]) {
  return { size: () => points.length, get: (j: number) => ({ x: points[j][0], y: points[j][1] }) };
}

function fakePaths(polys: [number, number][][]) {
  return { size: () => polys.length, get: (i: number) => fakePath(polys[i]), delete: () => {} };
}

beforeEach(() => {
  inflateSpy.mockReset();
  const fake = {
    PathsD: function () {
      return { push_back: () => {}, delete: () => {} };
    },
    MakePathD: () => ({ delete: () => {} }),
    JoinType: { Round: 'round' },
    EndType: { Polygon: 'polygon', Round: 'round' },
    InflatePathsD: (...args: unknown[]) => {
      inflateSpy(...args);
      return fakePaths([[[0, 0], [1, 0], [1, 1]]]);
    },
  } as unknown as MainModule;
  setClipperModule(fake);
});

describe('Clipper2Engine offsetting', () => {
  it('passes an integer precision, not the arc tolerance, in the precision slot', () => {
    clipper2Engine.inflateOpen([[[0, 0], [4, 0]]], 0.25);

    const args = inflateSpy.mock.calls[0];
    const precision = args[5] as number;
    expect(Number.isInteger(precision)).toBe(true);
    expect(precision).toBeGreaterThanOrEqual(1);
    // arcTolerance is the last argument and is a sub-unit distance
    expect(args[6] as number).toBeLessThan(1);
  });

  it('uses the same argument order for closed-path inflation', () => {
    clipper2Engine.inflate([[[0, 0], [4, 0], [4, 4]]], -1);

    const args = inflateSpy.mock.calls[0];
    expect(args[4]).toBe(2); // miterLimit
    expect(Number.isInteger(args[5] as number)).toBe(true);
    expect(args[6] as number).toBeLessThan(1);
  });
});

/**
 * The semantics `computeMergedFloor` (subscribeToStore.ts) now leans on: unioning
 * N subjects in one call answers what folding them pairwise did.
 *
 * It used to fold — `union(merged, [next])` once per shape — marshalling the whole
 * accumulated floor across the WASM boundary N-1 times to reach the same polygons.
 * Pinned here so the fold cannot come back as a fix for output that never differed.
 * Real Clipper2, because the whole question is what UnionD does with several
 * subjects at once.
 */
describe('union — one call for every subject', () => {
  let real: MainModule;

  /** Same wasm hand-off as roomDetection.test.ts — jsdom can't fetch the .wasm. */
  beforeAll(async () => {
    const { readFileSync } = await import('node:fs' as string);
    const { createRequire } = await import('node:module' as string);
    const wasmBinary = readFileSync(
      createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'),
    );
    const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
    real = await mod.default({ wasmBinary });
  }, 30_000);

  // Runs after the stub the offsetting suite installs, so it wins.
  beforeEach(() => setClipperModule(real));

  const rect = (x: number, y: number, w: number, h: number): Polygon => [
    [x, y], [x + w, y], [x + w, y + h], [x, y + h],
  ];

  /**
   * Ring order and start vertex are Clipper's business; the coordinates are not,
   * and both paths round to the same precision, so the point sets must match.
   */
  const canonical = (polys: Polygon[]): string =>
    polys
      .map((p) => [...p].map(([x, y]) => `${x},${y}`).sort().join(' '))
      .sort()
      .join(' | ');

  /** What computeMergedFloor did before: one union per shape, folded left. */
  const folded = (paths: Polygon[]): Polygon[] => {
    let merged: Polygon[] = [paths[0]];
    for (let i = 1; i < paths.length; i++) {
      merged = clipper2Engine.union(merged, [paths[i]]);
    }
    return merged;
  };

  const cases: [string, Polygon[]][] = [
    ['overlapping shapes', [rect(0, 0, 10, 10), rect(5, 0, 10, 10), rect(8, 2, 10, 6)]],
    ['a chain that only touches at the seams', [rect(0, 0, 10, 10), rect(10, 0, 10, 10), rect(20, 0, 10, 10)]],
    ['disjoint shapes', [rect(0, 0, 10, 10), rect(50, 50, 10, 10)]],
    ['a shape wholly inside another', [rect(0, 0, 20, 20), rect(5, 5, 5, 5)]],
    ['a shape stamped on top of itself', [rect(0, 0, 10, 10), rect(0, 0, 10, 10)]],
  ];

  for (const [what, paths] of cases) {
    it(`gives the folded answer for ${what}`, () => {
      expect(canonical(clipper2Engine.union(paths, []))).toBe(canonical(folded(paths)));
    });
  }

  it('merges overlapping subjects rather than passing them through', () => {
    // The load-bearing half: subjects union against *each other*, not only
    // against the (empty) clip set. Two overlapping squares are one ring.
    // Clipper keeps the seam vertices, so the ring is the 15x10 outline with a
    // point part-way along two of its sides — one shape, not two.
    const merged = clipper2Engine.union([rect(0, 0, 10, 10), rect(5, 0, 10, 10)], []);
    expect(merged).toHaveLength(1);
    expect(Math.min(...merged[0].map(([x]) => x))).toBe(0);
    expect(Math.max(...merged[0].map(([x]) => x))).toBe(15);
    expect(Math.max(...merged[0].map(([, y]) => y))).toBe(10);
  });
});
