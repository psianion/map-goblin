import type { DoorChild } from '../shared/types';
import { detectRooms } from '../engine/roomDetection';
import { bindDoorToRooms } from '../shared/roomBinding';
import { resolveDoors, resolveWalls, toOcclusionDoors } from '../shared/wallResolve';
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
  // A command that commits geometry runs this directly, and the store change it
  // made has already armed the debounce. Drop that pending pass: this one is
  // reading the same state, and anything later re-arms the timer anyway.
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  for (const layer of useStore.getState().layers) {
    if (layer.type !== 'dungeon') continue;
    const rooms = detectRooms(
      layer.mergedFloor ?? [],
      layer.standaloneWalls,
      GRID_SIZE,
      layer.roomNameOverrides ?? {},
    );
    // Bind against resolved geometry, not the authored fields: a door on a
    // floor-ring edge has no `wallId` to look up, and both position and angle
    // on the child go stale the moment the wall under it is edited. A detached
    // door is absent from this list and keeps whatever it was bound to last.
    //
    // ponytail: every door rebinds, not just the ones whose wall moved. A room
    // boundary can move anywhere the geometry changed, so `detectRooms` above
    // has to run wholesale regardless — and it is the expensive half (~8ms vs
    // ~6ms for 40 doors across 100 rooms). Narrow to a touched set only if the
    // probes, which are O(doors x rooms), start showing up on a real map.
    const walls = resolveWalls(layer);
    const bindable = toOcclusionDoors(resolveDoors(layer, walls));
    const bound = new Map(
      bindable.map((d) => [d.id, bindDoorToRooms(d, walls, rooms)] as const),
    );

    // Rooms and the bindings derived from them are one write: they are the same
    // recomputation, and two setStates means every subscriber runs twice — once
    // on a layer whose doors still point at the rooms that no longer exist.
    // Door→room binding is derived from geometry, not user intent, so it is
    // written straight to the store and never lands on the undo stack.
    useStore.setState((s) => {
      const target = s.layers.find((l) => l.id === layer.id);
      if (!target || target.type !== 'dungeon') return;
      target.rooms = rooms;
      for (const child of target.children) {
        if (child.childType !== 'door') continue;
        const door = child as DoorChild;
        const next = bound.get(door.id);
        if (!next) continue;
        door.roomA = next.roomA;
        door.roomB = next.roomB;
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
