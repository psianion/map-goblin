import { describe, expect, it } from 'vitest';
import { accumulate, compositeTexel, depositForTick, floorRegionAt, MIN_DEPOSIT, strokePasses, type SplatTexel } from './terrainShared';

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

describe('holding the terrain brush', () => {
  it('adds intensity × seconds, so a still brush keeps adding', () => {
    expect(accumulate(0, 0.25, 1)).toBeCloseTo(0.25);
    expect(accumulate(0, 0.25, 2)).toBeCloseTo(0.5);
    expect(accumulate(accumulate(0, 0.25, 1), 0.25, 1)).toBeCloseTo(accumulate(0, 0.25, 2));
  });

  it('builds faster at a higher intensity', () => {
    expect(accumulate(0, 1, 0.5)).toBeGreaterThan(accumulate(0, 0.25, 0.5));
    expect(accumulate(0, 0.5, 1)).toBeCloseTo(0.5);
  });

  it('never passes full however long it is held', () => {
    expect(accumulate(0.9, 1, 10)).toBe(1);
  });

  it('erases at the same rate, down to nothing', () => {
    expect(accumulate(0.8, 0.25, 1, true)).toBeCloseTo(0.55);
    expect(accumulate(0.2, 1, 5, true)).toBe(0);
  });

  it('is frame-rate independent: sixty short ticks lay what one second does', () => {
    let pending = 0;
    let laid = 0;
    for (let i = 0; i < 60; i++) {
      const tick = depositForTick(pending, 0.3, 1 / 60, 0);
      pending = tick.pending;
      laid += tick.each * tick.count;
    }
    expect(laid + pending).toBeCloseTo(0.3);
    const once = depositForTick(0, 0.3, 1, 0);
    expect(once.each * once.count).toBeCloseTo(0.3);
  });

  it('carries a sliver of paint on until the mask can hold it, and lays it along a drag', () => {
    expect(depositForTick(0, 0.1, 0.01, 0)).toEqual({ each: 0, count: 0, pending: expect.closeTo(0.001) });
    const drag = depositForTick(0, 0.6, 0.1, 3);
    expect(drag.count).toBe(3);
    expect(drag.each).toBeCloseTo(0.02);
    expect(depositForTick(0, 0.1, 0.01, 4).each).toBe(MIN_DEPOSIT);
  });

  it('lays full paint at every stamp in one tick when solid, whatever the speed, intensity or time', () => {
    for (const [intensity, seconds, stamps] of [
      [0.1, 1 / 240, 0],
      [0.1, 1 / 60, 1],
      [1, 0.25, 40],
      [0.6, 0, 7],
    ]) {
      const lay = depositForTick(0, intensity, seconds, stamps, true);
      expect(lay).toEqual({ each: 1, count: Math.max(1, stamps), pending: 0 });
      // One stamp of it lays the slot at full, painting or erasing.
      expect(compositeTexel(bare(), strokePasses(0, false), lay.each)[0][0]).toBe(1);
    }
    expect(compositeTexel(compositeTexel(bare(), strokePasses(0, false), 1), strokePasses(0, true), 1)[0][0]).toBe(0);
  });

  it('is unchanged when not solid', () => {
    expect(depositForTick(0, 0.6, 0.1, 3, false)).toEqual(depositForTick(0, 0.6, 0.1, 3));
    expect(depositForTick(0.01, 0.3, 1 / 60, 0, false)).toEqual(depositForTick(0.01, 0.3, 1 / 60, 0));
    expect(depositForTick(0, 0.1, 0.01, 0, false)).toEqual({ each: 0, count: 0, pending: expect.closeTo(0.001) });
  });

  it('lays the accumulated amount as a lerp towards the slot', () => {
    const half = compositeTexel(bare(), strokePasses(0, false), accumulate(0, 0.5, 1));
    expect(half[0][0]).toBeCloseTo(0.5);
    const over = compositeTexel(painted(), strokePasses(0, false), 0.5);
    expect(over[0][0]).toBeCloseTo(0.5);
    expect(over[0][1]).toBeCloseTo(0.5);
    expect(compositeTexel(painted(), strokePasses(0, false), 1)[0]).toEqual([1, 0, 0, 1]);
  });

  it('writes the slot into its own map and channel', () => {
    expect(compositeTexel(bare(), strokePasses(5, false), 1)[1][2]).toBeCloseTo(1);
    expect(compositeTexel(bare(), strokePasses(2, false), 1)[0][2]).toBeCloseTo(1);
  });

  it('erases towards the bare floor, the tint with it', () => {
    const tinted: SplatTexel = [
      [1, 0, 0, 1],
      [0, 0, 0, 0],
      [0.5, 0.2, 0.1, 1],
    ];
    const out = compositeTexel(tinted, strokePasses(0, true), 0.5);
    expect(out[0][0]).toBeCloseTo(0.5);
    expect(out[2][3]).toBeCloseTo(0.5);
    expect(compositeTexel(tinted, strokePasses(0, true), 1)[0][0]).toBeCloseTo(0);
  });

  it('leaves texels the brush did not cover alone', () => {
    expect(compositeTexel(painted(), strokePasses(0, false), 0)).toEqual(painted());
  });
});

describe('Fill enclosed floor', () => {
  const square = (x: number, y: number, s: number): [number, number][] => [
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
  ];
  const hall = square(0, 0, 10);
  const hole = square(3, 3, 4);
  const island = square(4, 4, 2);
  const shed = square(20, 0, 4);

  it('floods the floor under the point and stops at its edge and its holes', () => {
    expect(floorRegionAt([hall, hole, shed], 1, 1)).toEqual({ outer: hall, holes: [hole] });
    expect(floorRegionAt([hall, hole, shed], 21, 1)).toEqual({ outer: shed, holes: [] });
  });

  it('finds no floor outside every ring or inside a hole', () => {
    expect(floorRegionAt([hall, hole, shed], 15, 1)).toBeNull();
    expect(floorRegionAt([hall, hole], 3.5, 3.5)).toBeNull();
    expect(floorRegionAt([], 1, 1)).toBeNull();
  });

  it('treats an island in a hole as its own floor, never part of the one around it', () => {
    expect(floorRegionAt([hall, hole, island], 1, 1)).toEqual({ outer: hall, holes: [hole] });
    expect(floorRegionAt([hall, hole, island], 5, 5)).toEqual({ outer: island, holes: [] });
  });
});
