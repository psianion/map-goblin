// How the Design cards write: through the core command layer, so undo keeps working.
//
// A card field is handed one value per change. A slider or a colour picker sends many in a
// drag; giving those writes a coalesce key folds the drag into one undo step (the undo
// manager merges commands with the same key that land close together). Discrete controls
// write without a key, one step per change.

import { useStore } from '@/store/store';
import { selectLayerForChild, selectWallById } from '@/store/selectors';
import { UpdateChildCommand, UpdateWallCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import type { AnyChild, Command, WallSegment } from '@/store/types';
import { blockedLayerReason } from '@dnd/core/src/engine/tools/layerGuard';
import { notify } from '@dnd/ui/toast';

/**
 * Commands run as one undo step. With a key, a later CardEdit with the same key appends
 * its commands, and undo runs them all backwards, so any command can be folded in.
 */
export class CardEdit implements Command {
  readonly label: string;
  readonly coalesceKey?: string;
  readonly affectsRooms: boolean;
  private readonly cmds: Command[];

  constructor(label: string, cmds: Command[], coalesceKey?: string) {
    this.label = label;
    this.coalesceKey = coalesceKey;
    this.cmds = [...cmds];
    this.affectsRooms = cmds.some((c) => c.affectsRooms);
  }

  execute(): void {
    for (const c of this.cmds) c.execute();
  }

  undo(): void {
    for (let i = this.cmds.length - 1; i >= 0; i--) this.cmds[i].undo();
  }

  merge(next: Command): boolean {
    if (!(next instanceof CardEdit) || next.coalesceKey === undefined || next.coalesceKey !== this.coalesceKey) return false;
    this.cmds.push(...next.cmds);
    return true;
  }
}

/** Runs `cmds` as one step; `coalesce` names the field so a drag folds into one entry. */
export function runEdit(label: string, cmds: Command[], coalesce?: string): void {
  if (cmds.length === 0) return;
  undoManager.execute(new CardEdit(label, cmds, coalesce));
}

/** A key per field and picked set, so a drag on one field never folds into another's. */
export const editKey = (field: string, ids: readonly string[]) => `card:${field}:${[...ids].sort().join(',')}`;

type Patch = Record<string, unknown>;

/**
 * Patches each picked child (`patch` may return null to leave one alone) as one step. A
 * child on a locked layer is left alone, with the reason said once.
 */
export function editChildren(
  label: string,
  ids: readonly string[],
  patch: (child: AnyChild) => Patch | null,
  coalesce?: string,
): void {
  const state = useStore.getState();
  const cmds: Command[] = [];
  let blocked: string | null = null;
  for (const id of ids) {
    const layer = selectLayerForChild(state, id);
    const child = layer?.children.find((c) => c.id === id);
    if (!layer || !child) continue;
    const after = patch(child);
    if (!after) continue;
    const reason = blockedLayerReason(layer);
    if (reason) {
      blocked = reason;
      continue;
    }
    const before: Patch = {};
    for (const k of Object.keys(after)) before[k] = (child as unknown as Patch)[k];
    if (Object.keys(after).every((k) => Object.is(before[k], after[k]))) continue;
    cmds.push(new UpdateChildCommand(label, layer.id, id, before as Partial<AnyChild>, after as Partial<AnyChild>));
  }
  if (blocked && cmds.length === 0) notify.warning(blocked);
  runEdit(label, cmds, coalesce);
}

/** The same for drawn walls. */
export function editWalls(
  label: string,
  ids: readonly string[],
  patch: (wall: WallSegment) => Partial<WallSegment> | null,
  coalesce?: string,
): void {
  const state = useStore.getState();
  const cmds: Command[] = [];
  let blocked: string | null = null;
  for (const id of ids) {
    const found = selectWallById(state, id);
    if (!found) continue;
    const after = patch(found.wall);
    if (!after) continue;
    const reason = blockedLayerReason(found.layer);
    if (reason) {
      blocked = reason;
      continue;
    }
    const before: Partial<WallSegment> = {};
    for (const k of Object.keys(after) as (keyof WallSegment)[]) (before as Patch)[k] = found.wall[k];
    if ((Object.keys(after) as (keyof WallSegment)[]).every((k) => Object.is(before[k], after[k]))) continue;
    cmds.push(new UpdateWallCommand(found.layer.id, id, before, after));
  }
  if (blocked && cmds.length === 0) notify.warning(blocked);
  runEdit(label, cmds, coalesce);
}
