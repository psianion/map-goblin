// Door edits that move the walls around the doorway with them (shared/doorwaySeal.ts):
// a width, a style that changes the width, a slide along the wall. Each is one undo
// step: the door's fields and every wall piece that follows it, together.

import { useStore } from './store';
import { CompositeCommand, UpdateChildCommand, UpdateWallCommand } from './commands';
import type { Command, DungeonLayer } from './types';
import type { AnyChild, DoorChild } from '../shared/types';
import { sealDoorway, type DoorwaySeal } from '../shared/doorwaySeal';

/**
 * One undo step for a door edit on `layer` (the layer as it stood before the edit):
 * `before`/`after` are the door fields the caller changes (style, say), and `next` the
 * width and/or centre it ends at. When the door sits in a doorway, the door's width and
 * centre and the walls bounding it ride along; otherwise it is the door's fields alone,
 * with `next.width` among them.
 */
export function doorwayEditCommand(
  label: string,
  layer: DungeonLayer,
  doorId: string,
  before: Partial<DoorChild>,
  after: Partial<DoorChild>,
  next: { width?: number; at?: [number, number] },
): Command | null {
  const door = layer.children.find((c): c is DoorChild => c.id === doorId && c.childType === 'door');
  if (!door) return null;
  const seal = sealDoorway(layer, doorId, next);
  const doorBefore: Partial<DoorChild> = { ...before };
  const doorAfter: Partial<DoorChild> = { ...after };
  if (seal) {
    Object.assign(doorBefore, { width: door.width, position: [...door.position] });
    Object.assign(doorAfter, seal.door);
  } else if (next.width !== undefined) {
    doorBefore.width = door.width;
    doorAfter.width = next.width;
  }
  const changed = (Object.keys(doorAfter) as (keyof DoorChild)[]).some(
    (k) => JSON.stringify(doorAfter[k]) !== JSON.stringify(door[k]),
  );
  if (!changed && !seal?.walls.length) return null;
  const doorCmd = new UpdateChildCommand(label, layer.id, doorId, doorBefore as Partial<AnyChild>, doorAfter as Partial<AnyChild>);
  if (!seal?.walls.length) return doorCmd;
  return new CompositeCommand(label, [
    doorCmd,
    ...seal.walls.map((w) => new UpdateWallCommand(layer.id, w.id, { points: w.before }, { points: w.after })),
  ]);
}

/**
 * Writes a door edit live, off the undo stack, for a drag in progress: computed from
 * `from` (the layer as the gesture found it) every tick, so the walls never drift. Pair
 * it with `doorwayEditCommand` on the same `from` when the gesture ends.
 */
export function writeDoorwayLive(
  from: DungeonLayer,
  doorId: string,
  patch: Partial<DoorChild>,
  next: { width?: number; at?: [number, number] },
): DoorwaySeal | null {
  const seal = sealDoorway(from, doorId, next);
  // Every wall the gesture could have moved goes back to where it started, then the seal lands.
  const touched = new Map(from.standaloneWalls.map((w) => [w.id, w.points]));
  useStore.setState((s) => {
    const l = s.layers.find((x) => x.id === from.id);
    if (!l || l.type !== 'dungeon') return;
    const layer = l as DungeonLayer;
    const door = layer.children.find((c) => c.id === doorId) as DoorChild | undefined;
    if (!door) return;
    Object.assign(door, patch);
    if (seal) Object.assign(door, seal.door);
    else if (next.width !== undefined) door.width = next.width;
    for (const w of layer.standaloneWalls) {
      const after = seal?.walls.find((x) => x.id === w.id)?.after;
      const start = touched.get(w.id);
      if (after) w.points = after.map((p) => [...p] as [number, number]);
      else if (start && JSON.stringify(start) !== JSON.stringify(w.points)) w.points = structuredClone(start);
    }
  });
  return seal;
}

/** Puts a live gesture back to `from`, door and walls, with nothing on the undo stack. */
export function revertDoorwayLive(from: DungeonLayer, doorId: string): void {
  const fromDoor = from.children.find((c) => c.id === doorId) as DoorChild | undefined;
  const start = new Map(from.standaloneWalls.map((w) => [w.id, w.points]));
  useStore.setState((s) => {
    const l = s.layers.find((x) => x.id === from.id);
    if (!l || l.type !== 'dungeon') return;
    const layer = l as DungeonLayer;
    const i = layer.children.findIndex((c) => c.id === doorId);
    if (i >= 0 && fromDoor) layer.children[i] = structuredClone(fromDoor);
    for (const w of layer.standaloneWalls) {
      const p = start.get(w.id);
      if (p && JSON.stringify(p) !== JSON.stringify(w.points)) w.points = structuredClone(p);
    }
  });
}
