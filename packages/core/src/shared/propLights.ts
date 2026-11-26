// Light props: a prop whose picture follows the lights attached to it. The pack says which
// pictures a prop has (its entry's `light.states`, packCatalog); everything here is derived
// from that and the lights, so nothing about the picture is ever saved on the prop.

import type { AssetChild, LightChild } from './types';

/** A light prop's pictures by state, as full asset ids. A lit/unlit pair has no `embers`. */
export interface LightStates {
  off?: string;
  embers?: string;
  on?: string;
}

/** What a light, or a set of lights, is doing: Off, Embers or On, or Mixed across several. */
export type LightState = 'off' | 'embers' | 'on';

/** One light's state: off when switched off, embers when burning low, else on. */
export function lightStateOf(light: Pick<LightChild, 'visible' | 'embers'>): LightState {
  if (light.visible === false) return 'off';
  return light.embers ? 'embers' : 'on';
}

/** The state several lights share, or `mixed`; `off` for none. */
export function sharedLightState(lights: readonly Pick<LightChild, 'visible' | 'embers'>[]): LightState | 'mixed' {
  if (lights.length === 0) return 'off';
  const first = lightStateOf(lights[0]!);
  return lights.every((l) => lightStateOf(l) === first) ? first : 'mixed';
}

/**
 * The picture a prop shows: its own `assetId` when it has no states or no attached light;
 * otherwise On while any attached light burns (Embers when the burning ones are all embers and
 * the prop has an embers picture), Off when every one is switched off. A state the prop has no
 * picture for keeps its own.
 */
export function shownAssetId(
  prop: Pick<AssetChild, 'assetId'>,
  states: LightStates | undefined,
  attached: readonly Pick<LightChild, 'visible' | 'embers'>[],
): string {
  if (!states || attached.length === 0) return prop.assetId;
  const burning = attached.filter((l) => l.visible !== false);
  if (burning.length === 0) return states.off ?? prop.assetId;
  if (states.embers && burning.every((l) => l.embers)) return states.embers;
  return states.on ?? prop.assetId;
}

/**
 * The state a newly placed light prop's light starts in, read off the picture placed: the
 * unlit picture starts Off, a brazier's embers picture Embers, anything else On (a fixed
 * picture, or the lit one).
 */
export function startStateOf(assetId: string, states: LightStates | undefined): LightState {
  if (!states) return 'on';
  if (assetId === states.off) return 'off';
  if (assetId === states.embers) return 'embers';
  return 'on';
}

/** The light fields that put a light in `state`. Off keeps `embers`, so switching back on restores it. */
export function lightStatePatch(state: LightState): Pick<LightChild, 'visible'> & { embers?: true | undefined } {
  if (state === 'off') return { visible: false };
  return state === 'embers' ? { visible: true, embers: true } : { visible: true, embers: undefined };
}

/** Lights by the prop they are attached to, from every dungeon layer. Rebuild when `layers` changes. */
export function lightsByHost(
  layers: readonly { type: string; children?: readonly { childType: string }[] }[],
): Map<string, LightChild[]> {
  const out = new Map<string, LightChild[]>();
  for (const layer of layers) {
    if (layer.type !== 'dungeon' || !layer.children) continue;
    for (const c of layer.children) {
      if (c.childType !== 'light') continue;
      const light = c as LightChild;
      if (!light.attachedTo) continue;
      const list = out.get(light.attachedTo);
      if (list) list.push(light);
      else out.set(light.attachedTo, [light]);
    }
  }
  return out;
}
