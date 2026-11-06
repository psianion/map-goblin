// Looks pinned on a room, an area or a level: what the selection card's Floor and Walls
// sections and the dock's Floors and Walls tabs edit while one of those is selected.
// Every write is one undo step through the look commands; a colour or width drag
// previews in the store off the stack and lands as one step when it ends.
import { useMemo } from 'react';
import { useStore } from '@/store/store';
import {
  areaChain,
  patchLook,
  resolveRoomLook,
  roomChain,
  type LookChain,
  type ResolvedLook,
} from '@dnd/core/src/shared/lookScope';
import { SetAreaLookCommand, SetLevelLookCommand, SetRoomLookCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import type { DungeonLayer, MapBuilderStore, RoomLook } from '@/store/types';
import { soleRoomTarget, type RoomTarget } from './selectionModel';

/** A scope that carries a look, by id: what the commands take. */
export type LookTarget =
  | { kind: 'room'; layerId: string; roomId: string }
  | { kind: 'area'; layerId: string; areaId: string }
  | { kind: 'level'; levelId: string };

export function lookTargetOf(target: RoomTarget | null): LookTarget | null {
  if (!target) return null;
  if (target.kind === 'room') return { kind: 'room', layerId: target.layer.id, roomId: target.room.id };
  if (target.kind === 'area') return { kind: 'area', layerId: target.layer.id, areaId: target.area.id };
  return { kind: 'level', levelId: target.level.id };
}

/** The selected room, area or level as a look target, or null. */
export function selectedLookTarget(state: MapBuilderStore = useStore.getState()): LookTarget | null {
  return lookTargetOf(soleRoomTarget(state, state.selection.selectedIds));
}

/** Same, kept current in a component. */
export function useLookTarget(): LookTarget | null {
  const key = useStore((s) => {
    const t = selectedLookTarget(s);
    return t ? JSON.stringify(t) : '';
  });
  return useMemo(() => (key ? (JSON.parse(key) as LookTarget) : null), [key]);
}

/** The chain a target's look resolves through. A level stands alone: its own look, then the map's. */
export function chainOf(state: MapBuilderStore, target: LookTarget): LookChain | null {
  if (target.kind === 'level') {
    const level = state.levels.find((l) => l.id === target.levelId);
    if (!level) return null;
    // A layer with nothing set, so nothing between the level and the map answers.
    const bare = { id: '', name: '', type: 'dungeon', style: {} } as unknown as DungeonLayer;
    return { map: state.mapSettings, level, layer: bare };
  }
  const layer = state.layers.find((l) => l.id === target.layerId);
  if (!layer || layer.type !== 'dungeon') return null;
  const dungeon = layer as DungeonLayer;
  if (target.kind === 'room') {
    const room = dungeon.rooms?.find((r) => r.id === target.roomId);
    return room ? roomChain(state, dungeon, room) : null;
  }
  const area = dungeon.areas?.find((a) => a.id === target.areaId);
  return area ? areaChain(state, dungeon, area) : null;
}

/** Every key of the target's look, resolved down the chain. */
export function resolvedLookOf(state: MapBuilderStore, target: LookTarget): ResolvedLook | null {
  const chain = chainOf(state, target);
  return chain ? resolveRoomLook(chain) : null;
}

/** The target's own pins (not what it inherits). */
export function ownLook(state: MapBuilderStore, target: LookTarget): RoomLook | undefined {
  if (target.kind === 'level') return state.levels.find((l) => l.id === target.levelId)?.look;
  const layer = state.layers.find((l) => l.id === target.layerId) as DungeonLayer | undefined;
  if (target.kind === 'room') return layer?.rooms?.find((r) => r.id === target.roomId)?.look;
  return layer?.areas?.find((a) => a.id === target.areaId)?.look;
}

/** A name for the target in a tip or a toast. */
export function targetName(state: MapBuilderStore, target: LookTarget): string {
  if (target.kind === 'level') return state.levels.find((l) => l.id === target.levelId)?.name || 'this level';
  const layer = state.layers.find((l) => l.id === target.layerId) as DungeonLayer | undefined;
  if (target.kind === 'room') return layer?.rooms?.find((r) => r.id === target.roomId)?.name || 'this room';
  return layer?.areas?.find((a) => a.id === target.areaId)?.name || 'this area';
}

/** Pin (a value) or reset (undefined) look keys on the target, as one undo step. */
export function setLook(target: LookTarget, patch: Partial<RoomLook>): void {
  if (Object.keys(patch).length === 0) return;
  if (target.kind === 'room') undoManager.execute(new SetRoomLookCommand(target.layerId, target.roomId, patch));
  else if (target.kind === 'area') undoManager.execute(new SetAreaLookCommand(target.layerId, target.areaId, patch));
  else undoManager.execute(new SetLevelLookCommand(target.levelId, patch));
}

/** Write a look straight into the store, off the undo stack: a gesture's preview, or its rewind. */
function writeLook(target: LookTarget, look: RoomLook | undefined): void {
  if (target.kind === 'level') {
    useStore.getState().updateLevel(target.levelId, { look });
    return;
  }
  useStore.setState((s) => {
    const layer = s.layers.find((l) => l.id === target.layerId);
    if (!layer || layer.type !== 'dungeon') return;
    const owner =
      target.kind === 'room'
        ? layer.rooms?.find((r) => r.id === target.roomId)
        : layer.areas?.find((a) => a.id === target.areaId);
    if (!owner) return;
    if (look) owner.look = structuredClone(look);
    else delete owner.look;
  });
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * A drag on a look control (a colour picker, a width slider): `preview` repaints live
 * off the undo stack; `commit` rewinds the preview and lands what it reached as one
 * look command, so undo returns to where the drag started.
 */
export function lookGesture(target: LookTarget) {
  let before: RoomLook | undefined | null = null;
  let patch: Partial<RoomLook> = {};
  return {
    preview(next: Partial<RoomLook>): void {
      if (before === null) before = structuredClone(ownLook(useStore.getState(), target));
      patch = { ...patch, ...next };
      writeLook(target, patchLook(before, patch));
    },
    commit(): void {
      if (before === null) return;
      const start = before;
      const reached = patch;
      before = null;
      patch = {};
      writeLook(target, start);
      if (!sameJson(patchLook(start, reached), start)) setLook(target, reached);
    },
  };
}

export type { RoomTarget };
