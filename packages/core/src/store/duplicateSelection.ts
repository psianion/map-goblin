// Copies of a whole selection, walls included: Ctrl+D, Alt+drag, Paste and the menus.
//
// Children go through `createDuplicateCommand` (the one duplicate path: fresh ids,
// " (copy)" names, groups, attached lights). Drawn walls are copied here under new ids
// with the doors that hang on them, re-bound to the copy. A door on its own is never
// copied: it lives on its wall, and a copy would hang on nothing. Rooms are places, not
// things, and stay where they are. Locked members are copied unlocked.

import type { AnyChild, Command, DoorChild, DungeonLayer, Layer, WallSegment } from './types';
import { AddChildCommand, AddWallCommand, CompositeCommand } from './commands';
import { createDuplicateCommand } from './propEdits';
import { resolveSelection } from './selectionResolve';
import { copyWall, doorsOnWall, type Pt } from '../shared/wallTransform';

/** A wall on the clipboard: the wall and the doors that hang on it, as they were. */
export interface ClipboardWall {
  wall: WallSegment;
  doors: DoorChild[];
}

export interface SelectionDuplicate {
  command: Command | null;
  /** The copies' ids, children then walls, for the selection. */
  newIds: string[];
  /** Selected doors left out because their wall was not in the selection. */
  doorsSkipped: number;
  /** Selected rooms left out. */
  roomsSkipped: number;
}

/** The message a refused door copy gives. */
export const DOOR_COPY_MESSAGE = 'Doors stay on their wall. Draw one with D.';

/** Commands adding copies of `walls` (and their doors) to `targetLayerId`, offset by (dx, dy). */
export function wallCopyCommands(
  label: string,
  walls: readonly ClipboardWall[],
  targetLayerId: string,
  dx: number,
  dy: number,
): { commands: Command[]; newIds: string[] } {
  const commands: Command[] = [];
  const newIds: string[] = [];
  const shift = ([x, y]: Pt): Pt => [x + dx, y + dy];
  for (const { wall, doors } of walls) {
    const id = crypto.randomUUID();
    commands.push(new AddWallCommand(label, targetLayerId, copyWall(wall, id, shift)));
    newIds.push(id);
    for (const door of doors) {
      const copy = structuredClone(door) as DoorChild;
      copy.id = crypto.randomUUID();
      copy.name = `${door.name} (copy)`;
      copy.wallId = id;
      copy.position = shift(door.position);
      delete copy.locked;
      delete copy.groupId;
      delete copy.roomA;
      delete copy.roomB;
      commands.push(new AddChildCommand(label, targetLayerId, copy as AnyChild));
    }
  }
  return { commands, newIds };
}

/** The walls in `ids` with their doors, ready for the clipboard (cloned). */
export function clipboardWalls(state: { layers: readonly Layer[] }, ids: readonly string[]): ClipboardWall[] {
  return resolveSelection(state, ids).walls.map(({ wall, layer }) => ({
    wall: structuredClone(wall),
    doors: doorsOnWall(layer, wall.id).map((d) => structuredClone(d)),
  }));
}

/**
 * Duplicates the selection `ids` as one undo entry: children in their own layers (or
 * `targetLayerId`), walls with their doors in their own layers, offset by `offset`
 * (default one square right and down).
 */
export function createDuplicateSelectionCommand(
  layers: readonly Layer[],
  ids: readonly string[],
  opts: { offset?: { x: number; y: number }; label?: string } = {},
): SelectionDuplicate {
  const label = opts.label ?? 'Duplicate';
  const dx = opts.offset?.x ?? 1;
  const dy = opts.offset?.y ?? 1;
  const sel = resolveSelection({ layers }, ids);
  const wallIds = new Set(sel.walls.map((w) => w.wall.id));
  const childIds: string[] = [];
  let doorsSkipped = 0;
  for (const { child } of sel.children) {
    if (child.childType === 'door') {
      // A door with its wall comes along with the wall's copy; alone it stays.
      if (!wallIds.has(child.wallId)) doorsSkipped++;
      continue;
    }
    childIds.push(child.id);
  }
  const cmds: Command[] = [];
  const newIds: string[] = [];
  if (childIds.length > 0) {
    const dup = createDuplicateCommand(layers, childIds, { offset: { x: dx, y: dy }, label });
    if (dup.command) {
      cmds.push(dup.command);
      newIds.push(...dup.newIds);
    }
  }
  const byLayer = new Map<string, ClipboardWall[]>();
  for (const { wall, layer } of sel.walls) {
    const list = byLayer.get(layer.id) ?? [];
    list.push({ wall, doors: doorsOnWall(layer as DungeonLayer, wall.id) });
    byLayer.set(layer.id, list);
  }
  for (const [layerId, walls] of byLayer) {
    const w = wallCopyCommands(label, walls, layerId, dx, dy);
    cmds.push(...w.commands);
    newIds.push(...w.newIds);
  }
  return {
    command: cmds.length === 0 ? null : cmds.length === 1 ? cmds[0] : new CompositeCommand(label, cmds),
    newIds,
    doorsSkipped,
    roomsSkipped: sel.rooms.length,
  };
}
