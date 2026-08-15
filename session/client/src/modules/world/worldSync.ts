// The Table's clock, handed to the engine — the one thing this surface knows that the Editor
// does not.
//
// Everything the world clock decides (the composed grade, the lighting pass's time bucket, the
// sun the P3 shadow pass extrudes along) is composed inside core's render loop from the map's
// own settings plus one number: what time it is. The Editor composes that number from the map
// (the scrub head, or a fixed hour); here it is the campaign's, off the same resolver the
// referee gates sight with, so the badge, the mask and the picture cannot disagree.
//
// Shaped like `syncLightsToScene`/`syncDoorsToLighting`: a subscription on both stores, slice
// identity as the whole test, and a cleanup the mounting effect returns.

import { setTableWorld } from '@dnd/core/src/engine/worldOverride';
import { useStore } from '@dnd/core/src/store/store';
import { worldLightOf, type TriggersState } from '@dnd/mechanics/triggers';
import { useSessionStore } from '../../session/store';

/** The world over the scene the table is playing, or `null` before the join snapshot lands. */
function activeWorld(): Parameters<typeof setTableWorld>[0] {
  const session = useSessionStore.getState().session;
  const sceneId = session?.activeSceneId;
  const triggers = session?.modules?.triggers as TriggersState | undefined;
  if (!sceneId || !triggers) return null;
  const light = worldLightOf(useStore.getState().mapSettings, triggers, sceneId);
  return { minutes: light.minutes, sun: light.sun };
}

/**
 * Keep the engine standing at the campaign's own hour. Call from an effect; the returned
 * function is the effect's cleanup, and it hands the clock back to the surface.
 */
export function syncWorldToScene(): () => void {
  let last: unknown[] = [];
  const check = (): void => {
    const session = useSessionStore.getState().session;
    const next = [
      session?.modules?.triggers,
      session?.activeSceneId,
      useStore.getState().mapSettings,
    ];
    if (next.length === last.length && next.every((v, i) => v === last[i])) return;
    last = next;
    setTableWorld(activeWorld());
  };
  check();
  const unsubSession = useSessionStore.subscribe(check);
  const unsubMap = useStore.subscribe(check);
  return () => {
    unsubSession();
    unsubMap();
    setTableWorld(null);
  };
}
