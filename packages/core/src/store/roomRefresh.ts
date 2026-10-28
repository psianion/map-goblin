import type { DoorChild } from '../shared/types';
import { syncRooms } from './roomSync';
import { useStore } from './store';

/** How long wall/floor edits must settle before rooms are refreshed. */
const DEBOUNCE_MS = 250;

/**
 * Refresh every dungeon layer's rooms and door bindings in the store
 * (`syncRooms`). Faces, orphan flags and door→room bindings are derived from
 * geometry, so they are written straight to the store and never land on the undo
 * stack; the command that moved the geometry re-runs this after its own
 * execute/undo (`undoManager`), which keeps the binding in the same entry.
 */
export function refreshRooms(): void {
  // A command that commits geometry runs this directly, and the store change it
  // made has already armed the debounce. Drop that pending pass: this one is
  // reading the same state, and anything later re-arms the timer anyway.
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  for (const layer of useStore.getState().layers) {
    if (layer.type !== 'dungeon') continue;
    const { rooms, doorRooms, changed } = syncRooms(layer);

    const doorsMoved = layer.children.some((c) => {
      if (c.childType !== 'door') return false;
      const next = doorRooms.get(c.id);
      return !!next && (next.roomA !== c.roomA || next.roomB !== c.roomB);
    });
    // Nothing moved: no write, so nothing downstream (overlay, lighting key,
    // autosave) sees a new layer for a pass that changed nothing.
    if (!changed && !doorsMoved) continue;

    // Rooms and the bindings derived from them are one write: they are the same
    // recomputation, and two setStates means every subscriber runs twice — once on
    // a layer whose doors still point at rooms that have moved.
    useStore.setState((s) => {
      const target = s.layers.find((l) => l.id === layer.id);
      if (!target || target.type !== 'dungeon') return;
      if (changed) target.rooms = rooms;
      if (!doorsMoved) return;
      for (const child of target.children) {
        if (child.childType !== 'door') continue;
        const door = child as DoorChild;
        const next = doorRooms.get(door.id);
        if (!next) continue;
        door.roomA = next.roomA;
        door.roomB = next.roomB;
      }
    });
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Debounced {@link refreshRooms} — geometry edits arrive in bursts (every node of
 * a wall drag), and the Clipper2 subtraction is the expensive part.
 */
export function scheduleRoomSync(delayMs = DEBOUNCE_MS): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    refreshRooms();
  }, delayMs);
}
