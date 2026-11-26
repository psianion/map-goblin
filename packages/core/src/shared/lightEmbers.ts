// Embers: a light burning low. The light keeps its authored fields; what it lights with while
// it is on and `embers` is set is worked out here, so going back to On restores it exactly.
// The renderer, the light manager's sweep and the table's `effectiveLight` all read this.

import type { LightChild } from './types';

/** What embers do to a light: a third of its reach, 60 % of its strength, a deep red. */
export const EMBERS = { reach: 1 / 3, intensity: 0.6, color: '#d0451b' } as const;

type EmberFields = Pick<LightChild, 'visible' | 'radius' | 'featherRadius' | 'intensity' | 'color' | 'embers'>;

/** Whether a light is burning as embers right now: on, with `embers` set. */
export const burnsAsEmbers = (light: Pick<LightChild, 'visible' | 'embers'>): boolean =>
  light.visible !== false && light.embers === true;

/** The light as it lights: its embers values while it burns as embers, else the light itself, unchanged. */
export function shownLight<T extends EmberFields>(light: T): T {
  if (!burnsAsEmbers(light)) return light;
  return {
    ...light,
    radius: light.radius * EMBERS.reach,
    featherRadius: light.featherRadius * EMBERS.reach,
    intensity: light.intensity * EMBERS.intensity,
    color: EMBERS.color,
  };
}
