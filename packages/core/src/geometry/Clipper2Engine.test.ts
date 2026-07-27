import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule, clipper2Engine } from './Clipper2Engine';

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
