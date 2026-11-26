// The prop a light is attached to, as the light card reads it.

import { useStore } from '@/store/store';
import { selectChildById } from '@/store/selectors';
import { lightPropOf } from '@dnd/core/src/assets/packCatalog';
import type { LightStates } from '@dnd/core/src/shared/propLights';
import type { LightChild, MapBuilderStore } from '@/store/types';

/** The pictures by state of the prop a light is attached to, or none. */
export function hostStates(l: Pick<LightChild, 'attachedTo'>): LightStates | undefined {
  if (!l.attachedTo) return undefined;
  const host = selectChildById(useStore.getState() as MapBuilderStore, l.attachedTo);
  return host?.childType === 'asset' ? lightPropOf(host.assetId)?.states : undefined;
}
