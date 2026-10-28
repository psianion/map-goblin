// Every light edit as one Command (one undo entry). Callers run `undoManager.execute()` on
// the result. The invariants a light keeps live here, so the card, the dock, the context
// menu and the canvas handles cannot write a light the renderer has to second-guess:
// bright edge <= dim edge, cone 10..360 degrees, animation speed 0.25..4.

import type { LightChild } from '../shared/types';
import type { Command, Layer } from './types';
import { UpdateChildCommand } from './commands';
import { useStore } from './store';

/** The light fields an edit may write. `undefined` on a key removes it (back to its default). */
export type LightPatch = Partial<
  Pick<
    LightChild,
    | 'name'
    | 'visible'
    | 'color'
    | 'radius'
    | 'featherRadius'
    | 'intensity'
    | 'falloff'
    | 'position'
    | 'attachedTo'
    | 'cone'
    | 'animation'
    | 'throughWalls'
    | 'nightOnly'
    | 'darkness'
    | 'darkvisionSees'
    | 'tableOn'
  >
>;

export const CONE_ANGLE = { min: 10, max: 360 } as const;
export const ANIMATION_SPEED = { min: 0.25, max: 4 } as const;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function findLight(layers: readonly Layer[], id: string): { layerId: string; light: LightChild } | null {
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const c of layer.children) if (c.id === id && c.childType === 'light') return { layerId: layer.id, light: c };
  }
  return null;
}

/**
 * `patch` made legal against `light`: the bright edge never past the dim edge (moving the dim
 * edge in drags the bright one with it; pushing the bright edge out stops at the dim one),
 * radii never negative, the cone and the speed in range, a night-only window ordered.
 */
export function clampLightPatch(light: LightChild, patch: LightPatch): LightPatch {
  const out: LightPatch = { ...patch };
  if (out.radius !== undefined) out.radius = Math.max(0, out.radius);
  if (out.featherRadius !== undefined) out.featherRadius = Math.max(0, out.featherRadius);
  const radius = out.radius ?? light.radius;
  const feather = out.featherRadius ?? light.featherRadius;
  if (feather > radius) out.featherRadius = radius;
  if (out.intensity !== undefined) out.intensity = clamp(out.intensity, 0, 1);
  if (out.cone) {
    out.cone = {
      angle: clamp(out.cone.angle, CONE_ANGLE.min, CONE_ANGLE.max),
      direction: ((out.cone.direction % 360) + 360) % 360,
    };
  }
  if (out.animation) {
    out.animation = { ...out.animation, speed: clamp(out.animation.speed, ANIMATION_SPEED.min, ANIMATION_SPEED.max) };
  }
  if (out.nightOnly) {
    const a = clamp(out.nightOnly.min, 0, 1);
    const b = clamp(out.nightOnly.max, 0, 1);
    out.nightOnly = { min: Math.min(a, b), max: Math.max(a, b) };
  }
  return out;
}

/** The values `light` holds now for each key `patch` writes. */
function beforeOf(light: LightChild, patch: LightPatch): LightPatch {
  const before: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) before[key] = (light as unknown as Record<string, unknown>)[key];
  return before as LightPatch;
}

/**
 * One undo entry for an edit of light `id`, clamped (`clampLightPatch`). `before` is for a
 * gesture that previewed its values straight onto the store while dragging: pass the values
 * from before the drag, so undo lands where the gesture started. Null when there is no such
 * light or nothing to write.
 */
export function setLightFields(id: string, patch: LightPatch, before?: LightPatch, label = 'Edit light'): Command | null {
  const found = findLight(useStore.getState().layers, id);
  if (!found || Object.keys(patch).length === 0) return null;
  const after = clampLightPatch(found.light, patch);
  const prior = before ? { ...beforeOf(found.light, after), ...before } : beforeOf(found.light, after);
  return new UpdateChildCommand(label, found.layerId, id, prior, after);
}

/**
 * Turns a light into a darkness source or back. The radii stay; the colour is dropped from
 * play (a darkness source burns no colour, so the renderer ignores it) but kept stored, so
 * turning it back restores the light it was. Turning darkness off also clears
 * `darkvisionSees`, which only a darkness source reads.
 */
export function toggleDarkness(id: string): Command | null {
  const found = findLight(useStore.getState().layers, id);
  if (!found) return null;
  const on = !found.light.darkness;
  const patch: LightPatch = on ? { darkness: true } : { darkness: undefined, darkvisionSees: undefined };
  return setLightFields(id, patch, undefined, on ? 'Make darkness' : 'Make light');
}

/** Glues light `id` to asset `assetId`: it then moves with the asset and is deleted with it. */
export function attachLight(id: string, assetId: string): Command | null {
  return setLightFields(id, { attachedTo: assetId }, undefined, 'Attach light');
}

/** Frees light `id` from the asset it follows. Null when it follows nothing. */
export function detachLight(id: string): Command | null {
  const found = findLight(useStore.getState().layers, id);
  if (!found?.light.attachedTo) return null;
  return setLightFields(id, { attachedTo: undefined }, undefined, 'Detach light');
}
