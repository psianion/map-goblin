// A path's units along its line: laid at their own length, never stretched; scaled by the
// width; ramped in and out at the ends.

import { describe, expect, it } from 'vitest';
import { layPathUnits, pathwayLine, TRANSITION_UNITS, type PathUnit } from './pathway';

const unit = { length: 2, width: 1 };
const straight: [number, number][] = [[0, 0], [10, 0]];

/** The distance between consecutive unit centres. */
const gaps = (units: PathUnit[]) => units.slice(1).map((u, i) => Math.hypot(u.x - units[i].x, u.y - units[i].y));

describe('laying units along a line', () => {
  it('lays whole units end to end along a straight line, each at its own size', () => {
    const units = layPathUnits(straight, unit, 1, 'hard', 'hard');
    expect(units).toHaveLength(5);
    expect(units.map((u) => u.x)).toEqual([1, 3, 5, 7, 9]);
    for (const u of units) expect(u).toMatchObject({ y: 0, rotation: 0, scaleAlong: 1, scaleAcross: 1, alpha: 1 });
  });

  it('never stretches a unit: a line that is not a whole number of units overlaps them a little', () => {
    const units = layPathUnits([[0, 0], [9, 0]], unit, 1, 'hard', 'hard');
    expect(units).toHaveLength(5);
    for (const u of units) expect(u.scaleAlong).toBe(1);
    // Centres closer than a unit's length: the units overlap, no gap opens.
    for (const g of gaps(units)) expect(g).toBeLessThanOrEqual(2);
    expect(units[0].x).toBeCloseTo(0.9);
    expect(units[4].x).toBeCloseTo(8.1);
  });

  it('follows a curve, each unit turned along its stretch of it', () => {
    const arc: [number, number][] = Array.from({ length: 33 }, (_, i) => {
      const a = (i / 32) * Math.PI;
      return [10 * Math.cos(a), 10 * Math.sin(a)];
    });
    const units = layPathUnits(arc, unit, 1, 'hard', 'hard');
    // Half a circle of radius 10 is 31.4 long: 16 units of 2.
    expect(units).toHaveLength(16);
    for (const u of units) {
      // On the circle (a chord's midpoint sits just inside it) and tangent to it.
      expect(Math.hypot(u.x, u.y)).toBeGreaterThan(9.9);
      expect(Math.hypot(u.x, u.y)).toBeLessThanOrEqual(10.001);
      const tangent = Math.atan2(u.y, u.x) + Math.PI / 2;
      const d = Math.atan2(Math.sin(u.rotation - tangent), Math.cos(u.rotation - tangent));
      expect(Math.abs(d)).toBeLessThan(0.1);
    }
  });

  it('scales the units with the width, so fewer, larger units cover the line', () => {
    const wide = layPathUnits(straight, unit, 2, 'hard', 'hard');
    expect(wide).toHaveLength(3);
    for (const u of wide) expect(u).toMatchObject({ scaleAlong: 2, scaleAcross: 2 });
    const narrow = layPathUnits(straight, unit, 0.5, 'hard', 'hard');
    expect(narrow).toHaveLength(10);
    for (const u of narrow) expect(u.scaleAlong).toBe(0.5);
  });

  it('fades the first units in and leaves a hard end hard', () => {
    const units = layPathUnits([[0, 0], [20, 0]], unit, 1, 'fade', 'hard');
    const alphas = units.map((u) => u.alpha);
    expect(alphas.slice(0, TRANSITION_UNITS)).toEqual([0.25, 0.5, 0.75]);
    expect(alphas.slice(TRANSITION_UNITS).every((a) => a === 1)).toBe(true);
    for (const u of units) expect(u.scaleAcross).toBe(1);
  });

  it('grows the start and shrinks the end across the path, along it never', () => {
    const units = layPathUnits([[0, 0], [20, 0]], unit, 1, 'grow', 'shrink');
    expect(units.map((u) => u.scaleAcross)).toEqual([0.25, 0.5, 0.75, 1, 1, 1, 1, 0.75, 0.5, 0.25]);
    for (const u of units) expect(u).toMatchObject({ scaleAlong: 1, alpha: 1 });
    // A fade out ramps the last units' alpha the same way.
    const out = layPathUnits([[0, 0], [20, 0]], unit, 1, 'hard', 'fade');
    expect(out.map((u) => u.alpha).slice(-3)).toEqual([0.75, 0.5, 0.25]);
  });

  it('ramps a short path over half its units at each end at most', () => {
    const units = layPathUnits([[0, 0], [8, 0]], unit, 1, 'fade', 'fade');
    expect(units.map((u) => u.alpha)).toEqual([1 / 3, 2 / 3, 2 / 3, 1 / 3]);
  });
});

describe('the line a path is laid along', () => {
  const path = { contours: [[[0, 0], [10, 0], [10, 10]] as [number, number][]], curve: false, smoothness: 0 };

  it('is the nodes themselves with no smoothness and no curve', () => {
    expect(pathwayLine(path)).toEqual([[0, 0], [10, 0], [10, 10]]);
  });

  it('rounds the corner with smoothness, keeping both ends', () => {
    const line = pathwayLine({ ...path, smoothness: 1 });
    expect(line[0]).toEqual([0, 0]);
    expect(line[line.length - 1]).toEqual([10, 10]);
    expect(line.length).toBeGreaterThan(8);
    // The corner is cut: no point comes near it.
    for (const [x, y] of line) expect(Math.hypot(x - 10, y)).toBeGreaterThan(1);
  });

  it('runs through every node as a spline with Curve on', () => {
    const line = pathwayLine({ ...path, curve: true });
    expect(line.length).toBeGreaterThan(20);
    for (const node of path.contours[0]) expect(line.some(([x, y]) => Math.hypot(x - node[0], y - node[1]) < 1e-6)).toBe(true);
  });
});
