import { afterEach, describe, it, expect } from 'vitest';
import { anchoredMotion, coneAt, isMoving, motionDirection, motionTime } from './lightMotion';
import type { LightMotion } from './types';
import { clearFreeze } from './freeze';

const spin = (rpm: number, clockwise: boolean) => ({ kind: 'spin' as const, rpm, clockwise });
const sweep = (from: number, to: number, degPerSec: number) => ({ kind: 'sweep' as const, from, to, degPerSec });

describe('motionDirection', () => {
  it('spins clockwise and counter-clockwise from the authored direction', () => {
    // 6 rpm = 36 degrees a second.
    expect(motionDirection(spin(6, true), 0, 0)).toBeCloseTo(0);
    expect(motionDirection(spin(6, true), 0, 1)).toBeCloseTo(36);
    expect(motionDirection(spin(6, false), 0, 1)).toBeCloseTo(324);
    expect(motionDirection(spin(6, true), 350, 1)).toBeCloseTo(26);
    // A full turn every ten seconds.
    expect(motionDirection(spin(6, true), 90, 10)).toBeCloseTo(90);
  });

  it('agrees for a wall-clock time, so two screens draw the same angle', () => {
    const t = 1_795_000_000.25;
    expect(motionDirection(spin(30, true), 45, t)).toBeCloseTo(motionDirection(spin(30, true), 45, t), 9);
    const a = motionDirection(spin(6, true), 0, t);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(360);
  });

  it('sweeps from one edge to the other and back, easing at both edges', () => {
    // 0..90 at 45 deg/s: a pass is 2 s, there and back 4 s.
    const m = sweep(0, 90, 45);
    expect(motionDirection(m, 0, 0)).toBeCloseTo(0);
    expect(motionDirection(m, 0, 1)).toBeCloseTo(45);
    expect(motionDirection(m, 0, 2)).toBeCloseTo(90);
    expect(motionDirection(m, 0, 3)).toBeCloseTo(45);
    expect(motionDirection(m, 0, 4)).toBeCloseTo(0);
    // Eased: slower near an edge than through the middle.
    const nearEdge = motionDirection(m, 0, 0.1) - motionDirection(m, 0, 0);
    const middle = motionDirection(m, 0, 1.05) - motionDirection(m, 0, 0.95);
    expect(nearEdge).toBeLessThan(middle);
  });

  it('sweeps clockwise across east', () => {
    const m = sweep(300, 30, 45);
    expect(motionDirection(m, 0, 0)).toBeCloseTo(300);
    expect(motionDirection(m, 0, 1)).toBeCloseTo(345);
    expect(motionDirection(m, 0, 2)).toBeCloseTo(30);
  });

  it('holds still for a sweep with no span', () => {
    expect(motionDirection(sweep(40, 40, 45), 0, 12)).toBe(40);
  });
});

describe('isMoving and coneAt', () => {
  it('moves only a cone narrower than a full circle', () => {
    expect(isMoving({ motion: spin(6, true), cone: { angle: 60, direction: 0 } })).toBe(true);
    expect(isMoving({ motion: spin(6, true), cone: { angle: 360, direction: 0 } })).toBe(false);
    expect(isMoving({ motion: spin(6, true) })).toBe(false);
    expect(isMoving({ cone: { angle: 60, direction: 0 } })).toBe(false);
  });

  it('turns the cone and keeps its width', () => {
    const cone = { angle: 60, direction: 10 };
    expect(coneAt({ cone }, 5)).toBe(cone);
    expect(coneAt({ motion: spin(6, true), cone }, 1)).toEqual({ angle: 60, direction: 46 });
  });
});

describe('motionTime', () => {
  afterEach(() => clearFreeze());

  it('is the wall clock in seconds, and 0 under a freeze', () => {
    expect(motionTime(5000)).toBe(5);
    (globalThis as { __GG_FREEZE__?: { minutes: number } }).__GG_FREEZE__ = { minutes: 600 };
    expect(motionTime(5000)).toBe(0);
  });
});

describe('a lighthouse: lights anchored together turn together, each from where it points', () => {
  // A wall-clock moment, far from 0, as on any real screen.
  const NOW = 1_795_000_123.37;
  const DIRS = [0, 90, 180, 270];
  type Beam = { cone: { angle: number; direction: number }; motion?: LightMotion };
  const beams = (): Beam[] => DIRS.map((direction) => ({ cone: { angle: 60, direction } }));
  /** Every beam given `next`, anchored at one moment, as the card's edit does. */
  const set = (lights: Beam[], next: (l: Beam) => LightMotion, now: number): Beam[] =>
    lights.map((l) => ({ ...l, motion: anchoredMotion(l, next(l), now) }));
  const angles = (lights: Beam[], t: number) => lights.map((l) => coneAt(l, t)!.direction);
  /** Each beam's angle on from the first, 0..360. */
  const spread = (lights: Beam[], t: number) => {
    const a = angles(lights, t);
    return a.map((d) => (((d - a[0]!) % 360) + 360) % 360);
  };
  const near = (got: number[], want: number[]) => got.forEach((g, i) => expect(Math.min(Math.abs(g - want[i]!), 360 - Math.abs(g - want[i]!))).toBeLessThan(1e-3));

  it('starting a spin makes no beam jump, and the four stay 90° apart as one at later times', () => {
    const spun = set(beams(), () => ({ kind: 'spin', rpm: 6, clockwise: true }), NOW);
    near(angles(spun, NOW), DIRS);
    for (const dt of [0.25, 1, 3.7, 10, 61.3, 3600]) {
      near(spread(spun, NOW + dt), DIRS);
      // One clock, one pace: 6 rpm is 36° a second.
      near([angles(spun, NOW + dt)[0]!], [(36 * dt) % 360]);
    }
  });

  it('a speed change mid-spin makes no beam jump and keeps the spread', () => {
    const spun = set(beams(), () => ({ kind: 'spin', rpm: 6, clockwise: true }), NOW);
    const later = NOW + 7.3;
    const before = angles(spun, later);
    const faster = set(spun, (l) => ({ ...(l.motion as Extract<LightMotion, { kind: 'spin' }>), rpm: 20 }), later);
    near(angles(faster, later), before);
    for (const dt of [0.5, 2, 9]) near(spread(faster, later + dt), DIRS);
    // And the way round: no jump either.
    const back = set(faster, (l) => ({ ...(l.motion as Extract<LightMotion, { kind: 'spin' }>), clockwise: false }), later + 2);
    near(angles(back, later + 2), angles(faster, later + 2));
    near(spread(back, later + 5), DIRS);
  });

  it('a sweep starts where each beam points, and a speed change keeps its place in the pass', () => {
    const swept = set(beams(), (l) => ({ kind: 'sweep', from: l.cone.direction - 45 + (l.cone.direction < 45 ? 360 : 0), to: l.cone.direction + 45, degPerSec: 45 }), NOW);
    near(angles(swept, NOW), DIRS);
    for (const dt of [0.3, 1.1, 2.6]) near(spread(swept, NOW + dt), DIRS);
    const later = NOW + 1.3;
    const before = angles(swept, later);
    const slower = set(swept, (l) => ({ ...(l.motion as Extract<LightMotion, { kind: 'sweep' }>), degPerSec: 20 }), later);
    near(angles(slower, later), before);
    // Still on the same way: a moment on, each has moved the same way as before the change.
    const step = (ls: Beam[], t: number) => angles(ls, t + 0.05).map((a, i) => Math.sign(((a - angles(ls, t)[i]! + 540) % 360) - 180));
    expect(step(slower, later)).toEqual(step(swept, later - 0.01));
  });

  it('the export and a freeze (t = 0) still draw the authored pose', () => {
    const spun = set(beams(), () => ({ kind: 'spin', rpm: 6, clockwise: true }), NOW + 12.9);
    near(angles(spun, 0), DIRS);
    const swept = set(beams(), (l) => ({ kind: 'sweep', from: (l.cone.direction + 300) % 360, to: (l.cone.direction + 60) % 360, degPerSec: 45 }), NOW);
    near(angles(swept, 0), DIRS.map((d) => (d + 300) % 360));
  });

  it('a map saved before the anchor turns from the clock\'s zero, as it always did', () => {
    expect(motionDirection({ kind: 'spin', rpm: 6, clockwise: true }, 0, 1)).toBeCloseTo(36);
  });
});
