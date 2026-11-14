import { describe, expect, it } from 'vitest';
import type { Polygon } from '../types/geometry';
import { isDenseRing, tidyRing, tidyRings } from './tidyRings';

const circle = (n: number, r = 1): Polygon =>
  Array.from({ length: n }, (_, i): [number, number] => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)]);

describe('tidyRing', () => {
  it('thins a brush dab to the points that shape it', () => {
    const dab = circle(158);
    const out = tidyRing(dab);
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out.length).toBeLessThanOrEqual(30);
    for (const [x, y] of out) expect(Math.abs(Math.hypot(x, y) - 1)).toBeLessThanOrEqual(0.02);
    // Every point of the dab lies within the tolerance of the thinned ring's edges.
    const near = (px: number, py: number) =>
      Math.min(
        ...out.map(([ax, ay], i) => {
          const [bx, by] = out[(i + 1) % out.length];
          const dx = bx - ax;
          const dy = by - ay;
          const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
          return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
        }),
      );
    for (const [x, y] of dab) expect(near(x, y)).toBeLessThanOrEqual(0.02 + 1e-9);
  });

  it('hands a ring with nothing to drop back as the same array', () => {
    const square: Polygon = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(tidyRing(square)).toBe(square);
  });

  it('drops a point stacked on the one before it, and a ring left under 3 points', () => {
    expect(tidyRing([[0, 0], [2, 0], [2.005, 0.001], [2, 2], [0, 2]])).toHaveLength(4);
    expect(tidyRing([[0, 0], [0.005, 0], [0.005, 0.005]])).toEqual([]);
    expect(tidyRings([[[0, 0], [0.005, 0], [0.005, 0.005]], [[0, 0], [1, 0], [1, 1]]])).toHaveLength(1);
  });
});

describe('isDenseRing', () => {
  it('reads brush steps, not drawn corners', () => {
    expect(isDenseRing(circle(158))).toBe(true);
    expect(isDenseRing([[0, 0], [1, 0], [1, 1], [0, 1]])).toBe(false);
  });
});
