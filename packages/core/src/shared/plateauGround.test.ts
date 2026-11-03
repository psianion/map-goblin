// The void rule: a plateau stands only on ground, 95 % of it at least, a cell at the least.
import { describe, it, expect } from 'vitest';
import { groundShare, groundVerdict, inRingsTest, PLATEAU_GROUND_SHARE, ringArea } from './plateauGround';
import type { Polygon } from '../types/geometry';

const box = (x0: number, y0: number, x1: number, y1: number): Polygon => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const floor = inRingsTest([box(0, 0, 10, 10)]);

describe('the void rule', () => {
  it('measures a ring in cells, whichever way it winds', () => {
    expect(ringArea(box(0, 0, 3, 2))).toBe(6);
    expect(ringArea([...box(0, 0, 3, 2)].reverse())).toBe(6);
  });

  it('takes a ring wholly on the floor, and refuses one wholly on void', () => {
    expect(groundShare(box(2, 2, 6, 6), floor)).toBe(1);
    expect(groundVerdict(box(2, 2, 6, 6), floor)).toBe('ok');
    expect(groundShare(box(20, 20, 24, 24), floor)).toBe(0);
    expect(groundVerdict(box(20, 20, 24, 24), floor)).toBe('void');
  });

  it('draws the line at 95 % over ground', () => {
    // Ten cells long, half a cell of it off the floor: 95 %, on the line.
    expect(groundVerdict(box(-0.5, 2, 9.5, 4), floor)).toBe('ok');
    // Half off the floor.
    expect(groundShare(box(5, 2, 15, 4), floor)).toBeCloseTo(0.5, 2);
    expect(groundVerdict(box(5, 2, 15, 4), floor)).toBe('void');
    // Just under the line.
    const share = groundShare(box(0, 2, 10.8, 4), floor);
    expect(share).toBeLessThan(PLATEAU_GROUND_SHARE);
    expect(groundVerdict(box(0, 2, 10.8, 4), floor)).toBe('void');
  });

  it('counts painted terrain as ground, and a floor hole as void', () => {
    const painted = (x: number) => x >= 10 && x <= 20;
    const either = (x: number, y: number) => floor(x, y) || painted(x);
    expect(groundVerdict(box(5, 2, 15, 4), either)).toBe('ok');
    const holed = inRingsTest([box(0, 0, 10, 10), box(3, 3, 7, 7)]);
    expect(groundVerdict(box(3, 3, 7, 7), holed)).toBe('void');
  });

  it('refuses a ring under a cell, on ground or not', () => {
    expect(groundVerdict(box(2, 2, 2.9, 2.9), floor)).toBe('small');
    expect(groundVerdict(box(2, 2, 3, 3), floor)).toBe('ok');
  });
});
