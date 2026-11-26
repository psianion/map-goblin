// Pure pieces the Light tool and the light card share: bright and dim in feet over cells,
// keeping bright inside dim, the cone and effect as the controls hold them, and the prop a
// light would attach to.

import type { AssetChild, DungeonLayer, LightChild } from '@/store/types';
import { LIGHT_RADIUS_FT } from '@dnd/core/src/store/lightPresets';

export { LIGHT_RADIUS_FT };

/** The light fields both the next light (lightDefaults) and a placed light carry. */
export type LightLike = Pick<LightChild, 'radius' | 'featherRadius' | 'cone' | 'animation'>;

export const CONE_RANGE = { min: 10, max: 360, step: 5 } as const;
export const DIRECTION_RANGE = { min: 0, max: 355, step: 5 } as const;
export const SPEED_RANGE = { min: 0.25, max: 4, step: 0.25 } as const;
export const INTENSITY_RANGE = { min: 0.1, max: 1, step: 0.05 } as const;

export type Effect = 'none' | 'flicker' | 'pulse';
export const EFFECTS: { value: Effect; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'flicker', label: 'Flicker' },
  { value: 'pulse', label: 'Pulse' },
];

export const toFt = (cells: number, ftPerCell: number): number => Math.round(cells * (ftPerCell || 5));
export const toCells = (ft: number, ftPerCell: number): number => ft / (ftPerCell || 5);

/** Feet held to the range and its 5 ft step. */
export function clampFt(ft: number): number {
  const { min, max, step } = LIGHT_RADIUS_FT;
  return Math.min(max, Math.max(min, Math.round(ft / step) * step));
}

/** Bright at `ft`; dim follows when bright passes it. Cells. */
export function brightPatch(light: LightLike, ft: number, ftPerCell: number): Partial<LightLike> {
  const cells = toCells(clampFt(ft), ftPerCell);
  return cells > light.radius ? { featherRadius: cells, radius: cells } : { featherRadius: cells };
}

/** Dim at `ft`; bright follows when dim falls under it. Cells. */
export function dimPatch(light: LightLike, ft: number, ftPerCell: number): Partial<LightLike> {
  const cells = toCells(clampFt(ft), ftPerCell);
  return cells < light.featherRadius ? { radius: cells, featherRadius: cells } : { radius: cells };
}

/** The cone's angle in degrees; 360, a full circle, when it has none. */
export const coneAngle = (l: LightLike): number => Math.min(360, l.cone?.angle ?? 360);
export const coneDirection = (l: LightLike): number => l.cone?.direction ?? 0;

/** The cone at `angle`, keeping its direction; a full circle stores nothing. */
export function conePatch(l: LightLike, angle: number): Pick<LightLike, 'cone'> {
  return { cone: angle >= 360 ? undefined : { angle, direction: coneDirection(l) } };
}

export const effectOf = (l: LightLike): Effect => l.animation?.kind ?? 'none';
export const speedOf = (l: LightLike): number => l.animation?.speed ?? 1;

export function animationFor(effect: Effect, speed: number): LightChild['animation'] {
  return effect === 'none' ? undefined : { kind: effect, speed };
}

/** Within half a cell of a prop's centre a light can be glued to it (the Light tool's rule). */
export const ATTACH_RADIUS = 0.5;

/** The prop a free light would attach to: the nearest on its layer within half a cell. */
export function nearestProp(layer: DungeonLayer, light: LightChild): AssetChild | null {
  let best: AssetChild | null = null;
  let bestDist = ATTACH_RADIUS;
  for (const c of layer.children) {
    if (c.childType !== 'asset') continue;
    const d = Math.hypot(c.position.x - light.position.x, c.position.y - light.position.y);
    if (d <= bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

/* ── Motion ───────────────────────────────────────────── */

export type MotionKind = 'still' | 'spin' | 'sweep';

export const motionKindOf = (l: Pick<LightChild, 'motion'>): MotionKind => l.motion?.kind ?? 'still';

/** A spin's default pace, turns a minute, and a sweep's, degrees a second. */
export const SPIN_DEFAULT_RPM = 6;
export const SWEEP_DEFAULT_DEG_PER_SEC = 45;
/** A new sweep runs this far either side of where the cone points now. */
const SWEEP_HALF_SPAN = 45;

const wrap = (deg: number): number => ((Math.round(deg) % 360) + 360) % 360;

/** The motion `kind` starts as on light `l`: a spin clockwise at 6 rpm, a sweep 45° either side of its direction. */
export function motionFor(kind: MotionKind, l: Pick<LightChild, 'cone' | 'motion'>): LightChild['motion'] {
  if (kind === 'still') return undefined;
  if (l.motion?.kind === kind) return l.motion;
  if (kind === 'spin') return { kind: 'spin', rpm: SPIN_DEFAULT_RPM, clockwise: true };
  const d = coneDirection(l as LightLike);
  return { kind: 'sweep', from: wrap(d - SWEEP_HALF_SPAN), to: wrap(d + SWEEP_HALF_SPAN), degPerSec: SWEEP_DEFAULT_DEG_PER_SEC };
}

/* ── Groups list ──────────────────────────────────────── */

/** One row of the Light tool's Groups list. */
export interface GroupRowModel {
  name: string;
  /** Every light in the group, on any level. */
  ids: string[];
  /** What its switch reaches: the group less locked lights and lights on locked layers, as every switch leaves them. */
  switchIds: string[];
  /** "4 lights", or "2 of 4 on" while some are on and some off. */
  count: string;
  on: 'all' | 'none' | 'some';
}

/**
 * The Groups list's rows, one per group, in the order given (by name). `lockedOut` says which
 * lights a switch must leave alone (locked, or on a locked layer); they still count.
 */
export function groupRows(
  groups: readonly { name: string; lights: readonly LightChild[] }[],
  lockedOut: (l: LightChild) => boolean = (l) => !!l.locked,
): GroupRowModel[] {
  return groups.map(({ name, lights }) => {
    const lit = lights.filter((l) => l.visible !== false).length;
    const n = lights.length;
    const on = lit === n ? 'all' : lit === 0 ? 'none' : 'some';
    const switchIds = lights.filter((l) => !lockedOut(l)).map((l) => l.id);
    return { name, ids: lights.map((l) => l.id), switchIds, count: on === 'some' ? `${lit} of ${n} on` : `${n} ${n === 1 ? 'light' : 'lights'}`, on };
  });
}
