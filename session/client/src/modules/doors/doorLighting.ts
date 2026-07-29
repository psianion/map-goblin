// D3 layer 1 / D12 — the live door state the lighting engine reads. Always on, both roles:
// a shut door stops light on the DM's canvas exactly as it does on a player's.
//
// There is no new pipeline here, and that is the point. Core's sight pass is already a pure
// function of the walls and the *door children of the core store* — `extractWallSegments`
// hands them to `buildOcclusionSegments`, which treats anything not `open` as a wall — and
// `subscribeToStore` already invalidates every light polygon when a door child's `state`
// changes. So feeding ClockwiseSweep the table's answer is writing that answer onto the
// map's own doors. Core stays untouched (§2.5), and the editor's door art follows for free.

import type { DoorChild, DoorState } from '@dnd/core/src/shared/types';
import { useStore } from '@dnd/core/src/store/store';
import type { DoorLiveState } from '@dnd/mechanics/doors';
import type { LiveDoor } from './doors';
import { liveSceneDoors, subscribeLiveDoors } from './DoorRenderer';

/**
 * The authored state a live door should be playing at. Locked is a shut door that will not
 * budge — occlusion.ts already blocks light on both, so this keeps the distinction only
 * because the map's own door art draws them differently.
 */
export const authoredStateOf = (live: DoorLiveState): DoorState =>
  live.open ? 'open' : live.locked ? 'locked' : 'closed';

/** Doors whose map state disagrees with the table's, and what the map should say instead. */
export function lightingDrift(doors: readonly LiveDoor[]): Map<string, DoorState> {
  const drift = new Map<string, DoorState>();
  for (const { door, live } of doors) {
    const next = authoredStateOf(live);
    if (door.state !== next) drift.set(door.id, next);
  }
  return drift;
}

/**
 * Keep the loaded map's doors at the state the table is playing them at. Call from an
 * effect; the returned function is the effect's cleanup.
 *
 * The empty-drift early return is also the recursion guard: writing to the core store
 * re-enters this callback (`subscribeLiveDoors` watches both stores), and the second pass
 * finds nothing to change.
 */
export function syncDoorsToLighting(): () => void {
  return subscribeLiveDoors(() => {
    const drift = lightingDrift(liveSceneDoors());
    if (drift.size === 0) return;
    useStore.setState((state) => {
      for (const layer of state.layers) {
        if (layer.type !== 'dungeon') continue;
        for (const child of layer.children) {
          if (child.childType !== 'door') continue;
          const next = drift.get(child.id);
          if (next) (child as DoorChild).state = next;
        }
      }
    });
  });
}
