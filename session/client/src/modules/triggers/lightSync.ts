// M5 — the live relight a DM's `light` trigger actually paints. A light child's on/off is
// nothing but its own `visible` flag: LightingRenderer's `getVisibleLights` (backed by
// LightManager) filters on it every frame, and the flag rides in that renderer's own cache
// signature, so a value flip alone earns a recomposite. (LightManager's dirty set tracks only
// geometry — position/radius/falloff — not visibility.) So playing `lightOverrides` back onto
// the core store's light children *is* the relight — no new pipeline, same shape as
// doors→lighting (D3 layer 1, `modules/doors/doorLighting.ts`).
//
// Two triggers, one drift check, mirroring the door lane exactly: a triggers command landing
// changes the overrides, and a fresh map load / scene switch changes the children back to
// their authored visibility out from under any override already in play. Either has to
// reapply the same drift, so both are watched and the empty-drift return is the recursion
// guard (writing the store re-enters this callback and the second pass finds nothing left).

import type { LightChild } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import { useStore } from '@dnd/core/src/store/store';
import { sceneTriggersOf, type TriggersState } from '@dnd/mechanics/triggers';
import { useSessionStore } from '../../session/store';

/** This scene's light overrides, or none while there is no scene/triggers state yet. */
function activeOverrides(): Record<string, boolean> {
  const session = useSessionStore.getState().session;
  const sceneId = session?.activeSceneId;
  const triggers = session?.modules?.triggers as TriggersState | undefined;
  if (!sceneId || !triggers) return {};
  return sceneTriggersOf(triggers, sceneId).lightOverrides;
}

/** Light ids whose map visibility disagrees with the scene's overrides, and what it should
 *  say instead. */
export function lightingDrift(
  overrides: Record<string, boolean>,
  layers: readonly Layer[],
): Map<string, boolean> {
  const drift = new Map<string, boolean>();
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const child of layer.children) {
      if (child.childType !== 'light') continue;
      const on = overrides[child.id];
      if (on !== undefined && child.visible !== on) drift.set(child.id, on);
    }
  }
  return drift;
}

/**
 * Fires whenever the drift inputs could have changed — a triggers command, a scene change, or
 * a new map. Both stores replace their slices wholesale, so identity is the whole test (same
 * as `subscribeLiveDoors`).
 */
function subscribeLiveLights(onChange: () => void): () => void {
  let last: unknown[] = [];
  const check = () => {
    const session = useSessionStore.getState().session;
    const next = [session?.modules?.triggers, session?.activeSceneId, useStore.getState().layers];
    if (next.length === last.length && next.every((v, i) => v === last[i])) return;
    last = next;
    onChange();
  };
  check();
  const unsubSession = useSessionStore.subscribe(check);
  const unsubMap = useStore.subscribe(check);
  return () => {
    unsubSession();
    unsubMap();
  };
}

/**
 * Keep the loaded map's lights at the state the table is playing them at. Call from an
 * effect; the returned function is the effect's cleanup.
 */
export function syncLightsToScene(): () => void {
  return subscribeLiveLights(() => {
    const drift = lightingDrift(activeOverrides(), useStore.getState().layers);
    if (drift.size === 0) return;
    useStore.setState((state) => {
      for (const layer of state.layers) {
        if (layer.type !== 'dungeon') continue;
        for (const child of layer.children) {
          if (child.childType !== 'light') continue;
          const next = drift.get(child.id);
          if (next !== undefined) (child as LightChild).visible = next;
        }
      }
    });
  });
}
