import { useStore } from '../../store/store';
import { notify } from '../../shared/notify';
import type { DungeonLayer } from '../../store/types';

/**
 * Null when `layer` may be edited; otherwise the warning that belongs to why
 * not. Shared by every write path that already holds a resolved layer (a
 * delete, mostly) so a lock or hide applied after the layer was picked up
 * still gets caught right before the mutation.
 */
export function blockedLayerReason(layer: DungeonLayer | null | undefined): string | null {
  if (!layer) return 'Layer was removed';
  if (layer.locked) return 'Layer is locked';
  if (!layer.visible) return 'Layer is hidden';
  return null;
}

/**
 * Resolves `layerId` to an editable dungeon layer — existing, type
 * 'dungeon', unlocked, visible — warning and returning null otherwise.
 *
 * For a chain tool (wall/polygon/path/water) this is called at *finalize*
 * against the layer id captured when the chain started, not the current
 * active layer: the active layer can be locked, hidden, or switched away
 * from mid-chain, and the commit has to answer for the layer the chain was
 * actually drawn on.
 */
export function resolveEditableLayer(
  layerId: string | null | undefined,
  missingMessage = 'Layer was removed',
): DungeonLayer | null {
  const layer = useStore.getState().layers.find(
    (l): l is DungeonLayer => l.id === layerId && l.type === 'dungeon',
  );
  const reason = layer ? blockedLayerReason(layer) : missingMessage;
  if (reason) {
    notify.warning(reason);
    return null;
  }
  return layer!;
}
