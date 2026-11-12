// A path's units along its line: laid at their own length, never stretched; scaled by the
// width; ramped in and out at the ends.

import { describe, expect, it } from 'vitest';
import { layPathUnits, pathwayLine, softPathStrip, TRANSITION_UNITS, type PathUnit } from './pathway';

const unit = { length: 2, width: 1 };
const straight: [number, number][] = [[0, 0], [10, 0]];

/** The distance between consecutive unit centres. */
const gaps = (units: PathUnit[]) => units.slice(1).map((u, i) => Math.hypot(u.x - units[i].x, u.y - units[i].y));

describe('a soft piece as one band', () => {
  const bend: [number, number][] = [[0, 0], [6, 0], [6, 6]];
  const tri = (s: ReturnType<typeof softPathStrip>, k: number) => {
    const [a, b, c] = [s.indices[k], s.indices[k + 1], s.indices[k + 2]];
    const p = (i: number) => [s.positions[2 * i], s.positions[2 * i + 1]];
    const [ax, ay] = p(a);
    const [bx, by] = p(b);
    const [cx, cy] = p(c);
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  };

  it('runs as one continuous strip through a 90 degree bend, each station joined to the next', () => {
    const s = softPathStrip(bend, 2, 1.5, 'hard', 'hard');
    const pairs = s.alphas.length / 2;
    expect(pairs).toBeGreaterThan(20);
    expect(s.indices).toHaveLength((pairs - 1) * 6);
    // Each pair shares its side with the next: no gap anywhere along it.
    for (let k = 0; k < pairs - 1; k++) {
      expect(s.indices.slice(6 * k, 6 * k + 6)).toEqual([2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 2, 2 * k + 1, 2 * k + 3]);
    }
    // Every station off the bend is the band's width across.
    const widths = Array.from({ length: pairs }, (_, k) =>
      Math.hypot(s.positions[4 * k] - s.positions[4 * k + 2], s.positions[4 * k + 1] - s.positions[4 * k + 3]),
    );
    expect(widths.filter((w) => Math.abs(w - 1.5) < 1e-6).length).toBeGreaterThan(pairs / 2);
    // Neither side ever jumps: round the bend each vertex moves on a little from the last.
    for (let k = 1; k < pairs; k++) {
      for (const side of [0, 2]) {
        const d = Math.hypot(s.positions[4 * k + side] - s.positions[4 * (k - 1) + side], s.positions[4 * k + side + 1] - s.positions[4 * (k - 1) + side + 1]);
        expect(d).toBeLessThan(0.6);
      }
    }
    // Its ends sit square across the line's ends.
    expect([s.positions[0], s.positions[1], s.positions[2], s.positions[3]].map((v) => Math.round(v * 1000) / 1000)).toEqual([0, -0.75, 0, 0.75]);
  });

  it('never inverts a triangle, even on a bend sharper than the band is wide', () => {
    for (const line of [bend, [[0, 0], [6, 0], [0.5, 1]] as [number, number][]]) {
      const s = softPathStrip(line, 2, 2, 'hard', 'hard');
      for (let k = 0; k < s.indices.length; k += 3) expect(tri(s, k)).toBeLessThanOrEqual(1e-9);
    }
  });

  it('repeats the art along the length, a station laid twice where one repeat ends and the next begins', () => {
    const s = softPathStrip(straight, 2, 1, 'hard', 'hard');
    const us = s.uvs.filter((_, i) => i % 4 === 0);
    expect(us[0]).toBe(0);
    expect(us[us.length - 1]).toBe(1);
    expect(us.filter((u) => u === 1)).toHaveLength(5);
    expect(us.filter((u) => u === 0)).toHaveLength(5);
    // Across: the left of travel is the art's top, the right its bottom.
    expect(s.uvs[1]).toBe(0);
    expect(s.uvs[3]).toBe(1);
  });

  it('fades to nothing at a Fade end and tapers to nothing at Grow and Shrink ends, Hard doing neither', () => {
    const width = (s: ReturnType<typeof softPathStrip>, k: number) =>
      Math.hypot(s.positions[4 * k] - s.positions[4 * k + 2], s.positions[4 * k + 1] - s.positions[4 * k + 3]);
    const fade = softPathStrip(straight, 1, 1, 'fade', 'fade');
    const last = fade.alphas.length - 1;
    expect(fade.alphas[0]).toBe(0);
    expect(fade.alphas[last]).toBe(0);
    expect(fade.alphas[Math.floor(last / 2)]).toBe(1);
    // Smooth: never falling over the ramp in, and well short of full a step in.
    const rising = fade.alphas.filter((_, i) => i % 2 === 0).slice(0, 8);
    for (let i = 1; i < rising.length; i++) expect(rising[i]).toBeGreaterThanOrEqual(rising[i - 1]);
    expect(rising[1]).toBeLessThan(0.1);
    const taper = softPathStrip(straight, 1, 1, 'grow', 'shrink');
    const pairs = taper.alphas.length / 2;
    expect(width(taper, 0)).toBeCloseTo(0);
    expect(width(taper, pairs - 1)).toBeCloseTo(0);
    expect(width(taper, Math.floor(pairs / 2))).toBeCloseTo(1);
    expect(taper.alphas.every((a) => a === 1)).toBe(true);
    const hard = softPathStrip(straight, 1, 1, 'hard', 'hard');
    expect(hard.alphas.every((a) => a === 1)).toBe(true);
    expect(width(hard, 0)).toBeCloseTo(1);
  });
});

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
