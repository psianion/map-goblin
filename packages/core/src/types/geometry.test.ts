import { describe, it, expect } from 'vitest';
import type { Point, Polygon, Viewport } from './geometry';

describe('core types', () => {
  it('Point type has x and y', () => {
    const p: Point = { x: 10, y: 20 };
    expect(p.x).toBe(10);
    expect(p.y).toBe(20);
  });

  it('Polygon type is array of coordinate tuples', () => {
    const poly: Polygon = [[0, 0], [100, 0], [100, 100], [0, 100]];
    expect(poly).toHaveLength(4);
  });

  it('Viewport type has width, height, dpr', () => {
    const v: Viewport = { width: 800, height: 600, dpr: 2 };
    expect(v.width).toBe(800);
    expect(v.dpr).toBe(2);
  });
});
