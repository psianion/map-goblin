// The warp a measured kit's piece is drawn through where it meets a neighbour at an angle
// (a mitre bend), and the narrowing of a piece whose end is left open (a taper).
import { describe, expect, it } from 'vitest';
import { mitreAlong, mitreSlope, taperWidth } from './bandBend';

type V = [number, number];

/** Offsets across a straight's art, from its rock line: its tile runs 1.36 to the void side and 0.64 to the floor side. */
const ACROSS: number[] = Array.from({ length: 41 }, (_, k) => -1.36 + (2 * k) / 40);

describe('the mitre warp', () => {
  it('is the identity with no turn at either end', () => {
    for (const L of [0.5, 2.3, 4.3]) {
      for (const v of ACROSS) {
        for (let u = 0; u <= L; u += L / 50) expect(mitreAlong(u, v, L, 0, 0)).toBeCloseTo(u, 12);
      }
    }
  });

  for (const deg of [15, 30, 45, 60]) {
    for (const side of [1, -1]) {
      it(`meets its neighbour on the line splitting a joint turning ${deg}° toward the ${side > 0 ? 'floor' : 'void'}, at every offset across the art`, () => {
        const phi = (side * deg * Math.PI) / 180;
        const t = mitreSlope(phi);
        const L = 2.3;
        for (const v of ACROSS) {
          // `a` runs along x to the joint at the origin; its floor side (the right of travel) is +y.
          const along = mitreAlong(L, v, L, 0, t);
          const pa: V = [along - L, v];
          // `b` leaves the joint turned by phi, toward the floor side for a positive turn.
          const d: V = [Math.cos(phi), Math.sin(phi)];
          const n: V = [-d[1], d[0]];
          const ub = mitreAlong(0, v, L, t, 0);
          const pb: V = [d[0] * ub + n[0] * v, d[1] * ub + n[1] * v];
          expect(Math.hypot(pa[0] - pb[0], pa[1] - pb[1]), `v ${v}`).toBeLessThan(0.01);
        }
      });
    }
  }

  it('never folds the art: along runs strictly on with u at every offset', () => {
    for (const deg of [15, 30, 45, 60]) {
      for (const side of [1, -1]) {
        const t = mitreSlope((side * deg * Math.PI) / 180);
        // A 2- or 4-cell straight across its whole tile; a 1-cell one across its rock and a little either side.
        for (const [L, offsets] of [[1.3, ACROSS.filter((x) => x >= -0.8 && x <= 0.4)], [2.3, ACROSS], [4.3, ACROSS]] as [number, number[]][]) {
          for (const v of offsets) {
            let last = -Infinity;
            let folds = 0;
            for (let u = 0; u <= L + 1e-9; u += 0.002) {
              const a = mitreAlong(u, v, L, t, -t);
              if (a <= last) folds++;
              last = a;
            }
            expect(folds, `${deg} L ${L} v ${v}`).toBe(0);
          }
        }
      }
    }
  });

  it('leaves the middle of a 2-cell piece where it was when its bend zones are shorter than half of it', () => {
    const t = mitreSlope((40 * Math.PI) / 180);
    // At 40° the zone is 1.6 × |v| × tan 20°, under half the piece for every offset within a cell of the rock line.
    for (const v of ACROSS.filter((x) => Math.abs(x) <= 1)) expect(mitreAlong(1, v, 2, t, -t)).toBeCloseTo(1, 12);
  });
});

describe('a tapered end', () => {
  it('narrows to nothing at the tip along a quarter circle, never widening on the way', () => {
    expect(taperWidth(0)).toBe(1);
    expect(taperWidth(1)).toBe(0);
    let last = Infinity;
    for (let q = 0; q <= 1 + 1e-9; q += 0.01) {
      const f = taperWidth(q);
      expect(f).toBeLessThanOrEqual(last);
      expect(f).toBeCloseTo(Math.sqrt(Math.max(0, 1 - Math.min(1, q) ** 2)), 12);
      last = f;
    }
  });
});
