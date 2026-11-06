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
