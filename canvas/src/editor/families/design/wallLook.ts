// The wall look the Wall tool's dock edits: the picked room's, area's or level's when one
// is picked, else the active layer's. Pure reads plus one-step writes, shared by the Width
// setting and the Look column's tint.

import { LayerWallLookCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import type { MapBuilderStore, RoomLook } from '@/store/types';
import type { EditorState } from '@/editor/registry/types';
import { resolvedLookOf, selectedLookTarget, setLook } from '@/editor/models/roomLook';
import { activeDungeonLayer } from './layerStyle';

type WallKey = 'wallWidth' | 'wallTextureTint' | 'wallTextureSetId';

/** What the dock shows for a wall key: the picked scope's resolved look, else the layer's style. */
export function wallLookValue<K extends WallKey>(state: EditorState, key: K): RoomLook[K] | undefined {
  const store = state as MapBuilderStore;
  const target = selectedLookTarget(store);
  if (target) return resolvedLookOf(store, target)?.[key];
  return activeDungeonLayer(state)?.style[key] as RoomLook[K] | undefined;
}

/** Writes a wall key on the picked scope, else on the layer and the walls already drawn on it. One undo step. */
export function setWallLook(state: EditorState, patch: Partial<Pick<RoomLook, WallKey>>, label: string): void {
  const target = selectedLookTarget(state as MapBuilderStore);
  if (target) {
    setLook(target, patch);
    return;
  }
  const layer = activeDungeonLayer(state);
  if (!layer) return;
  const changed = (Object.keys(patch) as WallKey[]).some((k) => layer.style[k] !== patch[k]);
  if (changed) undoManager.execute(new LayerWallLookCommand(label, layer.id, patch));
}

/** The set value that means "the layer's": the wall pins nothing of its own. */
export const LAYER_SET = 'layer';

/** The set value that means a plain line, no set at all (stored as ''). */
export const NO_SET = 'none';
