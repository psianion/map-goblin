import { describe, expect, it } from 'vitest';
import { compositeTexel, strokePasses, type SplatTexel } from './terrainShared';

const bare = (): SplatTexel => [
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
];

/** Slot 1 (green, map 0) painted solid. */
const painted = (): SplatTexel => [
  [0, 1, 0, 1],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
];

describe('a terrain stroke', () => {
  it('at strength 0.5 and at 1.0 writes different weights', () => {
    const half = compositeTexel(bare(), strokePasses(0, 0.5, false), 1);
    const full = compositeTexel(bare(), strokePasses(0, 1, false), 1);
    expect(half[0][0]).toBeCloseTo(0.5);
    expect(full[0][0]).toBeCloseTo(1);
    expect(half).not.toEqual(full);
  });

  it('over another texture blends by strength instead of replacing it', () => {
    const half = compositeTexel(painted(), strokePasses(0, 0.5, false), 1);
    expect(half[0][0]).toBeCloseTo(0.5);
    expect(half[0][1]).toBeCloseTo(0.5);
    const full = compositeTexel(painted(), strokePasses(0, 1, false), 1);
    expect(full[0][0]).toBeCloseTo(1);
    expect(full[0][1]).toBeCloseTo(0);
  });

  it('holds strength as the ceiling of one stroke, however many stamps overlap', () => {
    // Every stamp re-lays the pre-stroke texel with the widened coverage, so overlap
    // never compounds: full coverage after six stamps is still a 0.3 lerp.
    const passes = strokePasses(4, 0.3, false);
    let out = bare();
    for (let stamp = 0; stamp < 6; stamp++) out = compositeTexel(bare(), passes, 1);
    expect(out[1][1]).toBeCloseTo(0.3);
  });

  it('writes the slot into its own map and channel', () => {
    expect(compositeTexel(bare(), strokePasses(5, 1, false), 1)[1][2]).toBeCloseTo(1);
    expect(compositeTexel(bare(), strokePasses(2, 1, false), 1)[0][2]).toBeCloseTo(1);
  });

  it('erases towards the bare floor by strength, the tint with it', () => {
    const tinted: SplatTexel = [
      [1, 0, 0, 1],
      [0, 0, 0, 0],
      [0.5, 0.2, 0.1, 1],
    ];
    const out = compositeTexel(tinted, strokePasses(0, 0.5, true), 1);
    expect(out[0][0]).toBeCloseTo(0.5);
    expect(out[2][3]).toBeCloseTo(0.5);
    expect(compositeTexel(tinted, strokePasses(0, 1, true), 1)[0][0]).toBeCloseTo(0);
  });

  it('leaves texels the brush did not cover alone', () => {
    expect(compositeTexel(painted(), strokePasses(0, 1, false), 0)).toEqual(painted());
  });
});
