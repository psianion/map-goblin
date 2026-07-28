import type { DoorChild } from '../shared/types';
import { detectRooms } from '../engine/roomDetection';
import { bindDoorToRooms } from '../shared/roomBinding';
import { useStore } from './store';

/**
 * World units are grid cells — 1 unit = 1 cell everywhere in the editor, so
 * room detection's grid parameter is a constant rather than a store read.
 */
const GRID_SIZE = 1;

/** How long wall/floor edits must settle before rooms are recomputed. */
const DEBOUNCE_MS = 250;

/**
 * Recompute rooms for every dungeon layer from its merged floor and walls.
 *
 * This is also the format backfill: `rooms` is optional on disk, so a file
 * saved before rooms existed simply arrives with none and gets them here — no
 * version bump, no migration step. `roomNameOverrides` is fed back in so a
 * renamed room keeps its name across re-detection.
 */
export function syncRooms(): void {
  for (const layer of useStore.getState().layers) {
    if (layer.type !== 'dungeon') continue;
    const rooms = detectRooms(
      layer.mergedFloor ?? [],
      layer.standaloneWalls,
      GRID_SIZE,
      layer.roomNameOverrides ?? {},
    );
    useStore.getState().setRooms(layer.id, rooms);

    // Door→room binding is derived from geometry, not user intent, so it is
    // written straight to the store and never lands on the undo stack.
    useStore.setState((s) => {
      const target = s.layers.find((l) => l.id === layer.id);
      if (!target || target.type !== 'dungeon') return;
      for (const child of target.children) {
        if (child.childType !== 'door') continue;
        const door = child as DoorChild;
        const bound = bindDoorToRooms(door, target.standaloneWalls, rooms);
        door.roomA = bound.roomA;
        door.roomB = bound.roomB;
      }
    });
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Debounced {@link syncRooms} — geometry edits arrive in bursts (every node of
 * a wall drag), and Clipper2 subdivision is the expensive part.
 */
export function scheduleRoomSync(delayMs = DEBOUNCE_MS): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    syncRooms();
  }, delayMs);
}
