// Moving cones: a cone light that spins or sweeps. Where it points is a pure function of the
// wall clock, so every screen that draws it (the editor, the DM's table, each player's) shows
// the same angle at the same moment without a message ever being sent.

import type { LightChild, LightMotion } from './types';
import { isFrozen } from './freeze';

/** Spin speed range, turns per minute. */
export const SPIN_RPM = { min: 1, max: 30, step: 1 } as const;
/** Sweep speed range, degrees per second. */
export const SWEEP_DEG_PER_SEC = { min: 5, max: 180, step: 5 } as const;

/**
 * The motion clock, seconds: the wall clock (`Date.now`), which every client shares as far as
 * their system clocks agree. 0 under a freeze, and the export passes 0 itself.
 */
export function motionTime(nowMs: number = Date.now()): number {
  return isFrozen() ? 0 : nowMs / 1000;
}

/** Whether a light moves: it has a motion and a cone narrower than a full circle. */
export function isMoving(light: Pick<LightChild, 'motion' | 'cone'>): boolean {
  return !!light.motion && !!light.cone && light.cone.angle < 360;
}

const wrap = (deg: number): number => ((deg % 360) + 360) % 360;

/** The fractional part of `x`, kept in [0, 1) for negative `x` too. */
const frac = (x: number): number => x - Math.floor(x);

/** How far a sweep travels clockwise from `from` to `to`, degrees, 0..360. */
export function sweepSpan(motion: Extract<LightMotion, { kind: 'sweep' }>): number {
  return wrap(motion.to - motion.from);
}

/**
 * Seconds a motion has run at `t`: from its anchor (`since`, 0 when absent). `t` = 0 is the
 * authored pose (the export and `?freeze=` pass it), where every motion is at its start.
 */
function elapsed(motion: LightMotion, t: number): number {
  return t === 0 ? 0 : t - (motion.since ?? 0);
}

/** A sweep's place in its there-and-back at `t`, 0..1: 0 at `from`, 0.5 at `to`. */
function sweepPhase(motion: Extract<LightMotion, { kind: 'sweep' }>, t: number): number {
  const span = sweepSpan(motion);
  if (span === 0 || motion.degPerSec <= 0) return 0;
  // One there-and-back pass covers twice the span.
  return frac(elapsed(motion, t) / ((2 * span) / motion.degPerSec));
}

/**
 * Where a moving cone points at `t` seconds, degrees (0 = east, clockwise). A spin turns from
 * `direction` at `rpm`, either way round. A sweep runs from `from` to `to` and back, clockwise
 * from `from`, easing at both edges (a sine) so it never bounces; its speed is the average
 * over a pass. Time runs from the motion's anchor (`since`) on the one shared clock, so lights
 * anchored together turn together, each from its own direction. At t = 0 (the export, a
 * freeze) a spin points at `direction` and a sweep at `from`.
 */
export function motionDirection(motion: LightMotion, direction: number, t: number): number {
  if (motion.kind === 'spin') {
    const turns = frac((elapsed(motion, t) * Math.max(0, motion.rpm)) / 60);
    return wrap(direction + (motion.clockwise ? 1 : -1) * turns * 360);
  }
  const span = sweepSpan(motion);
  if (span === 0 || motion.degPerSec <= 0) return wrap(motion.from);
  return wrap(motion.from + (span * (1 - Math.cos(2 * Math.PI * sweepPhase(motion, t)))) / 2);
}

/**
 * `next` anchored (`since`) so the light goes on pointing where it is drawn at `now`: setting a
 * motion, changing its speed or way round, or going from spin to sweep never makes the beam
 * jump. Anchor every light of one edit at the same `now`, and beams that turned together keep
 * turning together, each from where it points. A sweep that keeps its edges keeps its place in
 * the pass (and its way of travel); a new sweep starts on its outward pass at the drawn angle
 * when that lies between the edges, else at the nearer edge.
 */
export function anchoredMotion(light: Pick<LightChild, 'motion' | 'cone'>, next: LightMotion, now: number): LightMotion {
  const direction = light.cone?.direction ?? 0;
  const drawn = coneAt(light, now)?.direction ?? direction;
  if (next.kind === 'spin') {
    if (next.rpm <= 0) return { ...next, since: now };
    const turns = frac(((next.clockwise ? 1 : -1) * (drawn - direction)) / 360);
    return { ...next, since: now - (turns * 60) / next.rpm };
  }
  const span = sweepSpan(next);
  if (span === 0 || next.degPerSec <= 0) return { ...next, since: now };
  const prev = light.motion;
  let phase: number;
  if (prev?.kind === 'sweep' && isMoving(light) && prev.from === next.from && prev.to === next.to) {
    phase = sweepPhase(prev, now);
  } else {
    const u = wrap(drawn - next.from);
    if (u <= span) phase = Math.acos(Math.min(1, Math.max(-1, 1 - (2 * u) / span))) / (2 * Math.PI);
    else phase = 360 - u <= u - span ? 0 : 0.5;
  }
  return { ...next, since: now - phase * ((2 * span) / next.degPerSec) };
}

/** The cone a light points with at `t`: its authored cone, turned by its motion when it moves. */
export function coneAt(light: Pick<LightChild, 'motion' | 'cone'>, t: number): LightChild['cone'] {
  if (!isMoving(light)) return light.cone;
  return { angle: light.cone!.angle, direction: motionDirection(light.motion!, light.cone!.direction, t) };
}
