// D7/WP2 — the one merge every reader should use for the cloud's effective look: the map's
// authored default (`MapSettings.fogLook`, absent ⇒ the shader's own `DEFAULT_FOG_LOOK`),
// overridden field by field by the DM's live pick (`SceneFog.look`). `fogLookOf`
// (packages/mechanics/src/fog/types.ts) already does the second half of that merge; this adds
// only the authored-default fallback, so `FogRenderer` and `FogOverlay` compute the same look
// off the same two inputs instead of each open-coding the chain.

import type { MapSettings } from '@dnd/core/src/store/types';
import { fogLookOf, type SceneFog } from '@dnd/mechanics/fog';
import { DEFAULT_FOG_LOOK, type FogLook } from './livingFog';

export function effectiveFogLook(mapSettings: MapSettings, scene: SceneFog): FogLook {
  return fogLookOf(scene, mapSettings.fogLook ?? DEFAULT_FOG_LOOK);
}
