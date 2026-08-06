import { describe, it, expect } from 'vitest';
import { remapFloorWallEdits } from './ringEditRemap';
import type { WallEdits } from '../shared/types';

type Ring = [number, number][];

/** CCW square (positive area) at (x, y). */
const room = (x: number, y: number, size = 10): Ring => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
];

/** CW ring — a hole's winding. */
const hole = (x: number, y: number, size = 2): Ring => [
  [x, y],
  [x, y + size],
  [x + size, y + size],
  [x + size, y],
];

const edits = (t: number): WallEdits => ({ nodeEdits: [{ t, rotate: 0.1 }] });

describe('remapFloorWallEdits', () => {
  it('follows a ring whose index changed', () => {
    const a = room(0, 0);
    const b = room(100, 0);
    const out = remapFloorWallEdits([a, b], [b, a], { '1': edits(0.25) });
    expect(out).toEqual({ '0': edits(0.25) });
  });

  it('survives a small drift of the ring itself', () => {
    const a = room(0, 0);
    const dragged = room(1, 0); // one vertex-drag worth of movement
    const out = remapFloorWallEdits([a], [dragged], { '0': edits(0.5) });
    expect(out).toEqual({ '0': edits(0.5) });
  });

  it('drops edits whose ring vanished instead of grabbing a distant one', () => {
    const gone = room(0, 0);
    const far = room(500, 500);
    const out = remapFloorWallEdits([gone, far], [far], { '0': edits(0.5) });
    expect(out).toBeUndefined();
  });

  it('never matches an outer ring onto a hole', () => {
    const outer = room(0, 0);
    const punched = hole(4, 4);
    // Outer vanished; only a hole with a nearby centroid remains.
    const out = remapFloorWallEdits([outer], [punched], { '0': edits(0.5) });
    expect(out).toBeUndefined();
  });

  it('gives each new ring to its nearest claimant only once', () => {
    const a = room(0, 0);
    const b = room(12, 0);
    // Both rings drifted right by 1; matching must stay one-to-one.
    const out = remapFloorWallEdits([a, b], [room(1, 0), room(13, 0)], {
      '0': edits(0.1),
      '1': edits(0.9),
    });
    expect(out).toEqual({ '0': edits(0.1), '1': edits(0.9) });
  });
});
