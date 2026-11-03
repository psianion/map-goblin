// The void rule: a plateau exists only on something. Its ring must lie almost wholly over
// ground (the layer's floor or painted terrain) and cover at least a cell. Pure: the caller
// says what ground is at a point (see engine/plateauGround.ts for the editor's answer).

import type { Polygon } from '../types/geometry';
import { pointInPoly } from './plateaus';

/** The share of a plateau's area that must stand over ground. */
export const PLATEAU_GROUND_SHARE = 0.95;
/** The smallest plateau, cells². */
export const PLATEAU_MIN_AREA = 1;
/** How far apart the ground is sampled under a ring, cells. */
const GROUND_STEP = 0.25;

export type GroundVerdict = 'ok' | 'void' | 'small';

export const GROUND_MESSAGE = 'A plateau needs ground under it';
export const SMALL_MESSAGE = 'A plateau needs at least one cell';

/** A ring's area, cells², whichever way it winds. */
export function ringArea(ring: Polygon): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** A test for being inside a set of rings by even-odd (holes are outside), as the floor union reads. */
export function inRingsTest(rings: readonly Polygon[]): (x: number, y: number) => boolean {
  const live = rings.filter((r) => r.length >= 3);
  return (x, y) => {
    let n = 0;
    for (const r of live) if (pointInPoly(x, y, r)) n++;
    return n % 2 === 1;
  };
}

/**
 * The share of `ring`'s area over ground, 0..1: the ring sampled at the centres of a
 * GROUND_STEP grid over its box, the samples inside it counted, and of those the ones on
 * ground. A ring too small to hold a sample reads as its centre.
 */
export function groundShare(ring: Polygon, onGround: (x: number, y: number) => boolean, step = GROUND_STEP): number {
  if (ring.length < 3) return 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  let inside = 0;
  let over = 0;
  for (let y = minY + step / 2; y < maxY; y += step) {
    for (let x = minX + step / 2; x < maxX; x += step) {
      if (!pointInPoly(x, y, ring)) continue;
      inside++;
      if (onGround(x, y)) over++;
    }
  }
  if (inside === 0) return onGround((minX + maxX) / 2, (minY + maxY) / 2) ? 1 : 0;
  return over / inside;
}

/** Whether a ring may stand as a plateau: big enough, and over ground. */
export function groundVerdict(ring: Polygon, onGround: (x: number, y: number) => boolean): GroundVerdict {
  if (ringArea(ring) < PLATEAU_MIN_AREA) return 'small';
  return groundShare(ring, onGround) >= PLATEAU_GROUND_SHARE ? 'ok' : 'void';
}
