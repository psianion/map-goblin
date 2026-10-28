import { describe, it, expect } from 'vitest';
import { caveBandPieces, jointsOf } from '../assets/caveWallKit';
import { resampleClosed, walkClosed, type Curve, type Vec } from './caveWalk';

const dist = (a: Vec, b: Vec): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * A ring of floor with the void outside it, sampled the way `smoothRing` leaves
 * the cave outline: evenly, at 0.1 cells. Traced counter-clockwise in y-down
 * screen space so the floor is on the right of travel and the void on the left,
 * which is the handedness every measurement in the kit assumes.
 */
function circle(radius: number, spacing = 0.1): Curve {
  const n = Math.round((2 * Math.PI * radius) / spacing);
  const pts: Curve = Array.from({ length: n }, (_, k): Vec => {
    const a = (2 * Math.PI * k) / n;
    return [radius * Math.cos(a), radius * Math.sin(a)];
  });
  return resampleClosed(pts, spacing);
}

describe('walkClosed', () => {
  const walk = walkClosed(circle(7), caveBandPieces());

  it('lays a closed band with no rock missing', () => {
    // A hole is floor showing through to the void. The walk reports rather than
    // throws so a bad run can be looked at, so this is the assertion that a
    // clean curve produces none.
    expect(walk.holes).toEqual([]);
    expect(walk.placed.length).toBeGreaterThan(4);
  });

  it('matches pieces to the curve instead of stretching them onto it', () => {
    // Scale is uniform, so a stretched piece is a THICKER piece: past ±12% it
    // stops reading as the same wall as its neighbours. Only the closing piece
    // is allowed anywhere near that budget.
    for (const pl of walk.placed) {
      const label = `${pl.piece.key}/${pl.branch} @ scale ${pl.at.scale.toFixed(3)}`;
      expect(`${label}: ${Math.abs(pl.at.scale - 1) <= 0.12}`).toBe(`${label}: true`);
    }
  });

  it('leaves every joint closed to within the acceptance gate', () => {
    // Measured on the joints the pieces ACTUALLY land on — after BAND_OUT and
    // each piece's own sideways nudge — because that is where the rock is. Each
    // piece is meant to run past its successor's start by BAND_OVERLAP, so any
    // positive gap is already borrowed against the overlap; 0.9 cells is the
    // spec's gate and the same threshold `holes` uses.
    for (let k = 0; k < walk.placed.length; k++) {
      const a = walk.placed[k],
        b = walk.placed[(k + 1) % walk.placed.length];
      const gap = dist(jointsOf(a.piece, a.at)[1], jointsOf(b.piece, b.at)[0]);
      const label = `${a.piece.key} → ${b.piece.key}, gap ${gap.toFixed(3)}`;
      expect(`${label}: ${gap <= 0.9}`).toBe(`${label}: true`);
    }
  });
});

describe('walkClosed options the live band uses', () => {
  const curve = circle(7);
  const firstOf = (r: ReturnType<typeof walkClosed>): Vec => r.placed[0].P;
  const lastOf = (r: ReturnType<typeof walkClosed>): Vec => r.placed[r.placed.length - 1].Q;

  it('closes onto the first piece end to end by default (the solver fixture relies on it)', () => {
    const r = walkClosed(curve, caveBandPieces());
    expect(dist(lastOf(r), firstOf(r))).toBeLessThan(1e-9);
  });

  it('with lap, runs the closing piece past the first piece by the overlap', () => {
    const r = walkClosed(curve, caveBandPieces(), { lap: true });
    expect(r.holes).toEqual([]);
    expect(dist(lastOf(r), firstOf(r))).toBeGreaterThan(0.2);
    expect(dist(lastOf(r), firstOf(r))).toBeLessThan(0.45);
  });

  it('keeps every piece to the stretch budget with splits and fill on', () => {
    const r = walkClosed(curve, caveBandPieces(), { lap: true, splits: 4, fill: true });
    expect(r.holes).toEqual([]);
    for (const pl of r.placed) expect(Math.abs(pl.at.scale - 1)).toBeLessThanOrEqual(0.12);
  });
});
