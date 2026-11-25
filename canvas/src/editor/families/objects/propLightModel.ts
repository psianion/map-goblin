// What the light rows read: the line under the dock's Add its light, and the prop card's Light
// section (the picked props' attached lights, their shared state, the pictures to show).

import { familyVariants, lightPropOf, type CatalogEntry } from '@dnd/core/src/assets/packCatalog';
import { lightPreset } from '@dnd/core/src/store/lightPresets';
import { lightsOnProp } from '@dnd/core/src/shared/lightSwitches';
import { sharedLightState, startStateOf, type LightState, type LightStates } from '@dnd/core/src/shared/propLights';
import type { AssetChild, Layer, LightChild } from '@/store/types';
import { setLightStateCommand } from '@dnd/core/src/store/lightCommands';
import { undoManager } from '@/store/undoManager';

const STARTS: Record<LightState, string> = { off: 'starts off', embers: 'starts as embers', on: 'starts on' };

/**
 * The line under Add its light, from the first prop in hand that brings a light: "Candle
 * light, starts on", "Brazier light, starts off". Null when none of them brings one (the
 * switch is then hidden).
 */
export function addLightNote(pool: readonly string[]): string | null {
  for (const id of pool) {
    const light = lightPropOf(id);
    if (!light) continue;
    return `${lightPreset(light.preset).label} light, ${STARTS[startStateOf(id, light.states)]}`;
  }
  return null;
}

/** The prop card's Light section for the picked props. */
export interface PropLightView {
  /** The pictures by state, from the first picked prop that has them; absent for a fixed picture. */
  states?: LightStates;
  /** Every light attached to a picked prop. */
  lights: LightChild[];
  /** What they share; `mixed` across props or lights that differ. */
  state: LightState | 'mixed';
  /** A picked light prop with no light of its own: Add a light. */
  bare: AssetChild[];
}

/** Whether the prop card shows its Light section for this prop: it brings a light or has one attached. */
export function showsLight(layers: readonly Layer[], prop: AssetChild): boolean {
  return prop.objectType === 'asset' && (!!lightPropOf(prop.assetId) || lightsOnProp(layers, prop.id).length > 0);
}

export function propLightView(layers: readonly Layer[], props: readonly AssetChild[]): PropLightView {
  const lights: LightChild[] = [];
  const bare: AssetChild[] = [];
  let states: LightStates | undefined;
  for (const p of props) {
    const own = lightsOnProp(layers, p.id);
    lights.push(...own);
    const light = lightPropOf(p.assetId);
    if (own.length === 0 && light) bare.push(p);
    if (!states && light?.states) states = light.states;
  }
  return { states, lights, state: sharedLightState(lights), bare };
}

/** Off and On, for a prop whose picture stays the same whatever its light does. */
export const ON_OFF = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
];

/** Lights put to `state`, with their groups, as one step (the State tiles and the Off/On seg). */
export function setPropLightState(lightIds: readonly string[], state: LightState): void {
  const cmd = setLightStateCommand(lightIds, state);
  if (cmd) undoManager.execute(cmd);
}

/** The Variant tiles for a prop showing `shown`: its variants, a light prop's by model (`familyVariants`). */
export function variantTiles(shown: string): CatalogEntry[] {
  return familyVariants(shown);
}
